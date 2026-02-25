/**
 * Queue Loader
 *
 * Provides loadQueue (and loadQueueV2) extracted from queueStore.ts to break
 * the circular dependency between queueStore and queueTaskManager.
 *
 * Import chain: queueTaskManager → queueLoader (no cycle)
 *               queueStore → queueLoader (re-exports for backward compat)
 */

import type { ExecutionTask } from '../core/models/ExecutionTask';
import { createLogger, type StructuredLogger, LogLevel } from '../telemetry/logger';
import {
  integrityVerifiedDirs,
  verifyQueueIntegrity,
} from './queueIntegrity.js';
import { getV2IndexCache, toExecutionTask } from './queueCache.js';

const logger: StructuredLogger = createLogger({
  component: 'queue-loader',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

/** Load all tasks from queue via V2 WAL-based index. */
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
  // Verify queue integrity only on first (cold) load per runDir (CDMCH-69)
  if (!integrityVerifiedDirs.has(runDir)) {
    // In fail-fast mode, verifyQueueIntegrity throws QueueIntegrityError on corruption.
    // In warn-only mode, it returns a result with valid=false but does not throw.
    const integrity = await verifyQueueIntegrity(runDir);
    if (!integrity.valid) {
      logger.warn('Queue integrity check found issues', {
        errors: integrity.errors,
        sequence_gaps: integrity.sequenceGaps,
        wal_checksum_failures: integrity.walChecksumFailures,
      });
    }
    integrityVerifiedDirs.add(runDir);
  }

  const v2Cache = await getV2IndexCache(runDir);
  const tasks = new Map<string, ExecutionTask>();

  for (const [taskId, taskData] of v2Cache.state.tasks) {
    tasks.set(taskId, toExecutionTask(taskData));
  }

  return tasks;
}

/** Load queue using V2 index only (no fallback). */
export async function loadQueueV2(runDir: string): Promise<Map<string, ExecutionTask>> {
  const v2Cache = await getV2IndexCache(runDir);
  const tasks = new Map<string, ExecutionTask>();

  for (const [taskId, taskData] of v2Cache.state.tasks) {
    tasks.set(taskId, toExecutionTask(taskData));
  }

  return tasks;
}
