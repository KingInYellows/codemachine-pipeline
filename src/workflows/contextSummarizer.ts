/**
 * Context Summarizer
 *
 * Orchestrates chunking, summarization, caching, cost tracking, and redaction
 * for repository context documents. Delegates chunking logic to contextBudget,
 * persistence to summaryStore, and chunk processing to summaryOrchestration.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ContextDocument, ContextSummary } from '../core/models/ContextDocument';
import { estimateTokens } from './contextRanking';
import { RedactionEngine, type StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import { getSubdirectoryPath } from '../persistence';
import type { CostTracker } from '../telemetry/costTracker';
import { chunkFile, generateChunkId } from './contextBudget';
import { processSingleChunk, processMultipleChunks } from './summaryOrchestration';
import {
  type FileChunk,
  type SummaryResponse,
  type SummarizerClient,
  type ChunkMetadata,
  type SummarizerConfig,
  type SummarizationResult,
  type BatchSummarizationResult,
} from './summarizerClients/types';

// Re-export types for backward compatibility
export type {
  FileChunk,
  SummaryResponse,
  SummarizerClient,
  ChunkMetadata,
  SummarizerConfig,
  SummarizationResult,
  BatchSummarizationResult,
};
export { chunkFile, generateChunkId };

// ============================================================================
// Summarization Orchestrator
// ============================================================================

/**
 * Summarize a single document with chunking and caching
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

  for (const [relativePath, fileRecord] of Object.entries(contextDoc.files)) {
    const fullPath = path.join(config.repoRoot, relativePath);

    logger.info('Processing file for summarization', {
      path: relativePath,
      hash: fileRecord.hash,
      size: fileRecord.size,
    });

    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      warnings.push(`Failed to read file ${relativePath}: ${String(error)}`);
      continue;
    }

    const estimatedTokenCount = estimateTokens(fileRecord.size);

    if (estimatedTokenCount <= maxTokensPerChunk) {
      const result = await processSingleChunk(
        relativePath,
        fileRecord.hash,
        content,
        contextDir,
        client,
        config,
        redactor,
        costTracker,
        logger,
        warnings
      );
      summaries.push(...result.summaries);
      chunksGenerated += result.chunksGenerated;
      chunksCached += result.chunksCached;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
    } else {
      const chunks = chunkFile(content, maxTokensPerChunk, overlapPercent);

      logger.info('Chunking file', {
        path: relativePath,
        chunks: chunks.length,
        maxTokens: maxTokensPerChunk,
      });

      const result = await processMultipleChunks(
        relativePath,
        fileRecord.hash,
        chunks,
        contextDir,
        client,
        config,
        redactor,
        costTracker,
        logger,
        warnings
      );
      summaries.push(...result.summaries);
      chunksGenerated += result.chunksGenerated;
      chunksCached += result.chunksCached;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
    }
  }

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

  const filteredDoc: ContextDocument = {
    ...contextDoc,
    files: filteredFiles,
    summaries: [],
  };

  const forceFreshConfig: SummarizerConfig = {
    ...config,
    forceFresh: true,
  };

  return summarizeDocument(filteredDoc, client, forceFreshConfig, logger, redactor, costTracker);
}
