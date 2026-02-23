/**
 * Deployment Trigger - backward-compatibility re-export
 *
 * This module re-exports everything from src/workflows/deployment/
 * to maintain backward compatibility with existing importers.
 *
 * New code should import directly from './deployment' or its sub-modules.
 */

export {
  triggerDeployment,
  selectDeploymentStrategy,
  assessMergeReadiness,
  loadDeploymentContext,
  persistDeploymentOutcome,
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
} from './deployment/trigger';
