/**
 * Summary Orchestration
 *
 * Processes file content into LLM-generated summaries via chunk-based
 * summarization. Supports single-file and multi-chunk processing with
 * caching, cost tracking, and secret redaction.
 */

import type { ContextSummary } from '../core/models/ContextDocument';
import { RedactionEngine, type StructuredLogger } from '../telemetry/logger';
import type { CostTracker } from '../telemetry/costTracker';
import { generateChunkId } from './contextBudget';
import { loadCachedChunk, saveCachedChunk } from './summaryStore';
import {
  toContextSummary,
  type FileChunk,
  type SummaryResponse,
  type SummarizerClient,
  type ChunkMetadata,
  type SummarizerConfig,
} from './summarizerClients/types';

/** Aggregated result from processing one or more file chunks */
export interface ChunkProcessResult {
  summaries: ContextSummary[];
  chunksGenerated: number;
  chunksCached: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Process a single file as one chunk, with caching support.
 *
 * @param relativePath - File path relative to workspace root
 * @param fileHash - SHA hash of the file content (used for cache key)
 * @param content - File content to summarize
 * @param contextDir - Directory for cached summaries
 * @param client - LLM summarizer client
 * @param config - Summarizer configuration (forceFresh, etc.)
 * @param redactor - Secret redaction engine applied to summaries
 * @param costTracker - Optional cost tracker for LLM usage
 * @param logger - Structured logger
 * @param warnings - Mutable array; failure messages are appended here
 */
export async function processSingleChunk(
  relativePath: string,
  fileHash: string,
  content: string,
  contextDir: string,
  client: SummarizerClient,
  config: SummarizerConfig,
  redactor: RedactionEngine,
  costTracker: CostTracker | undefined,
  logger: StructuredLogger,
  warnings: string[]
): Promise<ChunkProcessResult> {
  const chunkId = generateChunkId(relativePath, fileHash, 0);
  const result: ChunkProcessResult = {
    summaries: [],
    chunksGenerated: 0,
    chunksCached: 0,
    promptTokens: 0,
    completionTokens: 0,
  };

  let cached: ChunkMetadata | null = null;
  if (!config.forceFresh) {
    cached = await loadCachedChunk(contextDir, chunkId);
  }

  if (cached && cached.fileSha === fileHash) {
    logger.debug('Using cached summary', { chunkId, path: relativePath });
    result.summaries.push(toContextSummary(cached));
    result.chunksCached = 1;
    return result;
  }

  logger.info('Generating summary', { path: relativePath, chunkId });

  try {
    const response = await client.summarizeChunk(content);
    const metadata = buildChunkMetadata(
      chunkId,
      relativePath,
      fileHash,
      0,
      1,
      'single_chunk',
      response,
      redactor,
      client.getProviderId()
    );

    result.summaries.push(toContextSummary(metadata));
    await saveCachedChunk(contextDir, metadata);
    result.chunksGenerated = 1;
    result.promptTokens = response.promptTokens;
    result.completionTokens = response.completionTokens;
    await costTracker?.recordUsage(
      response.model ?? client.getProviderId(),
      'summarize',
      response.promptTokens,
      response.completionTokens,
      response.model,
      { path: relativePath, chunk_id: chunkId, chunk_index: 0 }
    );
  } catch (error) {
    warnings.push(`Failed to summarize ${relativePath}: ${String(error)}`);
  }

  return result;
}

/**
 * Process a file that has been split into multiple chunks.
 *
 * Each chunk is processed independently with its own cache key. Cached
 * chunks are reused if the file hash matches. Cost and token usage are
 * aggregated across all chunks.
 *
 * @param relativePath - File path relative to workspace root
 * @param fileHash - SHA hash of the full file content
 * @param chunks - Array of file chunks with index, total, and content
 * @param contextDir - Directory for cached summaries
 * @param client - LLM summarizer client
 * @param config - Summarizer configuration
 * @param redactor - Secret redaction engine applied to summaries
 * @param costTracker - Optional cost tracker for LLM usage
 * @param logger - Structured logger
 * @param warnings - Mutable array; failure messages are appended here
 */
export async function processMultipleChunks(
  relativePath: string,
  fileHash: string,
  chunks: FileChunk[],
  contextDir: string,
  client: SummarizerClient,
  config: SummarizerConfig,
  redactor: RedactionEngine,
  costTracker: CostTracker | undefined,
  logger: StructuredLogger,
  warnings: string[]
): Promise<ChunkProcessResult> {
  const result: ChunkProcessResult = {
    summaries: [],
    chunksGenerated: 0,
    chunksCached: 0,
    promptTokens: 0,
    completionTokens: 0,
  };

  for (const chunk of chunks) {
    const chunkId = generateChunkId(relativePath, fileHash, chunk.index);

    let cached: ChunkMetadata | null = null;
    if (!config.forceFresh) {
      cached = await loadCachedChunk(contextDir, chunkId);
    }

    if (cached && cached.fileSha === fileHash) {
      logger.debug('Using cached chunk summary', {
        chunkId,
        path: relativePath,
        index: chunk.index,
      });
      result.summaries.push(toContextSummary(cached));
      result.chunksCached++;
      continue;
    }

    logger.info('Generating chunk summary', {
      path: relativePath,
      chunkId,
      index: chunk.index,
      total: chunk.total,
    });

    try {
      const chunkContext = `This is chunk ${chunk.index + 1} of ${chunk.total} from ${relativePath}`;
      const response = await client.summarizeChunk(chunk.content, { context: chunkContext });
      const metadata = buildChunkMetadata(
        chunkId,
        relativePath,
        fileHash,
        chunk.index,
        chunk.total,
        'multi_chunk',
        response,
        redactor,
        client.getProviderId()
      );

      result.summaries.push(toContextSummary(metadata));
      await saveCachedChunk(contextDir, metadata);
      result.chunksGenerated++;
      result.promptTokens += response.promptTokens;
      result.completionTokens += response.completionTokens;
      await costTracker?.recordUsage(
        response.model ?? client.getProviderId(),
        'summarize',
        response.promptTokens,
        response.completionTokens,
        response.model,
        { path: relativePath, chunk_id: chunkId, chunk_index: chunk.index }
      );
    } catch (error) {
      warnings.push(
        `Failed to summarize chunk ${chunk.index} of ${relativePath}: ${String(error)}`
      );
    }
  }

  return result;
}

function buildChunkMetadata(
  chunkId: string,
  relativePath: string,
  fileHash: string,
  chunkIndex: number,
  chunkTotal: number,
  method: string,
  response: SummaryResponse,
  redactor: RedactionEngine,
  providerId: string
): ChunkMetadata {
  const redactionResult = redactor.redactWithReport(response.summary);
  const redactionFlags = Array.from(
    new Set([...(response.redactionFlags ?? []), ...redactionResult.flags])
  );
  return {
    chunkId,
    path: relativePath,
    fileSha: fileHash,
    chunkIndex,
    chunkTotal,
    summary: redactionResult.text,
    tokenCount: {
      prompt: response.promptTokens,
      completion: response.completionTokens,
    },
    generatedAt: new Date().toISOString(),
    generatedBy: response.model ?? providerId,
    summarizationMethod: method,
    redactionFlags,
  };
}
