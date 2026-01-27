/**
 * Queue Snapshot Manager
 *
 * Manages periodic snapshots of queue state for fast recovery.
 * Works with WAL from queueOperationsLog.ts for point-in-time recovery.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 3
 * - FR-3 (Resumability): Snapshot-based fast recovery
 * - ADR-2 (State Persistence): Atomic snapshot writes with checksums
 *
 * Features:
 * - Atomic writes via write-temp-rename pattern
 * - SHA-256 checksum for integrity validation
 * - File locking for concurrent access safety
 * - Graceful handling of malformed data
 */

import type { QueueSnapshotV2, QueueCounts, ExecutionTaskData } from './queueTypes';
import { isQueueSnapshotV2 } from './queueTypes';
import type { ExecutionTask } from '../core/models/ExecutionTask';
import { withLock } from '../persistence/runDirectoryManager';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// ============================================================================
// Constants
// ============================================================================

const SNAPSHOT_FILENAME = 'queue_snapshot.json';
const TEMP_SNAPSHOT_SUFFIX = '.tmp';

// ============================================================================
// Checksum Functions
// ============================================================================

/**
 * Compute SHA-256 checksum for snapshot integrity.
 *
 * Covers tasks + counts + dependencyGraph to detect any corruption.
 *
 * @param tasks - Task records to include in checksum
 * @param counts - Queue counts to include in checksum
 * @param dependencyGraph - Dependency graph to include in checksum
 * @returns Hex-encoded SHA-256 checksum
 */
export function computeSnapshotChecksum(
  tasks: Record<string, ExecutionTaskData>,
  counts: QueueCounts,
  dependencyGraph: Record<string, string[]>
): string {
  const dataToHash = JSON.stringify({
    tasks,
    counts,
    dependencyGraph,
  });

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

/**
 * Verify snapshot integrity by recomputing checksum.
 *
 * @param snapshot - Snapshot to verify
 * @returns True if checksum matches, false otherwise
 */
export function verifySnapshotChecksum(snapshot: QueueSnapshotV2): boolean {
  const expectedChecksum = computeSnapshotChecksum(
    snapshot.tasks,
    snapshot.counts,
    snapshot.dependencyGraph
  );

  return snapshot.checksum === expectedChecksum;
}

// ============================================================================
// Snapshot Loading
// ============================================================================

/**
 * Load snapshot from disk.
 *
 * Validates schema version and checksum before returning.
 * Returns null for missing, malformed, or corrupted snapshots.
 *
 * @param queueDir - Path to queue directory
 * @returns Snapshot if exists and valid, null otherwise
 */
export async function loadSnapshot(queueDir: string): Promise<QueueSnapshotV2 | null> {
  const snapshotPath = path.join(queueDir, SNAPSHOT_FILENAME);

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    // Validate schema
    if (!isQueueSnapshotV2(parsed)) {
      console.warn('Queue snapshot has invalid schema - ignoring');
      return null;
    }

    // Verify integrity
    if (!verifySnapshotChecksum(parsed)) {
      console.warn('Queue snapshot checksum mismatch - ignoring corrupted snapshot');
      return null;
    }

    return parsed;
  } catch (error) {
    // Handle specific error cases
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ENOENT') {
        // Snapshot doesn't exist - normal for new queues
        return null;
      }
    }

    // Log other errors but don't throw - caller can fall back to WAL replay
    console.warn(
      `Failed to load queue snapshot: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

// ============================================================================
// Snapshot Saving
// ============================================================================

/**
 * Save snapshot atomically using write-temp-rename pattern.
 *
 * This ensures no partial snapshots are ever visible - either the
 * complete new snapshot exists or the old one remains.
 *
 * @param queueDir - Path to queue directory
 * @param featureId - Feature identifier
 * @param tasks - Current task state
 * @param counts - Current queue counts
 * @param snapshotSeq - WAL sequence number this snapshot covers up to
 * @param dependencyGraph - Task dependency graph
 * @returns The created snapshot
 */
export async function saveSnapshot(
  queueDir: string,
  featureId: string,
  tasks: Record<string, ExecutionTask>,
  counts: QueueCounts,
  snapshotSeq: number,
  dependencyGraph: Record<string, string[]>
): Promise<QueueSnapshotV2> {
  const snapshotPath = path.join(queueDir, SNAPSHOT_FILENAME);
  const tempPath = `${snapshotPath}${TEMP_SNAPSHOT_SUFFIX}.${crypto.randomBytes(8).toString('hex')}`;

  // Convert ExecutionTask to ExecutionTaskData (remove readonly)
  const taskData: Record<string, ExecutionTaskData> = {};
  for (const [taskId, task] of Object.entries(tasks)) {
    taskData[taskId] = { ...task } as ExecutionTaskData;
  }

  // Build snapshot
  const checksum = computeSnapshotChecksum(taskData, counts, dependencyGraph);
  const snapshot: QueueSnapshotV2 = {
    schemaVersion: '2.0.0',
    featureId,
    snapshotSeq,
    tasks: taskData,
    counts,
    dependencyGraph,
    timestamp: new Date().toISOString(),
    checksum,
  };

  try {
    // Write to temp file with fsync for durability
    const content = JSON.stringify(snapshot, null, 2);
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync(); // Ensure data is on disk before rename
    } finally {
      await handle.close();
    }

    // Atomic rename
    await fs.rename(tempPath, snapshotPath);

    return snapshot;
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors - don't mask the original error
    }
    throw error;
  }
}

/**
 * Save snapshot with file locking for concurrent access safety.
 *
 * Acquires exclusive lock on run directory before writing.
 *
 * @param runDir - Path to run directory (for locking)
 * @param queueDir - Path to queue directory
 * @param featureId - Feature identifier
 * @param tasks - Current task state
 * @param counts - Current queue counts
 * @param snapshotSeq - WAL sequence number this snapshot covers up to
 * @param dependencyGraph - Task dependency graph
 * @returns The created snapshot
 */
export async function saveSnapshotLocked(
  runDir: string,
  queueDir: string,
  featureId: string,
  tasks: Record<string, ExecutionTask>,
  counts: QueueCounts,
  snapshotSeq: number,
  dependencyGraph: Record<string, string[]>
): Promise<QueueSnapshotV2> {
  return withLock(
    runDir,
    async () => saveSnapshot(queueDir, featureId, tasks, counts, snapshotSeq, dependencyGraph),
    { operation: 'save_queue_snapshot' }
  );
}

// ============================================================================
// Snapshot Management
// ============================================================================

/**
 * Delete snapshot file.
 *
 * Used during WAL compaction or queue reset operations.
 *
 * @param queueDir - Path to queue directory
 */
export async function deleteSnapshot(queueDir: string): Promise<void> {
  const snapshotPath = path.join(queueDir, SNAPSHOT_FILENAME);

  try {
    await fs.unlink(snapshotPath);
  } catch (error) {
    // Ignore if file doesn't exist
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

/**
 * Check if snapshot file exists.
 *
 * Quick existence check without loading or validating content.
 *
 * @param queueDir - Path to queue directory
 * @returns True if snapshot file exists
 */
export async function snapshotExists(queueDir: string): Promise<boolean> {
  const snapshotPath = path.join(queueDir, SNAPSHOT_FILENAME);

  try {
    await fs.access(snapshotPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get snapshot metadata without loading full tasks.
 *
 * Useful for quick status checks and compaction decisions.
 *
 * @param queueDir - Path to queue directory
 * @returns Snapshot metadata or null if not available
 */
export async function getSnapshotMetadata(queueDir: string): Promise<{
  exists: boolean;
  snapshotSeq: number;
  taskCount: number;
  timestamp: string;
} | null> {
  const snapshotPath = path.join(queueDir, SNAPSHOT_FILENAME);

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isQueueSnapshotV2(parsed)) {
      return null;
    }

    return {
      exists: true,
      snapshotSeq: parsed.snapshotSeq,
      taskCount: Object.keys(parsed.tasks).length,
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}
