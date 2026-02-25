import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import {
  createBranchProtectionAdapter,
  type BranchProtectionConfig,
} from '../../../adapters/github/branchProtection';
import { evaluateCompliance } from '../../../workflows/branchComplianceChecker';
import {
  loadReport as loadBranchProtectionReport,
  generateSummary as generateBranchProtectionSummary,
  generateReport as buildBranchProtectionReport,
  persistReport as persistBranchProtectionReport,
  detectValidationMismatch,
} from '../../../workflows/branchProtectionReporter';
import type { PRMetadata } from '../../pr/shared';
import { withSpan } from '../../../telemetry/traces';
import type { StructuredLogger } from '../../../telemetry/logger';
import type { TraceManager, ActiveSpan } from '../../../telemetry/traces';
import type { RunDirectorySettings } from '../../utils/runDirectory';
import type { RunManifest } from '../../../persistence/runDirectoryManager';
import type { StatusBranchProtectionPayload } from '../types';
import { logIfUnexpectedFileError } from './types';
import type { DataLogger } from './types';
import { loadPRMetadata } from './integrationsData';

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
    logIfUnexpectedFileError(error, logger, 'Failed to load branch protection', {
      run_dir: runDir,
      error_code: 'STATUS_BRANCH_PROTECTION_LOAD_FAILED',
    });
    return undefined;
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

    const compliance = await evaluateCompliance(
      adapter,
      {
        branch,
        sha: branch,
        base_sha: baseBranch,
        pull_number: prMetadata?.pr_number,
      },
      logger
    );

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
