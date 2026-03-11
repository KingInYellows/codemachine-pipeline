import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDirectoryPath } from '../../../persistence/runLifecycle';
import { safeJsonParse } from '../../../utils/safeJson';
import { parseContextDocument } from '../../../core/models/ContextDocument';
import { truncateSummary } from '../renderers';
import type { StatusContextPayload } from '../types';
import type { DataLogger } from './types';

export async function attachSummarizationMetadata(
  payload: StatusContextPayload,
  contextDir: string,
  logger?: DataLogger
): Promise<void> {
  const metadataPath = join(contextDir, 'summarization.json');

  try {
    const metadataRaw = await readFile(metadataPath, 'utf-8');
    const metadata = safeJsonParse<{
      updated_at?: string;
      chunks_generated?: number;
      chunks_cached?: number;
      tokens_used?: { prompt?: number; completion?: number; total?: number };
      warnings?: string[];
    }>(metadataRaw);

    if (metadata) {
      payload.summarization = {
        ...(payload.summarization ?? {}),
        ...(metadata.updated_at && { updated_at: metadata.updated_at }),
        ...(typeof metadata.chunks_generated === 'number' && {
          chunks_generated: metadata.chunks_generated,
        }),
        ...(typeof metadata.chunks_cached === 'number' && {
          chunks_cached: metadata.chunks_cached,
        }),
        ...(metadata.tokens_used && { tokens_used: metadata.tokens_used }),
      };

      if (metadata.warnings && metadata.warnings.length > 0) {
        payload.warnings = [...(payload.warnings ?? []), ...metadata.warnings];
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    logger?.warn('Failed to read summarization metadata', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      context_dir: contextDir,
      error_code: 'STATUS_SUMMARIZATION_METADATA_READ_FAILED',
    });
    payload.warnings = [...(payload.warnings ?? []), 'Failed to read summarization metadata'];
  }
}

export async function attachCostTelemetry(
  payload: StatusContextPayload,
  runDir: string,
  logger?: DataLogger
): Promise<void> {
  const costsPath = join(runDir, 'telemetry', 'costs.json');

  try {
    const content = await readFile(costsPath, 'utf-8');
    const costs = safeJsonParse<{
      totals?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        totalCostUsd?: number;
      };
      warnings?: string[];
    }>(content);

    if (costs?.totals) {
      const tokensUsed: { prompt?: number; completion?: number; total?: number } = {};
      if (typeof costs.totals.promptTokens === 'number') {
        tokensUsed.prompt = costs.totals.promptTokens;
      }
      if (typeof costs.totals.completionTokens === 'number') {
        tokensUsed.completion = costs.totals.completionTokens;
      }
      if (typeof costs.totals.totalTokens === 'number') {
        tokensUsed.total = costs.totals.totalTokens;
      }

      payload.summarization = {
        ...(payload.summarization ?? {}),
        ...(Object.keys(tokensUsed).length > 0 && { tokens_used: tokensUsed }),
        ...(typeof costs.totals.totalCostUsd === 'number' && {
          cost_usd: costs.totals.totalCostUsd,
        }),
      };
    }

    if (costs?.warnings && costs.warnings.length > 0) {
      payload.budget_warnings = costs.warnings;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    logger?.warn('Failed to read cost telemetry', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: runDir,
      error_code: 'STATUS_COST_TELEMETRY_READ_FAILED',
    });
    payload.warnings = [...(payload.warnings ?? []), 'Failed to read cost telemetry'];
  }
}

export async function loadContextStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusContextPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);
  const contextDir = join(runDir, 'context');
  const summaryPath = join(contextDir, 'summary.json');

  let content: string;
  try {
    content = await readFile(summaryPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    return {
      error: error instanceof Error ? error.message : 'Failed to read context summary',
    };
  }

  const jsonData = safeJsonParse<unknown>(content);
  if (!jsonData) {
    return {
      error: 'Failed to parse context summary JSON',
    };
  }

  const parsed = parseContextDocument(jsonData);
  if (!parsed.success) {
    return {
      error: parsed.errors.map((err) => `${err.path}: ${err.message}`).join('; '),
    };
  }

  const contextDoc = parsed.data;
  const docPayload: StatusContextPayload = {
    files: Object.keys(contextDoc.files).length,
    total_tokens: contextDoc.total_token_count,
    summaries: contextDoc.summaries.length,
    summaries_preview: contextDoc.summaries.slice(0, 5).map((entry) => ({
      file_path: entry.file_path,
      chunk_id: entry.chunk_id,
      generated_at: entry.generated_at,
      summary: truncateSummary(entry.summary),
    })),
  };

  await attachSummarizationMetadata(docPayload, contextDir, logger);
  await attachCostTelemetry(docPayload, runDir, logger);

  return docPayload;
}
