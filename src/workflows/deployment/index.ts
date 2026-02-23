/**
 * Deployment module barrel export
 *
 * Re-exports all public APIs from the deployment trigger module.
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
} from './trigger';
