/**
 * Context Summarizer
 *
 * Chunks large repository files, feeds them to configured agent providers
 * for summarization, stores compressed summaries with metadata, and records
 * token costs and redaction flags to telemetry.
 *
 * Key features:
 * - Token-based chunking with semantic boundary preservation
 * - Incremental caching based on file SHA hashes
 * - Provider-agnostic summarization client interface
 * - Secret redaction integration
 * - Cost and token telemetry tracking
 * - CLI commands for re-summarization and status viewing
 *
 * Implements FR-8, NFR-3, Section 4 (Directives).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import type { ContextDocument, ContextSummary } from '../core/models/ContextDocument';
import { estimateTokens } from './contextRanking';
import { RedactionEngine, type StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import { getSubdirectoryPath } from '../persistence';
import type { CostTracker } from '../telemetry/costTracker';
import { isFileNotFound } from '../utils/safeJson.js';
import { validateOrResult, validateOrThrow } from '../validation/helpers.js';

// ============================================================================
// Types
// ============================================================================

/**
 * File chunk for summarization
 */
export interface FileChunk {
  /** Chunk content */
  content: string;
  /** Chunk index (0-based) */
  index: number;
  /** Total number of chunks for this file */
  total: number;
  /** Estimated token count for chunk */
  tokenCount: number;
  /** Start byte offset in original file */
  startOffset: number;
  /** End byte offset in original file */
  endOffset: number;
}

/**
 * Summary response from provider
 */
export interface SummaryResponse {
  /** Summary text */
  summary: string;
  /** Prompt tokens used */
  promptTokens: number;
  /** Completion tokens used */
  completionTokens: number;
  /** Model identifier */
  model?: string;
  /** Redaction flags applied */
  redactionFlags?: string[];
}

/**
 * Summarizer client interface (provider-agnostic)
 */
export interface SummarizerClient {
  /**
   * Summarize a chunk of text
   * @param text - Text to summarize
   * @param options - Summarization options
   */
  summarizeChunk(
    text: string,
    options?: { streaming?: boolean; context?: string }
  ): Promise<SummaryResponse>;

  /**
   * Get provider identifier
   */
  getProviderId(): string;
}

/**
 * Chunk metadata stored for caching
 */
export interface ChunkMetadata {
  /** Chunk ID (hash-based) */
  chunkId: string;
  /** Source file path */
  path: string;
  /** Source file SHA-256 hash */
  fileSha: string;
  /** Chunk index */
  chunkIndex: number;
  /** Chunk total count */
  chunkTotal: number;
  /** Summary text */
  summary: string;
  /** Token counts */
  tokenCount: {
    prompt: number;
    completion: number;
  };
  /** Generation timestamp */
  generatedAt: string;
  /** Provider/model used */
  generatedBy: string;
  /** Summarization method */
  summarizationMethod: string;
  /** Redaction flags */
  redactionFlags: string[];
}

const ChunkMetadataSchema = z.object({
  chunkId: z.string(),
  path: z.string(),
  fileSha: z.string(),
  chunkIndex: z.number().nonnegative(),
  chunkTotal: z.number().positive(),
  summary: z.string(),
  tokenCount: z.object({
    prompt: z.number().nonnegative(),
    completion: z.number().nonnegative(),
  }),
  generatedAt: z.string(),
  generatedBy: z.string(),
  summarizationMethod: z.string(),
  redactionFlags: z.array(z.string()),
});

/**
 * Convert chunk metadata to ContextSummary entry
 */
function toContextSummary(metadata: ChunkMetadata): ContextSummary {
  return {
    chunk_id: metadata.chunkId,
    file_path: metadata.path,
    file_sha: metadata.fileSha,
    chunk_index: metadata.chunkIndex,
    chunk_total: metadata.chunkTotal,
    summary: metadata.summary,
    token_count: metadata.tokenCount.prompt + metadata.tokenCount.completion,
    generated_at: metadata.generatedAt,
    generated_by: metadata.generatedBy,
    method: metadata.summarizationMethod,
    redaction_flags: metadata.redactionFlags,
  };
}

/**
 * Summarization configuration
 */
export interface SummarizerConfig {
  /** Repository root directory */
  repoRoot: string;
  /** Run directory path */
  runDir: string;
  /** Feature ID */
  featureId: string;
  /** Maximum tokens per chunk (default: 4000) */
  maxTokensPerChunk?: number;
  /** Chunk overlap percentage (default: 10) */
  chunkOverlapPercent?: number;
  /** Token budget limit */
  tokenBudget?: number;
  /** Enable summarization */
  enableSummarization?: boolean;
  /** Force re-summarize (ignore cache) */
  forceFresh?: boolean;
}

/**
 * Summarization result for a single document
 */
export interface SummarizationResult {
  /** Context document with summaries */
  contextDocument: ContextDocument;
  /** Chunks generated */
  chunksGenerated: number;
  /** Chunks cached (reused) */
  chunksCached: number;
  /** Total tokens used */
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Warnings */
  warnings: string[];
}

/**
 * Batch summarization result
 */
export interface BatchSummarizationResult {
  /** Summarized documents */
  documents: ContextDocument[];
  /** Total chunks generated */
  totalChunksGenerated: number;
  /** Total chunks cached */
  totalChunksCached: number;
  /** Total tokens used */
  totalTokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Warnings */
  warnings: string[];
  /** Errors */
  errors: string[];
}

// ============================================================================
// Chunking Logic
// ============================================================================

/**
 * Chunk a file into token-budget-sized pieces with overlap
 *
 * @param content - File content
 * @param maxTokens - Maximum tokens per chunk
 * @param overlapPercent - Overlap percentage (0-100)
 * @returns Array of chunks
 */
function chunkByFixedWidth(content: string, maxChars: number): FileChunk[] {
  const chunks: FileChunk[] = [];
  let cursor = 0;
  let byteOffset = 0;

  while (cursor < content.length) {
    const slice = content.slice(cursor, cursor + maxChars);
    const sliceBytes = Buffer.byteLength(slice, 'utf-8');
    const tokenCount = estimateTokens(sliceBytes);

    chunks.push({
      content: slice,
      index: chunks.length,
      total: 0,
      tokenCount,
      startOffset: byteOffset,
      endOffset: byteOffset + sliceBytes,
    });

    cursor += maxChars;
    byteOffset += sliceBytes;
  }

  const total = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total = total;
  });

  return chunks;
}

export function chunkFile(
  content: string,
  maxTokens: number = 4000,
  overlapPercent: number = 10
): FileChunk[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const chunks: FileChunk[] = [];

  // Estimate characters per token (heuristic: ~4 chars/token)
  const charsPerToken = 4;
  const maxCharsPerChunk = maxTokens * charsPerToken;
  const overlapChars = Math.floor(maxCharsPerChunk * (overlapPercent / 100));

  // Split content into lines for semantic boundary preservation
  const lines = content.split('\n');

  if (!content.includes('\n') && Buffer.byteLength(content, 'utf-8') > maxCharsPerChunk) {
    return chunkByFixedWidth(content, maxCharsPerChunk);
  }

  let currentChunk = '';
  let currentStartOffset = 0;
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWithNewline = i < lines.length - 1 ? `${line}\n` : line;

    // Check if adding this line would exceed chunk size
    if (
      currentChunk.length > 0 &&
      currentChunk.length + lineWithNewline.length > maxCharsPerChunk
    ) {
      // Finalize current chunk
      const tokenCount = estimateTokens(Buffer.byteLength(currentChunk, 'utf-8'));
      chunks.push({
        content: currentChunk,
        index: chunks.length,
        total: 0, // Will update after all chunks are created
        tokenCount,
        startOffset: currentStartOffset,
        endOffset: lineOffset,
      });

      // Start new chunk with overlap
      const overlapStartIndex = Math.max(0, i - Math.floor(overlapChars / 50)); // ~50 chars per line
      currentChunk = lines.slice(overlapStartIndex, i + 1).join('\n');
      if (overlapStartIndex < i) {
        currentChunk += '\n';
      }
      currentStartOffset =
        lineOffset - Buffer.byteLength(lines.slice(overlapStartIndex, i).join('\n'), 'utf-8');
    } else {
      currentChunk += lineWithNewline;
    }

    lineOffset += Buffer.byteLength(lineWithNewline, 'utf-8');
  }

  // Add final chunk if any content remains
  if (currentChunk.trim().length > 0) {
    const tokenCount = estimateTokens(Buffer.byteLength(currentChunk, 'utf-8'));
    chunks.push({
      content: currentChunk,
      index: chunks.length,
      total: 0,
      tokenCount,
      startOffset: currentStartOffset,
      endOffset: lineOffset,
    });
  }

  // Update total count for all chunks
  const totalChunks = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total = totalChunks;
  });

  return chunks;
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Generate chunk ID from file path, SHA, and chunk index
 *
 * @param path - File path
 * @param fileSha - File SHA hash
 * @param chunkIndex - Chunk index
 * @returns Chunk ID
 */
export function generateChunkId(path: string, fileSha: string, chunkIndex: number): string {
  const input = `${path}:${fileSha}:${chunkIndex}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Load cached chunk metadata
 *
 * @param contextDir - Context directory path
 * @param chunkId - Chunk ID
 * @returns Chunk metadata or null if not found
 */
async function loadCachedChunk(contextDir: string, chunkId: string): Promise<ChunkMetadata | null> {
  const chunkPath = path.join(contextDir, 'docs', `${chunkId}.json`);

  try {
    const content = await fs.readFile(chunkPath, 'utf-8');
    const result = validateOrResult(ChunkMetadataSchema, JSON.parse(content), 'chunk metadata');
    return result.success ? result.data : null;
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Save chunk metadata to cache
 *
 * @param contextDir - Context directory path
 * @param metadata - Chunk metadata
 */
async function saveCachedChunk(contextDir: string, metadata: ChunkMetadata): Promise<void> {
  const docsDir = path.join(contextDir, 'docs');
  await fs.mkdir(docsDir, { recursive: true });

  const chunkPath = path.join(docsDir, `${metadata.chunkId}.json`);
  await fs.writeFile(chunkPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

// ============================================================================
// Summarization Orchestrator
// ============================================================================

/**
 * Summarize a single document with chunking and caching
 *
 * @param contextDoc - Context document to summarize
 * @param client - Summarizer client
 * @param config - Summarizer configuration
 * @param logger - Structured logger
 * @param redactor - Redaction engine
 * @returns Summarization result
 */
export async function summarizeDocument(
  contextDoc: ContextDocument,
  client: SummarizerClient,
  config: SummarizerConfig,
  logger: StructuredLogger,
  redactor: RedactionEngine,
  costTracker?: CostTracker
): Promise<SummarizationResult> {
  const warnings: string[] = [];
  const contextDir = getSubdirectoryPath(config.runDir, 'context');

  const maxTokensPerChunk = config.maxTokensPerChunk ?? 4000;
  const overlapPercent = config.chunkOverlapPercent ?? 10;

  let chunksGenerated = 0;
  let chunksCached = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  const summaries: ContextSummary[] = [];

  // Process each file in the context document
  for (const [relativePath, fileRecord] of Object.entries(contextDoc.files)) {
    const fullPath = path.join(config.repoRoot, relativePath);

    logger.info('Processing file for summarization', {
      path: relativePath,
      hash: fileRecord.hash,
      size: fileRecord.size,
    });

    // Read file content
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      warnings.push(`Failed to read file ${relativePath}: ${String(error)}`);
      continue;
    }

    // Estimate tokens
    const estimatedTokenCount = estimateTokens(fileRecord.size);

    // Check if chunking is needed
    if (estimatedTokenCount <= maxTokensPerChunk) {
      // Single chunk, summarize directly
      const chunkId = generateChunkId(relativePath, fileRecord.hash, 0);

      // Check cache first
      let cached: ChunkMetadata | null = null;
      if (!config.forceFresh) {
        cached = await loadCachedChunk(contextDir, chunkId);
      }

      if (cached && cached.fileSha === fileRecord.hash) {
        logger.debug('Using cached summary', { chunkId, path: relativePath });
        summaries.push(toContextSummary(cached));
        chunksCached++;
      } else {
        // Generate new summary
        logger.info('Generating summary', { path: relativePath, chunkId });

        try {
          const response = await client.summarizeChunk(content);

          // Redact summary
          const redactionResult = redactor.redactWithReport(response.summary);
          const redactionFlags = Array.from(
            new Set([...(response.redactionFlags ?? []), ...redactionResult.flags])
          );
          const generatedAt = new Date().toISOString();
          const providerId = response.model ?? client.getProviderId();

          const metadata: ChunkMetadata = {
            chunkId,
            path: relativePath,
            fileSha: fileRecord.hash,
            chunkIndex: 0,
            chunkTotal: 1,
            summary: redactionResult.text,
            tokenCount: {
              prompt: response.promptTokens,
              completion: response.completionTokens,
            },
            generatedAt,
            generatedBy: providerId,
            summarizationMethod: 'single_chunk',
            redactionFlags,
          };

          // Store summary
          summaries.push(toContextSummary(metadata));

          await saveCachedChunk(contextDir, metadata);
          chunksGenerated++;
          promptTokens += response.promptTokens;
          completionTokens += response.completionTokens;
          await costTracker?.recordUsage(
            providerId,
            'summarize',
            response.promptTokens,
            response.completionTokens,
            response.model,
            {
              path: relativePath,
              chunk_id: chunkId,
              chunk_index: 0,
            }
          );
        } catch (error) {
          warnings.push(`Failed to summarize ${relativePath}: ${String(error)}`);
        }
      }
    } else {
      // Multiple chunks needed
      const chunks = chunkFile(content, maxTokensPerChunk, overlapPercent);

      logger.info('Chunking file', {
        path: relativePath,
        chunks: chunks.length,
        maxTokens: maxTokensPerChunk,
      });

      for (const chunk of chunks) {
        const chunkId = generateChunkId(relativePath, fileRecord.hash, chunk.index);

        // Check cache
        let cached: ChunkMetadata | null = null;
        if (!config.forceFresh) {
          cached = await loadCachedChunk(contextDir, chunkId);
        }

        if (cached && cached.fileSha === fileRecord.hash) {
          logger.debug('Using cached chunk summary', {
            chunkId,
            path: relativePath,
            index: chunk.index,
          });
          summaries.push(toContextSummary(cached));
          chunksCached++;
        } else {
          // Generate new summary for chunk
          logger.info('Generating chunk summary', {
            path: relativePath,
            chunkId,
            index: chunk.index,
            total: chunk.total,
          });

          try {
            const chunkContext = `This is chunk ${chunk.index + 1} of ${chunk.total} from ${relativePath}`;
            const response = await client.summarizeChunk(chunk.content, {
              context: chunkContext,
            });

            // Redact summary
            const redactionResult = redactor.redactWithReport(response.summary);
            const redactionFlags = Array.from(
              new Set([...(response.redactionFlags ?? []), ...redactionResult.flags])
            );
            const generatedAt = new Date().toISOString();
            const providerId = response.model ?? client.getProviderId();

            const metadata: ChunkMetadata = {
              chunkId,
              path: relativePath,
              fileSha: fileRecord.hash,
              chunkIndex: chunk.index,
              chunkTotal: chunk.total,
              summary: redactionResult.text,
              tokenCount: {
                prompt: response.promptTokens,
                completion: response.completionTokens,
              },
              generatedAt,
              generatedBy: providerId,
              summarizationMethod: 'multi_chunk',
              redactionFlags,
            };

            // Store summary
            summaries.push(toContextSummary(metadata));

            await saveCachedChunk(contextDir, metadata);
            chunksGenerated++;
            promptTokens += response.promptTokens;
            completionTokens += response.completionTokens;
            await costTracker?.recordUsage(
              providerId,
              'summarize',
              response.promptTokens,
              response.completionTokens,
              response.model,
              {
                path: relativePath,
                chunk_id: chunkId,
                chunk_index: chunk.index,
              }
            );
          } catch (error) {
            warnings.push(
              `Failed to summarize chunk ${chunk.index} of ${relativePath}: ${String(error)}`
            );
          }
        }
      }
    }
  }

  // Update context document with summaries
  const updatedDoc: ContextDocument = {
    ...contextDoc,
    summaries,
    total_token_count: contextDoc.total_token_count + promptTokens + completionTokens,
    updated_at: new Date().toISOString(),
  };

  return {
    contextDocument: updatedDoc,
    chunksGenerated,
    chunksCached,
    tokensUsed: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    warnings,
  };
}

/**
 * Summarize multiple documents in batch
 *
 * @param contextDocs - Array of context documents
 * @param client - Summarizer client
 * @param config - Summarizer configuration
 * @param logger - Structured logger
 * @param metrics - Metrics collector
 * @param redactor - Redaction engine
 * @returns Batch summarization result
 */
export async function summarizeMultiple(
  contextDocs: ContextDocument[],
  client: SummarizerClient,
  config: SummarizerConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  redactor: RedactionEngine,
  costTracker?: CostTracker
): Promise<BatchSummarizationResult> {
  const documents: ContextDocument[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let totalChunksGenerated = 0;
  let totalChunksCached = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  logger.info('Starting batch summarization', {
    documentCount: contextDocs.length,
    provider: client.getProviderId(),
  });

  // Process documents sequentially to respect rate limits
  for (const contextDoc of contextDocs) {
    try {
      const result = await summarizeDocument(
        contextDoc,
        client,
        config,
        logger,
        redactor,
        costTracker
      );

      documents.push(result.contextDocument);
      totalChunksGenerated += result.chunksGenerated;
      totalChunksCached += result.chunksCached;
      totalPromptTokens += result.tokensUsed.prompt;
      totalCompletionTokens += result.tokensUsed.completion;
      warnings.push(...result.warnings);

      // Record metrics
      metrics.recordTokenUsage(result.tokensUsed.prompt, result.tokensUsed.completion, {
        provider: client.getProviderId(),
        operation: 'summarize',
      });
    } catch (error) {
      errors.push(`Failed to summarize document ${contextDoc.feature_id}: ${String(error)}`);
      logger.error('Document summarization failed', {
        featureId: contextDoc.feature_id,
        error: String(error),
      });
    }
  }

  logger.info('Batch summarization complete', {
    documentsProcessed: documents.length,
    chunksGenerated: totalChunksGenerated,
    chunksCached: totalChunksCached,
    totalTokens: totalPromptTokens + totalCompletionTokens,
  });

  const batchResult: BatchSummarizationResult = {
    documents,
    totalChunksGenerated,
    totalChunksCached,
    totalTokensUsed: {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    },
    warnings,
    errors,
  };

  if (costTracker) {
    await costTracker.flush();
  }

  return batchResult;
}

/**
 * Re-summarize specific files matching glob patterns
 *
 * @param contextDoc - Context document
 * @param patterns - File glob patterns to re-summarize
 * @param client - Summarizer client
 * @param config - Summarizer configuration with forceFresh
 * @param logger - Structured logger
 * @param redactor - Redaction engine
 * @returns Summarization result
 */
export async function resynchronizeFiles(
  contextDoc: ContextDocument,
  patterns: string[],
  client: SummarizerClient,
  config: SummarizerConfig,
  logger: StructuredLogger,
  redactor: RedactionEngine,
  costTracker?: CostTracker
): Promise<SummarizationResult> {
  // Filter files matching patterns
  const picomatch = (await import('picomatch')).default;
  const matchers = patterns.map((pattern) => picomatch(pattern, { dot: true }));

  const filteredFiles: typeof contextDoc.files = {};
  for (const [filePath, fileRecord] of Object.entries(contextDoc.files)) {
    if (matchers.some((matcher) => matcher(filePath))) {
      filteredFiles[filePath] = fileRecord;
    }
  }

  logger.info('Re-summarizing files', {
    patterns,
    matchedFiles: Object.keys(filteredFiles).length,
  });

  // Create filtered context doc
  const filteredDoc: ContextDocument = {
    ...contextDoc,
    files: filteredFiles,
    summaries: [], // Clear existing summaries
  };

  // Force fresh summarization
  const forceFreshConfig: SummarizerConfig = {
    ...config,
    forceFresh: true,
  };

  return summarizeDocument(filteredDoc, client, forceFreshConfig, logger, redactor, costTracker);
}
