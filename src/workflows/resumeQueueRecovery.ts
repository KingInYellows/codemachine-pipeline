/**
 * Resume Queue Recovery
 *
 * Extracted from resumeCoordinator.ts: queue snapshot validation
 * and task recovery for execution resumption.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readManifest } from '../persistence/runDirectoryManager';
import {
  type ExecutionTask,
  canRetry,
  areDependenciesCompleted,
} from '../core/models/ExecutionTask';
import { loadQueue } from './queueStore';

// ============================================================================
// Types
// ============================================================================

export interface QueueSnapshotMetadata {
  /** Number of tasks captured in the snapshot */
  taskCount: number;
  /** Snapshot checksum for integrity */
  checksum: string;
  /** Timestamp when snapshot was taken */
  timestamp: string;
  /** Queue file path (relative to queue directory) */
  queueFile: string;
}

// ============================================================================
// Queue Recovery Functions
// ============================================================================

/**
 * Validate queue snapshot integrity
 *
 * @param runDir - Run directory path
 * @param snapshot - Queue snapshot metadata
 * @returns True if snapshot is valid
 */
export async function validateQueueSnapshot(
  runDir: string,
  snapshot: QueueSnapshotMetadata
): Promise<boolean> {
  try {
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);

    // Note: Don't check queue file existence here - V2 format may not have queue.jsonl
    // The snapshot file itself is the source of truth

    // Load raw snapshot file to check format (handles both V1 and V2)
    const snapshotPath = path.join(queueDir, 'queue_snapshot.json');
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const rawSnapshot = JSON.parse(content) as {
      schemaVersion?: string;
      schema_version?: string;
      tasks: { [taskId: string]: unknown };
      counts?: unknown;
      dependencyGraph?: Record<string, string[]>;
      dependency_graph?: Record<string, string[]>;
      checksum: string;
      timestamp: string;
    };

    const taskCount = Object.keys(rawSnapshot.tasks).length;
    const normalizedStoredTimestamp = new Date(rawSnapshot.timestamp).toISOString();
    const timestampsMatch = normalizedStoredTimestamp === snapshot.timestamp;

    // Basic validation: task count, checksum, and timestamp must match
    // This works for both V1 and V2 formats since both have these fields
    return (
      taskCount === snapshot.taskCount &&
      rawSnapshot.checksum === snapshot.checksum &&
      timestampsMatch
    );
  } catch {
    return false;
  }
}

/**
 * Get resumable tasks from queue
 *
 * This is a placeholder - actual implementation will use queueStore
 *
 * @param runDir - Run directory path
 * @returns Array of tasks that can be resumed
 */
export async function getResumableTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  const ready: ExecutionTask[] = [];
  const seen = new Set<string>();

  const addTask = (task: ExecutionTask): void => {
    if (!seen.has(task.task_id)) {
      ready.push(task);
      seen.add(task.task_id);
    }
  };

  // Retry any tasks that were running when the crash occurred
  for (const [, task] of tasks) {
    if (task.status === 'running' && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  // Pending tasks are next as long as their dependencies are satisfied
  for (const [, task] of tasks) {
    if (task.status === 'pending' && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  // Finally, include retryable failures
  for (const [, task] of tasks) {
    if (canRetry(task) && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  return ready;
}
