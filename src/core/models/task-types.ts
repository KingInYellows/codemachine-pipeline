/**
 * Task domain sub-barrel
 *
 * Exports for task management models: ResearchTask, Specification, ExecutionTask.
 * Prefer these granular imports over the main index.ts barrel for better tree-shaking.
 *
 * Usage:
 *   import { ExecutionTask, ResearchTask } from '@/core/models/task-types';
 */

export {
  ResearchTask,
  ResearchTaskSchema,
  ResearchStatus,
  ResearchStatusSchema,
  ResearchSource,
  ResearchResult,
  FreshnessRequirement,
  parseResearchTask,
  serializeResearchTask,
  createResearchTask,
  generateCacheKey,
  isCachedResultFresh,
  formatResearchTaskValidationErrors,
} from './ResearchTask';

export {
  Specification,
  SpecificationSchema,
  SpecificationStatus,
  SpecificationStatusSchema,
  ReviewerInfo,
  ChangeLogEntry,
  RiskAssessment,
  TestPlanItem,
  RolloutPlan,
  parseSpecification,
  serializeSpecification,
  createSpecification,
  addChangeLogEntry,
  isFullyApproved,
  getPendingReviewers,
  formatSpecificationValidationErrors,
} from './Specification';

export {
  ExecutionTask,
  ExecutionTaskSchema,
  ExecutionTaskType,
  ExecutionTaskTypeSchema,
  ExecutionTaskStatus,
  ExecutionTaskStatusSchema,
  TaskError,
  CostTracking,
  RateLimitBudget,
  parseExecutionTask,
  serializeExecutionTask,
  createExecutionTask,
  canRetry,
  areDependenciesCompleted,
  getTaskDuration,
  formatExecutionTaskValidationErrors,
} from './ExecutionTask';
