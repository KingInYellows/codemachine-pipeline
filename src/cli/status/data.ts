import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  readManifest,
  type RunManifest,
} from '../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../utils/safeJson';
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
} from '../../workflows/branchProtectionReporter';
import type { PRMetadata } from '../pr/shared';
import { RateLimitReporter } from '../../telemetry/rateLimitReporter';
import { createResearchCoordinator } from '../../workflows/researchCoordinator';
import { withSpan } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { LogContext } from '../../core/sharedTypes.js';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import type { RunDirectorySettings } from '../utils/runDirectory';
import { truncateSummary } from './renderers';
import {
  MANIFEST_FILE,
  type ManifestLoadResult,
  type StatusContextPayload,
  type StatusTraceabilityPayload,
  type StatusPlanPayload,
  type StatusValidationPayload,
  type StatusBranchProtectionPayload,
  type StatusIntegrationsPayload,
  type StatusRateLimitsPayload,
  type StatusResearchPayload,
} from './types';

/** Simple logger interface accepted by data-loading functions. */
export interface DataLogger {
  debug: (msg: string, meta?: LogContext) => void;
  info: (msg: string, meta?: LogContext) => void;
  warn: (msg: string, meta?: LogContext) => void;
}

export async function loadManifestSnapshot(
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

export async function loadManifestWithTracing(
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
        const result = await loadManifestSnapshot(baseDir, featureId);
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

  return loadManifestSnapshot(baseDir, featureId);
}

export async function loadContextStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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

  await attachSummarizationMetadata(docPayload, contextDir, logger);
  await attachCostTelemetry(docPayload, runDir, logger);

  return docPayload;
}

export async function loadTraceabilityStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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
      logger?.warn('Failed to load traceability', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_TRACEABILITY_LOAD_FAILED',
      });
    }
    return undefined;
  }
}

export async function loadPlanStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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
      logger?.warn('Failed to load plan', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        plan_path: planPath,
        error_code: 'STATUS_PLAN_LOAD_FAILED',
      });
    }
    return {
      plan_path: planPath,
      plan_exists: false,
    };
  }
}

export async function loadValidationStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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
      logger?.warn('Failed to load queue validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        queue_validation_path: queueValidationPath,
        error_code: 'STATUS_QUEUE_VALIDATION_LOAD_FAILED',
      });
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
      logger?.warn('Failed to load plan validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        plan_validation_path: planValidationPath,
        error_code: 'STATUS_PLAN_VALIDATION_LOAD_FAILED',
      });
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

export async function loadBranchProtectionStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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
      logger?.warn('Failed to load branch protection', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_BRANCH_PROTECTION_LOAD_FAILED',
      });
    }
    return undefined;
  }
}

export async function loadIntegrationsStatus(
  settings: RunDirectorySettings,
  featureId: string,
  logger?: DataLogger
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
      const prMetadata = await loadPRMetadata(runDir);
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
      logger?.warn('Failed to load GitHub integration data', {
        error: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_GITHUB_INTEGRATION_LOAD_FAILED',
      });
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
          logger?.warn('Failed to read manifest for Linear status', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            manifest_path: manifestPath,
            error_code: 'STATUS_LINEAR_MANIFEST_READ_FAILED',
          });
        }
      }

      integrations.linear = linear;
    } catch (error) {
      logger?.warn('Failed to load Linear integration data', {
        error: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_LINEAR_INTEGRATION_LOAD_FAILED',
      });
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

export async function loadRateLimitsStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
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
      logger?.warn('Failed to load rate limits', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_RATE_LIMITS_LOAD_FAILED',
      });
    }
    return undefined;
  }
}

export async function loadResearchStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger,
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
      logger?.warn('Failed to access research directory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        research_dir: researchDir,
        error_code: 'STATUS_RESEARCH_DIR_ACCESS_FAILED',
      });
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
      logger as StructuredLogger,
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
    logger?.warn('Failed to load research status', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      research_dir: researchDir,
      error_code: 'STATUS_RESEARCH_LOAD_FAILED',
    });
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

export async function attachSummarizationMetadata(
  payload: StatusContextPayload,
  contextDir: string,
  logger?: DataLogger
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

export async function refreshBranchProtectionArtifact(
  settings: RunDirectorySettings,
  featureId: string,
  manifest: RunManifest | undefined,
  logger: StructuredLogger | undefined,
  traceManager: TraceManager | undefined,
  parentSpan: ActiveSpan | undefined
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
    prMetadata = await loadPRMetadata(runDir);
  } catch (error) {
    logger?.warn('Failed to read PR metadata for branch protection refresh', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: runDir,
      error_code: 'STATUS_PR_METADATA_READ_FAILED',
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
        report.validation_mismatch = await detectValidationMismatch(runDir, report.required_checks);
      } catch (error) {
        logger?.warn('Failed to compare ExecutionTask validations with required checks', {
          error: error instanceof Error ? error.message : 'unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          run_dir: runDir,
          error_code: 'STATUS_BRANCH_PROTECTION_VALIDATION_COMPARE_FAILED',
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
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: runDir,
      error_code: 'STATUS_BRANCH_PROTECTION_REFRESH_FAILED',
    });
  }
}

export async function loadPRMetadata(runDir: string): Promise<PRMetadata | null> {
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
