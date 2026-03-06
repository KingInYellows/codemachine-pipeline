import { appendFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import {
  type ExecutionTask,
  ExecutionTaskSchema,
  serializeExecutionTask,
} from '../../core/models/ExecutionTask';
import { validateOrThrow } from '../../validation/helpers.js';
import { readManifest, writeManifest, withLock } from '../../persistence';
import { createLogger, type StructuredLogger, LogLevel } from '../../telemetry/logger';
import { getErrorMessage } from '../../utils/errors.js';

// V2 WAL Components
import { getCounts, addTask as addTaskToIndex } from './queueMemoryIndex.js';
import { appendOperationsBatch } from './queueOperationsLog.js';
import { compact } from './queueCompactionEngine.js';
import { QUEUE_FILE, QUEUE_MANIFEST_FILE, QUEUE_SNAPSHOT_FILE } from './queueTypes.js';
import type {
  QueueOperation,
  QueueManifest,
  QueueSnapshot,
  QueueOperationResult,
} from './queueTypes.js';

// V2 Cache and helpers (shared with other queue modules to avoid circular dependencies)
import {
  getV2IndexCache,
  buildDependencyGraph,
  toExecutionTaskData,
  invalidateV2Cache,
} from './queueCache.js';

// Re-export for backward compatibility.
export {
  getV2IndexCache,
  buildDependencyGraph,
  toExecutionTask,
  toExecutionTaskData,
  invalidateV2Cache,
} from './queueCache.js';

// Import integrity functions from companion module
import { invalidateIntegrityVerification } from './queueIntegrity.js';

const QueueSnapshotSchema = z.object({
  schema_version: z.string(),
  feature_id: z.string(),
  tasks: z.record(z.string(), ExecutionTaskSchema),
  dependency_graph: z.record(z.string(), z.array(z.string())),
  timestamp: z.string(),
  checksum: z.string(),
});

/**
 * Invalidate all process-local queue state for a run directory.
 *
 * This is intentionally separate from `invalidateV2Cache` (cache-only) to avoid changing
 * public API semantics across import paths. Use this when queue contents may have changed
 * (e.g. migrations) and we want a fresh hydrate plus integrity re-check.
 */
export function invalidateQueueRunState(runDir: string): void {
  invalidateV2Cache(runDir);
  invalidateIntegrityVerification(runDir);
}

/**
 * Queue Store
 *
 * Manages persistent task queue storage with JSONL snapshots,
 * integrity checksums, and safe resume capabilities.
 *
 */

// Re-export types for backward compatibility
export type {
  QueueManifest,
  QueueSnapshot,
  QueueOperationResult,
  QueueValidationResult,
  QueueIntegrityMode,
  QueueIntegrityErrorKind,
} from './queueTypes.js';
export { QueueIntegrityError } from './queueTypes.js';

// Module-level logger for queue store operations
const logger: StructuredLogger = createLogger({
  component: 'queue-store',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

/** Initialize queue storage in run directory. */
export async function initializeQueue(runDir: string, featureId: string): Promise<string> {
  const manifest = await readManifest(runDir);
  const queueDir = join(runDir, manifest.queue.queue_dir);

  await mkdir(queueDir, { recursive: true });

  // Create initial queue manifest
  const queueManifest: QueueManifest = {
    schema_version: '1.0.0',
    feature_id: featureId,
    total_tasks: 0,
    pending_count: 0,
    running_count: 0,
    completed_count: 0,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    queue_checksum: computeEmptyQueueChecksum(),
    updated_at: new Date().toISOString(),
  };

  await writeQueueManifest(queueDir, queueManifest);

  return queueDir;
}

export interface PlanTask {
  id: string;
  title: string;
  task_type: ExecutionTask['task_type'];
  dependency_ids?: string[];
  /** Intentional: task config shape varies by task_type */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: task config varies per execution task type
  config?: Record<string, unknown>;
  /** Intentional: task metadata varies by consumer */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: task metadata varies per execution task type
  metadata?: Record<string, unknown>;
}

/** TaskPlan interface for queue initialization. Queue-specific DTO, distinct from PlanArtifact. */
export interface TaskPlan {
  /** Feature identifier for queue initialization */
  feature_id: string;
  /** Array of plan tasks to transform to ExecutionTasks */
  tasks: PlanTask[];
}

export async function initializeQueueFromPlan(
  runDir: string,
  plan: TaskPlan
): Promise<QueueOperationResult> {
  try {
    await initializeQueue(runDir, plan.feature_id);

    if (plan.tasks.length === 0) {
      return {
        success: true,
        message: 'Queue initialized with no tasks',
        tasksAffected: 0,
      };
    }

    const now = new Date().toISOString();
    const executionTasks: ExecutionTask[] = plan.tasks.map((planTask) => ({
      schema_version: '1.0.0',
      task_id: planTask.id,
      feature_id: plan.feature_id,
      title: planTask.title,
      task_type: planTask.task_type,
      status: 'pending' as const,
      dependency_ids: planTask.dependency_ids ?? [],
      retry_count: 0,
      max_retries: 3,
      created_at: now,
      updated_at: now,
      ...(planTask.config !== undefined ? { config: planTask.config } : {}),
      ...(planTask.metadata !== undefined ? { metadata: planTask.metadata } : {}),
    }));

    const result = await appendToQueue(runDir, executionTasks);

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      message: `Queue initialized from plan with ${executionTasks.length} task(s)`,
      tasksAffected: executionTasks.length,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to initialize queue from plan',
      errors: [error instanceof Error ? (error.stack ?? error.message) : 'Unknown error'],
    };
  }
}

function computeEmptyQueueChecksum(): string {
  return createHash('sha256').update('').digest('hex');
}

/**
 * Append tasks to queue.
 * Uses V2 WAL for atomic task creation with batch support.
 */
export async function appendToQueue(
  runDir: string,
  tasks: ExecutionTask[]
): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      const v2Cache = await getV2IndexCache(runDir);

      if (tasks.length === 0) {
        return {
          success: true,
          message: 'No tasks to append',
          tasksAffected: 0,
        };
      }

      // Build create operations for batch append
      const ops: Array<Omit<QueueOperation, 'seq' | 'checksum'>> = tasks.map((task) => ({
        op: 'create' as const,
        ts: new Date().toISOString(),
        taskId: task.task_id,
        task: toExecutionTaskData(task),
      }));

      // Batch append to WAL (non-locked, we're already inside withLock)
      const appendedOps = await appendOperationsBatch(v2Cache.queueDir, ops);
      const lastOp = appendedOps[appendedOps.length - 1];
      if (lastOp) {
        v2Cache.state.lastSeq = lastOp.seq;
      }

      // Update in-memory index
      for (const task of tasks) {
        addTaskToIndex(v2Cache.state, toExecutionTaskData(task));
      }

      // Also append to queue.jsonl for validators/tests that read from it
      const queuePath = join(v2Cache.queueDir, QUEUE_FILE);
      const lines = `${tasks.map((task) => serializeExecutionTask(task, false)).join('\n')}\n`;
      await appendFile(queuePath, lines, 'utf-8');

      // Update run manifest
      const manifest = await readManifest(runDir);
      const counts = getCounts(v2Cache.state);

      const updatedManifest = {
        ...manifest,
        queue: {
          ...manifest.queue,
          pending_count: counts.pending,
        },
        timestamps: {
          ...manifest.timestamps,
          updated_at: new Date().toISOString(),
        },
      };

      await writeManifest(runDir, updatedManifest);

      return {
        success: true,
        message: `Successfully appended ${tasks.length} task(s) to queue (V2 WAL)`,
        tasksAffected: tasks.length,
      };
    },
    { operation: 'append_to_queue' }
  );
}

/** Validate that a queue directory path is safe (defense-in-depth against path traversal). */
function validateQueueDirectory(queueDir: string): void {
  const segments = queueDir.split(/[\\/]+/).filter(Boolean);

  // Basic sanity checks for path traversal patterns
  if (segments.includes('..')) {
    throw new Error(`Unsafe queue directory path: ${queueDir}`);
  }
}

/** Write queue manifest to disk with fsync for durability (write-temp-rename pattern). */
async function writeQueueManifest(queueDir: string, manifest: QueueManifest): Promise<void> {
  validateQueueDirectory(queueDir);
  const manifestPath = join(queueDir, QUEUE_MANIFEST_FILE);
  const tempPath = `${manifestPath}.tmp.${randomBytes(8).toString('hex')}`;
  const content = JSON.stringify(manifest, null, 2);

  try {
    // Write to temp file with fsync
    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync(); // Ensure data is on disk before rename
    } finally {
      await handle.close();
    }

    await rename(tempPath, manifestPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      // Log cleanup failure but don't mask the original error
      logger.debug('Failed to clean up temp file during error recovery', {
        temp_path: tempPath,
        cleanup_error: getErrorMessage(cleanupError),
      });
    }
    throw error;
  }
}

export { loadQueue, loadQueueV2 } from './queueLoader.js';

/** Load queue from snapshot (faster than reading JSONL). */
export async function loadQueueSnapshot(runDir: string): Promise<QueueSnapshot | null> {
  const manifest = await readManifest(runDir);
  const queueDir = join(runDir, manifest.queue.queue_dir);
  const snapshotPath = join(queueDir, QUEUE_SNAPSHOT_FILE);

  try {
    const content = await readFile(snapshotPath, 'utf-8');
    const snapshot = validateOrThrow(QueueSnapshotSchema, JSON.parse(content), 'queue snapshot');

    // Verify snapshot integrity
    const dataToHash = JSON.stringify({
      tasks: snapshot.tasks,
      dependency_graph: snapshot.dependency_graph,
    });
    const expectedChecksum = createHash('sha256').update(dataToHash).digest('hex');

    if (snapshot.checksum !== expectedChecksum) {
      logger.warn('Queue snapshot checksum mismatch - falling back to JSONL');
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

// Re-export integrity types and functions for backward compatibility
export {
  getQueueIntegrityMode,
  verifyQueueIntegrity,
  type QueueIntegrityResult,
} from './queueIntegrity.js';

/** Create queue snapshot for fast recovery via V2 compaction engine. */
export async function createQueueSnapshot(runDir: string): Promise<QueueOperationResult> {
  try {
    const v2Cache = await getV2IndexCache(runDir);
    const dependencyGraph = buildDependencyGraph(v2Cache.state);

    // Use V2 compaction engine to create snapshot
    const result = await compact(
      runDir,
      v2Cache.queueDir,
      v2Cache.featureId,
      dependencyGraph,
      { pruneCompleted: false } // Don't prune, just snapshot
    );

    const taskCount = v2Cache.state.tasks.size;

    return {
      success: true,
      message: result.compacted
        ? `Snapshot created with ${taskCount} task(s) at seq ${result.snapshotSeq}`
        : `Queue already at snapshot seq ${result.snapshotSeq}, no changes needed`,
      tasksAffected: taskCount,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      errors: [error instanceof Error ? error.stack || error.message : 'Unknown error'],
    };
  }
}

export {
  getNextTask,
  getPendingTasks,
  getFailedTasks,
  getTaskById,
  updateTaskInQueue,
  updateTaskInQueueV2,
} from './queueTaskManager.js';
export {
  getQueueCountsV2,
  getReadyTasksV2,
  getV2IndexState,
  forceCompactV2,
  exportV2State,
} from './queueV2Api.js';
export { validateQueue } from './queueValidation.js';
