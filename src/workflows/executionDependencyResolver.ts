import { ExecutionTask, canRetry, areDependenciesCompleted } from '../core/models/ExecutionTask.js';
import { loadQueue } from './queueStore.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { DEFAULT_EXECUTION_CONFIG } from '../core/config/RepoConfig.js';
import type { RepoConfig } from '../core/config/RepoConfig.js';

/**
 * Select up to `limit` ready tasks from the queue, excluding any tasks
 * already in-flight. Priority order: running (resumed) > pending > retryable.
 *
 * Uses a single-pass bucket approach (O(n)) rather than three separate passes.
 */
export async function getReadyTasks(
  runDir: string,
  inFlight: Set<string>,
  limit: number
): Promise<ExecutionTask[]> {
  if (limit <= 0) {
    return [];
  }

  const tasks = await loadQueue(runDir);

  // Single pass: bucket tasks by priority
  const running: ExecutionTask[] = [];
  const pending: ExecutionTask[] = [];
  const retryable: ExecutionTask[] = [];

  for (const task of tasks.values()) {
    if (running.length >= limit) break;
    if (inFlight.has(task.task_id)) continue;

    // Once running+pending already fill the requested limit, retryable tasks
    // cannot be selected, so skip dependency scans for non-priority statuses.
    if (
      running.length + pending.length >= limit &&
      task.status !== 'running' &&
      task.status !== 'pending'
    ) {
      continue;
    }

    if (!areDependenciesCompleted(task, tasks)) continue;

    if (task.status === 'running') {
      running.push(task);
    } else if (task.status === 'pending') {
      pending.push(task);
    } else if (canRetry(task)) {
      retryable.push(task);
    }
  }

  return [...running, ...pending, ...retryable].slice(0, limit);
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
