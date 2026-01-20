/**
 * Queue Compaction Engine
 *
 * Merges WAL operations into snapshots when thresholds are exceeded.
 * Provides atomic compaction with file locking to prevent concurrent modifications.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 5
 * - FR-3 (Resumability): Periodic compaction maintains fast recovery times
 * - ADR-2 (State Persistence): Atomic snapshot + WAL truncation
 *
 * Compaction Process:
 * 1. Check thresholds (operation count and WAL size)
 * 2. Hydrate current state from snapshot + WAL
 * 3. Optionally prune completed tasks with no dependents
 * 4. Write new snapshot with current lastSeq
 * 5. Truncate WAL atomically
 *
 * Default Thresholds:
 * - maxUpdates: 1000 operations
 * - maxBytes: 5MB WAL size
 */

import type { CompactionConfig, QueueIndexState, QueueCounts } from './queueTypes';
import { createDefaultCompactionConfig } from './queueTypes';
import { getSnapshotMetadata, saveSnapshot } from './queueSnapshotManager';
import { getOperationsLogStats, truncateOperationsLogToSeq } from './queueOperationsLog';
import { hydrateIndex, exportIndexState, markClean } from './queueMemoryIndex';
import { withLock } from '../persistence/runDirectoryManager';
import type { ExecutionTaskStatus } from '../core/models/ExecutionTask';

// ============================================================================
// Status to Count Field Mapping
// ============================================================================

/**
 * Maps task status to the corresponding count field.
 * Used for maintaining accurate counts during pruning.
 */
const STATUS_TO_COUNT_FIELD: Record<ExecutionTaskStatus, keyof Omit<QueueCounts, 'total'>> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
};

// ============================================================================
// Threshold Checking
// ============================================================================

/**
 * Check if compaction is needed based on WAL thresholds.
 *
 * Evaluates both operation count and byte size against configured limits.
 * Returns detailed stats for logging/monitoring.
 *
 * @param queueDir - Path to queue directory
 * @param config - Optional partial compaction config (uses defaults for missing values)
 * @returns Compaction decision with reason and current stats
 */
export async function shouldCompact(
  queueDir: string,
  config?: Partial<CompactionConfig>
): Promise<{ needed: boolean; reason: string; stats: { operations: number; bytes: number } }> {
  const mergedConfig = { ...createDefaultCompactionConfig(), ...config };
  const walStats = await getOperationsLogStats(queueDir);

  const stats = {
    operations: walStats.operationCount,
    bytes: walStats.sizeBytes,
  };

  // Check operation count threshold
  if (walStats.operationCount >= mergedConfig.maxUpdates) {
    return {
      needed: true,
      reason: `WAL operation count (${walStats.operationCount}) exceeds threshold (${mergedConfig.maxUpdates})`,
      stats,
    };
  }

  // Check byte size threshold
  if (walStats.sizeBytes >= mergedConfig.maxBytes) {
    return {
      needed: true,
      reason: `WAL size (${walStats.sizeBytes} bytes) exceeds threshold (${mergedConfig.maxBytes} bytes)`,
      stats,
    };
  }

  return {
    needed: false,
    reason: 'Thresholds not exceeded',
    stats,
  };
}

// ============================================================================
// Task Pruning
// ============================================================================

/**
 * Prune completed tasks from snapshot that have no remaining dependents.
 *
 * A task can be pruned if:
 * 1. It is in a terminal state (completed, failed, skipped, cancelled)
 * 2. No other pending/running tasks depend on it
 *
 * This optimization reduces snapshot size over time for long-running queues.
 *
 * @param state - Index state to prune (modified in place)
 * @param dependencyGraph - Task dependency mappings
 * @returns Number of tasks pruned
 */
export function pruneCompletedTasks(
  state: QueueIndexState,
  dependencyGraph: Record<string, string[]>
): number {
  // Build reverse dependency map: taskId -> tasks that depend on it
  const dependents = new Map<string, Set<string>>();

  for (const [taskId, deps] of Object.entries(dependencyGraph)) {
    for (const depId of deps) {
      if (!dependents.has(depId)) {
        dependents.set(depId, new Set());
      }
      dependents.get(depId)?.add(taskId);
    }
  }

  // Find tasks eligible for pruning
  const terminalStatuses = new Set(['completed', 'failed', 'skipped', 'cancelled']);
  const toPrune: string[] = [];

  for (const [taskId, task] of state.tasks) {
    // Only prune terminal tasks
    if (!terminalStatuses.has(task.status)) {
      continue;
    }

    // Check if any non-terminal task depends on this one
    const taskDependents = dependents.get(taskId);
    if (!taskDependents || taskDependents.size === 0) {
      // No dependents - safe to prune
      toPrune.push(taskId);
      continue;
    }

    // Check if all dependents are also terminal
    const hasActiveDependents = [...taskDependents].some((dependentId) => {
      const dependentTask = state.tasks.get(dependentId);
      return dependentTask && !terminalStatuses.has(dependentTask.status);
    });

    if (!hasActiveDependents) {
      toPrune.push(taskId);
    }
  }

  // Prune identified tasks
  for (const taskId of toPrune) {
    const task = state.tasks.get(taskId);
    if (task) {
      // Update counts
      state.counts.total -= 1;
      const statusField = STATUS_TO_COUNT_FIELD[task.status];
      state.counts[statusField] -= 1;
      // Remove from index
      state.tasks.delete(taskId);
    }
  }

  if (toPrune.length > 0) {
    state.dirty = true;
  }

  return toPrune.length;
}

// ============================================================================
// Core Compaction
// ============================================================================

/**
 * Perform compaction with existing state (for use during execution).
 *
 * Used when caller already has hydrated state and holds the lock.
 * Writes new snapshot and truncates WAL atomically.
 *
 * @param runDir - Run directory path (for lock coordination)
 * @param queueDir - Queue directory path
 * @param featureId - Feature identifier for snapshot
 * @param state - Current hydrated index state
 * @param dependencyGraph - Task dependency mappings
 * @param config - Optional partial compaction config
 * @returns Compaction result with snapshot sequence and pruned count
 */
export async function compactWithState(
  _runDir: string, // Reserved for future use (caller holds lock)
  queueDir: string,
  featureId: string,
  state: QueueIndexState,
  dependencyGraph: Record<string, string[]>,
  config?: Partial<CompactionConfig>
): Promise<{ compacted: boolean; snapshotSeq: number; prunedTasks: number }> {
  const mergedConfig = { ...createDefaultCompactionConfig(), ...config };

  // Optionally prune completed tasks
  let prunedTasks = 0;
  if (mergedConfig.pruneCompleted) {
    prunedTasks = pruneCompletedTasks(state, dependencyGraph);
  }

  // Export state for snapshot
  const exported = exportIndexState(state);

  // Write new snapshot with current sequence
  const snapshot = await saveSnapshot(
    queueDir,
    featureId,
    exported.tasks,
    exported.counts,
    exported.lastSeq,
    dependencyGraph
  );

  // Truncate WAL - all operations are now in snapshot
  await truncateOperationsLogToSeq(queueDir, snapshot.snapshotSeq);

  // Update state to reflect new snapshot
  markClean(state, snapshot.snapshotSeq);

  return {
    compacted: true,
    snapshotSeq: snapshot.snapshotSeq,
    prunedTasks,
  };
}

/**
 * Perform full compaction: hydrate state, optionally prune, snapshot, truncate WAL.
 *
 * Acquires lock for the entire operation to ensure atomicity.
 * Suitable for standalone compaction calls.
 *
 * @param runDir - Run directory path (for locking)
 * @param queueDir - Queue directory path
 * @param featureId - Feature identifier for snapshot
 * @param dependencyGraph - Task dependency mappings
 * @param config - Optional partial compaction config
 * @returns Compaction result with snapshot sequence and pruned count
 */
export async function compact(
  runDir: string,
  queueDir: string,
  featureId: string,
  dependencyGraph: Record<string, string[]>,
  config?: Partial<CompactionConfig>
): Promise<{ compacted: boolean; snapshotSeq: number; prunedTasks: number }> {
  return withLock(
    runDir,
    async () => {
      // Hydrate current state from snapshot + WAL
      const state = await hydrateIndex(queueDir);

      // If no operations to compact, skip unless WAL still has stale entries.
      if (state.lastSeq === state.snapshotSeq) {
        const walStats = await getOperationsLogStats(queueDir);

        if (walStats.operationCount > 0 || walStats.sizeBytes > 0) {
          await truncateOperationsLogToSeq(queueDir, state.snapshotSeq);
          return {
            compacted: true,
            snapshotSeq: state.snapshotSeq,
            prunedTasks: 0,
          };
        }

        return {
          compacted: false,
          snapshotSeq: state.snapshotSeq,
          prunedTasks: 0,
        };
      }

      // Perform compaction with hydrated state
      return compactWithState(runDir, queueDir, featureId, state, dependencyGraph, config);
    },
    { operation: 'queue_compaction' }
  );
}

/**
 * Conditionally compact if thresholds are exceeded.
 *
 * Convenience function that checks thresholds first, then compacts if needed.
 * Acquires lock only if compaction is needed.
 *
 * @param runDir - Run directory path (for locking)
 * @param queueDir - Queue directory path
 * @param featureId - Feature identifier for snapshot
 * @param dependencyGraph - Task dependency mappings
 * @param config - Optional partial compaction config
 * @returns Compaction result (compacted: false if thresholds not exceeded)
 */
export async function maybeCompact(
  runDir: string,
  queueDir: string,
  featureId: string,
  dependencyGraph: Record<string, string[]>,
  config?: Partial<CompactionConfig>
): Promise<{ compacted: boolean; snapshotSeq: number }> {
  // Check if compaction is needed (no lock required for read)
  const check = await shouldCompact(queueDir, config);

  if (!check.needed) {
    // Get current snapshot seq without compacting
    const metadata = await getSnapshotMetadata(queueDir);
    return {
      compacted: false,
      snapshotSeq: metadata?.snapshotSeq ?? 0,
    };
  }

  // Perform compaction with locking
  const result = await compact(runDir, queueDir, featureId, dependencyGraph, config);

  return {
    compacted: result.compacted,
    snapshotSeq: result.snapshotSeq,
  };
}
