/**
 * Deployment Trigger Module
 *
 * Controls merge readiness, status-check polling, auto-merge toggles, and workflow dispatch.
 * Orchestrates the final deployment phase of the AI feature pipeline.
 *
 * Key Features:
 * - Branch protection compliance validation
 * - Merge readiness assessment with blocker detection
 * - Strategy selection (auto-merge, manual merge, workflow dispatch)
 * - Deployment execution with GitHub adapter integration
 * - Audit trail persistence in deployment.json
 */

import type { GitHubAdapter } from '../../adapters/github/GitHubAdapter';

import {
  DEPLOYMENT_SCHEMA_VERSION,
  DeploymentStrategy,
  type DeploymentContext,
  type DeploymentOutcome,
  type DeploymentOptions,
  type MergeReadiness,
  type TriggerDeploymentInput,
} from './types';

export {
  DEPLOYMENT_SCHEMA_VERSION,
  DeploymentStrategy,
  DeploymentOutcomeSchema,
  DeploymentHistorySchema,
  type Blocker,
  type MergeReadiness,
  type WorkflowDispatchConfig,
  type DeploymentConfig,
  type ApprovalState,
  type DeploymentContext,
  type DeploymentOutcome,
  type DeploymentHistory,
  type DeploymentOptions,
  type TriggerDeploymentInput,
} from './types';

import {
  assessMergeReadiness,
  buildOutcome,
  executeAutoMerge,
  executeManualMerge,
  executeWorkflowDispatch,
  handleBlocked,
} from './execution';

export { assessMergeReadiness } from './execution';

import { loadDeploymentContext, persistDeploymentOutcome } from './context';
import { getErrorMessage } from '../../utils/errors.js';

export { loadDeploymentContext, persistDeploymentOutcome } from './context';

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
type StrategyRule = {
  predicate: () => boolean;
  strategy: DeploymentStrategy;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: logging context accepts arbitrary structured data
  logContext?: Record<string, unknown>;
};

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

  const rules: StrategyRule[] = [
    {
      predicate: () => !readiness.eligible && !options?.force,
      strategy: DeploymentStrategy.BLOCKED,
      message: 'Deployment blocked due to unmet requirements',
      logContext: { blockers_count: readiness.blockers.length },
    },
    {
      predicate: () => !!(options?.workflow_inputs || config.workflow_dispatch),
      strategy: DeploymentStrategy.WORKFLOW_DISPATCH,
      message: 'Selected WORKFLOW_DISPATCH strategy',
      logContext: { workflow_id: config.workflow_dispatch?.workflow_id },
    },
    {
      predicate: () => !!config.prevent_auto_merge,
      strategy: DeploymentStrategy.MANUAL_MERGE,
      message: 'Selected MANUAL_MERGE strategy (governance prevents auto-merge)',
      logContext: { reason: 'governance.risk_controls.prevent_auto_merge = true' },
    },
    {
      predicate: () => !config.enable_auto_merge,
      strategy: DeploymentStrategy.MANUAL_MERGE,
      message: 'Selected MANUAL_MERGE strategy (auto-merge feature disabled)',
      logContext: { reason: 'feature_flags.enable_auto_merge = false' },
    },
    {
      predicate: () => !!(branchProtection && !branchProtection.allows_auto_merge),
      strategy: DeploymentStrategy.MANUAL_MERGE,
      message: 'Selected MANUAL_MERGE strategy (branch protection disallows auto-merge)',
      logContext: { reason: 'Branch protection rules prevent auto-merge' },
    },
  ];

  for (const rule of rules) {
    if (rule.predicate()) {
      logger.info(rule.message, rule.logContext);
      return rule.strategy;
    }
  }

  logger.info('Selected AUTO_MERGE strategy', {
    reason: 'All requirements met and auto-merge enabled',
  });
  return DeploymentStrategy.AUTO_MERGE;
}

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
 * @param input Deployment trigger inputs (runDirectory, featureId, config, logger)
 * @param githubAdapter GitHub adapter instance
 * @param options Deployment options
 * @returns Deployment outcome
 */
export async function triggerDeployment(
  input: TriggerDeploymentInput,
  githubAdapter: GitHubAdapter,
  options?: DeploymentOptions
): Promise<DeploymentOutcome> {
  const { runDirectory, featureId, config, logger } = input;
  logger.info('Triggering deployment', {
    feature_id: featureId,
    dry_run: options?.dry_run ?? false,
    force: options?.force ?? false,
  });

  try {
    const context = await loadDeploymentContext(runDirectory, featureId, config, logger);

    const readiness = await assessMergeReadiness(context, githubAdapter);

    logger.info('Merge readiness assessed', {
      eligible: readiness.eligible,
      blockers_count: readiness.blockers.length,
    });

    const strategy = selectDeploymentStrategy(context, readiness, options);

    logger.info('Deployment strategy selected', { strategy });

    // Dry run - return assessment without executing
    if (options?.dry_run) {
      logger.info('Dry run mode - skipping execution', { strategy });
      return buildOutcome(context, readiness, {
        strategy,
        action: 'none',
        success: false,
        blockers: readiness.blockers,
      });
    }

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

    await persistDeploymentOutcome(outcome, runDirectory);

    logger.info('Deployment outcome persisted', {
      strategy: outcome.strategy,
      success: outcome.success,
    });

    return outcome;
  } catch (error) {
    logger.error('Deployment failed with unexpected error', {
      error: getErrorMessage(error),
    });

    // Create failure outcome
    const outcome: DeploymentOutcome = {
      schema_version: DEPLOYMENT_SCHEMA_VERSION,
      feature_id: featureId,
      timestamp: new Date().toISOString(),
      strategy: DeploymentStrategy.BLOCKED,
      action: 'none',
      success: false,
      pr_number: 0, // Unknown PR number
      blockers: [
        {
          type: 'config',
          message: getErrorMessage(error),
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
        message: getErrorMessage(error),
        type: 'UNEXPECTED_ERROR',
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
