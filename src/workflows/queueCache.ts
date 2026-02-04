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
import { readManifest } from '../persistence/runDirectoryManager';
import { createLogger, type StructuredLogger, LogLevel } from '../telemetry/logger';
import { ensureV2Format } from './queueMigration.js';
import { hydrateIndex } from './queueMemoryIndex.js';
import type { QueueIndexState, ExecutionTaskData } from './queueTypes.js';
import type { ExecutionTask } from '../core/models/ExecutionTask';

// Module-level logger
const logger: StructuredLogger = createLogger({
  component: 'queue-cache',
  minLevel: LogLevel.DEBUG,
  mirrorToStderr: true,
});

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
      message: "Run 'codepipe queue verify' to confirm migration integrity",
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
