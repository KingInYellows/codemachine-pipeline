/**
 * Queue V2 API (Direct Access)
 *
 * Provides high-level V2-specific queue operations for direct access
 * to the WAL-based index: counts, ready tasks, state export, and compaction.
 *
 * Extracted from queueStore.ts for maintainability.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 1
 * - FR-3 (Resumability): Fast state queries via in-memory index
 */

import type { ExecutionTask } from '../core/models/ExecutionTask';

// V2 WAL Components
import {
  getReadyTasks as getReadyTasksFromIndex,
  getCounts,
  exportIndexState,
} from './queueMemoryIndex.js';
import { compact } from './queueCompactionEngine.js';
import type { QueueIndexState, ExecutionTaskData, QueueCounts } from './queueTypes.js';

// Shared cache and helpers (avoids circular dependency with queueStore)
import { getV2IndexCache, buildDependencyGraph, toExecutionTask } from './queueCache.js';

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
export async function forceCompactV2(
  runDir: string
): Promise<{ compacted: boolean; snapshotSeq: number }> {
  const v2Cache = await getV2IndexCache(runDir);
  const dependencyGraph = buildDependencyGraph(v2Cache.state);

  const result = await compact(runDir, v2Cache.queueDir, v2Cache.featureId, dependencyGraph);

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
