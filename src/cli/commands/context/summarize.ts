import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  getRunDirectoryPath,
  getSubdirectoryPath,
  withLock,
} from '../../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../../utils/safeJson.js';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
  type RunDirectorySettings,
} from '../../utils/runDirectory';
import { createCliLogger, LogLevel, RedactionEngine } from '../../../telemetry/logger';
import {
  createRunMetricsCollector,
  StandardMetrics,
  type MetricsCollector,
} from '../../../telemetry/metrics';
import {
  createRunTraceManager,
  SpanStatusCode,
  type TraceManager,
  type ActiveSpan,
} from '../../../telemetry/traces';
import type { StructuredLogger } from '../../../telemetry/logger';
import {
  summarizeDocument,
  resynchronizeFiles,
  type SummarizationResult,
  type SummarizerConfig,
  type SummarizerClient,
} from '../../../workflows/contextSummarizer';
import { LocalSummarizerClient } from '../../../workflows/summarizerClients/localSummarizerClient';
import { loadOrCreateCostTracker } from '../../../telemetry/costTracker';
import {
  parseContextDocument,
  serializeContextDocument,
  type ContextDocument,
} from '../../../core/models/ContextDocument';

type SummarizeFlags = {
  feature?: string;
  path?: string[];
  force: boolean;
  json: boolean;
  'max-chunk-tokens'?: number;
  'chunk-overlap'?: number;
};

interface SummarizationStats {
  chunksGenerated: number;
  chunksCached: number;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  warnings: string[];
}

interface SummarizationMetadata {
  feature_id: string;
  updated_at: string;
  chunks_generated: number;
  chunks_cached: number;
  tokens_used: SummarizationStats['tokensUsed'];
  warnings: string[];
  patterns: string[];
  force: boolean;
}

export default class ContextSummarize extends Command {
  static description = 'Generate or refresh cached context summaries';

  static examples = [
    '<%= config.bin %> context summarize',
    '<%= config.bin %> context summarize --feature 01JXYZ --json',
    '<%= config.bin %> context summarize --path "src/**/*.ts" --path README.md',
    '<%= config.bin %> context summarize --force --max-chunk-tokens 2000',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to summarize (defaults to most recent)',
    }),
    path: Flags.string({
      char: 'p',
      description: 'Glob pattern of files to re-summarize (repeatable)',
      multiple: true,
    }),
    force: Flags.boolean({
      char: 'F',
      description: 'Force re-summarization even if cache is warm',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Emit machine-readable JSON output',
      default: false,
    }),
    'max-chunk-tokens': Flags.integer({
      description: 'Override maximum tokens per chunk (default 4000)',
      min: 500,
      max: 16000,
    }),
    'chunk-overlap': Flags.integer({
      description: 'Chunk overlap percentage (default 10)',
      min: 0,
      max: 50,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ContextSummarize);
    const typedFlags = flags as SummarizeFlags;

    if (typedFlags.json) {
      process.env.JSON_OUTPUT = '1';
    }

    const startTime = Date.now();

    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;

    try {
      const settings = resolveRunDirectorySettings();
      this.ensureConfigReady(settings);

      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
      if (!featureId) {
        this.error('Feature run directory not found. Use --feature to select a specific run.', {
          exit: 10,
        });
      }

      const runDir = getRunDirectoryPath(settings.baseDir, featureId);
      logger = createCliLogger('context:summarize', featureId, runDir, {
        minLevel: typedFlags.json ? LogLevel.WARN : LogLevel.INFO,
        mirrorToStderr: !typedFlags.json,
      });
      metrics = createRunMetricsCollector(runDir, featureId);
      traceManager = createRunTraceManager(runDir, featureId);
      commandSpan = traceManager.startSpan('cli.context.summarize');
      commandSpan.setAttribute('feature_id', featureId);
      commandSpan.setAttribute('patterns', typedFlags.path?.length ?? 0);
      commandSpan.setAttribute('force', typedFlags.force);

      logger.info('Context summarization started', {
        feature_id: featureId,
        patterns: typedFlags.path ?? [],
        force: typedFlags.force,
      });

      const repoConfig = settings.config!;
      if (!repoConfig.feature_flags.enable_context_summarization) {
        this.error('Context summarization is disabled in repo configuration.', { exit: 30 });
      }

      const contextDocument = await this.loadContextDocument(runDir);
      const client = new LocalSummarizerClient();
      const redactor = new RedactionEngine(repoConfig.safety.redact_secrets);
      const summarizerConfig: SummarizerConfig = {
        repoRoot: process.cwd(),
        runDir,
        featureId,
        tokenBudget: repoConfig.runtime.context_token_budget,
        enableSummarization: true,
        forceFresh: typedFlags.force,
        ...(typedFlags['max-chunk-tokens'] !== undefined && {
          maxTokensPerChunk: typedFlags['max-chunk-tokens'],
        }),
        ...(typedFlags['chunk-overlap'] !== undefined && {
          chunkOverlapPercent: typedFlags['chunk-overlap'],
        }),
      };

      const costTracker = await loadOrCreateCostTracker(featureId, runDir, logger, metrics, {
        maxCostUsd: repoConfig.runtime.context_cost_budget_usd,
        maxTokens: repoConfig.runtime.context_token_budget,
        warningThreshold: 80,
      });

      const patterns = typedFlags.path ?? [];
      const stats: SummarizationStats = {
        chunksGenerated: 0,
        chunksCached: 0,
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
        warnings: [],
      };

      const result = await this.executeSummarization(
        contextDocument,
        summarizerConfig,
        client,
        redactor,
        logger,
        costTracker,
        patterns,
        stats
      );

      await this.persistSummaries(runDir, result.contextDocument, {
        feature_id: featureId,
        updated_at: new Date().toISOString(),
        chunks_generated: stats.chunksGenerated,
        chunks_cached: stats.chunksCached,
        tokens_used: stats.tokensUsed,
        warnings: stats.warnings,
        patterns,
        force: typedFlags.force,
      });

      await costTracker.flush();
      const budgetWarnings = costTracker.getBudgetWarnings().map((warning) => warning.message);

      await ensureTelemetryReferences(runDir);

      const output = {
        feature_id: featureId,
        run_directory: runDir,
        files: Object.keys(result.contextDocument.files).length,
        summaries: result.contextDocument.summaries.length,
        chunks_generated: stats.chunksGenerated,
        chunks_cached: stats.chunksCached,
        tokens_used: stats.tokensUsed,
        warnings: stats.warnings,
        budget_warnings: budgetWarnings,
        patterns,
        force: typedFlags.force,
      };

      if (typedFlags.json) {
        this.log(JSON.stringify(output, null, 2));
      } else {
        this.log('');
        this.log(`Feature: ${featureId}`);
        this.log(`Run dir: ${runDir}`);
        this.log(`Summaries: ${output.summaries} (files=${output.files})`);
        this.log(`Chunks: generated=${output.chunks_generated} cached=${output.chunks_cached}`);
        this.log(
          `Tokens used: prompt=${output.tokens_used.prompt} completion=${output.tokens_used.completion} total=${output.tokens_used.total}`
        );
        if (patterns.length > 0) {
          this.log(`Patterns: ${patterns.join(', ')}`);
        }
        if (output.warnings.length > 0) {
          this.warn(`Warnings: ${output.warnings.join(' | ')}`);
        }
        if (budgetWarnings.length > 0) {
          this.warn(`Budget warnings: ${budgetWarnings.join(' | ')}`);
        }
        this.log('');
      }

      const duration = Date.now() - startTime;
      if (metrics) {
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'context:summarize',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'context:summarize',
          exit_code: '0',
        });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 0);
        commandSpan.end({ code: SpanStatusCode.OK });
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (logger) {
        logger.info('Context summarization completed', { duration_ms: duration });
        await logger.flush();
      }
    } catch (error) {
      if (metrics) {
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'context:summarize',
          exit_code: '1',
        });
        await metrics.flush();
      }
      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 1);
        if (error instanceof Error) {
          commandSpan.setAttribute('error.message', error.message);
        }
        commandSpan.end({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
      if (traceManager) {
        await traceManager.flush();
      }
      if (logger) {
        if (error instanceof Error) {
          logger.error('Context summarization failed', { error: error.message });
        }
        await logger.flush();
      }

      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Context summarization failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Context summarization failed with an unknown error', { exit: 1 });
      }
    }
  }

  private ensureConfigReady(settings: RunDirectorySettings): void {
    if (settings.errors.length > 0 || !settings.config) {
      const errorMessage =
        settings.errors.length > 0
          ? settings.errors.join('; ')
          : 'Repository configuration missing.';
      this.error(`Invalid repo configuration: ${errorMessage}`, { exit: 10 });
    }
  }

  private async loadContextDocument(runDir: string): Promise<ContextDocument> {
    const summaryPath = path.join(runDir, 'context', 'summary.json');
    let raw: string;
    try {
      raw = await fs.readFile(summaryPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.error('Context summary missing. Run the context aggregator before summarizing.', {
          exit: 30,
        });
      }
      throw error;
    }

    const jsonData = safeJsonParse<unknown>(raw);
    if (!jsonData) {
      this.error('Context summary contains invalid JSON', { exit: 30 });
    }

    const parsed = parseContextDocument(jsonData);
    if (!parsed.success) {
      const message = parsed.errors.map((err) => `${err.path}: ${err.message}`).join('; ');
      this.error(`Context summary validation failed: ${message}`, { exit: 30 });
    }

    return parsed.data;
  }

  private accumulate(target: SummarizationStats, source: SummarizationResult): void {
    target.chunksGenerated += source.chunksGenerated;
    target.chunksCached += source.chunksCached;
    target.tokensUsed.prompt += source.tokensUsed.prompt;
    target.tokensUsed.completion += source.tokensUsed.completion;
    target.tokensUsed.total += source.tokensUsed.total;
    target.warnings.push(...source.warnings);
  }

  private async executeSummarization(
    contextDocument: ContextDocument,
    config: SummarizerConfig,
    client: SummarizerClient,
    redactor: RedactionEngine,
    logger: StructuredLogger,
    costTracker: Awaited<ReturnType<typeof loadOrCreateCostTracker>>,
    patterns: string[],
    stats: SummarizationStats
  ): Promise<SummarizationResult> {
    if (patterns.length > 0 && !config.forceFresh) {
      const subsetResult = await resynchronizeFiles(
        contextDocument,
        patterns,
        client,
        config,
        logger,
        redactor,
        costTracker
      );
      this.accumulate(stats, subsetResult);

      const fullResult = await summarizeDocument(
        contextDocument,
        client,
        { ...config, forceFresh: false },
        logger,
        redactor,
        costTracker
      );
      this.accumulate(stats, fullResult);
      return fullResult;
    }

    const result = await summarizeDocument(
      contextDocument,
      client,
      config,
      logger,
      redactor,
      costTracker
    );
    stats.chunksGenerated = result.chunksGenerated;
    stats.chunksCached = result.chunksCached;
    stats.tokensUsed = { ...result.tokensUsed };
    stats.warnings = [...result.warnings];
    return result;
  }

  private async persistSummaries(
    runDir: string,
    contextDocument: ContextDocument,
    metadata: SummarizationMetadata
  ): Promise<void> {
    const contextDir = getSubdirectoryPath(runDir, 'context');
    await withLock(runDir, async () => {
      await fs.mkdir(contextDir, { recursive: true });
      const summaryPath = path.join(contextDir, 'summary.json');
      await fs.writeFile(summaryPath, serializeContextDocument(contextDocument), 'utf-8');

      const metadataPath = path.join(contextDir, 'summarization.json');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    });
  }
}
