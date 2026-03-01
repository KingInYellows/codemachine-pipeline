import { ExecutionTask, canRetry, areDependenciesCompleted } from '../core/models/ExecutionTask.js';
import { loadQueue } from './queueStore.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { DEFAULT_EXECUTION_CONFIG } from '../core/config/RepoConfig.js';
import type { RepoConfig } from '../core/config/RepoConfig.js';

/**
 * Select up to `limit` ready tasks from the queue, excluding any tasks
 * already in-flight. Priority order: running (resumed) > pending > retryable.
 */
export async function getReadyTasks(
  runDir: string,
  inFlight: Set<string>,
  limit: number
): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  const ready: ExecutionTask[] = [];
  const seen = new Set<string>();

  const consider = (task: ExecutionTask): void => {
    if (ready.length >= limit) {
      return;
    }
    if (inFlight.has(task.task_id) || seen.has(task.task_id)) {
      return;
    }
    if (!areDependenciesCompleted(task, tasks)) {
      return;
    }
    ready.push(task);
    seen.add(task.task_id);
  };

  for (const task of tasks.values()) {
    if (task.status === 'running') {
      consider(task);
    }
  }

  for (const task of tasks.values()) {
    if (task.status === 'pending') {
      consider(task);
    }
  }

  for (const task of tasks.values()) {
    if (canRetry(task)) {
      consider(task);
    }
  }

  return ready;
}

/**
 * Apply exponential backoff delay before a retry attempt.
 * Backoff is capped at 60 seconds.
 */
export async function applyRetryBackoff(
  retryCount: number,
  config: RepoConfig,
  logger?: StructuredLogger
): Promise<void> {
  const executionConfig = config.execution ?? DEFAULT_EXECUTION_CONFIG;
  const baseBackoffMs = executionConfig.retry_backoff_ms;
  const backoffMs = Math.min(baseBackoffMs * Math.pow(2, retryCount - 1), 60000);

  logger?.debug('Applying retry backoff', { retryCount, backoffMs });
  await sleep(backoffMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
