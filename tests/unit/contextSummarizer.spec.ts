/**
 * Context Summarizer Unit Tests
 *
 * Tests chunking logic, caching behavior, redaction integration,
 * cost tracking, and summarization workflows.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  chunkFile,
  generateChunkId,
  summarizeDocument,
  summarizeMultiple,
  type SummarizerClient,
  type SummaryResponse,
  type SummarizerConfig,
} from '../../src/workflows/contextSummarizer';
import {
  createContextDocument,
  type ContextDocument,
} from '../../src/core/models/ContextDocument';
import { RedactionEngine, createLogger } from '../../src/telemetry/logger';
import { createMetricsCollector } from '../../src/telemetry/metrics';
import { estimateTokens } from '../../src/workflows/contextRanking';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Stub summarizer client for testing
 */
class StubSummarizerClient implements SummarizerClient {
  private callCount = 0;
  private shouldFail = false;

  summarizeChunk(
    text: string,
    options?: { streaming?: boolean; context?: string }
  ): Promise<SummaryResponse> {
    this.callCount++;

    if (this.shouldFail) {
      return Promise.reject(new Error('Simulated provider failure'));
    }

    // Simulate summarization with truncation
    const summary = `Summary of chunk: ${text.substring(0, 100)}... (${options?.context ?? 'no context'})`;
    const promptTokens = estimateTokens(Buffer.byteLength(text, 'utf-8'));
    const completionTokens = estimateTokens(Buffer.byteLength(summary, 'utf-8'));

    return Promise.resolve({
      summary,
      promptTokens,
      completionTokens,
      model: 'stub-summarizer-v1',
      redactionFlags: [],
    });
  }

  getProviderId(): string {
    return 'stub';
  }

  getCallCount(): number {
    return this.callCount;
  }

  setFailureMode(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  reset(): void {
    this.callCount = 0;
    this.shouldFail = false;
  }
}

/**
 * Create a temporary test directory
 */
async function createTempDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-summarizer-test-'));
  return tmpDir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Chunking Tests
// ============================================================================

describe('contextSummarizer - chunking', () => {
  it('should chunk file based on token limits', () => {
    const content = 'a'.repeat(20000); // 20000 characters = ~5000 tokens
    const chunks = chunkFile(content, 2000); // 2000 token limit

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => {
      expect(chunk.tokenCount).toBeLessThanOrEqual(2000 * 1.1); // Allow 10% overage for line boundaries
    });
  });

  it('should preserve line boundaries when chunking', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    const content = lines.join('\n');
    const chunks = chunkFile(content, 100); // Small chunk size

    // Each chunk should end with a newline (except possibly the last)
    chunks.forEach((chunk, index) => {
      if (index < chunks.length - 1) {
        const lastChar = chunk.content[chunk.content.length - 1];
        expect(lastChar).toBe('\n');
      }
    });
  });

  it('should apply overlap between chunks', () => {
    const content = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}\n`).join('');
    const chunks = chunkFile(content, 20, 20); // 20% overlap with small chunk size

    expect(chunks.length).toBeGreaterThan(1);

    // Check that chunks have sequential indices
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.total).toBe(chunks.length);
    });
  });

  it('should handle empty content', () => {
    const chunks = chunkFile('', 1000);
    expect(chunks).toEqual([]);
  });

  it('should handle single small file without chunking', () => {
    const content = 'Small file content';
    const chunks = chunkFile(content, 4000);

    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].total).toBe(1);
  });

  it('should update total count for all chunks', () => {
    const content = 'a'.repeat(40000);
    const chunks = chunkFile(content, 2000);

    const expectedTotal = chunks.length;
    chunks.forEach(chunk => {
      expect(chunk.total).toBe(expectedTotal);
    });
  });
});

// ============================================================================
// Cache ID Generation Tests
// ============================================================================

describe('contextSummarizer - cache ID generation', () => {
  it('should generate consistent chunk IDs', () => {
    const path = 'src/test.ts';
    const sha = 'abcdef1234567890';
    const index = 0;

    const id1 = generateChunkId(path, sha, index);
    const id2 = generateChunkId(path, sha, index);

    expect(id1).toBe(id2);
  });

  it('should generate different IDs for different files', () => {
    const sha = 'abcdef1234567890';
    const index = 0;

    const id1 = generateChunkId('src/file1.ts', sha, index);
    const id2 = generateChunkId('src/file2.ts', sha, index);

    expect(id1).not.toBe(id2);
  });

  it('should generate different IDs for different SHAs', () => {
    const path = 'src/test.ts';
    const index = 0;

    const id1 = generateChunkId(path, 'sha1', index);
    const id2 = generateChunkId(path, 'sha2', index);

    expect(id1).not.toBe(id2);
  });

  it('should generate different IDs for different chunk indices', () => {
    const path = 'src/test.ts';
    const sha = 'abcdef1234567890';

    const id1 = generateChunkId(path, sha, 0);
    const id2 = generateChunkId(path, sha, 1);

    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// Summarization Tests
// ============================================================================

describe('contextSummarizer - summarization', () => {
  let tmpDir: string;
  let runDir: string;
  let repoRoot: string;
  let client: StubSummarizerClient;
  let config: SummarizerConfig;
  let logger: ReturnType<typeof createLogger>;
  let redactor: RedactionEngine;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    runDir = path.join(tmpDir, 'run');
    repoRoot = path.join(tmpDir, 'repo');

    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });

    client = new StubSummarizerClient();
    logger = createLogger({
      component: 'test-summarizer',
      runDir,
      runId: 'test-run-id',
    });
    redactor = new RedactionEngine(true);

    config = {
      repoRoot,
      runDir,
      featureId: 'test-feature-id',
      maxTokensPerChunk: 1000,
      chunkOverlapPercent: 10,
      enableSummarization: true,
      forceFresh: false,
    };
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
  });

  it('should summarize a single small file', async () => {
    // Create test file
    const testFilePath = path.join(repoRoot, 'test.txt');
    const testContent = 'This is a small test file.';
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['test.txt'] = {
      path: 'test.txt',
      hash: 'abc123',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // Summarize
    const result = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result.contextDocument.summaries.length).toBe(1);
    expect(result.chunksGenerated).toBe(1);
    expect(result.chunksCached).toBe(0);
    expect(result.tokensUsed.total).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);

    const summaryEntry = result.contextDocument.summaries[0];
    expect(summaryEntry.chunk_id).toMatch(/^[a-f0-9]{16}$/);
    expect(summaryEntry.file_path).toBe('test.txt');
    expect(summaryEntry.file_sha).toBe('abc123');
    expect(summaryEntry.chunk_total).toBe(1);
    expect(summaryEntry.chunk_index).toBe(0);
    expect(summaryEntry.method).toBe('single_chunk');
    expect(Array.isArray(summaryEntry.redaction_flags)).toBe(true);
  });

  it('should chunk and summarize large files', async () => {
    // Create large test file
    const testFilePath = path.join(repoRoot, 'large.txt');
    const testContent = 'A'.repeat(10000); // Large file requiring chunks
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['large.txt'] = {
      path: 'large.txt',
      hash: 'def456',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // Summarize
    const result = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result.contextDocument.summaries.length).toBeGreaterThan(1);
    expect(result.chunksGenerated).toBeGreaterThan(1);
    expect(result.chunksCached).toBe(0);
  });

  it('should cache and reuse summaries', async () => {
    // Create test file
    const testFilePath = path.join(repoRoot, 'cached.txt');
    const testContent = 'This file will be cached.';
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['cached.txt'] = {
      path: 'cached.txt',
      hash: 'cache123',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // First summarization
    const result1 = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result1.chunksGenerated).toBe(1);
    expect(result1.chunksCached).toBe(0);
    const callsAfterFirst = client.getCallCount();

    // Second summarization (should hit cache)
    const result2 = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result2.chunksGenerated).toBe(0);
    expect(result2.chunksCached).toBe(1);
    expect(result2.tokensUsed.total).toBe(0);
    expect(client.getCallCount()).toBe(callsAfterFirst); // No new API calls
  });

  it('should bypass cache when forceFresh is true', async () => {
    // Create test file
    const testFilePath = path.join(repoRoot, 'forced.txt');
    const testContent = 'This file will be force-refreshed.';
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['forced.txt'] = {
      path: 'forced.txt',
      hash: 'force123',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // First summarization
    await summarizeDocument(contextDoc, client, config, logger, redactor);

    // Reset call count
    client.reset();

    // Second summarization with forceFresh
    const forceFreshConfig = { ...config, forceFresh: true };
    const result = await summarizeDocument(
      contextDoc,
      client,
      forceFreshConfig,
      logger,
      redactor
    );

    expect(result.chunksGenerated).toBe(1);
    expect(result.chunksCached).toBe(0);
    expect(client.getCallCount()).toBe(1); // API called again
  });

  it('should handle provider failures gracefully', async () => {
    // Create test file
    const testFilePath = path.join(repoRoot, 'failing.txt');
    const testContent = 'This will fail to summarize.';
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['failing.txt'] = {
      path: 'failing.txt',
      hash: 'fail123',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // Enable failure mode
    client.setFailureMode(true);

    // Summarize
    const result = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result.chunksGenerated).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Failed to summarize');
  });

  it('should record token usage correctly', async () => {
    // Create test file
    const testFilePath = path.join(repoRoot, 'tokens.txt');
    const testContent = 'Test token counting.';
    await fs.writeFile(testFilePath, testContent, 'utf-8');

    // Create context document
    const contextDoc = createContextDocument('test-feature-id', 'manual');
    contextDoc.files['tokens.txt'] = {
      path: 'tokens.txt',
      hash: 'token123',
      size: Buffer.byteLength(testContent, 'utf-8'),
      file_type: 'txt',
      token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
    };

    // Summarize
    const result = await summarizeDocument(
      contextDoc,
      client,
      config,
      logger,
      redactor
    );

    expect(result.tokensUsed.prompt).toBeGreaterThan(0);
    expect(result.tokensUsed.completion).toBeGreaterThan(0);
    expect(result.tokensUsed.total).toBe(
      result.tokensUsed.prompt + result.tokensUsed.completion
    );
  });
});

// ============================================================================
// Batch Summarization Tests
// ============================================================================

describe('contextSummarizer - batch summarization', () => {
  let tmpDir: string;
  let runDir: string;
  let repoRoot: string;
  let client: StubSummarizerClient;
  let config: SummarizerConfig;
  let logger: ReturnType<typeof createLogger>;
  let metrics: ReturnType<typeof createMetricsCollector>;
  let redactor: RedactionEngine;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    runDir = path.join(tmpDir, 'run');
    repoRoot = path.join(tmpDir, 'repo');

    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });

    client = new StubSummarizerClient();
    logger = createLogger({
      component: 'test-batch-summarizer',
      runDir,
      runId: 'test-batch-run-id',
    });
    metrics = createMetricsCollector({ runDir });
    redactor = new RedactionEngine(true);

    config = {
      repoRoot,
      runDir,
      featureId: 'test-feature-id',
      maxTokensPerChunk: 1000,
      chunkOverlapPercent: 10,
      enableSummarization: true,
      forceFresh: false,
    };
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
  });

  it('should summarize multiple documents', async () => {
    // Create test files
    const files = ['file1.txt', 'file2.txt', 'file3.txt'];
    const contextDocs: ContextDocument[] = [];

    for (const fileName of files) {
      const testFilePath = path.join(repoRoot, fileName);
      const testContent = `Content of ${fileName}`;
      await fs.writeFile(testFilePath, testContent, 'utf-8');

      const contextDoc = createContextDocument(`feature-${fileName}`, 'manual');
      contextDoc.files[fileName] = {
        path: fileName,
        hash: `hash-${fileName}`,
        size: Buffer.byteLength(testContent, 'utf-8'),
        file_type: 'txt',
        token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
      };
      contextDocs.push(contextDoc);
    }

    // Batch summarize
    const result = await summarizeMultiple(
      contextDocs,
      client,
      config,
      logger,
      metrics,
      redactor
    );

    expect(result.documents.length).toBe(3);
    expect(result.totalChunksGenerated).toBe(3);
    expect(result.totalChunksCached).toBe(0);
    expect(result.totalTokensUsed.total).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('should handle partial failures in batch', async () => {
    // Create test files
    const contextDocs: ContextDocument[] = [];

    for (let i = 0; i < 3; i++) {
      const fileName = `file${i}.txt`;
      const testFilePath = path.join(repoRoot, fileName);
      const testContent = `Content of file ${i}`;

      // Only create file for first two (third will fail to read)
      if (i < 2) {
        await fs.writeFile(testFilePath, testContent, 'utf-8');
      }

      const contextDoc = createContextDocument(`feature-${i}`, 'manual');
      contextDoc.files[fileName] = {
        path: fileName,
        hash: `hash-${i}`,
        size: Buffer.byteLength(testContent, 'utf-8'),
        file_type: 'txt',
        token_count: estimateTokens(Buffer.byteLength(testContent, 'utf-8')),
      };
      contextDocs.push(contextDoc);
    }

    // Batch summarize
    const result = await summarizeMultiple(
      contextDocs,
      client,
      config,
      logger,
      metrics,
      redactor
    );

    expect(result.documents.length).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('Failed to read'))).toBe(true);
  });
});

// ============================================================================
// Redaction Integration Tests
// ============================================================================

describe('contextSummarizer - redaction', () => {
  it('should redact secrets from summaries', () => {
    const redactor = new RedactionEngine(true);

    const summary = 'API key: [example-github-token]';
    const redacted = redactor.redact(summary);

    expect(redacted).not.toContain('ghp_');
    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('should handle multiple redaction patterns', () => {
    const redactor = new RedactionEngine(true);

    const summary = 'Token: [example-github-token], JWT: [example-jwt]';
    const redacted = redactor.redact(summary);

    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(redacted).toContain('[REDACTED_JWT]');
  });
});
