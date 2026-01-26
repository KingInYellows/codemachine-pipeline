import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  readManifest,
  type RunManifest,
} from '../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../utils/safeJson.js';
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
import { loadPlanSummary } from '../../workflows/taskPlanner';
import {
  createBranchProtectionAdapter,
  type BranchProtectionConfig,
} from '../../adapters/github/branchProtection';
import {
  loadReport as loadBranchProtectionReport,
  generateSummary as generateBranchProtectionSummary,
  generateReport as buildBranchProtectionReport,
  persistReport as persistBranchProtectionReport,
  detectValidationMismatch,
  type ValidationMismatch,
} from '../../workflows/branchProtectionReporter';
import type { PRMetadata } from '../pr/shared';
import { RateLimitReporter } from '../../telemetry/rateLimitReporter';
import { createResearchCoordinator } from '../../workflows/researchCoordinator';

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
  plan?: StatusPlanPayload;
  validation?: StatusValidationPayload;
  branch_protection?: StatusBranchProtectionPayload;
  integrations?: StatusIntegrationsPayload;
  rate_limits?: StatusRateLimitsPayload;
  research?: StatusResearchPayload;
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

interface StatusPlanPayload {
  plan_path: string;
  plan_exists: boolean;
  total_tasks?: number;
  entry_tasks?: number;
  blocked_tasks?: number;
  task_type_breakdown?: Record<string, number>;
  dag_metadata?: {
    parallel_paths?: number;
    critical_path_depth?: number;
    generated_at: string;
  };
  checksum?: string;
  last_updated?: string;
}

interface StatusValidationPayload {
  has_validation_data: boolean;
  queue_valid?: boolean;
  plan_valid?: boolean;
  integrity_warnings?: string[];
}

interface StatusBranchProtectionPayload {
  protected: boolean;
  compliant: boolean;
  blockers_count: number;
  blockers: string[];
  missing_checks: string[];
  reviews_status: {
    required: number;
    completed: number;
    satisfied: boolean;
  };
  branch_status: {
    up_to_date: boolean;
    stale: boolean;
  };
  auto_merge: {
    allowed: boolean;
    enabled: boolean;
  };
  evaluated_at?: string;
  validation_mismatch?: ValidationMismatch;
}

interface StatusIntegrationsPayload {
  github?: {
    enabled: boolean;
    rate_limit?: {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
    };
    pr_status?: {
      number: number;
      state: string;
      mergeable: boolean | null;
      url: string;
    };
    warnings: string[];
  };
  linear?: {
    enabled: boolean;
    rate_limit?: {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
    };
    issue_status?: {
      identifier: string;
      state: string;
      url: string;
    };
    warnings: string[];
  };
}

interface StatusRateLimitsPayload {
  providers: Record<
    string,
    {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
      manual_ack_required: boolean;
      recent_hit_count: number;
    }
  >;
  summary: {
    any_in_cooldown: boolean;
    any_requires_ack: boolean;
    providers_in_cooldown: number;
  };
  warnings: string[];
}

interface StatusResearchPayload {
  total_tasks: number;
  pending_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  cached_tasks: number;
  stale_tasks: number;
  research_dir: string;
  tasks_file: string;
  warnings: string[];
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

      const planInfo = featureId
        ? await this.loadPlanStatus(settings.baseDir, featureId)
        : undefined;

      const validationInfo = featureId
        ? await this.loadValidationStatus(settings.baseDir, featureId)
        : undefined;

      if (featureId) {
        await this.refreshBranchProtectionArtifact(
          settings,
          featureId,
          manifestInfo?.manifest,
          logger,
          traceManager,
          commandSpan
        );
      }

      const branchProtectionInfo = featureId
        ? await this.loadBranchProtectionStatus(settings.baseDir, featureId)
        : undefined;

      const integrationsInfo = featureId
        ? await this.loadIntegrationsStatus(settings, featureId)
        : undefined;

      const rateLimitsInfo = featureId
        ? await this.loadRateLimitsStatus(settings.baseDir, featureId)
        : undefined;

      const researchInfo = featureId
        ? await this.loadResearchStatus(settings.baseDir, featureId, logger, metrics)
        : undefined;

      const payload = this.buildStatusPayload(
        featureId,
        settings,
        manifestInfo,
        contextInfo,
        traceInfo,
        planInfo,
        validationInfo,
        branchProtectionInfo,
        integrationsInfo,
        rateLimitsInfo,
        researchInfo
      );

      if (typedFlags.json) {
        // Disable stderr mirroring in JSON mode (already set in createCliLogger)
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload, typedFlags);
      }

      // Record success metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'status',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'status',
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
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'status',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'status',
          exit_code: '1',
        });
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
    traceInfo?: StatusTraceabilityPayload,
    planInfo?: StatusPlanPayload,
    validationInfo?: StatusValidationPayload,
    branchProtectionInfo?: StatusBranchProtectionPayload,
    integrationsInfo?: StatusIntegrationsPayload,
    rateLimitsInfo?: StatusRateLimitsPayload,
    researchInfo?: StatusResearchPayload
  ): StatusPayload {
    const manifest = manifestInfo?.manifest;
    const manifestPath =
      manifestInfo?.manifestPath ?? this.deriveManifestPath(settings.baseDir, featureId);

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
      ...(planInfo && { plan: planInfo }),
      ...(validationInfo && { validation: validationInfo }),
      ...(branchProtectionInfo && { branch_protection: branchProtectionInfo }),
      ...(integrationsInfo && { integrations: integrationsInfo }),
      ...(rateLimitsInfo && { rate_limits: rateLimitsInfo }),
      ...(researchInfo && { research: researchInfo }),
    };

    if (manifest?.title) {
      payload.title = manifest.title;
    }

    if (manifest?.source) {
      payload.source = manifest.source;
    }

    if (manifestInfo?.error) {
      payload.manifest_error = manifestInfo.error;
      payload.notes.push(
        'Manifest could not be read; inspect manifest_error for remediation guidance.'
      );
    }

    if (!manifest) {
      payload.notes.push(
        'No manifest found. Run "ai-feature start" to provision a new feature run directory.'
      );
    }

    return payload;
  }

  private async loadPlanStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusPlanPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);
    const planPath = path.join(runDir, 'plan.json');

    try {
      const planSummary = await loadPlanSummary(runDir);
      if (!planSummary) {
        return {
          plan_path: planPath,
          plan_exists: false,
        };
      }

      const result: StatusPlanPayload = {
        plan_path: planPath,
        plan_exists: true,
        total_tasks: planSummary.totalTasks,
        entry_tasks: planSummary.entryTasks.length,
        blocked_tasks: planSummary.blockedTasks,
        task_type_breakdown: planSummary.taskTypeBreakdown,
        ...(planSummary.checksum !== undefined && { checksum: planSummary.checksum }),
        ...(planSummary.lastUpdated && { last_updated: planSummary.lastUpdated }),
      };

      if (planSummary.dag) {
        result.dag_metadata = {
          ...(planSummary.dag.parallelPaths !== undefined && {
            parallel_paths: planSummary.dag.parallelPaths,
          }),
          ...(planSummary.dag.criticalPathDepth !== undefined && {
            critical_path_depth: planSummary.dag.criticalPathDepth,
          }),
          generated_at: planSummary.dag.generatedAt,
        };
      }

      return result;
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load plan:', error instanceof Error ? error.message : 'Unknown error');
      }
      return {
        plan_path: planPath,
        plan_exists: false,
      };
    }
  }

  private async loadValidationStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusValidationPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);

    // Check for validation artifacts (queue validation, plan validation)
    const queueValidationPath = path.join(runDir, 'queue_validation.json');
    const planValidationPath = path.join(runDir, 'plan_validation.json');

    let queueValid: boolean | undefined;
    let planValid: boolean | undefined;
    const integrityWarnings: string[] = [];

    try {
      const queueContent = await fs.readFile(queueValidationPath, 'utf-8');
      const queueData = safeJsonParse<{ valid: boolean; errors?: unknown[] }>(queueContent);
      if (queueData) {
        queueValid = queueData.valid;
        if (!queueData.valid && queueData.errors && Array.isArray(queueData.errors)) {
          integrityWarnings.push(`Queue validation found ${queueData.errors.length} errors`);
        }
      }
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load queue validation:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    try {
      const planContent = await fs.readFile(planValidationPath, 'utf-8');
      const planData = safeJsonParse<{ valid: boolean; errors?: string[] }>(planContent);
      if (planData) {
        planValid = planData.valid;
        if (!planData.valid && planData.errors && Array.isArray(planData.errors)) {
          integrityWarnings.push(...planData.errors);
        }
      }
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load plan validation:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    const hasValidationData = queueValid !== undefined || planValid !== undefined;

    if (!hasValidationData) {
      return undefined;
    }

    const validationPayload: StatusValidationPayload = {
      has_validation_data: hasValidationData,
    };

    if (queueValid !== undefined) {
      validationPayload.queue_valid = queueValid;
    }

    if (planValid !== undefined) {
      validationPayload.plan_valid = planValid;
    }

    if (integrityWarnings.length > 0) {
      validationPayload.integrity_warnings = integrityWarnings;
    }

    return validationPayload;
  }

  private async loadBranchProtectionStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusBranchProtectionPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);

    try {
      const report = await loadBranchProtectionReport(runDir);

      if (!report) {
        return undefined;
      }

      const summary = generateBranchProtectionSummary(report);

      return {
        ...summary,
        evaluated_at: report.evaluated_at,
        ...(report.validation_mismatch && { validation_mismatch: report.validation_mismatch }),
      };
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load branch protection:', error instanceof Error ? error.message : 'Unknown error');
      }
      return undefined;
    }
  }

  private async refreshBranchProtectionArtifact(
    settings: RunDirectorySettings,
    featureId: string,
    manifest?: RunManifest,
    logger?: StructuredLogger,
    traceManager?: TraceManager,
    parentSpan?: ActiveSpan
  ): Promise<void> {
    const config = settings.config;
    if (!config?.github.enabled) {
      return;
    }

    const tokenEnvVar = config.github.token_env_var;
    const token = tokenEnvVar ? process.env[tokenEnvVar] : undefined;
    if (!token) {
      logger?.warn('Skipping branch protection refresh: GitHub token not found', {
        token_env_var: tokenEnvVar,
      });
      return;
    }

    const repoUrl = config.project.repo_url;
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) {
      logger?.warn('Skipping branch protection refresh: Unable to parse GitHub repository URL', {
        repo_url: repoUrl,
      });
      return;
    }

    const [, owner, repo] = match;
    const runDir = getRunDirectoryPath(settings.baseDir, featureId);

    let prMetadata: PRMetadata | null;
    try {
      prMetadata = await this.loadPRMetadata(runDir);
    } catch (error) {
      logger?.warn('Failed to read PR metadata for branch protection refresh', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
      return;
    }

    if (!prMetadata) {
      logger?.debug('Skipping branch protection refresh: No PR metadata recorded', {
        feature_id: featureId,
      });
      return;
    }

    const branch = prMetadata.branch;
    const baseBranch = prMetadata.base_branch ?? manifest?.repo.default_branch;

    if (!branch || !baseBranch) {
      logger?.warn('Skipping branch protection refresh: Missing branch metadata', {
        branch,
        base_branch: baseBranch,
      });
      return;
    }

    const executeRefresh = async (): Promise<void> => {
      const adapterConfig: BranchProtectionConfig = {
        owner,
        repo,
        token,
        baseUrl: config.github.api_base_url,
        runDir,
      };

      if (logger) {
        adapterConfig.logger = logger;
      }

      const adapter = createBranchProtectionAdapter(adapterConfig);

      const compliance = await adapter.evaluateCompliance({
        branch,
        sha: branch,
        base_sha: baseBranch,
        pull_number: prMetadata?.pr_number,
      });

      const report = buildBranchProtectionReport(featureId, compliance, {
        owner,
        repo,
        base_sha: baseBranch,
        pull_number: prMetadata?.pr_number,
      });

      if (report.required_checks.length > 0) {
        try {
          report.validation_mismatch = await detectValidationMismatch(
            runDir,
            report.required_checks
          );
        } catch (error) {
          logger?.warn('Failed to compare ExecutionTask validations with required checks', {
            error: error instanceof Error ? error.message : 'unknown error',
          });
        }
      }

      await persistBranchProtectionReport(runDir, report);

      logger?.info('Branch protection report refreshed', {
        branch,
        base_branch: baseBranch,
        compliant: report.compliant,
        blockers: report.blockers.length,
      });
    };

    try {
      if (traceManager && parentSpan) {
        await withSpan(
          traceManager,
          'status.refresh_branch_protection',
          async (span) => {
            span.setAttribute('feature_id', featureId);
            span.setAttribute('branch', branch);
            span.setAttribute('base_branch', baseBranch);
            if (prMetadata?.pr_number) {
              span.setAttribute('pr_number', prMetadata.pr_number);
            }
            await executeRefresh();
          },
          parentSpan.context
        );
      } else {
        await executeRefresh();
      }
    } catch (error) {
      logger?.warn('Branch protection refresh failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  private async loadPRMetadata(runDir: string): Promise<PRMetadata | null> {
    const prPath = path.join(runDir, 'pr.json');
    try {
      const content = await fs.readFile(prPath, 'utf-8');
      const parsed = safeJsonParse<PRMetadata>(content);
      return parsed ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async loadIntegrationsStatus(
    settings: RunDirectorySettings,
    featureId: string
  ): Promise<StatusIntegrationsPayload | undefined> {
    const runDir = getRunDirectoryPath(settings.baseDir, featureId);
    const integrations: StatusIntegrationsPayload = {};

    // GitHub integration
    if (settings.config?.github.enabled) {
      const githubWarnings: string[] = [];

      try {
        const rateLimitReport = await RateLimitReporter.generateReport(runDir);
        const githubProvider = rateLimitReport.providers['github'];

        const github: StatusIntegrationsPayload['github'] = {
          enabled: true,
          warnings: githubWarnings,
        };

        if (githubProvider) {
          github.rate_limit = {
            remaining: githubProvider.remaining,
            reset_at: githubProvider.resetAt,
            in_cooldown: githubProvider.inCooldown,
          };

          if (githubProvider.inCooldown) {
            githubWarnings.push(`GitHub API is in cooldown until ${githubProvider.resetAt}`);
          }
          if (githubProvider.manualAckRequired) {
            githubWarnings.push(
              `GitHub rate limit requires manual acknowledgement (${githubProvider.recentHitCount} consecutive hits)`
            );
          }
        }

        // Load PR status
        const prMetadata = await this.loadPRMetadata(runDir);
        if (prMetadata && prMetadata.pr_number) {
          github.pr_status = {
            number: prMetadata.pr_number,
            state: prMetadata.state ?? 'unknown',
            mergeable: prMetadata.mergeable ?? null,
            url: prMetadata.url ?? '',
          };
        }

        integrations.github = github;
      } catch (error) {
        integrations.github = {
          enabled: true,
          warnings: [
            `Failed to load GitHub integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
          ],
        };
      }
    }

    // Linear integration
    if (settings.config?.linear?.enabled) {
      const linearWarnings: string[] = [];

      try {
        const rateLimitReport = await RateLimitReporter.generateReport(runDir);
        const linearProvider = rateLimitReport.providers['linear'];

        const linear: StatusIntegrationsPayload['linear'] = {
          enabled: true,
          warnings: linearWarnings,
        };

        if (linearProvider) {
          linear.rate_limit = {
            remaining: linearProvider.remaining,
            reset_at: linearProvider.resetAt,
            in_cooldown: linearProvider.inCooldown,
          };

          if (linearProvider.inCooldown) {
            linearWarnings.push(`Linear API is in cooldown until ${linearProvider.resetAt}`);
          }
          if (linearProvider.manualAckRequired) {
            linearWarnings.push(
              `Linear rate limit requires manual acknowledgement (${linearProvider.recentHitCount} consecutive hits)`
            );
          }
        }

        // Load Linear issue status from manifest
        const manifestPath = path.join(runDir, 'manifest.json');
        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = safeJsonParse<RunManifest>(manifestContent);
          if (manifest && manifest.source === 'linear' && manifest.title) {
            linear.issue_status = {
              identifier: manifest.title.split(':')[0]?.trim() ?? 'unknown',
              state: 'tracked',
              url: '',
            };
          }
        } catch (error) {
          // Log unexpected errors (non-ENOENT) for debugging
          if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
            console.warn('[status] Failed to read manifest for Linear status:', error instanceof Error ? error.message : 'Unknown error');
          }
        }

        integrations.linear = linear;
      } catch (error) {
        integrations.linear = {
          enabled: true,
          warnings: [
            `Failed to load Linear integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
          ],
        };
      }
    }

    return Object.keys(integrations).length > 0 ? integrations : undefined;
  }

  private async loadRateLimitsStatus(
    baseDir: string,
    featureId: string
  ): Promise<StatusRateLimitsPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);

    try {
      const report = await RateLimitReporter.generateReport(runDir);

      if (Object.keys(report.providers).length === 0) {
        return undefined;
      }

      const providers: StatusRateLimitsPayload['providers'] = {};
      const warnings: string[] = [];

      for (const [providerName, providerReport] of Object.entries(report.providers)) {
        providers[providerName] = {
          remaining: providerReport.remaining,
          reset_at: providerReport.resetAt,
          in_cooldown: providerReport.inCooldown,
          manual_ack_required: providerReport.manualAckRequired,
          recent_hit_count: providerReport.recentHitCount,
        };

        if (providerReport.inCooldown) {
          warnings.push(`${providerName}: In cooldown until ${providerReport.resetAt}`);
        }
        if (providerReport.manualAckRequired) {
          warnings.push(
            `${providerName}: Manual acknowledgement required (${providerReport.recentHitCount} consecutive rate limit hits)`
          );
        }
      }

      return {
        providers,
        summary: {
          any_in_cooldown: report.summary.anyInCooldown,
          any_requires_ack: report.summary.anyRequiresAck,
          providers_in_cooldown: report.summary.providersInCooldown,
        },
        warnings,
      };
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load rate limits:', error instanceof Error ? error.message : 'Unknown error');
      }
      return undefined;
    }
  }

  private async loadResearchStatus(
    baseDir: string,
    featureId: string,
    logger?: StructuredLogger,
    metrics?: MetricsCollector
  ): Promise<StatusResearchPayload | undefined> {
    const runDir = getRunDirectoryPath(baseDir, featureId);
    const researchDir = path.join(runDir, 'research');
    const tasksFile = path.join(researchDir, 'tasks.jsonl');

    // Check if research directory exists
    try {
      await fs.access(researchDir);
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to access research directory:', error instanceof Error ? error.message : 'Unknown error');
      }
      return undefined;
    }

    try {
      // Create coordinator to get diagnostics
      if (!logger || !metrics) {
        return {
          total_tasks: 0,
          pending_tasks: 0,
          in_progress_tasks: 0,
          completed_tasks: 0,
          failed_tasks: 0,
          cached_tasks: 0,
          stale_tasks: 0,
          research_dir: researchDir,
          tasks_file: tasksFile,
          warnings: ['Research coordinator telemetry unavailable'],
        };
      }

      const coordinator = createResearchCoordinator(
        {
          repoRoot: process.cwd(),
          runDir,
          featureId,
        },
        logger,
        metrics
      );

      const diagnostics = await coordinator.getDiagnostics();
      const warnings: string[] = [...diagnostics.warnings];

      if (diagnostics.errors.length > 0) {
        warnings.push(...diagnostics.errors);
      }

      // Count stale tasks
      const allTasks = await coordinator.listTasks({});
      const { isCachedResultFresh } = await import('../../core/models/ResearchTask.js');
      const staleTasks = allTasks.filter((task) => {
        if (task.status !== 'completed' || !task.results) return false;
        const freshnessReq = task.freshness_requirements ?? {
          max_age_hours: 24,
          force_fresh: false,
        };
        return !isCachedResultFresh(task.results, freshnessReq);
      });

      return {
        total_tasks: diagnostics.totalTasks,
        pending_tasks: diagnostics.pendingTasks,
        in_progress_tasks: diagnostics.inProgressTasks,
        completed_tasks: diagnostics.completedTasks,
        failed_tasks: diagnostics.failedTasks,
        cached_tasks: diagnostics.cachedTasks,
        stale_tasks: staleTasks.length,
        research_dir: researchDir,
        tasks_file: tasksFile,
        warnings,
      };
    } catch (error) {
      return {
        total_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        cached_tasks: 0,
        stale_tasks: 0,
        research_dir: researchDir,
        tasks_file: tasksFile,
        warnings: [
          `Failed to load research status: ${error instanceof Error ? error.message : 'unknown error'}`,
        ],
      };
    }
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
    } catch (error) {
      // Log unexpected errors (non-ENOENT) for debugging
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[status] Failed to load traceability:', error instanceof Error ? error.message : 'Unknown error');
      }
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
    docPayload = {
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
      payload.warnings = [...(payload.warnings ?? []), 'Failed to read summarization metadata'];
    }
  }

  private async attachCostTelemetry(payload: StatusContextPayload, runDir: string): Promise<void> {
    const costsPath = path.join(runDir, 'telemetry', 'costs.json');

    try {
      const content = await fs.readFile(costsPath, 'utf-8');
      const costs = safeJsonParse<{
        totals?: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
          totalCostUsd?: number;
        };
        warnings?: string[];
      }>(content);

      if (costs && costs.totals) {
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

      if (costs && costs.warnings && costs.warnings.length > 0) {
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
        payload.approvals.pending.forEach((gate) => {
          this.warn(
            `  • ${gate.toUpperCase()} - Review artifact and run: ai-feature approve ${gate} --signer "<your-email>"`
          );
        });
      }

      // Show completed approvals in verbose mode
      if (flags.verbose && payload.approvals.completed.length > 0) {
        this.log('Completed approvals:');
        payload.approvals.completed.forEach((gate) => {
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
        if (
          flags.verbose &&
          payload.context.summaries_preview &&
          payload.context.summaries_preview.length > 0
        ) {
          this.log('Context summary preview:');
          for (const preview of payload.context.summaries_preview) {
            this.log(`  - ${preview.file_path} (${preview.chunk_id}): ${preview.summary}`);
          }
        }
      }
    }

    if (payload.plan) {
      if (payload.plan.plan_exists) {
        this.log(
          `Plan: ${payload.plan.total_tasks} tasks (${payload.plan.entry_tasks} entry, ${payload.plan.blocked_tasks} blocked)`
        );
        if (payload.plan.dag_metadata) {
          this.log(
            `DAG: parallel_paths=${payload.plan.dag_metadata.parallel_paths ?? 'N/A'} depth=${payload.plan.dag_metadata.critical_path_depth ?? 'N/A'}`
          );
        }
        if (flags.verbose && payload.plan.task_type_breakdown) {
          this.log('Task types:');
          for (const [taskType, count] of Object.entries(payload.plan.task_type_breakdown)) {
            this.log(`  • ${taskType}: ${count}`);
          }
        }
        if (flags.verbose && payload.plan.checksum) {
          this.log(`Plan checksum: ${payload.plan.checksum.substring(0, 16)}...`);
        }
      } else {
        this.log('Plan: not generated yet');
      }
    }

    if (payload.validation) {
      const validationParts: string[] = [];
      if (payload.validation.queue_valid !== undefined) {
        validationParts.push(`queue=${payload.validation.queue_valid ? '✓' : '✗'}`);
      }
      if (payload.validation.plan_valid !== undefined) {
        validationParts.push(`plan=${payload.validation.plan_valid ? '✓' : '✗'}`);
      }
      if (validationParts.length > 0) {
        this.log(`Validation: ${validationParts.join(' ')}`);
      }
      if (
        payload.validation.integrity_warnings &&
        payload.validation.integrity_warnings.length > 0
      ) {
        this.warn('Integrity warnings:');
        payload.validation.integrity_warnings.forEach((warning) => {
          this.warn(`  • ${warning}`);
        });
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

    if (payload.branch_protection) {
      const bp = payload.branch_protection;
      this.log('');
      this.log('Branch Protection:');
      this.log(`  Protected: ${bp.protected ? 'Yes' : 'No'}`);
      this.log(`  Compliant: ${bp.compliant ? 'Yes' : 'No'}`);

      if (bp.blockers_count > 0) {
        this.warn(`  Blockers (${bp.blockers_count}):`);
        bp.blockers.forEach((blocker) => {
          this.warn(`    • ${blocker}`);
        });
      }

      if (bp.missing_checks.length > 0) {
        this.log(`  Missing Checks:`);
        bp.missing_checks.forEach((check) => {
          this.log(`    - ${check}`);
        });
      }

      this.log(
        `  Reviews: ${bp.reviews_status.completed}/${bp.reviews_status.required} (${bp.reviews_status.satisfied ? 'satisfied' : 'not satisfied'})`
      );
      this.log(`  Branch Up-to-date: ${bp.branch_status.up_to_date ? 'Yes' : 'No'}`);
      this.log(`  Auto-merge Allowed: ${bp.auto_merge.allowed ? 'Yes' : 'No'}`);

      if (bp.validation_mismatch) {
        const { missing_in_registry, extra_in_registry, recommendations } = bp.validation_mismatch;
        if (missing_in_registry.length === 0 && extra_in_registry.length === 0) {
          this.log('  Validation Alignment: ExecutionTask validations cover all required checks');
        } else {
          this.log('  Validation Alignment:');
          if (missing_in_registry.length > 0) {
            this.warn(
              `    Missing ExecutionTask validations for: ${missing_in_registry.join(', ')}`
            );
          }
          if (extra_in_registry.length > 0) {
            this.log(
              `    Extra validations not required by branch protection: ${extra_in_registry.join(', ')}`
            );
          }
          if (flags.verbose && recommendations.length > 0) {
            this.log('    Recommendations:');
            recommendations.forEach((rec) => this.log(`      • ${rec}`));
          }
        }
      }

      if (flags.verbose && bp.evaluated_at) {
        this.log(`  Last Evaluated: ${bp.evaluated_at}`);
      }
    }

    // Rate limits section (API ledger block per architecture)
    if (payload.rate_limits) {
      const rl = payload.rate_limits;
      this.log('');
      this.log('────────────────────────────────────────────────────────────');
      this.log('API Ledger (Rate Limits)');
      this.log('────────────────────────────────────────────────────────────');

      if (Object.keys(rl.providers).length === 0) {
        this.log('No rate limit data recorded yet.');
      } else {
        for (const [providerName, providerData] of Object.entries(rl.providers)) {
          this.log(`\n${providerName}:`);
          this.log(`  Remaining: ${providerData.remaining}`);
          this.log(`  Reset: ${providerData.reset_at}`);
          this.log(`  In Cooldown: ${providerData.in_cooldown ? 'Yes' : 'No'}`);

          if (providerData.manual_ack_required) {
            this.warn(
              `  ⚠ Manual Acknowledgement Required (${providerData.recent_hit_count} consecutive hits)`
            );
          }

          if (flags.verbose) {
            this.log(`  Recent Hits: ${providerData.recent_hit_count}`);
          }
        }
      }

      if (rl.warnings.length > 0) {
        this.log('\nRate Limit Warnings:');
        rl.warnings.forEach((warning) => {
          this.warn(`  ⚠ ${warning}`);
        });
      }

      this.log('────────────────────────────────────────────────────────────');
    }

    // Integrations section
    if (payload.integrations) {
      const integrations = payload.integrations;
      this.log('');
      this.log('Integration Status:');

      if (integrations.github) {
        this.log('  GitHub:');
        this.log(`    Enabled: ${integrations.github.enabled ? 'Yes' : 'No'}`);

        if (integrations.github.rate_limit) {
          this.log(`    Rate Limit: ${integrations.github.rate_limit.remaining} remaining`);
          if (integrations.github.rate_limit.in_cooldown) {
            this.warn(`    ⚠ In cooldown until ${integrations.github.rate_limit.reset_at}`);
          }
        }

        if (integrations.github.pr_status) {
          this.log(
            `    PR #${integrations.github.pr_status.number}: ${integrations.github.pr_status.state}`
          );
          this.log(
            `    Mergeable: ${integrations.github.pr_status.mergeable === null ? 'Unknown' : integrations.github.pr_status.mergeable ? 'Yes' : 'No'}`
          );
          if (flags.verbose && integrations.github.pr_status.url) {
            this.log(`    URL: ${integrations.github.pr_status.url}`);
          }
        }

        if (integrations.github.warnings.length > 0) {
          integrations.github.warnings.forEach((warning) => {
            this.warn(`    ⚠ ${warning}`);
          });
        }
      }

      if (integrations.linear) {
        this.log('  Linear:');
        this.log(`    Enabled: ${integrations.linear.enabled ? 'Yes' : 'No'}`);

        if (integrations.linear.rate_limit) {
          this.log(`    Rate Limit: ${integrations.linear.rate_limit.remaining} remaining`);
          if (integrations.linear.rate_limit.in_cooldown) {
            this.warn(`    ⚠ In cooldown until ${integrations.linear.rate_limit.reset_at}`);
          }
        }

        if (integrations.linear.issue_status) {
          this.log(
            `    Issue: ${integrations.linear.issue_status.identifier} (${integrations.linear.issue_status.state})`
          );
          if (flags.verbose && integrations.linear.issue_status.url) {
            this.log(`    URL: ${integrations.linear.issue_status.url}`);
          }
        }

        if (integrations.linear.warnings.length > 0) {
          integrations.linear.warnings.forEach((warning) => {
            this.warn(`    ⚠ ${warning}`);
          });
        }
      }
    }

    // Research section
    if (payload.research) {
      const research = payload.research;
      this.log('');
      this.log('Research Tasks:');
      this.log(`  Total: ${research.total_tasks}`);
      this.log(`  Pending: ${research.pending_tasks}, In Progress: ${research.in_progress_tasks}`);
      this.log(`  Completed: ${research.completed_tasks}, Failed: ${research.failed_tasks}`);
      this.log(`  Cached: ${research.cached_tasks}, Stale: ${research.stale_tasks}`);
      this.log(`  Research Directory: ${research.research_dir}`);
      this.log(`  Snapshot: ${research.tasks_file}`);

      if (research.warnings.length > 0) {
        research.warnings.forEach((warning) => {
          this.warn(`  ⚠ ${warning}`);
        });
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
        const start = payload.timestamps.started_at
          ? ` started=${payload.timestamps.started_at}`
          : '';
        const complete = payload.timestamps.completed_at
          ? ` completed=${payload.timestamps.completed_at}`
          : '';
        this.log(`Timestamps: created=${payload.timestamps.created_at}${start}${complete}`);
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
