import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  type ExecutionTask,
  parseExecutionTask,
  serializeExecutionTask,
  canRetry,
} from '../core/models/ExecutionTask';
import { readManifest, writeManifest, withLock } from '../persistence/runDirectoryManager';
import { createLogger, type StructuredLogger, LogLevel } from '../telemetry/logger';

// V2 WAL Components
import { ensureV2Format } from './queueMigration.js';
import {
  hydrateIndex,
  getTask,
  updateTask as updateTaskInIndex,
  getReadyTasks as getReadyTasksFromIndex,
  getCounts,
  exportIndexState,
  addTask as addTaskToIndex,
  areDependenciesCompleted as v2AreDependenciesCompleted,
} from './queueMemoryIndex.js';
import {
  appendOperation,
  appendOperationsBatch,
} from './queueOperationsLog.js';
import { shouldCompact, compactWithState, compact } from './queueCompactionEngine.js';
import type { QueueIndexState, QueueOperation, ExecutionTaskData } from './queueTypes.js';

/**
 * Queue Store
 *
 * Manages persistent task queue storage with JSONL snapshots,
 * integrity checksums, and safe resume capabilities.
 *
 * Implements:
 * - FR-2 (Run Directory): Queue persistence in `queue/` subdirectory
 * - FR-3 (Resumability): Queue snapshots with checksums for crash recovery
 * - ADR-2 (State Persistence): Monotonic queue files with integrity validation
 *
 * Queue Format:
 * - queue.jsonl: One ExecutionTask per line (append-only during execution)
 * - queue_snapshot.json: Periodic snapshots for fast recovery
 * - queue_manifest.json: Metadata (task counts, checksums, timestamps)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Queue manifest metadata
 */
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

/**
 * Queue snapshot for fast recovery
 */
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

/**
 * Queue operation result
 */
export interface QueueOperationResult {
  success: boolean;
  message: string;
  tasksAffected?: number;
  errors?: string[];
}

/**
 * Queue validation result
 */
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

// ============================================================================
// Constants
// ============================================================================

const QUEUE_FILE = 'queue.jsonl';
const QUEUE_MANIFEST_FILE = 'queue_manifest.json';
const QUEUE_SNAPSHOT_FILE = 'queue_snapshot.json';

// Module-level logger for queue store operations
const logger: StructuredLogger = createLogger({
  component: 'queue-store',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

interface QueueCounts {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

// ============================================================================
// V2 Index State Management
// ============================================================================

/**
 * V2 Index cache entry with state and metadata.
 * Maintains hydrated index state per run directory.
 */
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

/**
 * V2 index state cache, keyed by runDir.
 * Stores hydrated index state for O(1) task lookups.
 */
const v2IndexCache = new Map<string, V2IndexCache>();

/**
 * Get or create V2 index cache entry.
 * Hydrates index state from V2 WAL format.
 * Automatically migrates V1 queues to V2 when detected.
 *
 * @param runDir - Run directory path
 * @returns V2 index cache entry with hydrated state
 */
async function getV2IndexCache(runDir: string): Promise<V2IndexCache> {
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

/**
 * Build dependency graph from tasks in index state.
 *
 * @param state - Index state with tasks
 * @returns Dependency graph mapping taskId -> dependency taskIds
 */
function buildDependencyGraph(state: QueueIndexState): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const [taskId, task] of state.tasks) {
    if (task.dependency_ids && task.dependency_ids.length > 0) {
      graph[taskId] = [...task.dependency_ids];
    }
  }

  return graph;
}

/**
 * Convert ExecutionTaskData to ExecutionTask (readonly).
 * V2 index uses mutable data internally.
 *
 * @param data - Mutable task data from index
 * @returns Readonly ExecutionTask
 */
function toExecutionTask(data: ExecutionTaskData): ExecutionTask {
  return data as ExecutionTask;
}

/**
 * Convert ExecutionTask to ExecutionTaskData (mutable).
 *
 * @param task - Readonly ExecutionTask
 * @returns Mutable task data for index operations
 */
function toExecutionTaskData(task: ExecutionTask): ExecutionTaskData {
  return { ...task } as ExecutionTaskData;
}

/**
 * Invalidate V2 cache for a run directory.
 * Forces re-hydration on next access.
 *
 * @param runDir - Run directory to invalidate
 */
export function invalidateV2Cache(runDir: string): void {
  v2IndexCache.delete(runDir);
}

// ============================================================================
// Queue Initialization
// ============================================================================

/**
 * Initialize queue storage in run directory
 *
 * @param runDir - Run directory path
 * @param featureId - Feature ID
 * @returns Queue directory path
 */
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

/**
 * TaskPlan interface for queue initialization
 *
 * Represents a plan with a feature ID and associated tasks.
 * This is a queue-specific DTO, distinct from PlanArtifact.
 */
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

// ============================================================================
// Queue Writing
// ============================================================================

/**
 * Append tasks to queue
 *
 * Uses V2 WAL for atomic task creation with batch support.
 * Automatically migrates V1 queues to V2 when detected.
 *
 * @param runDir - Run directory path
 * @param tasks - Tasks to append
 * @returns Operation result
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

/**
 * Validate that a queue directory path is safe and doesn't escape its parent.
 * Defense-in-depth check to prevent path traversal.
 *
 * @param queueDir - Queue directory path to validate
 * @throws Error if path appears unsafe
 */
function validateQueueDirectory(queueDir: string): void {
  const segments = queueDir.split(/[\\\/]+/).filter(Boolean);

  // Basic sanity checks for path traversal patterns
  if (segments.includes('..')) {
    throw new Error(`Unsafe queue directory path: ${queueDir}`);
  }
}

/**
 * Write queue manifest to disk with fsync for durability.
 * Uses write-to-temp-then-rename pattern for atomicity.
 */
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

/**
 * Compute SHA-256 checksum of a file
 */
async function computeFileChecksum(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return computeEmptyQueueChecksum();
    }
    throw error;
  }
}

// ============================================================================
// Queue Reading
// ============================================================================

/**
 * Load all tasks from queue
 *
 * Uses V2 WAL-based index for O(1) task lookups.
 * Automatically migrates V1 queues to V2 when detected.
 *
 * @param runDir - Run directory path
 * @returns Map of task_id to ExecutionTask
 */
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
  const v2Cache = await getV2IndexCache(runDir);
  const tasks = new Map<string, ExecutionTask>();

  for (const [taskId, taskData] of v2Cache.state.tasks) {
    tasks.set(taskId, toExecutionTask(taskData));
  }

  return tasks;
}

/**
 * Load queue using V2 index only (no fallback).
 * Use when V2 format is required.
 *
 * @param runDir - Run directory path
 * @returns Map of task_id to ExecutionTask
 * @throws If V2 index cannot be loaded
 */
export async function loadQueueV2(runDir: string): Promise<Map<string, ExecutionTask>> {
  const v2Cache = await getV2IndexCache(runDir);
  const tasks = new Map<string, ExecutionTask>();

  for (const [taskId, taskData] of v2Cache.state.tasks) {
    tasks.set(taskId, toExecutionTask(taskData));
  }

  return tasks;
}

/**
 * Load queue from snapshot (faster than reading JSONL)
 *
 * @param runDir - Run directory path
 * @returns Queue snapshot or null if not available
 */
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

// ============================================================================
// Queue Snapshots
// ============================================================================

/**
 * Create queue snapshot for fast recovery
 *
 * Uses V2 compaction engine to create snapshot with WAL truncation.
 * Automatically migrates V1 queues to V2 when detected.
 *
 * @param runDir - Run directory path
 * @returns Operation result
 */
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

// ============================================================================
// Queue Validation
// ============================================================================

/**
 * Validate queue integrity
 *
 * @param runDir - Run directory path
 * @returns Validation result
 */
export async function validateQueue(runDir: string): Promise<QueueValidationResult> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const queuePath = path.join(queueDir, QUEUE_FILE);

  const result: QueueValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    totalTasks: 0,
    corruptedTasks: 0,
  };

  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    result.totalTasks = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      try {
        const parsed: unknown = JSON.parse(line);
        const parseResult = parseExecutionTask(parsed);
        const parsedRecord =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        const parsedTaskId =
          parsedRecord && typeof parsedRecord['task_id'] === 'string'
            ? parsedRecord['task_id']
            : `line_${lineNumber}`;

        if (!parseResult.success) {
          result.valid = false;
          result.corruptedTasks++;
          result.errors.push({
            taskId: parsedTaskId,
            line: lineNumber,
            message: `Validation failed: ${parseResult.errors.map((e) => e.message).join(', ')}`,
          });
        }
      } catch (error) {
        result.valid = false;
        result.corruptedTasks++;
        result.errors.push({
          taskId: `line_${lineNumber}`,
          line: lineNumber,
          message: error instanceof Error ? error.message : 'JSON parse error',
        });
      }
    }

    // Verify checksum
    const queueManifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
    try {
      const queueManifestContent = await fs.readFile(queueManifestPath, 'utf-8');
      const queueManifest = JSON.parse(queueManifestContent) as QueueManifest;

      const currentChecksum = await computeFileChecksum(queuePath);
      if (currentChecksum !== queueManifest.queue_checksum) {
        result.warnings.push({
          taskId: 'queue_manifest',
          message: 'Queue checksum mismatch - queue may have been modified externally',
        });
      }
    } catch {
      result.warnings.push({
        taskId: 'queue_manifest',
        message: 'Queue manifest not found or corrupted',
      });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // Queue file doesn't exist yet
      result.totalTasks = 0;
    } else {
      result.valid = false;
      result.errors.push({
        taskId: 'queue_file',
        line: 0,
        message: error instanceof Error ? error.message : 'Failed to read queue file',
      });
    }
  }

  return result;
}

// ============================================================================
// Queue Task Management
// ============================================================================

/**
 * Get next executable task from queue
 *
 * Uses V2 memory index for efficient task selection.
 * Priority order: running tasks (crash recovery) > pending tasks > retryable failures
 * Automatically migrates V1 queues to V2 when detected.
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
 * Automatically migrates V1 queues to V2 when detected.
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
 * Automatically migrates V1 queues to V2 when detected.
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

// ============================================================================
// V2 Queue API (Direct Access)
// ============================================================================

/**
 * Get queue counts using V2 index.
 * Returns O(1) counts from the in-memory index.
 *
 * @param runDir - Run directory path
 * @returns Queue counts by status
 */
export async function getQueueCountsV2(runDir: string): Promise<QueueCounts> {
  const v2Cache = await getV2IndexCache(runDir);
  return getCounts(v2Cache.state);
}

/**
 * Get all ready tasks using V2 index.
 * Returns pending tasks with all dependencies completed.
 *
 * @param runDir - Run directory path
 * @returns Array of ready-to-execute tasks
 */
export async function getReadyTasksV2(runDir: string): Promise<ExecutionTask[]> {
  const v2Cache = await getV2IndexCache(runDir);
  const dependencyGraph = buildDependencyGraph(v2Cache.state);
  const readyTasksData = getReadyTasksFromIndex(v2Cache.state, dependencyGraph);

  return readyTasksData.map(toExecutionTask);
}

/**
 * Get the V2 index state for advanced operations.
 * Use with caution - modifying state directly may cause inconsistencies.
 *
 * @param runDir - Run directory path
 * @returns V2 index state
 */
export async function getV2IndexState(runDir: string): Promise<QueueIndexState> {
  const v2Cache = await getV2IndexCache(runDir);
  return v2Cache.state;
}

/**
 * Force compaction of the V2 queue.
 * Creates a new snapshot and truncates the WAL.
 *
 * @param runDir - Run directory path
 * @returns Compaction result
 */
export async function forceCompactV2(runDir: string): Promise<{ compacted: boolean; snapshotSeq: number }> {
  const v2Cache = await getV2IndexCache(runDir);
  const dependencyGraph = buildDependencyGraph(v2Cache.state);

  const result = await compact(
    runDir,
    v2Cache.queueDir,
    v2Cache.featureId,
    dependencyGraph
  );

  if (result.compacted) {
    v2Cache.state.snapshotSeq = result.snapshotSeq;
    v2Cache.state.dirty = false;
  }

  return {
    compacted: result.compacted,
    snapshotSeq: result.snapshotSeq,
  };
}

/**
 * Export V2 queue state for debugging or backup.
 *
 * @param runDir - Run directory path
 * @returns Exported index state
 */
export async function exportV2State(runDir: string): Promise<{
  tasks: Record<string, ExecutionTaskData>;
  counts: QueueCounts;
  lastSeq: number;
}> {
  const v2Cache = await getV2IndexCache(runDir);
  return exportIndexState(v2Cache.state);
}
