import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import {
  BranchProtectionAdapter,
  type BranchProtectionConfig,
} from '../../../adapters/github/branchProtection';
import { evaluateCompliance } from '../../../workflows/branchComplianceChecker';
import {
  generateReport as buildBranchProtectionReport,
  detectValidationMismatch,
} from '../../../workflows/branchProtectionReporter';
import { persistReport as persistBranchProtectionReport } from '../../../persistence/branchProtectionStore';
import type { PRMetadata } from '../../pr/shared';
import { withSpan } from '../../../telemetry/traces';
import type { StructuredLogger } from '../../../telemetry/logger';
import type { TraceManager, ActiveSpan } from '../../../telemetry/traces';
import type { RunDirectorySettings } from '../../utils/runDirectory';
import type { RunManifest } from '../../../persistence/runDirectoryManager';
import { loadPRMetadata } from './prMetadataData';

/** Validated context required to perform a branch protection refresh. */
interface RefreshContext {
  token: string;
  owner: string;
  repo: string;
  config: NonNullable<RunDirectorySettings['config']>;
  runDir: string;
  branch: string;
  baseBranch: string;
  prNumber: number | undefined;
}

/**
 * Validate all preconditions for a branch protection refresh.
 * Returns `null` when any guard fails (with appropriate log messages).
 */
async function validateRefreshContext(
  settings: RunDirectorySettings,
  featureId: string,
  manifest: RunManifest | undefined,
  logger: StructuredLogger | undefined
): Promise<RefreshContext | null> {
  const config = settings.config;
  if (!config?.github.enabled) {
    return null;
  }

  const tokenEnvVar = config.github.token_env_var;
  const token = tokenEnvVar ? process.env[tokenEnvVar] : undefined;
  if (!token) {
    logger?.warn('Skipping branch protection refresh: GitHub token not found', {
      token_env_var: tokenEnvVar,
    });
    return null;
  }

  const repoUrl = config.project.repo_url;
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    logger?.warn('Skipping branch protection refresh: Unable to parse GitHub repository URL', {
      repo_url: repoUrl,
    });
    return null;
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
    return null;
  }

  if (!prMetadata) {
    logger?.debug('Skipping branch protection refresh: No PR metadata recorded', {
      feature_id: featureId,
    });
    return null;
  }

  const branch = prMetadata.branch;
  const baseBranch = prMetadata.base_branch ?? manifest?.repo.default_branch;

  if (!branch || !baseBranch) {
    logger?.warn('Skipping branch protection refresh: Missing branch metadata', {
      branch,
      base_branch: baseBranch,
    });
    return null;
  }

  return {
    token,
    owner,
    repo,
    config,
    runDir,
    branch,
    baseBranch,
    prNumber: prMetadata.pr_number,
  };
}

/**
 * Fetch branch protection rules, evaluate compliance, and persist the report.
 */
async function executeBranchProtectionRefresh(
  ctx: RefreshContext,
  featureId: string,
  config: NonNullable<RunDirectorySettings['config']>,
  logger: StructuredLogger | undefined
): Promise<void> {
  const adapterConfig: BranchProtectionConfig = {
    owner: ctx.owner,
    repo: ctx.repo,
    token: ctx.token,
    baseUrl: config.github.api_base_url,
    runDir: ctx.runDir,
  };

  if (logger) {
    adapterConfig.logger = logger;
  }

  const adapter = new BranchProtectionAdapter(adapterConfig);

  const complianceInput: { branch: string; sha: string; base_sha: string; pull_number?: number } = {
    branch: ctx.branch,
    sha: ctx.branch,
    base_sha: ctx.baseBranch,
  };
  if (ctx.prNumber !== undefined) {
    complianceInput.pull_number = ctx.prNumber;
  }

  const compliance = await evaluateCompliance(adapter, complianceInput, logger);

  const reportMeta: { owner: string; repo: string; base_sha: string; pull_number?: number } = {
    owner: ctx.owner,
    repo: ctx.repo,
    base_sha: ctx.baseBranch,
  };
  if (ctx.prNumber !== undefined) {
    reportMeta.pull_number = ctx.prNumber;
  }

  const report = buildBranchProtectionReport(featureId, compliance, reportMeta);

  if (report.required_checks.length > 0) {
    try {
      report.validation_mismatch = await detectValidationMismatch(
        ctx.runDir,
        report.required_checks
      );
    } catch (error) {
      logger?.warn('Failed to compare ExecutionTask validations with required checks', {
        error: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: ctx.runDir,
        error_code: 'STATUS_BRANCH_PROTECTION_VALIDATION_COMPARE_FAILED',
      });
    }
  }

  await persistBranchProtectionReport(ctx.runDir, report);

  logger?.info('Branch protection report refreshed', {
    branch: ctx.branch,
    base_branch: ctx.baseBranch,
    compliant: report.compliant,
    blockers: report.blockers.length,
  });
}

export async function refreshBranchProtectionArtifact(
  settings: RunDirectorySettings,
  featureId: string,
  manifest: RunManifest | undefined,
  logger: StructuredLogger | undefined,
  traceManager: TraceManager | undefined,
  parentSpan: ActiveSpan | undefined
): Promise<void> {
  const ctx = await validateRefreshContext(settings, featureId, manifest, logger);
  if (!ctx) {
    return;
  }

  const { config } = ctx;

  const doRefresh = (): Promise<void> =>
    executeBranchProtectionRefresh(ctx, featureId, config, logger);

  try {
    if (traceManager && parentSpan) {
      await withSpan(
        traceManager,
        'status.refresh_branch_protection',
        async (span) => {
          span.setAttribute('feature_id', featureId);
          span.setAttribute('branch', ctx.branch);
          span.setAttribute('base_branch', ctx.baseBranch);
          if (ctx.prNumber !== undefined) {
            span.setAttribute('pr_number', ctx.prNumber);
          }
          await doRefresh();
        },
        parentSpan.context
      );
    } else {
      await doRefresh();
    }
  } catch (error) {
    logger?.warn('Branch protection refresh failed', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: ctx.runDir,
      error_code: 'STATUS_BRANCH_PROTECTION_REFRESH_FAILED',
    });
  }
}
