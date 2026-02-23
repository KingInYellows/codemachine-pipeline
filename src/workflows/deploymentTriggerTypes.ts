/**
 * Deployment Trigger Types - backward-compatibility re-export
 *
 * This module re-exports everything from src/workflows/deployment/types.ts
 * to maintain backward compatibility with existing importers.
 *
 * New code should import directly from './deployment/types' or './deployment'.
 */

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
} from './deployment/types';
