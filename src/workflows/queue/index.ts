/**
 * Queue subsystem public API barrel.
 *
 * All external consumers should import from this barrel (or from
 * src/workflows/queueStore.ts for backward compatibility).
 */

export {
  initializeQueue,
  initializeQueueFromPlan,
  appendToQueue,
  loadQueue,
  loadQueueV2,
  loadQueueSnapshot,
  createQueueSnapshot,
  invalidateQueueRunState,
  type PlanTask,
  type TaskPlan,
  type QueueManifest,
  type QueueSnapshot,
  type QueueOperationResult,
  type QueueValidationResult,
  type QueueIntegrityMode,
  type QueueIntegrityErrorKind,
  QueueIntegrityError,
} from './queueStore.js';

export {
  getNextTask,
  getPendingTasks,
  getFailedTasks,
  getTaskById,
  updateTaskInQueue,
  updateTaskInQueueV2,
} from './queueTaskManager.js';

export { validateQueue } from './queueValidation.js';

export {
  getQueueCountsV2,
  getReadyTasksV2,
  getV2IndexState,
  forceCompactV2,
  exportV2State,
} from './queueV2Api.js';

export {
  getV2IndexCache,
  buildDependencyGraph,
  toExecutionTask,
  toExecutionTaskData,
  invalidateV2Cache,
} from './queueCache.js';

export {
  getQueueIntegrityMode,
  verifyQueueIntegrity,
  type QueueIntegrityResult,
} from './queueIntegrity.js';
