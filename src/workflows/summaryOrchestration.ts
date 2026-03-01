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

// ============================================================================
// Internal chunk processing helpers
// ============================================================================

export interface ChunkProcessResult {
  summaries: ContextSummary[];
  chunksGenerated: number;
  chunksCached: number;
  promptTokens: number;
  completionTokens: number;
}

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
