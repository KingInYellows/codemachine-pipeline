/**
 * Deployment Trigger Execution Handlers
 *
 * Strategy execution functions for auto-merge, manual merge, workflow dispatch,
 * and blocked deployment handling. Extracted from deploymentTrigger.ts for module
 * size management.
 */

import type {
  GitHubAdapter,
  MergeResult,
  MergePullRequestParams,
} from '../adapters/github/GitHubAdapter';
import {
  DEPLOYMENT_SCHEMA_VERSION,
  DeploymentStrategy,
  type Blocker,
  type DeploymentContext,
  type DeploymentOutcome,
  type DeploymentOptions,
  type MergeReadiness,
} from './deploymentTriggerTypes';

// ============================================================================
// Execution Handlers
// ============================================================================

export function buildMetadata(
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
 * @param readiness Merge readiness assessment
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
export async function executeAutoMerge(
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
 * @param readiness Merge readiness assessment
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
export async function executeManualMerge(
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
 * @param readiness Merge readiness assessment
 * @param githubAdapter GitHub adapter
 * @param options Deployment options
 * @returns Deployment outcome
 */
export async function executeWorkflowDispatch(
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
        recommended_action: 'Run "codepipe status" to check specific protection requirements',
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
        'Collect required approvals with "codepipe approve <gate>" or rerun with --force when authorized',
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

/**
 * Handle blocked deployment
 *
 * Returns outcome with blocker details and recommended actions.
 *
 * @param context Deployment context
 * @param readiness Merge readiness assessment
 * @returns Deployment outcome
 */
export function handleBlocked(
  context: DeploymentContext,
  readiness: MergeReadiness
): DeploymentOutcome {
  const { pr, logger, featureId } = context;

  logger.warn('Deployment blocked', {
    pr_number: pr.pr_number,
    blockers_count: readiness.blockers.length,
    blockers: readiness.blockers.map((b) => b.message),
  });

  return {
    schema_version: DEPLOYMENT_SCHEMA_VERSION,
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
