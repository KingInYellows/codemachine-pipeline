/**
 * Queue Migration (V1 to V2)
 *
 * Migrates existing V1 queue.jsonl format to V2 (snapshot + WAL).
 * Automatic, transparent migration with full data preservation.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 6
 * - FR-3 (Resumability): Seamless upgrade path for existing queues
 * - ADR-2 (State Persistence): Safe migration with backup/rollback
 *
 * V1 Format:
 * - queue.jsonl: One ExecutionTask per line
 * - queue_updates.jsonl: Incremental task updates
 *
 * V2 Format:
 * - queue_snapshot.json: QueueSnapshotV2 with tasks + counts + dependency graph
 * - queue_operations.log: WAL for incremental changes
 * - queue_sequence.txt: Sequence counter for fast seq lookup
 */

import type { MigrationResult, QueueCounts, ExecutionTaskData } from './queueTypes';
import { createEmptyQueueCounts } from './queueTypes';
import type { ExecutionTask } from '../core/models/ExecutionTask';
import { parseExecutionTask } from '../core/models/ExecutionTask';
import { loadSnapshot, saveSnapshot } from './queueSnapshotManager';
import { initializeOperationsLog } from './queueOperationsLog';
import { invalidateV2Cache } from './queueStore';
import { createLogger, LogLevel } from '../telemetry/logger';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Module-level logger for migration operations
const logger = createLogger({
  component: 'queue-migration',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

// ============================================================================
// Constants
// ============================================================================

const V1_QUEUE_FILENAME = 'queue.jsonl';
const V1_UPDATES_FILENAME = 'queue_updates.jsonl';
const V1_BACKUP_SUFFIX = '.v1backup';
const V2_SNAPSHOT_FILENAME = 'queue_snapshot.json';
const V2_OPERATIONS_FILENAME = 'queue_operations.log';

// ============================================================================
// Version Detection
// ============================================================================

/**
 * Detect queue format version.
 *
 * Detection logic:
 * - V2: queue_snapshot.json exists with schemaVersion '2.0.0', OR
 *       queue_operations.log exists (V2 WAL marker)
 * - V1: queue.jsonl exists (without V2 snapshot or operations log)
 * - none: No queue files found
 *
 * @param queueDir - Path to queue directory
 * @returns Detected version or 'none' if no queue exists
 */
export async function detectQueueVersion(queueDir: string): Promise<'v1' | 'v2' | 'none'> {
  // Check for V2 snapshot first (takes precedence)
  const snapshot = await loadSnapshot(queueDir);
  if (snapshot) {
    return 'v2';
  }

  // Check for V2 operations log (WAL marker for V2 format without snapshot yet)
  const v2OpsLogPath = path.join(queueDir, V2_OPERATIONS_FILENAME);
  try {
    await fs.access(v2OpsLogPath);
    return 'v2';
  } catch {
    // V2 operations log doesn't exist
  }

  // Check for V1 queue file (only considered V1 if no V2 markers present)
  const v1QueuePath = path.join(queueDir, V1_QUEUE_FILENAME);
  try {
    await fs.access(v1QueuePath);
    return 'v1';
  } catch {
    // V1 queue doesn't exist
  }

  return 'none';
}

/**
 * Check if migration from V1 to V2 is needed.
 *
 * @param queueDir - Path to queue directory
 * @returns True if V1 queue exists without V2 snapshot
 */
export async function needsMigration(queueDir: string): Promise<boolean> {
  const version = await detectQueueVersion(queueDir);
  return version === 'v1';
}

// ============================================================================
// V1 Queue Loading
// ============================================================================

/**
 * Load V1 queue from queue.jsonl file.
 *
 * Gracefully handles corrupted lines by skipping them.
 * Also applies updates from queue_updates.jsonl if present.
 *
 * @param queueDir - Path to queue directory
 * @returns Array of all valid tasks
 */
export async function loadV1Queue(queueDir: string): Promise<ExecutionTask[]> {
  const tasks = new Map<string, ExecutionTask>();

  // Load base queue
  const queuePath = path.join(queueDir, V1_QUEUE_FILENAME);
  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    const lines = content.trim().split('\n').filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const result = parseExecutionTask(parsed);
        if (result.success) {
          tasks.set(result.data.task_id, result.data);
        }
      } catch {
        // Skip corrupted lines
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Apply updates from queue_updates.jsonl
  const updatesPath = path.join(queueDir, V1_UPDATES_FILENAME);
  try {
    const content = await fs.readFile(updatesPath, 'utf-8');
    const lines = content.trim().split('\n').filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const result = parseExecutionTask(parsed);
        if (result.success) {
          tasks.set(result.data.task_id, result.data);
        }
      } catch {
        // Skip corrupted updates
      }
    }
  } catch {
    // Updates file doesn't exist - that's fine
  }

  return Array.from(tasks.values());
}

// ============================================================================
// Snapshot Building
// ============================================================================

/**
 * Build initial V2 snapshot data from V1 tasks.
 *
 * Extracts dependency graph and computes status counts.
 *
 * @param tasks - Array of tasks from V1 queue
 * @returns Snapshot data components (tasks record, counts, dependency graph)
 */
export function buildInitialSnapshot(
  tasks: ExecutionTask[]
): {
  tasks: Record<string, ExecutionTaskData>;
  counts: QueueCounts;
  dependencyGraph: Record<string, string[]>;
} {
  const taskRecord: Record<string, ExecutionTaskData> = {};
  const dependencyGraph: Record<string, string[]> = {};
  const counts = createEmptyQueueCounts();

  for (const task of tasks) {
    // Convert to mutable data type
    taskRecord[task.task_id] = { ...task } as ExecutionTaskData;

    // Build dependency graph
    if (task.dependency_ids.length > 0) {
      dependencyGraph[task.task_id] = [...task.dependency_ids];
    }

    // Update counts
    counts.total += 1;
    switch (task.status) {
      case 'pending':
        counts.pending += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
    }
  }

  return { tasks: taskRecord, counts, dependencyGraph };
}

// ============================================================================
// Migration Operations
// ============================================================================

/**
 * Migrate V1 queue to V2 format.
 *
 * Migration steps:
 * 1. Load all tasks from V1 queue.jsonl + queue_updates.jsonl
 * 2. Build initial V2 snapshot with counts and dependency graph
 * 3. Create empty WAL (operations log)
 * 4. Backup V1 files by renaming to .v1backup
 *
 * @param queueDir - Path to queue directory
 * @param featureId - Feature identifier for the queue
 * @returns Migration result with success status and details
 */
export async function migrateV1ToV2(
  queueDir: string,
  featureId: string
): Promise<MigrationResult> {
  const v1QueuePath = path.join(queueDir, V1_QUEUE_FILENAME);
  const v1UpdatesPath = path.join(queueDir, V1_UPDATES_FILENAME);
  const v1QueueBackup = `${v1QueuePath}${V1_BACKUP_SUFFIX}`;
  const v1UpdatesBackup = `${v1UpdatesPath}${V1_BACKUP_SUFFIX}`;

  logger.info('Starting V1 to V2 queue migration', {
    queue_dir: queueDir,
    feature_id: featureId,
    v1_queue_file: v1QueuePath,
    backup_location: v1QueueBackup,
  });

  try {
    // Step 1: Load V1 queue
    logger.debug('Loading V1 queue tasks', { queue_path: v1QueuePath });
    const tasks = await loadV1Queue(queueDir);
    logger.info('Loaded V1 queue tasks', { task_count: tasks.length });

    // Step 2: Build V2 snapshot data
    logger.debug('Building V2 snapshot data from tasks');
    const { tasks: taskRecord, counts, dependencyGraph } = buildInitialSnapshot(tasks);
    logger.info('Built V2 snapshot', {
      total_tasks: counts.total,
      pending: counts.pending,
      completed: counts.completed,
      failed: counts.failed,
      dependency_edges: Object.keys(dependencyGraph).length,
    });

    // Step 3: Create V2 snapshot (snapshotSeq = 0 for initial snapshot)
    logger.debug('Saving V2 snapshot');
    await saveSnapshot(
      queueDir,
      featureId,
      taskRecord as Record<string, ExecutionTask>,
      counts,
      0,
      dependencyGraph
    );

    // Step 4: Initialize empty WAL
    logger.debug('Initializing V2 operations log (WAL)');
    await initializeOperationsLog(queueDir);

    // Step 5: Backup V1 files (rename to .v1backup)
    logger.debug('Backing up V1 files');
    try {
      await fs.rename(v1QueuePath, v1QueueBackup);
      logger.info('V1 queue file backed up', { backup_path: v1QueueBackup });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.rename(v1UpdatesPath, v1UpdatesBackup);
      logger.info('V1 updates file backed up', { backup_path: v1UpdatesBackup });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        // Updates file may not exist - that's fine
        logger.debug('No V1 updates file to backup (expected for queues without updates)');
      }
    }

    logger.info('V1 to V2 migration completed successfully', {
      tasks_converted: tasks.length,
      backup_path: v1QueueBackup,
    });

    return {
      success: true,
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      tasksConverted: tasks.length,
      backupPath: v1QueueBackup,
    };
  } catch (error) {
    logger.error('V1 to V2 migration failed', {
      error: error instanceof Error ? error.message : String(error),
      queue_dir: queueDir,
    });
    return {
      success: false,
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      tasksConverted: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Rollback migration by restoring V1 files from backup.
 *
 * Removes V2 files and restores V1 backups.
 *
 * @param queueDir - Path to queue directory
 * @returns True if rollback succeeded, false if no backup found
 */
export async function rollbackMigration(queueDir: string): Promise<boolean> {
  const v1QueuePath = path.join(queueDir, V1_QUEUE_FILENAME);
  const v1UpdatesPath = path.join(queueDir, V1_UPDATES_FILENAME);
  const v1QueueBackup = `${v1QueuePath}${V1_BACKUP_SUFFIX}`;
  const v1UpdatesBackup = `${v1UpdatesPath}${V1_BACKUP_SUFFIX}`;
  const snapshotPath = path.join(queueDir, V2_SNAPSHOT_FILENAME);
  const operationsPath = path.join(queueDir, V2_OPERATIONS_FILENAME);
  const sequencePath = path.join(queueDir, 'queue_sequence.txt');

  // Check if backup exists
  try {
    await fs.access(v1QueueBackup);
  } catch {
    return false;
  }

  // Remove V2 files
  for (const filePath of [snapshotPath, operationsPath, sequencePath]) {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore missing files
    }
  }

  // Restore V1 files
  try {
    await fs.rename(v1QueueBackup, v1QueuePath);
  } catch {
    return false;
  }

  try {
    await fs.rename(v1UpdatesBackup, v1UpdatesPath);
  } catch {
    // Updates backup may not exist - that's fine
  }

  return true;
}

/**
 * Clean up V1 backup files after successful migration verification.
 *
 * Should only be called after confirming V2 queue works correctly.
 *
 * @param queueDir - Path to queue directory
 */
export async function cleanupV1Backups(queueDir: string): Promise<void> {
  const v1QueueBackup = path.join(queueDir, `${V1_QUEUE_FILENAME}${V1_BACKUP_SUFFIX}`);
  const v1UpdatesBackup = path.join(queueDir, `${V1_UPDATES_FILENAME}${V1_BACKUP_SUFFIX}`);

  for (const backupPath of [v1QueueBackup, v1UpdatesBackup]) {
    try {
      await fs.unlink(backupPath);
    } catch {
      // Ignore if backup doesn't exist
    }
  }
}

// ============================================================================
// Auto-Migration
// ============================================================================

/**
 * Ensure queue is in V2 format, migrating if necessary.
 *
 * Call this at queue load time for transparent migration.
 * Safe to call multiple times - no-op if already V2 or empty.
 *
 * @param queueDir - Path to queue directory
 * @param featureId - Feature identifier for the queue
 * @returns Migration status and result if migration occurred
 */
export async function ensureV2Format(
  queueDir: string,
  featureId: string
): Promise<{ migrated: boolean; result?: MigrationResult }> {
  const version = await detectQueueVersion(queueDir);

  if (version === 'v2') {
    logger.debug('Queue already in V2 format', { queue_dir: queueDir });
    return { migrated: false };
  }

  if (version === 'none') {
    // No existing queue - just initialize empty V2 structure
    logger.debug('Initializing new V2 queue (no existing queue found)', { queue_dir: queueDir });
    await initializeOperationsLog(queueDir);
    return { migrated: false };
  }

  // V1 detected - perform migration
  logger.warn('⚠️ V1 queue format detected - auto-migration will be performed', {
    queue_dir: queueDir,
    feature_id: featureId,
    recommendation: "Run 'ai-feature queue verify' after migration to confirm integrity",
  });
  const result = await migrateV1ToV2(queueDir, featureId);

  // Invalidate V2 cache to ensure fresh data is loaded after migration
  if (result.success) {
    // Find the run directory (parent of queue directory)
    const runDir = path.dirname(queueDir);
    invalidateV2Cache(runDir);
    logger.debug('V2 index cache invalidated after successful migration', { run_dir: runDir });
  }

  return { migrated: result.success, result };
}
