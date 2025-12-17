import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  readManifest,
  type RunManifest,
} from '../../persistence/runDirectoryManager';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode, withSpan } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
  type RunDirectorySettings,
} from '../utils/runDirectory';
import { parseContextDocument } from '../../core/models/ContextDocument';
import { loadTraceSummary } from '../../workflows/traceabilityMapper';

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_SCHEMA_DOC = 'docs/requirements/run_directory_schema.md';
const MANIFEST_TEMPLATE = '.ai-feature-pipeline/templates/run_manifest.json';

type StatusFlags = {
  feature?: string;
  json: boolean;
  verbose: boolean;
  'show-costs': boolean;
};

interface ManifestLoadResult {
  manifest?: RunManifest;
  manifestPath: string;
  error?: string;
}

interface StatusPayload {
  feature_id: string | null;
  title?: string;
  source?: string;
  status: RunManifest['status'] | 'unknown';
  manifest_path: string;
  manifest_schema_doc: string;
  manifest_template: string;
  last_step: string | null;
  last_error: RunManifest['execution']['last_error'] | null;
  queue: RunManifest['queue'] | null;
  approvals: RunManifest['approvals'] | null;
  telemetry: RunManifest['telemetry'] | null;
  timestamps: RunManifest['timestamps'] | null;
  config_reference: string;
  config_errors: string[];
  config_warnings: string[];
  notes: string[];
  manifest_error?: string;
  context?: StatusContextPayload;
  traceability?: StatusTraceabilityPayload;
}

interface StatusContextPayload {
  files?: number;
  total_tokens?: number;
  summaries?: number;
  summaries_preview?: Array<{
    file_path: string;
    chunk_id: string;
    generated_at: string;
    summary: string;
  }>;
  summarization?: {
    updated_at?: string;
    chunks_generated?: number;
    chunks_cached?: number;
    tokens_used?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
    cost_usd?: number;
  };
  warnings?: string[];
  budget_warnings?: string[];
  error?: string;
}

interface StatusTraceabilityPayload {
  trace_path: string;
  total_links: number;
  prd_goals_mapped: number;
  spec_requirements_mapped: number;
  execution_tasks_mapped: number;
  last_updated: string;
  outstanding_gaps: number;
}

/**
 * Status command - Display current state of a feature pipeline
 * Implements FR-9: Status reporting and progress tracking
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found)
 */
export default class Status extends Command {
  static description = 'Show the current state of a feature development pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --verbose',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to query (defaults to current/latest)',
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed execution logs and task breakdown',
      default: false,
    }),
    'show-costs': Flags.boolean({
      description: 'Include token usage and cost estimates',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const typedFlags = flags as StatusFlags;

    if (typedFlags.json) {
      process.env.JSON_OUTPUT = '1';
    }

    // Initialize telemetry (logger, metrics, traces)
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    let runDirPath: string | undefined;
    const startTime = Date.now();

    try {
      const settings = resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      // Initialize telemetry if feature exists
      if (featureId) {
        runDirPath = getRunDirectoryPath(settings.baseDir, featureId);
        logger = createCliLogger('status', featureId, runDirPath, {
          minLevel: typedFlags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
          mirrorToStderr: !typedFlags.json,
        });
        metrics = createRunMetricsCollector(runDirPath, featureId);
        traceManager = createRunTraceManager(runDirPath, featureId);
        commandSpan = traceManager.startSpan('cli.status');
        commandSpan.setAttribute('feature_id', featureId);
        commandSpan.setAttribute('json_mode', typedFlags.json);
        commandSpan.setAttribute('verbose_flag', typedFlags.verbose);

        logger.info('Status command invoked', {
          feature_id: featureId,
          json_mode: typedFlags.json,
          verbose: typedFlags.verbose,
        });
      }

      if (typedFlags.feature && featureId !== typedFlags.feature) {
        if (logger) {
          logger.error('Feature not found', { requested: typedFlags.feature });
        }
        this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
      }

      const manifestInfo = featureId
        ? await this.loadManifestWithTracing(traceManager, commandSpan, settings.baseDir, featureId)
        : undefined;

      const contextInfo = featureId
        ? await this.loadContextStatus(settings.baseDir, featureId)
        : undefined;

      const traceInfo = featureId
        ? await this.loadTraceabilityStatus(settings.baseDir, featureId)
        : undefined;

      const payload = this.buildStatusPayload(featureId, settings, manifestInfo, contextInfo, traceInfo);

      if (typedFlags.json) {
        // Disable stderr mirroring in JSON mode (already set in createCliLogger)
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload, typedFlags);
      }

      // Record success metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, { command: 'status' });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, { command: 'status', exit_code: '0' });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 0);
        commandSpan.end({ code: SpanStatusCode.OK });
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (runDirPath) {
        await ensureTelemetryReferences(runDirPath);
      }

      if (logger) {
        logger.info('Status command completed', { duration_ms: Date.now() - startTime });
        await logger.flush();
      }
    } catch (error) {
      // Record error metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, { command: 'status' });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, { command: 'status', exit_code: '1' });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 1);
        commandSpan.setAttribute('error', true);
        if (error instanceof Error) {
          commandSpan.setAttribute('error.message', error.message);
          commandSpan.setAttribute('error.name', error.name);
        }
        commandSpan.end({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (runDirPath) {
        await ensureTelemetryReferences(runDirPath);
      }

      if (logger) {
        if (error instanceof Error) {
          logger.error('Status command failed', {
            error: error.message,
            stack: error.stack,
            duration_ms: Date.now() - startTime,
          });
        }
        await logger.flush();
      }

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Status command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Status command failed with an unknown error', { exit: 1 });
      }
    }
  }

  private deriveManifestPath(baseDir: string, featureId?: string): string {
    if (featureId) {
      return path.join(getRunDirectoryPath(baseDir, featureId), MANIFEST_FILE);
    }

    return path.join(baseDir, '<feature_id>', MANIFEST_FILE);
  }

  private async loadManifestSnapshot(
    baseDir: string,
    featureId: string
  ): Promise<ManifestLoadResult> {
    const runDir = getRunDirectoryPath(baseDir, featureId);
    const manifestPath = path.join(runDir, MANIFEST_FILE);

    try {
      const manifest = await readManifest(runDir);
      return { manifest, manifestPath };
    } catch (error) {
      return {
        manifestPath,
        error: error instanceof Error ? error.message : 'Unknown manifest error',
      };
    }
  }

  private buildStatusPayload(
    featureId: string | undefined,
    settings: RunDirectorySettings,
    manifestInfo?: ManifestLoadResult,
    contextInfo?: StatusContextPayload,
    traceInfo?: StatusTraceabilityPayload
  ): StatusPayload {
    const manifest = manifestInfo?.manifest;
    const manifestPath = manifestInfo?.manifestPath ?? this.deriveManifestPath(settings.baseDir, featureId);

    const payload: StatusPayload = {
      feature_id: featureId ?? null,
      status: manifest?.status ?? 'unknown',
      manifest_path: manifestPath,
      manifest_schema_doc: MANIFEST_SCHEMA_DOC,
      manifest_template: MANIFEST_TEMPLATE,
      last_step: manifest?.execution.last_step ?? null,
      last_error: manifest?.execution.last_error ?? null,
      queue: manifest?.queue ?? null,
      approvals: manifest?.approvals ?? null,
      telemetry: manifest?.telemetry ?? null,
      timestamps: manifest?.timestamps ?? null,
      config_reference: settings.configPath,
      config_errors: settings.errors,
      config_warnings: settings.warnings,
      notes: [
        `Manifest layout documented at ${MANIFEST_SCHEMA_DOC}`,
        `Template manifest available at ${MANIFEST_TEMPLATE}`,
      ],
      ...(contextInfo && { context: contextInfo }),
      ...(traceInfo && { traceability: traceInfo }),
    };

    if (manifest?.title) {
      payload.title = manifest.title;
    }

    if (manifest?.source) {
      payload.source = manifest.source;
    }

    if (manifestInfo?.error) {
      payload.manifest_error = manifestInfo.error;
      payload.notes.push('Manifest could not be read; inspect manifest_error for remediation guidance.');
    }

    if (!manifest) {
      payload.notes.push('No manifest found. Run "ai-feature start" to provision a new feature run directory.');
    }

    return payload;
  }

  private async loadTraceabilityStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusTraceabilityPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);

    try {
      const traceSummary = await loadTraceSummary(runDir);

      if (!traceSummary) {
        return undefined;
      }

      return {
        trace_path: traceSummary.tracePath,
        total_links: traceSummary.totalLinks,
        prd_goals_mapped: traceSummary.prdGoalsMapped,
        spec_requirements_mapped: traceSummary.specRequirementsMapped,
        execution_tasks_mapped: traceSummary.executionTasksMapped,
        last_updated: traceSummary.lastUpdated,
        outstanding_gaps: traceSummary.outstandingGaps,
      };
    } catch {
      // Silently return undefined if trace.json doesn't exist or is invalid
      return undefined;
    }
  }

  private async loadContextStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusContextPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);
    const contextDir = path.join(runDir, 'context');
    const summaryPath = path.join(contextDir, 'summary.json');

    let content: string;
    try {
      content = await fs.readFile(summaryPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      return {
        error: error instanceof Error ? error.message : 'Failed to read context summary',
      };
    }

    let docPayload: StatusContextPayload = {};
    try {
      const parsed = parseContextDocument(JSON.parse(content));
      if (!parsed.success) {
        return {
          error: parsed.errors.map(err => `${err.path}: ${err.message}`).join('; '),
        };
      }

      const contextDoc = parsed.data;
      docPayload = {
        files: Object.keys(contextDoc.files).length,
        total_tokens: contextDoc.total_token_count,
        summaries: contextDoc.summaries.length,
        summaries_preview: contextDoc.summaries.slice(0, 5).map(entry => ({
          file_path: entry.file_path,
          chunk_id: entry.chunk_id,
          generated_at: entry.generated_at,
          summary: truncateSummary(entry.summary),
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to parse context summary',
      };
    }

    await this.attachSummarizationMetadata(docPayload, contextDir);
    await this.attachCostTelemetry(docPayload, runDir);

    return docPayload;
  }

  private async attachSummarizationMetadata(
    payload: StatusContextPayload,
    contextDir: string
  ): Promise<void> {
    const metadataPath = path.join(contextDir, 'summarization.json');

    try {
      const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataRaw) as {
        updated_at?: string;
        chunks_generated?: number;
        chunks_cached?: number;
        tokens_used?: { prompt?: number; completion?: number; total?: number };
        warnings?: string[];
      };

      payload.summarization = {
        ...(payload.summarization ?? {}),
        ...(metadata.updated_at && { updated_at: metadata.updated_at }),
        ...(typeof metadata.chunks_generated === 'number' && { chunks_generated: metadata.chunks_generated }),
        ...(typeof metadata.chunks_cached === 'number' && { chunks_cached: metadata.chunks_cached }),
        ...(metadata.tokens_used && { tokens_used: metadata.tokens_used }),
      };

      if (metadata.warnings && metadata.warnings.length > 0) {
        payload.warnings = [...(payload.warnings ?? []), ...metadata.warnings];
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      payload.warnings = [...(payload.warnings ?? []), 'Failed to read summarization metadata'];
    }
  }

  private async attachCostTelemetry(
    payload: StatusContextPayload,
    runDir: string
  ): Promise<void> {
    const costsPath = path.join(runDir, 'telemetry', 'costs.json');

    try {
      const content = await fs.readFile(costsPath, 'utf-8');
      const costs = JSON.parse(content) as {
        totals?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; totalCostUsd?: number };
        warnings?: string[];
      };

      if (costs.totals) {
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
          ...(typeof costs.totals.totalCostUsd === 'number' && { cost_usd: costs.totals.totalCostUsd }),
        };
      }

      if (costs.warnings && costs.warnings.length > 0) {
        payload.budget_warnings = costs.warnings;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      payload.warnings = [...(payload.warnings ?? []), 'Failed to read cost telemetry'];
    }
  }

  private async loadManifestWithTracing(
    traceManager: TraceManager | undefined,
    parentSpan: ActiveSpan | undefined,
    baseDir: string,
    featureId: string
  ): Promise<ManifestLoadResult> {
    if (traceManager && parentSpan) {
      return withSpan(
        traceManager,
        'status.load_manifest',
        async (span) => {
          span.setAttribute('feature_id', featureId);
          const result = await this.loadManifestSnapshot(baseDir, featureId);
          if (result.error) {
            span.setAttribute('manifest_load_error', true);
          } else if (result.manifest) {
            span.setAttribute('manifest_status', result.manifest.status);
          }
          return result;
        },
        parentSpan.context
      );
    }

    return this.loadManifestSnapshot(baseDir, featureId);
  }

  private printHumanReadable(payload: StatusPayload, flags: StatusFlags): void {
    this.log('');
    this.log(`Feature: ${payload.feature_id ?? '(none detected)'}`);
    if (payload.title) {
      this.log(`Title: ${payload.title}`);
    }
    if (payload.source) {
      this.log(`Source: ${payload.source}`);
    }
    this.log(`Manifest: ${payload.manifest_path}`);
    this.log(`Status: ${payload.status}`);
    this.log(`Last step: ${payload.last_step ?? 'not recorded'}`);

    if (payload.last_error) {
      this.log(
        `Last error: ${payload.last_error.step} — ${payload.last_error.message} (${payload.last_error.recoverable ? 'recoverable' : 'fatal'})`
      );
    } else {
      this.log('Last error: none recorded');
    }

    if (payload.queue) {
      this.log(
        `Queue: pending=${payload.queue.pending_count} completed=${payload.queue.completed_count} failed=${payload.queue.failed_count}`
      );
      if (flags.verbose && payload.queue.sqlite_index) {
        this.log(`Queue SQLite index: ${payload.queue.sqlite_index.database}`);
      }
    } else {
      this.log('Queue: manifest data unavailable');
    }

    if (payload.approvals) {
      this.log(
        `Approvals: pending=${payload.approvals.pending.length} completed=${payload.approvals.completed.length}`
      );

      // Highlight pending approvals with actionable prompts
      if (payload.approvals.pending.length > 0) {
        this.log('');
        this.warn('⚠ Pending approvals required:');
        payload.approvals.pending.forEach(gate => {
          this.warn(`  • ${gate.toUpperCase()} - Review artifact and run: ai-feature approve ${gate} --signer "<your-email>"`);
        });
      }

      // Show completed approvals in verbose mode
      if (flags.verbose && payload.approvals.completed.length > 0) {
        this.log('Completed approvals:');
        payload.approvals.completed.forEach(gate => {
          this.log(`  • ${gate.toUpperCase()}`);
        });
      }
    }

    if (payload.context) {
      if (payload.context.error) {
        this.warn(`Context summaries unavailable: ${payload.context.error}`);
      } else {
        this.log(
          `Context: files=${payload.context.files ?? 0} summaries=${payload.context.summaries ?? 0} total_tokens=${payload.context.total_tokens ?? 0}`
        );
        if (payload.context.budget_warnings && payload.context.budget_warnings.length > 0) {
          this.warn(`Context budget warnings: ${payload.context.budget_warnings.join(' | ')}`);
        }
        if (payload.context.warnings && payload.context.warnings.length > 0) {
          this.warn(`Context summarization warnings: ${payload.context.warnings.join(' | ')}`);
        }
        if (flags.verbose && payload.context.summaries_preview && payload.context.summaries_preview.length > 0) {
          this.log('Context summary preview:');
          for (const preview of payload.context.summaries_preview) {
            this.log(`  - ${preview.file_path} (${preview.chunk_id}): ${preview.summary}`);
          }
        }
      }
    }

    if (payload.traceability) {
      this.log(
        `Traceability: ${payload.traceability.total_links} links (${payload.traceability.prd_goals_mapped} PRD goals → ${payload.traceability.spec_requirements_mapped} spec requirements → ${payload.traceability.execution_tasks_mapped} tasks)`
      );
      this.log(`Last updated: ${payload.traceability.last_updated}`);
      if (payload.traceability.outstanding_gaps > 0) {
        this.warn(`Outstanding gaps: ${payload.traceability.outstanding_gaps}`);
      } else {
        this.log('Outstanding gaps: None');
      }
      if (flags.verbose) {
        this.log(`Trace file: ${payload.traceability.trace_path}`);
      }
    }

    if (payload.manifest_error) {
      this.warn(`Manifest read warning: ${payload.manifest_error}`);
    }

    if (flags['show-costs']) {
      if (payload.telemetry?.costs_file) {
        this.log(`Telemetry (costs): ${payload.telemetry.costs_file}`);
      } else {
        this.log('Telemetry (costs): not recorded in manifest');
      }
    }

    if (flags.verbose) {
      if (payload.timestamps) {
        const start = payload.timestamps.started_at ? ` started=${payload.timestamps.started_at}` : '';
        const complete = payload.timestamps.completed_at ? ` completed=${payload.timestamps.completed_at}` : '';
        this.log(
          `Timestamps: created=${payload.timestamps.created_at}${start}${complete}`
        );
      }

      if (payload.config_errors.length > 0) {
        this.warn(`Config validation issues: ${payload.config_errors.join(' | ')}`);
      }

      if (payload.config_warnings.length > 0) {
        this.log(`Config warnings: ${payload.config_warnings.join(' | ')}`);
      }

      this.log(`Manifest schema: ${payload.manifest_schema_doc}`);
      this.log(`Manifest template: ${payload.manifest_template}`);
    }

    this.log('');
    for (const note of payload.notes) {
      this.log(`• ${note}`);
    }
    this.log('');
  }
}

function truncateSummary(summary: string, maxLength = 240): string {
  if (summary.length <= maxLength) {
    return summary;
  }
  return `${summary.slice(0, maxLength - 1)}…`;
}
