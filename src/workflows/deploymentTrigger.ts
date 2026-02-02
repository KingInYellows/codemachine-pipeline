/**
 * Deployment Trigger Module
 *
 * Controls merge readiness, status-check polling, auto-merge toggles, and workflow dispatch.
 * Orchestrates the final deployment phase of the AI feature pipeline.
 *
 * Implements:
 * - FR-15: PR automation
 * - FR-16: Deployment automation
 * - ADR-3: Integration layer design
 * - Section 2.1: Deployment & resume state management
 * - Task I5.T1: Deployment trigger module
 *
 * Key Features:
 * - Branch protection compliance validation
 * - Merge readiness assessment with blocker detection
 * - Strategy selection (auto-merge, manual merge, workflow dispatch)
 * - Deployment execution with GitHub adapter integration
 * - Audit trail persistence in deployment.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  GitHubAdapter,
} from '../adapters/github/GitHubAdapter';
import type { BranchProtectionReport } from './branchProtectionReporter';
import { loadReport as loadBranchProtectionReport } from './branchProtectionReporter';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { PRMetadata } from '../cli/pr/shared';
import type { LoggerInterface } from '../adapters/http/client';
import { readManifest, type RunManifest } from '../persistence/runDirectoryManager';
import { computeContentHash } from './approvalRegistry';

// Re-export all types for backward compatibility
export type {
  Blocker,
  MergeReadiness,
  WorkflowDispatchConfig,
  DeploymentConfig,
  ApprovalState,
  DeploymentContext,
  DeploymentOutcome,
  DeploymentHistory,
  DeploymentOptions,
} from './deploymentTriggerTypes';
export {
  DeploymentStrategy,
  DeploymentOutcomeSchema,
  DeploymentHistorySchema,
} from './deploymentTriggerTypes';

import {
  DeploymentStrategy,
  DeploymentOutcomeSchema,
  DeploymentHistorySchema,
  type WorkflowDispatchConfig,
  type DeploymentConfig,
  type ApprovalState,
  type DeploymentContext,
  type DeploymentOutcome,
  type DeploymentHistory,
  type DeploymentOptions,
  type MergeReadiness,
} from './deploymentTriggerTypes';

import {
  assessMergeReadiness,
  buildMetadata,
  executeAutoMerge,
  executeManualMerge,
  executeWorkflowDispatch,
  handleBlocked,
} from './deploymentTriggerExecution';

export { assessMergeReadiness } from './deploymentTriggerExecution';

// ============================================================================
// Constants
// ============================================================================

const SCHEMA_VERSION = '1.0.0';
const DEPLOYMENT_FILE = 'deployment.json';
const APPROVALS_FILE = path.join('approvals', 'approvals.json');

// ============================================================================
// Data Loading Layer
// ============================================================================

/**
 * Load deployment context from run directory artifacts
 *
 * Reads and validates:
 * - pr.json (required)
 * - status/branch_protection.json (optional, may not exist for unprotected branches)
 * - RepoConfig deployment settings
 *
 * @param runDirectory Run directory path
 * @param featureId Feature ID
 * @param config Repository configuration
 * @param logger Logger instance
 * @returns Deployment context
 * @throws Error if required artifacts are missing or invalid
 */
export async function loadDeploymentContext(
  runDirectory: string,
  featureId: string,
  config: RepoConfig,
  logger: LoggerInterface
): Promise<DeploymentContext> {
  logger.debug('Loading deployment context', { feature_id: featureId, run_dir: runDirectory });

  // Load manifest for approvals and audit context
  let manifest: RunManifest;
  try {
    manifest = await readManifest(runDirectory);
    logger.debug('Loaded run manifest', {
      approvals_pending: manifest.approvals.pending.length,
      approvals_completed: manifest.approvals.completed.length,
    });
  } catch (error) {
    logger.error('Failed to load run manifest', {
      path: path.join(runDirectory, 'manifest.json'),
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Run manifest not found. Ensure the feature run directory exists and is initialized (run directory: ${runDirectory})`
    );
  }

  // Load PR metadata (required)
  const prJsonPath = path.join(runDirectory, 'pr.json');
  let pr: PRMetadata;
  try {
    const prContent = await fs.readFile(prJsonPath, 'utf-8');
    pr = JSON.parse(prContent) as PRMetadata;
    logger.debug('Loaded PR metadata', { pr_number: pr.pr_number, branch: pr.branch });
  } catch (error) {
    logger.error('Failed to load pr.json', {
      path: prJsonPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `PR metadata not found. Ensure PR has been created first (run directory: ${runDirectory})`
    );
  }

  // Load branch protection report (optional - may not exist for unprotected branches)
  let branchProtection: BranchProtectionReport | null = null;
  try {
    branchProtection = await loadBranchProtectionReport(runDirectory);
    if (branchProtection) {
      logger.debug('Loaded branch protection report', {
        protected: branchProtection.protected,
        compliant: branchProtection.compliant,
        blockers: branchProtection.blockers.length,
      });
    }
  } catch (error) {
    logger.warn('Branch protection report not found or invalid', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const branchProtectionHash = branchProtection
    ? computeContentHash(JSON.stringify(branchProtection))
    : undefined;

  // Extract deployment configuration from RepoConfig
  const deploymentSection = (
    config as RepoConfig & {
      deployment?: {
        workflow_dispatch?: WorkflowDispatchConfig;
      };
    }
  ).deployment;
  const deploymentConfig: DeploymentConfig = {
    enable_auto_merge: config.feature_flags?.enable_auto_merge ?? false,
    enable_deployment_triggers: config.feature_flags?.enable_deployment_triggers ?? false,
    merge_method: 'merge', // Default, can be overridden
    respect_branch_protection: config.github.branch_protection?.respect_status_checks ?? true,
    prevent_auto_merge: config.governance?.risk_controls?.prevent_auto_merge ?? true,
    require_deploy_approval:
      config.governance?.approval_workflow?.require_approval_for_deploy ?? true,
  };
  if (deploymentSection?.workflow_dispatch) {
    deploymentConfig.workflow_dispatch = deploymentSection.workflow_dispatch;
  }

  const approvalsHash = await computeApprovalsHash(runDirectory, logger);
  const deployApprovalRequired = deploymentConfig.require_deploy_approval;
  const deployApprovalGranted =
    !deployApprovalRequired || manifest.approvals.completed.includes('deploy');

  logger.debug(
    'Deployment configuration loaded',
    deploymentConfig as unknown as Record<string, unknown>
  );

  const approvalsState: ApprovalState = {
    pending: manifest.approvals.pending,
    completed: manifest.approvals.completed,
    deployApprovalRequired,
    deployApprovalGranted,
  };
  if (approvalsHash) {
    approvalsState.approvalsHash = approvalsHash;
  }

  const context: DeploymentContext = {
    pr,
    branchProtection,
    config: deploymentConfig,
    manifest,
    approvals: approvalsState,
    runDirectory,
    featureId,
    logger,
  };

  if (branchProtectionHash) {
    context.branchProtectionHash = branchProtectionHash;
  }

  return context;
}

async function computeApprovalsHash(
  runDirectory: string,
  logger: LoggerInterface
): Promise<string | undefined> {
  const approvalsPath = path.join(runDirectory, APPROVALS_FILE);

  try {
    const content = await fs.readFile(approvalsPath, 'utf-8');
    return computeContentHash(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to compute approvals hash', {
        path: approvalsPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
}

// ============================================================================
// Strategy Selection
// ============================================================================

/**
 * Select deployment strategy based on configuration and readiness
 *
 * Decision tree:
 * 1. If blockers exist → BLOCKED
 * 2. If workflow_dispatch configured → WORKFLOW_DISPATCH
 * 3. If auto-merge disabled by config → MANUAL_MERGE
 * 4. If auto-merge disabled by governance → MANUAL_MERGE
 * 5. If branch protection disallows auto-merge → MANUAL_MERGE
 * 6. If auto-merge enabled and allowed → AUTO_MERGE
 * 7. Otherwise → MANUAL_MERGE
 *
 * @param context Deployment context
 * @param readiness Merge readiness assessment
 * @param options Deployment options
 * @returns Selected deployment strategy
 */
export function selectDeploymentStrategy(
  context: DeploymentContext,
  readiness: MergeReadiness,
  options?: DeploymentOptions
): DeploymentStrategy {
  const { config, branchProtection, logger } = context;

  logger.debug('Selecting deployment strategy', {
    eligible: readiness.eligible,
    blockers_count: readiness.blockers.length,
    enable_auto_merge: config.enable_auto_merge,
    prevent_auto_merge: config.prevent_auto_merge,
    workflow_dispatch: !!options?.workflow_inputs,
  });

  // 1. If blockers exist and not forcing → BLOCKED
  if (!readiness.eligible && !options?.force) {
    logger.info('Deployment blocked due to unmet requirements', {
      blockers_count: readiness.blockers.length,
    });
    return DeploymentStrategy.BLOCKED;
  }

  // 2. If workflow dispatch inputs provided or configured → WORKFLOW_DISPATCH
  if (options?.workflow_inputs || config.workflow_dispatch) {
    logger.info('Selected WORKFLOW_DISPATCH strategy', {
      workflow_id: config.workflow_dispatch?.workflow_id,
    });
    return DeploymentStrategy.WORKFLOW_DISPATCH;
  }

  // 3. If auto-merge disabled by governance risk controls → MANUAL_MERGE
  if (config.prevent_auto_merge) {
    logger.info('Selected MANUAL_MERGE strategy (governance prevents auto-merge)', {
      reason: 'governance.risk_controls.prevent_auto_merge = true',
    });
    return DeploymentStrategy.MANUAL_MERGE;
  }

  // 4. If auto-merge disabled by feature flag → MANUAL_MERGE
  if (!config.enable_auto_merge) {
    logger.info('Selected MANUAL_MERGE strategy (auto-merge feature disabled)', {
      reason: 'feature_flags.enable_auto_merge = false',
    });
    return DeploymentStrategy.MANUAL_MERGE;
  }

  // 5. If branch protection disallows auto-merge → MANUAL_MERGE
  if (branchProtection && !branchProtection.allows_auto_merge) {
    logger.info('Selected MANUAL_MERGE strategy (branch protection disallows auto-merge)', {
      reason: 'Branch protection rules prevent auto-merge',
    });
    return DeploymentStrategy.MANUAL_MERGE;
  }

  // 6. Auto-merge is enabled and allowed → AUTO_MERGE
  logger.info('Selected AUTO_MERGE strategy', {
    reason: 'All requirements met and auto-merge enabled',
  });
  return DeploymentStrategy.AUTO_MERGE;
}

// ============================================================================
// State Persistence
// ============================================================================

/**
 * Persist deployment outcome to deployment.json
 *
 * Appends outcome to deployment history for audit trail.
 * Supports multiple deployment attempts (e.g., blocked → resolved → success).
 *
 * @param outcome Deployment outcome
 * @param runDirectory Run directory path
 */
export async function persistDeploymentOutcome(
  outcome: DeploymentOutcome,
  runDirectory: string
): Promise<void> {
  const deploymentPath = path.join(runDirectory, DEPLOYMENT_FILE);
  const tempPath = `${deploymentPath}.tmp`;

  // Load existing deployment history if it exists
  let history: DeploymentHistory;
  try {
    const content = await fs.readFile(deploymentPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    history = DeploymentHistorySchema.parse(parsed);
  } catch {
    // deployment.json doesn't exist or is invalid - create new
    history = {
      schema_version: SCHEMA_VERSION,
      feature_id: outcome.feature_id,
      outcomes: [],
      last_updated: new Date().toISOString(),
    };
  }

  // Validate outcome
  const validatedOutcome = DeploymentOutcomeSchema.parse(outcome);

  // Append outcome to history
  history.outcomes.push(validatedOutcome);
  history.last_updated = new Date().toISOString();

  // Write atomically
  await fs.writeFile(tempPath, JSON.stringify(history, null, 2), 'utf-8');
  await fs.rename(tempPath, deploymentPath);
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Trigger deployment for a feature PR
 *
 * Orchestrates the complete deployment flow:
 * 1. Load deployment context
 * 2. Assess merge readiness
 * 3. Select deployment strategy
 * 4. Execute strategy
 * 5. Persist outcome
 *
 * @param runDirectory Run directory path
 * @param featureId Feature ID
 * @param config Repository configuration
 * @param githubAdapter GitHub adapter instance
 * @param logger Logger instance
 * @param options Deployment options
 * @returns Deployment outcome
 */
export async function triggerDeployment(
  runDirectory: string,
  featureId: string,
  config: RepoConfig,
  githubAdapter: GitHubAdapter,
  logger: LoggerInterface,
  options?: DeploymentOptions
): Promise<DeploymentOutcome> {
  logger.info('Triggering deployment', {
    feature_id: featureId,
    dry_run: options?.dry_run ?? false,
    force: options?.force ?? false,
  });

  try {
    // Step 1: Load deployment context
    const context = await loadDeploymentContext(runDirectory, featureId, config, logger);

    // Step 2: Assess merge readiness
    const readiness = await assessMergeReadiness(context, githubAdapter);

    logger.info('Merge readiness assessed', {
      eligible: readiness.eligible,
      blockers_count: readiness.blockers.length,
    });

    // Step 3: Select deployment strategy
    const strategy = selectDeploymentStrategy(context, readiness, options);

    logger.info('Deployment strategy selected', { strategy });

    // Dry run - return assessment without executing
    if (options?.dry_run) {
      logger.info('Dry run mode - skipping execution', { strategy });
      return {
        schema_version: SCHEMA_VERSION,
        feature_id: featureId,
        timestamp: new Date().toISOString(),
        strategy,
        action: 'none',
        success: false,
        pr_number: context.pr.pr_number,
        head_sha: context.pr.head_sha,
        base_sha: context.pr.base_sha,
        blockers: readiness.blockers,
        metadata: buildMetadata(context, readiness),
      };
    }

    // Step 4: Execute strategy
    let outcome: DeploymentOutcome;

    switch (strategy) {
      case DeploymentStrategy.AUTO_MERGE:
        outcome = await executeAutoMerge(context, readiness, githubAdapter, options);
        break;

      case DeploymentStrategy.MANUAL_MERGE:
        outcome = await executeManualMerge(context, readiness, githubAdapter, options);
        break;

      case DeploymentStrategy.WORKFLOW_DISPATCH:
        outcome = await executeWorkflowDispatch(context, readiness, githubAdapter, options);
        break;

      case DeploymentStrategy.BLOCKED:
        outcome = handleBlocked(context, readiness);
        break;

      default: {
        const exhaustiveCheck: never = strategy;
        void exhaustiveCheck;
        throw new Error('Unknown deployment strategy encountered');
      }
    }

    // Step 5: Persist outcome
    await persistDeploymentOutcome(outcome, runDirectory);

    logger.info('Deployment outcome persisted', {
      strategy: outcome.strategy,
      success: outcome.success,
    });

    return outcome;
  } catch (error) {
    logger.error('Deployment failed with unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Create failure outcome
    const outcome: DeploymentOutcome = {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.BLOCKED,
      action: 'none',
      success: false,
      pr_number: 0, // Unknown PR number
      blockers: [
        {
          type: 'config',
          message: error instanceof Error ? error.message : String(error),
          recommended_action: 'Check logs and verify run directory artifacts',
        },
      ],
      metadata: {
        checks_passing: false,
        reviews_satisfied: false,
        branch_up_to_date: false,
        pending_approvals: [],
        deploy_approval_granted: false,
        deploy_approval_required: false,
      },
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'UNEXPECTED_ERROR',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };

    // Try to persist error outcome
    try {
      await persistDeploymentOutcome(outcome, runDirectory);
    } catch {
      // Ignore persistence errors during error handling
    }

    throw error;
  }
}
