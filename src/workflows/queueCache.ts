/**
 * Queue Cache Module
 *
 * Shared helpers for V2 queue index state management and data conversions.
 * Extracted to break circular dependencies between queueStore and queueTaskManager.
 *
 * Contains:
 * - V2 index cache management (getV2IndexCache)
 * - Dependency graph builders
 * - Type converters (ExecutionTask ↔ ExecutionTaskData)
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { readManifest } from '../persistence/runDirectoryManager';
import { hydrateIndex } from './queueMemoryIndex.js';
import type { QueueIndexState, ExecutionTaskData } from './queueTypes.js';
import type { ExecutionTask } from '../core/models/ExecutionTask';

// ============================================================================
// V2 Index Cache Management
// ============================================================================

/** V2 Index cache entry with state and metadata. */
export interface V2IndexCache {
  /** Hydrated index state */
  state: QueueIndexState;
  /** Queue directory path */
  queueDir: string;
  /** Feature ID for this queue */
  featureId: string;
  /** Last hydration timestamp */
  hydratedAt: number;
}

/** V2 index state cache, keyed by runDir. */
const v2IndexCache = new Map<string, V2IndexCache>();

/**
 * Get or create V2 index cache entry.
 * Hydrates index state from V2 WAL format.
 * @throws Error if legacy V1 queue format is detected
 */
export async function getV2IndexCache(runDir: string): Promise<V2IndexCache> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const featureId = manifest.feature_id;

  const existing = v2IndexCache.get(runDir);

  // Return existing cache if available and fresh
  if (existing && existing.queueDir === queueDir) {
    return existing;
  }

  // Check for legacy V1 queue format
  await detectLegacyV1Queue(queueDir);

  // Hydrate index from snapshot + WAL
  const state = await hydrateIndex(queueDir);

  const cache: V2IndexCache = {
    state,
    queueDir,
    featureId,
    hydratedAt: Date.now(),
  };

  v2IndexCache.set(runDir, cache);
  return cache;
}

/**
 * Detect if queue directory contains legacy V1 format files.
 * Throws an error if V1 queue is detected without V2 files.
 * @throws Error if legacy V1 queue format is detected
 */
async function detectLegacyV1Queue(queueDir: string): Promise<void> {
  const v1QueueFile = path.join(queueDir, 'queue.jsonl');
  const v1UpdatesFile = path.join(queueDir, 'queue_updates.jsonl');
  const v2OperationsLog = path.join(queueDir, 'queue_operations.log');
  const v2Snapshot = path.join(queueDir, 'queue_snapshot.json');

  try {
    // Check if V1 files exist
    const [v1QueueExists, v1UpdatesExists, v2OperationsExists, v2SnapshotExists] =
      await Promise.all([
        fs.access(v1QueueFile).then(() => true, () => false),
        fs.access(v1UpdatesFile).then(() => true, () => false),
        fs.access(v2OperationsLog).then(() => true, () => false),
        fs.access(v2Snapshot).then(() => true, () => false),
      ]);

    // If V1 files exist but no V2 files, throw error
    if ((v1QueueExists || v1UpdatesExists) && !v2OperationsExists && !v2SnapshotExists) {
      throw new Error(
        `Legacy V1 queue format detected in ${queueDir}. V1 queues are no longer supported. ` +
        `Please migrate your queue to V2 format or recreate the run. ` +
        `V1 files found: ${v1QueueExists ? 'queue.jsonl ' : ''}${v1UpdatesExists ? 'queue_updates.jsonl' : ''}`
      );
    }
  } catch (error) {
    // Re-throw if it's our V1 detection error
    if (error instanceof Error && error.message.includes('Legacy V1 queue format')) {
      throw error;
    }
    // Ignore other access errors (directory doesn't exist, permissions, etc.)
  }
}

/** Invalidate V2 cache for a run directory. Forces re-hydration on next access. */
export function invalidateV2Cache(runDir: string): void {
  v2IndexCache.delete(runDir);
}

// ============================================================================
// Dependency Graph Helpers
// ============================================================================

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

// ============================================================================
// Type Converters
// ============================================================================

/** Convert ExecutionTaskData to ExecutionTask (readonly). */
export function toExecutionTask(data: ExecutionTaskData): ExecutionTask {
  return data as ExecutionTask;
}

/** Convert ExecutionTask to ExecutionTaskData (mutable). */
export function toExecutionTaskData(task: ExecutionTask): ExecutionTaskData {
  return { ...task } as ExecutionTaskData;
}
