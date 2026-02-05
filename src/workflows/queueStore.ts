import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { type ExecutionTask, serializeExecutionTask } from '../core/models/ExecutionTask';
import { readManifest, writeManifest, withLock } from '../persistence/runDirectoryManager';
import { createLogger, type StructuredLogger, LogLevel } from '../telemetry/logger';

// V2 WAL Components
import { getCounts, addTask as addTaskToIndex } from './queueMemoryIndex.js';
import { appendOperationsBatch, readOperationsWithStats } from './queueOperationsLog.js';
import { loadSnapshot } from './queueSnapshotManager.js';
import { compact } from './queueCompactionEngine.js';
import { QUEUE_FILE, QUEUE_MANIFEST_FILE, QUEUE_SNAPSHOT_FILE } from './queueConstants.js';
import type {
  QueueOperation,
  QueueManifest,
  QueueSnapshot,
  QueueOperationResult,
  QueueIntegrityMode,
} from './queueTypes.js';
import { QueueIntegrityError } from './queueTypes.js';

// V2 Cache and helpers (shared with other queue modules to avoid circular dependencies)
import {
  getV2IndexCache,
  buildDependencyGraph,
  toExecutionTask,
  toExecutionTaskData,
} from './queueCache.js';

// Re-export for backward compatibility (including invalidateV2Cache which is used by migration code)
import { invalidateV2Cache as _invalidateV2CacheOriginal } from './queueCache.js';
export {
  getV2IndexCache,
  buildDependencyGraph,
  toExecutionTask,
  toExecutionTaskData,
} from './queueCache.js';

/** Set of runDirs whose integrity has already been verified this process. */
const integrityVerifiedDirs = new Set<string>();

/** Invalidate V2 cache and integrity verification flag for a run directory. */
export function invalidateV2Cache(runDir: string): void {
  _invalidateV2CacheOriginal(runDir);
  integrityVerifiedDirs.delete(runDir);
}

/**
 * Queue Store
 *
 * Manages persistent task queue storage with JSONL snapshots,
 * integrity checksums, and safe resume capabilities.
 *
 * Implements FR-2 (Run Directory), FR-3 (Resumability), ADR-2 (State Persistence).
 */

// --- Types ---

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
  const segments = queueDir.split(/[\\/]+/).filter(Boolean);

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

// --- Queue Integrity Verification (CDMCH-69) ---

/** Read the integrity mode from environment, defaulting to fail-fast. */
export function getQueueIntegrityMode(): QueueIntegrityMode {
  const env = process.env.QUEUE_INTEGRITY_MODE;
  if (env === 'warn-only') return 'warn-only';
  return 'fail-fast';
}

/** Result of queue integrity verification. */
export interface QueueIntegrityResult {
  valid: boolean;
  snapshotValid: boolean | null; // null if no snapshot
  walEntriesChecked: number;
  walChecksumFailures: number;
  sequenceGaps: number[];
  errors: string[];
}

/**
 * Verify queue integrity by checking snapshot checksum and WAL sequence continuity.
 *
 * Validates checksums on both snapshot and individual WAL entries, and checks
 * for sequence number gaps. In fail-fast mode, throws QueueIntegrityError on
 * the first critical failure. In warn-only mode, logs warnings and continues.
 *
 * @param runDir - Path to the run directory
 * @param mode - Integrity mode override (defaults to env/fail-fast)
 * @returns Integrity verification result
 */
export async function verifyQueueIntegrity(
  runDir: string,
  mode?: QueueIntegrityMode
): Promise<QueueIntegrityResult> {
  const integrityMode = mode ?? getQueueIntegrityMode();

  const result: QueueIntegrityResult = {
    valid: true,
    snapshotValid: null,
    walEntriesChecked: 0,
    walChecksumFailures: 0,
    sequenceGaps: [],
    errors: [],
  };

  try {
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);

    // 1. Verify snapshot (loadSnapshot already validates checksum internally)
    const snapshot = await loadSnapshot(queueDir);
    if (snapshot) {
      result.snapshotValid = true; // loadSnapshot returns null on checksum mismatch
    } else {
      // null means no snapshot exists or it was invalid
      // We can distinguish by checking if the file exists
      try {
        await fs.access(path.join(queueDir, QUEUE_SNAPSHOT_FILE));
        // File exists but loadSnapshot returned null => invalid
        result.snapshotValid = false;
        result.valid = false;
        const errorMsg = 'Snapshot file exists but failed validation (schema or checksum)';
        result.errors.push(errorMsg);

        if (integrityMode === 'fail-fast') {
          throw new QueueIntegrityError({
            kind: 'snapshot-checksum-mismatch',
            message: errorMsg,
            location: path.join(queueDir, QUEUE_SNAPSHOT_FILE),
            recoveryGuidance:
              'Delete the snapshot file and replay from WAL, or restore from backup.',
          });
        }
      } catch (err) {
        if (err instanceof QueueIntegrityError) throw err;
        // File does not exist - that's fine, snapshotValid stays null
      }
    }

    // 2. Read and verify WAL operations with stats (counts checksum failures)
    const afterSeq = snapshot?.snapshotSeq ?? -1;
    const walResult = await readOperationsWithStats(queueDir, afterSeq);
    const operations = walResult.operations;
    result.walEntriesChecked = operations.length;
    result.walChecksumFailures = walResult.checksumFailures;

    if (walResult.checksumFailures > 0) {
      result.valid = false;
      const errorMsg = `${walResult.checksumFailures} WAL entry checksum failure(s) detected`;
      result.errors.push(errorMsg);

      if (integrityMode === 'fail-fast') {
        throw new QueueIntegrityError({
          kind: 'wal-checksum-mismatch',
          message: errorMsg,
          location: path.join(queueDir, 'queue_operations.log'),
          recoveryGuidance: 'Restore WAL from backup or re-snapshot from last known good state.',
        });
      }
    }

    // 3. Check sequence continuity
    if (operations.length > 0) {
      // First, verify snapshot-to-WAL continuity if snapshot exists
      if (snapshot) {
        const firstSeq = operations[0].seq;
        const expectedFirstSeq = snapshot.snapshotSeq + 1;
        if (firstSeq !== expectedFirstSeq) {
          result.valid = false;
          const errorMsg = `Gap between snapshot and WAL: snapshot ends at seq ${snapshot.snapshotSeq}, WAL starts at seq ${firstSeq}`;
          result.errors.push(errorMsg);
          for (let missingSeq = expectedFirstSeq; missingSeq < firstSeq; missingSeq++) {
            result.sequenceGaps.push(missingSeq);
          }

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-gap',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedFirstSeq, actual: firstSeq },
              recoveryGuidance:
                'Re-snapshot from current state or restore missing WAL entries from backup.',
            });
          }
        }
      }

      // Check WAL internal continuity
      let expectedSeq = operations[0].seq;
      for (let i = 1; i < operations.length; i++) {
        const nextSeq = operations[i].seq;
        if (nextSeq > expectedSeq + 1) {
          result.valid = false;
          const errorMsg = `Sequence gap: expected ${expectedSeq + 1}, got ${nextSeq}`;
          result.errors.push(errorMsg);
          for (let missingSeq = expectedSeq + 1; missingSeq < nextSeq; missingSeq++) {
            result.sequenceGaps.push(missingSeq);
          }

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-gap',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedSeq + 1, actual: nextSeq },
              recoveryGuidance:
                'Investigate missing WAL entries. Restore from backup or re-initialize queue.',
            });
          }
        } else if (nextSeq <= expectedSeq) {
          result.valid = false;
          const errorMsg = `Sequence not monotonic: expected > ${expectedSeq}, got ${nextSeq}`;
          result.errors.push(errorMsg);

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-non-monotonic',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedSeq + 1, actual: nextSeq },
              recoveryGuidance:
                'WAL is severely corrupted. Re-initialize queue from last valid snapshot.',
            });
          }
        }
        expectedSeq = nextSeq;
      }
    }

    return result;
  } catch (error) {
    if (error instanceof QueueIntegrityError) throw error;
    result.valid = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
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
