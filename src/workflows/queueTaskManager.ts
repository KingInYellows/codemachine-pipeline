/**
 * Queue Task Manager
 *
 * Manages task lifecycle operations within the queue: retrieval, filtering,
 * and atomic status updates via the V2 WAL.
 *
 * Extracted from queueStore.ts for maintainability.
 *
 * Implements:
 * - FR-2 (Run Directory): Queue task management in `queue/` subdirectory
 * - FR-3 (Resumability): Crash-safe task updates via WAL
 */

import type { ExecutionTask } from '../core/models/ExecutionTask';
import { canRetry } from '../core/models/ExecutionTask';
import { readManifest, writeManifest, withLock } from '../persistence';

// V2 WAL Components
import {
  getTask,
  updateTask as updateTaskInIndex,
  getReadyTasks as getReadyTasksFromIndex,
  getCounts,
  areDependenciesCompleted as v2AreDependenciesCompleted,
} from './queueMemoryIndex.js';
import { appendOperation } from './queueOperationsLog.js';
import { shouldCompact, compactWithState } from './queueCompactionEngine.js';
import type { QueueOperation, ExecutionTaskData, QueueOperationResult } from './queueTypes.js';

// Shared cache and helpers (avoids circular dependency with queueStore)
import { getV2IndexCache, buildDependencyGraph, toExecutionTask } from './queueCache.js';

import { loadQueue } from './queueLoader.js';

// ============================================================================
// Queue Task Management
// ============================================================================

/**
 * Get next executable task from queue
 *
 * Uses V2 memory index for efficient task selection.
 * Priority order: running tasks (crash recovery) > pending tasks > retryable failures
 *
 * @param runDir - Run directory path
 * @returns Next task to execute, or null if none available
 */
export async function getNextTask(runDir: string): Promise<ExecutionTask | null> {
  const v2Cache = await getV2IndexCache(runDir);
  const dependencyGraph = buildDependencyGraph(v2Cache.state);
  const seen = new Set<string>();

  // 1. Retry tasks that were running when crash occurred
  for (const [, taskData] of v2Cache.state.tasks) {
    if (taskData.status === 'running') {
      if (v2AreDependenciesCompleted(v2Cache.state, taskData.task_id, dependencyGraph)) {
        if (!seen.has(taskData.task_id)) {
          return toExecutionTask(taskData);
        }
      }
    }
  }

  // 2. Pending tasks with completed dependencies
  const readyTasks = getReadyTasksFromIndex(v2Cache.state, dependencyGraph);
  for (const taskData of readyTasks) {
    if (!seen.has(taskData.task_id)) {
      return toExecutionTask(taskData);
    }
  }

  // 3. Retryable failures with completed dependencies
  for (const [, taskData] of v2Cache.state.tasks) {
    const task = toExecutionTask(taskData);
    if (canRetry(task)) {
      if (v2AreDependenciesCompleted(v2Cache.state, taskData.task_id, dependencyGraph)) {
        if (!seen.has(taskData.task_id)) {
          return task;
        }
      }
    }
  }

  return null;
}

/**
 * Get all pending tasks
 *
 * @param runDir - Run directory path
 * @returns Array of pending tasks
 */
export async function getPendingTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  return Array.from(tasks.values()).filter((task) => task.status === 'pending');
}

/**
 * Get all failed tasks
 *
 * @param runDir - Run directory path
 * @returns Array of failed tasks
 */
export async function getFailedTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  return Array.from(tasks.values()).filter((task) => task.status === 'failed');
}

/**
 * Get task by ID
 *
 * Uses V2 memory index for O(1) lookup.
 *
 * @param runDir - Run directory path
 * @param taskId - Task ID
 * @returns Task or null if not found
 */
export async function getTaskById(runDir: string, taskId: string): Promise<ExecutionTask | null> {
  const v2Cache = await getV2IndexCache(runDir);
  const taskData = getTask(v2Cache.state, taskId);

  if (taskData) {
    return toExecutionTask(taskData);
  }
  return null;
}

/**
 * Update task status in queue
 *
 * Uses V2 WAL for atomic updates with O(1) appends.
 *
 * @param runDir - Run directory path
 * @param taskId - Task ID to update
 * @param updates - Partial task updates
 * @returns Operation result
 */
export async function updateTaskInQueue(
  runDir: string,
  taskId: string,
  updates: Partial<ExecutionTask>
): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      const v2Cache = await getV2IndexCache(runDir);
      const existingTask = getTask(v2Cache.state, taskId);

      if (!existingTask) {
        return {
          success: false,
          message: `Task ${taskId} not found in queue`,
        };
      }

      // Build patch with updated_at timestamp
      const patch: Partial<ExecutionTaskData> = {
        ...updates,
        updated_at: new Date().toISOString(),
      } as Partial<ExecutionTaskData>;

      // Append update operation to WAL
      const op: Omit<QueueOperation, 'seq' | 'checksum'> = {
        op: 'update',
        ts: new Date().toISOString(),
        taskId,
        patch,
      };

      const appendedOp = await appendOperation(v2Cache.queueDir, op);
      v2Cache.state.lastSeq = appendedOp.seq;

      // Update in-memory index
      updateTaskInIndex(v2Cache.state, taskId, patch);

      // Build dependency graph for compaction
      const dependencyGraph = buildDependencyGraph(v2Cache.state);

      // Check if compaction is needed (avoid nested locks)
      const compactionCheck = await shouldCompact(v2Cache.queueDir);
      if (compactionCheck.needed) {
        await compactWithState(
          runDir,
          v2Cache.queueDir,
          v2Cache.featureId,
          v2Cache.state,
          dependencyGraph
        );
      }

      // Update run manifest if status changed
      if (updates.status) {
        const manifest = await readManifest(runDir);
        const counts = getCounts(v2Cache.state);

        const updatedManifest = {
          ...manifest,
          queue: {
            ...manifest.queue,
            pending_count: counts.pending,
            completed_count: counts.completed,
            failed_count: counts.failed,
          },
          timestamps: {
            ...manifest.timestamps,
            updated_at: new Date().toISOString(),
          },
        };

        await writeManifest(runDir, updatedManifest);
      }

      return {
        success: true,
        message: `Task ${taskId} updated successfully (V2 WAL)`,
        tasksAffected: 1,
      };
    },
    { operation: 'update_task_in_queue' }
  );
}

/**
 * Update task in queue using V2 WAL only (no fallback).
 * Use when V2 format is required.
 *
 * @param runDir - Run directory path
 * @param taskId - Task ID to update
 * @param updates - Partial task updates
 * @returns Operation result
 * @throws If V2 update fails
 */
export async function updateTaskInQueueV2(
  runDir: string,
  taskId: string,
  updates: Partial<ExecutionTask>
): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      const v2Cache = await getV2IndexCache(runDir);
      const existingTask = getTask(v2Cache.state, taskId);

      if (!existingTask) {
        return {
          success: false,
          message: `Task ${taskId} not found in queue`,
        };
      }

      // Build patch with updated_at timestamp
      const patch: Partial<ExecutionTaskData> = {
        ...updates,
        updated_at: new Date().toISOString(),
      } as Partial<ExecutionTaskData>;

      // Append update operation to WAL
      const op: Omit<QueueOperation, 'seq' | 'checksum'> = {
        op: 'update',
        ts: new Date().toISOString(),
        taskId,
        patch,
      };

      await appendOperation(v2Cache.queueDir, op);

      // Update in-memory index
      updateTaskInIndex(v2Cache.state, taskId, patch);

      // Check if compaction is needed (V2 uses different compaction strategy)
      // V2 compaction is handled automatically during snapshot operations

      // Update run manifest if status changed
      if (updates.status) {
        const manifest = await readManifest(runDir);
        const counts = getCounts(v2Cache.state);

        const updatedManifest = {
          ...manifest,
          queue: {
            ...manifest.queue,
            pending_count: counts.pending,
            completed_count: counts.completed,
            failed_count: counts.failed,
          },
          timestamps: {
            ...manifest.timestamps,
            updated_at: new Date().toISOString(),
          },
        };

        await writeManifest(runDir, updatedManifest);
      }

      return {
        success: true,
        message: `Task ${taskId} updated successfully (V2 WAL)`,
        tasksAffected: 1,
      };
    },
    { operation: 'update_task_in_queue_v2' }
  );
}
