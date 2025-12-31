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
import { z } from 'zod';
import type {
  GitHubAdapter,
  MergeResult,
  MergePullRequestParams,
} from '../adapters/github/GitHubAdapter';
import type { BranchProtectionReport } from './branchProtectionReporter';
import { loadReport as loadBranchProtectionReport } from './branchProtectionReporter';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { PRMetadata } from '../cli/pr/shared';
import type { LoggerInterface } from '../adapters/http/client';
import { readManifest, type RunManifest } from '../persistence/runDirectoryManager';
import { computeContentHash } from './approvalRegistry';

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Deployment strategy options
 */
export enum DeploymentStrategy {
  /** Enable auto-merge and let GitHub handle the merge */
  AUTO_MERGE = 'AUTO_MERGE',
  /** Merge PR directly via API */
  MANUAL_MERGE = 'MANUAL_MERGE',
  /** Trigger GitHub Actions workflow dispatch */
  WORKFLOW_DISPATCH = 'WORKFLOW_DISPATCH',
  /** Deployment blocked due to unmet requirements */
  BLOCKED = 'BLOCKED',
}

/**
 * Blocker information
 */
export interface Blocker {
  /** Blocker type for categorization */
  type:
    | 'status_checks'
    | 'reviews'
    | 'branch_stale'
    | 'conflicts'
    | 'draft'
    | 'closed'
    | 'config'
    | 'protection'
    | 'approvals';
  /** Human-readable blocker message */
  message: string;
  /** Recommended action to resolve blocker */
  recommended_action: string;
  /** Additional metadata about the blocker */
  metadata?: Record<string, unknown>;
}

/**
 * Merge readiness assessment result
 */
export interface MergeReadiness {
  /** Whether PR is ready to merge */
  eligible: boolean;
  /** List of blockers preventing merge */
  blockers: Blocker[];
  /** Additional context about readiness state */
  context: {
    pr_state: string;
    mergeable: boolean | null;
    mergeable_state: string | null;
    checks_passing: boolean;
    reviews_satisfied: boolean;
    branch_up_to_date: boolean;
    pending_approvals: string[];
    deploy_approval_required: boolean;
    deploy_approval_granted: boolean;
  };
}

/**
 * Deployment configuration from RepoConfig
 */
export interface WorkflowDispatchConfig {
  /** Workflow ID or filename */
  workflow_id: string;
  /** Workflow inputs */
  inputs?: Record<string, string>;
}

/**
 * Deployment configuration from RepoConfig
 */
export interface DeploymentConfig {
  /** Whether auto-merge is enabled */
  enable_auto_merge: boolean;
  /** Whether deployment triggers are enabled */
  enable_deployment_triggers: boolean;
  /** Workflow dispatch configuration */
  workflow_dispatch?: WorkflowDispatchConfig;
  /** Merge method preference */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** Whether to respect branch protection rules */
  respect_branch_protection: boolean;
  /** Prevent auto-merge even if eligible */
  prevent_auto_merge: boolean;
  /** Whether deploy approval gate is required */
  require_deploy_approval: boolean;
}

/**
 * Approval status snapshot
 */
export interface ApprovalState {
  /** Pending approval gate identifiers */
  pending: string[];
  /** Completed approval gate identifiers */
  completed: string[];
  /** Whether deploy approval gate is required by governance */
  deployApprovalRequired: boolean;
  /** Whether deploy approval is granted */
  deployApprovalGranted: boolean;
  /** Hash of approvals index for audit */
  approvalsHash?: string;
}

/**
 * Deployment context - all inputs needed for deployment orchestration
 */
export interface DeploymentContext {
  /** Pull request metadata */
  pr: PRMetadata;
  /** Branch protection compliance report */
  branchProtection: BranchProtectionReport | null;
  /** Hash of branch protection report for audit trail */
  branchProtectionHash?: string;
  /** Deployment configuration */
  config: DeploymentConfig;
  /** Run manifest loaded from run directory */
  manifest: RunManifest;
  /** Approval status snapshot */
  approvals: ApprovalState;
  /** Run directory path */
  runDirectory: string;
  /** Feature ID */
  featureId: string;
  /** Logger instance */
  logger: LoggerInterface;
}

/**
 * Deployment outcome schema for persistence
 */
export const DeploymentOutcomeSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  feature_id: z.string(),
  timestamp: z.string(),
  strategy: z.nativeEnum(DeploymentStrategy),
  action: z.enum(['auto-merge', 'merge', 'workflow-dispatch', 'none']),
  success: z.boolean(),
  pr_number: z.number(),
  head_sha: z.string().optional(),
  base_sha: z.string().optional(),
  merge_sha: z.string().optional(),
  workflow_run_id: z.string().optional(),
  workflow_url: z.string().optional(),
  github_response: z.record(z.unknown()).optional(),
  blockers: z.array(
    z.object({
      type: z.string(),
      message: z.string(),
      recommended_action: z.string(),
      metadata: z.record(z.unknown()).optional(),
    })
  ),
  metadata: z.object({
    approvals_hash: z.string().optional(),
    protection_report_hash: z.string().optional(),
    pr_url: z.string().optional(),
    checks_passing: z.boolean(),
    reviews_satisfied: z.boolean(),
    branch_up_to_date: z.boolean(),
    pending_approvals: z.array(z.string()).optional(),
    deploy_approval_granted: z.boolean().optional(),
    deploy_approval_required: z.boolean().optional(),
  }),
  error: z
    .object({
      message: z.string(),
      type: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
});

export type DeploymentOutcome = z.infer<typeof DeploymentOutcomeSchema>;

/**
 * Deployment history - tracks all deployment attempts for a feature
 */
export const DeploymentHistorySchema = z.object({
  schema_version: z.string().default('1.0.0'),
  feature_id: z.string(),
  outcomes: z.array(DeploymentOutcomeSchema),
  last_updated: z.string(),
});

export type DeploymentHistory = z.infer<typeof DeploymentHistorySchema>;

/**
 * Options for deployment trigger
 */
export interface DeploymentOptions {
  /** Force deployment even if blockers exist (admin override) */
  force?: boolean;
  /** Dry run - assess readiness but don't execute */
  dry_run?: boolean;
  /** Custom merge method */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** Custom workflow dispatch inputs */
  workflow_inputs?: Record<string, string>;
}

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
// Readiness Assessment
// ============================================================================

/**
 * Assess merge readiness based on PR state and branch protection requirements
 *
 * Checks (in priority order):
 * 1. PR state (must be open, not draft)
 * 2. Merge conflicts (must be mergeable)
 * 3. Required status checks (must be passing)
 * 4. Required reviews (must be satisfied)
 * 5. Branch staleness (must be up-to-date if required)
 *
 * @param context Deployment context
 * @param githubAdapter GitHub adapter for fresh PR data
 * @returns Merge readiness assessment
 */
export async function assessMergeReadiness(
  context: DeploymentContext,
  githubAdapter: GitHubAdapter
): Promise<MergeReadiness> {
  const { pr, branchProtection, logger, approvals } = context;
  const blockers: Blocker[] = [];

  logger.debug('Assessing merge readiness', { pr_number: pr.pr_number });

  // Fetch fresh PR data to ensure we have latest state
  const freshPR = await githubAdapter.getPullRequest(pr.pr_number);
  logger.debug('Fetched fresh PR data', {
    state: freshPR.state,
    draft: freshPR.draft,
    mergeable: freshPR.mergeable,
    mergeable_state: freshPR.mergeable_state,
  });

  // Check 1: PR must be open
  if (freshPR.state !== 'open') {
    blockers.push({
      type: 'closed',
      message: `PR is ${freshPR.state}, expected open`,
      recommended_action: 'Reopen the pull request before attempting deployment',
    });
  }

  // Check 2: PR must not be draft
  if (freshPR.draft) {
    blockers.push({
      type: 'draft',
      message: 'PR is in draft mode',
      recommended_action: 'Mark the pull request as ready for review',
    });
  }

  // Check 3: PR must be mergeable (no conflicts)
  if (freshPR.mergeable === false) {
    blockers.push({
      type: 'conflicts',
      message: 'PR has merge conflicts',
      recommended_action: 'Resolve merge conflicts by rebasing or merging base branch',
    });
  }

  // If branch protection report exists, use it for detailed validation
  if (branchProtection) {
    logger.debug('Validating branch protection requirements', {
      protected: branchProtection.protected,
      compliant: branchProtection.compliant,
    });

    // Check 4: Required status checks
    if (!branchProtection.checks_passing) {
      blockers.push({
        type: 'status_checks',
        message: `${branchProtection.failing_checks.length} required status check(s) failing`,
        recommended_action: `Wait for the following checks to pass: ${branchProtection.failing_checks.join(', ')}`,
        metadata: {
          failing_checks: branchProtection.failing_checks,
        },
      });
    }

    // Check 5: Required reviews
    if (!branchProtection.reviews_satisfied) {
      const needed = branchProtection.reviews_required - branchProtection.reviews_count;
      blockers.push({
        type: 'reviews',
        message: `Insufficient approving reviews (${branchProtection.reviews_count}/${branchProtection.reviews_required})`,
        recommended_action: `Request ${needed} more approving review(s) from authorized reviewers`,
        metadata: {
          reviews_required: branchProtection.reviews_required,
          reviews_count: branchProtection.reviews_count,
        },
      });
    }

    // Check 6: Branch staleness (must be up-to-date if strict mode)
    if (!branchProtection.up_to_date && branchProtection.stale_commit) {
      blockers.push({
        type: 'branch_stale',
        message: 'Branch is not up-to-date with base branch',
        recommended_action: 'Update branch by merging or rebasing base branch',
      });
    }
  } else {
    // No branch protection report - use basic GitHub mergeable_state
    logger.debug('No branch protection report - using basic GitHub mergeable_state');

    if (freshPR.mergeable_state === 'blocked') {
      blockers.push({
        type: 'protection',
        message: 'PR is blocked by branch protection rules',
        recommended_action: 'Run "ai-feature status" to check specific protection requirements',
      });
    }
  }

  // Check approvals (deploy gate + any pending approvals)
  const pendingApprovals = new Set(approvals.pending);
  if (approvals.deployApprovalRequired && !approvals.deployApprovalGranted) {
    pendingApprovals.add('deploy');
  }

  if (pendingApprovals.size > 0) {
    const pendingList = Array.from(pendingApprovals);
    blockers.push({
      type: 'approvals',
      message: `${pendingList.length} approval(s) pending: ${pendingList.join(', ')}`,
      recommended_action:
        'Collect required approvals with "ai-feature approve <gate>" or rerun with --force when authorized',
      metadata: {
        pending_approvals: pendingList,
      },
    });
  }

  const eligible = blockers.length === 0;

  logger.info('Merge readiness assessed', {
    pr_number: pr.pr_number,
    eligible,
    blockers_count: blockers.length,
  });

  return {
    eligible,
    blockers,
    context: {
      pr_state: freshPR.state,
      mergeable: freshPR.mergeable,
      mergeable_state: freshPR.mergeable_state,
      checks_passing: branchProtection?.checks_passing ?? true,
      reviews_satisfied: branchProtection?.reviews_satisfied ?? true,
      branch_up_to_date: branchProtection?.up_to_date ?? true,
      pending_approvals: Array.from(pendingApprovals),
      deploy_approval_required: approvals.deployApprovalRequired,
      deploy_approval_granted: approvals.deployApprovalGranted,
    },
  };
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
// Execution Handlers
// ============================================================================

function buildMetadata(
  context: DeploymentContext,
  readiness: MergeReadiness
): DeploymentOutcome['metadata'] {
  return {
    pr_url: context.pr.url,
    checks_passing: readiness.context.checks_passing,
    reviews_satisfied: readiness.context.reviews_satisfied,
    branch_up_to_date: readiness.context.branch_up_to_date,
    approvals_hash: context.approvals.approvalsHash,
    protection_report_hash: context.branchProtectionHash,
    pending_approvals: readiness.context.pending_approvals,
    deploy_approval_granted: readiness.context.deploy_approval_granted,
    deploy_approval_required: readiness.context.deploy_approval_required,
  };
}

/**
 * Execute auto-merge strategy
 *
 * Enables auto-merge on the PR and lets GitHub handle the merge automatically
 * once all required checks pass.
 *
 * @param context Deployment context
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
async function executeAutoMerge(
  context: DeploymentContext,
  readiness: MergeReadiness,
  githubAdapter: GitHubAdapter,
  options?: DeploymentOptions
): Promise<DeploymentOutcome> {
  const { pr, logger, featureId } = context;
  const mergeMethod = options?.merge_method ?? context.config.merge_method ?? 'merge';

  logger.info('Executing auto-merge', { pr_number: pr.pr_number, merge_method: mergeMethod });

  try {
    // Convert merge method to GraphQL enum format
    const graphqlMethod = mergeMethod.toUpperCase() as 'MERGE' | 'SQUASH' | 'REBASE';

    // Enable auto-merge via GitHub adapter
    await githubAdapter.enableAutoMerge(pr.pr_number, graphqlMethod);

    logger.info('Auto-merge enabled successfully', {
      pr_number: pr.pr_number,
      merge_method: mergeMethod,
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.AUTO_MERGE,
      action: 'auto-merge',
      success: true,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
    };
  } catch (error) {
    logger.error('Failed to enable auto-merge', {
      pr_number: pr.pr_number,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.AUTO_MERGE,
      action: 'auto-merge',
      success: false,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'AUTO_MERGE_FAILED',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Execute manual merge strategy
 *
 * Merges the PR directly via GitHub API.
 *
 * @param context Deployment context
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
async function executeManualMerge(
  context: DeploymentContext,
  readiness: MergeReadiness,
  githubAdapter: GitHubAdapter,
  options?: DeploymentOptions
): Promise<DeploymentOutcome> {
  const { pr, logger, featureId } = context;
  const mergeMethod = options?.merge_method ?? context.config.merge_method ?? 'merge';

  logger.info('Executing manual merge', { pr_number: pr.pr_number, merge_method: mergeMethod });

  try {
    // Merge PR via GitHub adapter
    const mergeParams: MergePullRequestParams = {
      pull_number: pr.pr_number,
      merge_method: mergeMethod,
    };
    if (pr.head_sha) {
      mergeParams.sha = pr.head_sha; // Ensure we're merging the expected SHA when available
    }

    const result: MergeResult = await githubAdapter.mergePullRequest(mergeParams);

    logger.info('PR merged successfully', {
      pr_number: pr.pr_number,
      merge_sha: result.sha,
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.MANUAL_MERGE,
      action: 'merge',
      success: result.merged,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      merge_sha: result.sha,
      blockers: [],
      github_response: result as unknown as Record<string, unknown>,
      metadata: buildMetadata(context, readiness),
    };
  } catch (error) {
    logger.error('Failed to merge PR', {
      pr_number: pr.pr_number,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.MANUAL_MERGE,
      action: 'merge',
      success: false,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'MERGE_FAILED',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Execute workflow dispatch strategy
 *
 * Triggers a GitHub Actions workflow dispatch with custom inputs.
 *
 * @param context Deployment context
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
async function executeWorkflowDispatch(
  context: DeploymentContext,
  readiness: MergeReadiness,
  githubAdapter: GitHubAdapter,
  options?: DeploymentOptions
): Promise<DeploymentOutcome> {
  const { pr, config, logger, featureId } = context;

  // Determine workflow ID and inputs
  const workflowId = config.workflow_dispatch?.workflow_id;
  const workflowInputs = options?.workflow_inputs ?? config.workflow_dispatch?.inputs ?? {};

  if (!workflowId) {
    logger.error('Workflow dispatch requested but no workflow_id configured');
    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.WORKFLOW_DISPATCH,
      action: 'workflow-dispatch',
      success: false,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
      error: {
        message: 'Workflow dispatch requested but no workflow_id configured',
        type: 'CONFIG_ERROR',
      },
    };
  }

  logger.info('Executing workflow dispatch', {
    workflow_id: workflowId,
    ref: pr.branch,
    inputs: workflowInputs,
  });

  try {
    // Trigger workflow via GitHub adapter
    await githubAdapter.triggerWorkflow({
      workflow_id: workflowId,
      ref: pr.branch,
      inputs: workflowInputs,
    });

    logger.info('Workflow dispatch triggered successfully', {
      workflow_id: workflowId,
      ref: pr.branch,
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.WORKFLOW_DISPATCH,
      action: 'workflow-dispatch',
      success: true,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
    };
  } catch (error) {
    logger.error('Failed to trigger workflow dispatch', {
      workflow_id: workflowId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      schema_version: SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.WORKFLOW_DISPATCH,
      action: 'workflow-dispatch',
      success: false,
      pr_number: pr.pr_number,
      head_sha: pr.head_sha,
      base_sha: pr.base_sha,
      blockers: [],
      metadata: buildMetadata(context, readiness),
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'WORKFLOW_DISPATCH_FAILED',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Handle blocked deployment
 *
 * Returns outcome with blocker details and recommended actions.
 *
 * @param context Deployment context
 * @param readiness Merge readiness assessment
 * @returns Deployment outcome
 */
function handleBlocked(context: DeploymentContext, readiness: MergeReadiness): DeploymentOutcome {
  const { pr, logger, featureId } = context;

  logger.warn('Deployment blocked', {
    pr_number: pr.pr_number,
    blockers_count: readiness.blockers.length,
    blockers: readiness.blockers.map((b) => b.message),
  });

  return {
    schema_version: SCHEMA_VERSION,
    feature_id: featureId,
    timestamp: new Date().toISOString(),
    strategy: DeploymentStrategy.BLOCKED,
    action: 'none',
    success: false,
    pr_number: pr.pr_number,
    head_sha: pr.head_sha,
    base_sha: pr.base_sha,
    blockers: readiness.blockers,
    metadata: buildMetadata(context, readiness),
  };
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
