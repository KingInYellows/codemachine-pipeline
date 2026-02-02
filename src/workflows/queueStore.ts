import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  type ExecutionTask,
  serializeExecutionTask,
} from '../core/models/ExecutionTask';
import { readManifest, writeManifest, withLock } from '../persistence/runDirectoryManager';
import { createLogger, type StructuredLogger, LogLevel } from '../telemetry/logger';

// V2 WAL Components
import { ensureV2Format } from './queueMigration.js';
import {
  hydrateIndex,
  getCounts,
  addTask as addTaskToIndex,
} from './queueMemoryIndex.js';
import {
  appendOperationsBatch,
} from './queueOperationsLog.js';
import { compact } from './queueCompactionEngine.js';
import type { QueueIndexState, QueueOperation, ExecutionTaskData } from './queueTypes.js';

/**
 * Queue Store
 *
 * Manages persistent task queue storage with JSONL snapshots,
 * integrity checksums, and safe resume capabilities.
 *
 * Implements FR-2 (Run Directory), FR-3 (Resumability), ADR-2 (State Persistence).
 */

// --- Types ---

/** Queue manifest metadata */
export interface QueueManifest {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** Total tasks in queue */
  total_tasks: number;
  /** Pending tasks */
  pending_count: number;
  /** Running tasks */
  running_count: number;
  /** Completed tasks */
  completed_count: number;
  /** Failed tasks */
  failed_count: number;
  /** Skipped tasks */
  skipped_count: number;
  /** Cancelled tasks */
  cancelled_count: number;
  /** SHA-256 checksum of queue.jsonl */
  queue_checksum: string;
  /** Timestamp of last update */
  updated_at: string;
  /** Timestamp of last snapshot */
  last_snapshot_at?: string;
}

/** Queue snapshot for fast recovery */
export interface QueueSnapshot {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** All tasks indexed by task_id */
  tasks: Record<string, ExecutionTask>;
  /** Task dependency graph (task_id -> dependent task_ids) */
  dependency_graph: Record<string, string[]>;
  /** Snapshot timestamp */
  timestamp: string;
  /** Checksum of snapshot data */
  checksum: string;
}

/** Queue operation result */
export interface QueueOperationResult {
  success: boolean;
  message: string;
  tasksAffected?: number;
  errors?: string[];
}

/** Queue validation result */
export interface QueueValidationResult {
  valid: boolean;
  errors: Array<{
    taskId: string;
    line: number;
    message: string;
  }>;
  warnings: Array<{
    taskId: string;
    message: string;
  }>;
  totalTasks: number;
  corruptedTasks: number;
}

// --- Constants ---

const QUEUE_FILE = 'queue.jsonl';
const QUEUE_MANIFEST_FILE = 'queue_manifest.json';
const QUEUE_SNAPSHOT_FILE = 'queue_snapshot.json';

// Module-level logger for queue store operations
const logger: StructuredLogger = createLogger({
  component: 'queue-store',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

// --- V2 Index State Management ---

/** V2 Index cache entry with state and metadata. */
interface V2IndexCache {
  /** Hydrated index state */
  state: QueueIndexState;
  /** Queue directory path */
  queueDir: string;
  /** Feature ID for this queue */
  featureId: string;
  /** Last hydration timestamp */
  hydratedAt: number;
  /** Whether V2 format has been verified */
  migrationChecked: boolean;
}

/** V2 index state cache, keyed by runDir. */
const v2IndexCache = new Map<string, V2IndexCache>();

/**
 * Get or create V2 index cache entry.
 * Hydrates index state from V2 WAL format, auto-migrating V1 queues.
 */
export async function getV2IndexCache(runDir: string): Promise<V2IndexCache> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const featureId = manifest.feature_id;

  const existing = v2IndexCache.get(runDir);

  // Return existing cache if available and fresh
  if (existing && existing.queueDir === queueDir && existing.migrationChecked) {
    return existing;
  }

  // Ensure V2 format (auto-migrate from V1 if needed)
  const migrationResult = await ensureV2Format(queueDir, featureId);
  if (migrationResult.result && !migrationResult.result.success) {
    throw new Error(
      `Queue migration failed: ${migrationResult.result.error ?? 'Unknown error'}`
    );
  }
  if (migrationResult.migrated && migrationResult.result) {
    logger.warn('⚠️ V1 queue format detected - auto-migrated to V2', {
      tasks_converted: migrationResult.result.tasksConverted,
      backup_path: migrationResult.result.backupPath,
      from_version: migrationResult.result.fromVersion,
      to_version: migrationResult.result.toVersion,
      message: "Run 'ai-feature queue verify' to confirm migration integrity",
    });
  }

  // Hydrate index from snapshot + WAL
  const state = await hydrateIndex(queueDir);

  const cache: V2IndexCache = {
    state,
    queueDir,
    featureId,
    hydratedAt: Date.now(),
    migrationChecked: true,
  };

  v2IndexCache.set(runDir, cache);
  return cache;
}

/** Build dependency graph from tasks in index state. */
export function buildDependencyGraph(state: QueueIndexState): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const [taskId, task] of state.tasks) {
    if (task.dependency_ids && task.dependency_ids.length > 0) {
      graph[taskId] = [...task.dependency_ids];
    }
  }

  return graph;
}

/** Convert ExecutionTaskData to ExecutionTask (readonly). */
export function toExecutionTask(data: ExecutionTaskData): ExecutionTask {
  return data as ExecutionTask;
}

/** Convert ExecutionTask to ExecutionTaskData (mutable). */
export function toExecutionTaskData(task: ExecutionTask): ExecutionTaskData {
  return { ...task } as ExecutionTaskData;
}

/** Invalidate V2 cache for a run directory. Forces re-hydration on next access. */
export function invalidateV2Cache(runDir: string): void {
  v2IndexCache.delete(runDir);
}

// --- Queue Initialization ---

/** Initialize queue storage in run directory. */
export async function initializeQueue(runDir: string, featureId: string): Promise<string> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);

  // Ensure queue directory exists
  await fs.mkdir(queueDir, { recursive: true });

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
  config?: Record<string, unknown>;
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
  return crypto.createHash('sha256').update('').digest('hex');
}

// --- Queue Writing ---

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
      const queuePath = path.join(v2Cache.queueDir, QUEUE_FILE);
      const lines = tasks.map((task) => serializeExecutionTask(task, false)).join('\n') + '\n';
      await fs.appendFile(queuePath, lines, 'utf-8');

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
  const segments = queueDir.split(/[\\\/]+/).filter(Boolean);

  // Basic sanity checks for path traversal patterns
  if (segments.includes('..')) {
    throw new Error(`Unsafe queue directory path: ${queueDir}`);
  }
}

/** Write queue manifest to disk with fsync for durability (write-temp-rename pattern). */
async function writeQueueManifest(queueDir: string, manifest: QueueManifest): Promise<void> {
  validateQueueDirectory(queueDir);
  const manifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
  const tempPath = `${manifestPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;
  const content = JSON.stringify(manifest, null, 2);

  try {
    // Write to temp file with fsync
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync(); // Ensure data is on disk before rename
    } finally {
      await handle.close();
    }

    // Atomic rename
    await fs.rename(tempPath, manifestPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      // Log cleanup failure but don't mask the original error
      logger.debug('Failed to clean up temp file during error recovery', {
        temp_path: tempPath,
        cleanup_error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    throw error;
  }
}

// --- Queue Reading ---

/** Load all tasks from queue via V2 WAL-based index. */
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
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

/** Load queue from snapshot (faster than reading JSONL). */
export async function loadQueueSnapshot(runDir: string): Promise<QueueSnapshot | null> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const snapshotPath = path.join(queueDir, QUEUE_SNAPSHOT_FILE);

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as QueueSnapshot;

    // Verify snapshot integrity
    const dataToHash = JSON.stringify({
      tasks: snapshot.tasks,
      dependency_graph: snapshot.dependency_graph,
    });
    const expectedChecksum = crypto.createHash('sha256').update(dataToHash).digest('hex');

    if (snapshot.checksum !== expectedChecksum) {
      logger.warn('Queue snapshot checksum mismatch - falling back to JSONL');
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

// --- Queue Snapshots ---

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

// --- Re-exports from companion modules for backward compatibility ---

export { getNextTask, getPendingTasks, getFailedTasks, getTaskById, updateTaskInQueue, updateTaskInQueueV2 } from './queueTaskManager.js';
export { getQueueCountsV2, getReadyTasksV2, getV2IndexState, forceCompactV2, exportV2State } from './queueV2Api.js';
export { validateQueue } from './queueValidation.js';
