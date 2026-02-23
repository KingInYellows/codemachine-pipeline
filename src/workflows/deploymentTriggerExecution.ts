/**
 * Deployment Trigger Execution - backward-compatibility re-export
 *
 * This module re-exports everything from src/workflows/deployment/execution.ts
 * to maintain backward compatibility with existing importers.
 *
 * New code should import directly from './deployment/execution' or './deployment'.
 */

export {
  buildMetadata,
  buildOutcome,
  executeAutoMerge,
  executeManualMerge,
  executeWorkflowDispatch,
  assessMergeReadiness,
  handleBlocked,
} from './deployment/execution';
