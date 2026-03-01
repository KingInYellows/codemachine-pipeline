/**
 * Queue Memory Index
 *
 * In-memory index providing O(1) lookups for tasks.
 * Hydrates from snapshot + WAL replay and maintains task counts for fast status queries.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 4
 * - FR-3 (Resumability): Fast recovery via snapshot + WAL replay
 * - ADR-2 (State Persistence): In-memory index synchronized with persistent state
 *
 * Features:
 * - O(1) task lookup by ID using Map
 * - Accurate counts maintained on every update
 * - Dependency resolution for task scheduling
 * - Dirty tracking for snapshot coordination
 */

import type { QueueIndexState, QueueCounts, ExecutionTaskData, QueueOperation } from './queueTypes';
import { createEmptyQueueCounts, createEmptyIndexState } from './queueTypes';
import { loadSnapshot } from './queueSnapshotManager';
import { readOperations } from './queueOperationsLog';
import type { ExecutionTaskStatus } from '../../core/models/ExecutionTask';

/**
 * Maps task status to the corresponding count field.
 * Used for maintaining accurate counts on status changes.
 */
const STATUS_TO_COUNT_FIELD: Record<ExecutionTaskStatus, keyof Omit<QueueCounts, 'total'>> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
};

/**
 * Create a new index state from snapshot and WAL.
 * This is the main hydration function for rebuilding state on startup.
 *
 * Process:
 * 1. Load snapshot if exists (provides baseline state)
 * 2. Read WAL operations after snapshot sequence
 * 3. Replay operations to bring index up to date
 *
 * @returns Hydrated index state
 */
export async function hydrateIndex(queueDir: string): Promise<QueueIndexState> {
  // Start with empty state
  const state = createEmptyIndexState();

  // Try to load snapshot
  const snapshot = await loadSnapshot(queueDir);

  if (snapshot) {
    // Populate index from snapshot
    for (const [taskId, taskData] of Object.entries(snapshot.tasks)) {
      state.tasks.set(taskId, taskData);
    }

    // Copy counts from snapshot
    state.counts = { ...snapshot.counts };

    // Set sequence watermarks
    state.snapshotSeq = snapshot.snapshotSeq;
    state.lastSeq = snapshot.snapshotSeq;
  }

  // Read WAL operations after snapshot sequence
  const operations = await readOperations(queueDir, state.snapshotSeq);

  // Replay operations to bring index up to date
  for (const op of operations) {
    applyOperation(state, op);
  }

  // Index is clean after hydration (no uncommitted changes)
  state.dirty = false;

  return state;
}

/**
 * Apply a single operation to the index.
 * Used during WAL replay and live updates.
 *
 * Handles three operation types:
 * - create: Add new task, increment pending count
 * - update: Modify existing task, adjust counts if status changed
 * - delete: Remove task, decrement appropriate count
 *
 */
export function applyOperation(state: QueueIndexState, op: QueueOperation): void {
  // Skip if operation is older than last applied
  if (op.seq <= state.lastSeq) {
    return;
  }

  switch (op.op) {
    case 'create': {
      if (op.task) {
        // Add task to index
        state.tasks.set(op.taskId, op.task);

        // Update counts
        state.counts.total += 1;
        const statusField = STATUS_TO_COUNT_FIELD[op.task.status];
        state.counts[statusField] += 1;
      }
      break;
    }

    case 'update': {
      const existingTask = state.tasks.get(op.taskId);
      if (existingTask && op.patch) {
        const oldStatus = existingTask.status;

        // Apply patch to task
        const updatedTask: ExecutionTaskData = {
          ...existingTask,
          ...op.patch,
        };
        state.tasks.set(op.taskId, updatedTask);

        // Adjust counts if status changed
        if (op.patch.status && op.patch.status !== oldStatus) {
          const oldField = STATUS_TO_COUNT_FIELD[oldStatus];
          const newField = STATUS_TO_COUNT_FIELD[op.patch.status];

          state.counts[oldField] -= 1;
          state.counts[newField] += 1;
        }
      }
      break;
    }

    case 'delete': {
      const taskToDelete = state.tasks.get(op.taskId);
      if (taskToDelete) {
        // Decrement counts
        state.counts.total -= 1;
        const statusField = STATUS_TO_COUNT_FIELD[taskToDelete.status];
        state.counts[statusField] -= 1;

        // Remove from index
        state.tasks.delete(op.taskId);
      }
      break;
    }
    default: {
      throw new Error('Unknown queue operation');
    }
  }

  // Update sequence tracking
  state.lastSeq = op.seq;
  state.dirty = true;
}

/**
 * Get a task by ID (O(1) lookup).
 *
 * @returns Task data if found, undefined otherwise
 */
export function getTask(state: QueueIndexState, taskId: string): ExecutionTaskData | undefined {
  return state.tasks.get(taskId);
}

/**
 * Get all tasks matching a status filter.
 * O(n) where n is total task count.
 *
 * @returns Array of matching tasks
 */
export function getTasksByStatus(
  state: QueueIndexState,
  status: ExecutionTaskStatus
): ExecutionTaskData[] {
  const results: ExecutionTaskData[] = [];

  for (const task of state.tasks.values()) {
    if (task.status === status) {
      results.push(task);
    }
  }

  return results;
}

/**
 * Get current counts (O(1)).
 *
 * @returns Copy of current queue counts
 */
export function getCounts(state: QueueIndexState): QueueCounts {
  return { ...state.counts };
}

/**
 * Check if all dependencies of a task are completed.
 *
 * @returns True if all dependencies are completed
 */
export function areDependenciesCompleted(
  state: QueueIndexState,
  taskId: string,
  dependencyGraph: Record<string, string[]>
): boolean {
  const dependencies = dependencyGraph[taskId];

  // No dependencies means ready
  if (!dependencies || dependencies.length === 0) {
    return true;
  }

  // Check each dependency
  for (const depId of dependencies) {
    const depTask = state.tasks.get(depId);

    // Dependency must exist and be completed
    if (!depTask || depTask.status !== 'completed') {
      return false;
    }
  }

  return true;
}

/**
 * Get next ready task (first pending task with completed dependencies).
 * Useful for sequential task execution.
 *
 * @returns First ready task or null if none available
 */
export function getNextReadyTask(
  state: QueueIndexState,
  dependencyGraph: Record<string, string[]>
): ExecutionTaskData | null {
  for (const task of state.tasks.values()) {
    if (task.status === 'pending') {
      if (areDependenciesCompleted(state, task.task_id, dependencyGraph)) {
        return task;
      }
    }
  }

  return null;
}

/**
 * Get all ready tasks (for parallel execution).
 * Returns all pending tasks whose dependencies are completed.
 *
 * @returns Array of ready tasks
 */
export function getReadyTasks(
  state: QueueIndexState,
  dependencyGraph: Record<string, string[]>
): ExecutionTaskData[] {
  const readyTasks: ExecutionTaskData[] = [];

  for (const task of state.tasks.values()) {
    if (task.status === 'pending') {
      if (areDependenciesCompleted(state, task.task_id, dependencyGraph)) {
        readyTasks.push(task);
      }
    }
  }

  return readyTasks;
}

/**
 * Update task in index and adjust counts.
 * This is a direct in-memory update, not persisted to WAL.
 * Caller is responsible for WAL persistence.
 *
 */
export function updateTask(
  state: QueueIndexState,
  taskId: string,
  updates: Partial<ExecutionTaskData>
): void {
  const existingTask = state.tasks.get(taskId);

  if (!existingTask) {
    return;
  }

  const oldStatus = existingTask.status;

  // Merge updates
  const updatedTask: ExecutionTaskData = {
    ...existingTask,
    ...updates,
  };
  state.tasks.set(taskId, updatedTask);

  // Adjust counts if status changed
  if (updates.status && updates.status !== oldStatus) {
    const oldField = STATUS_TO_COUNT_FIELD[oldStatus];
    const newField = STATUS_TO_COUNT_FIELD[updates.status];

    state.counts[oldField] -= 1;
    state.counts[newField] += 1;
  }

  state.dirty = true;
}

/**
 * Recalculate counts from tasks (for validation).
 * Iterates all tasks to compute accurate counts.
 * Useful for detecting count drift or corruption.
 *
 * @returns Freshly calculated counts
 */
export function recalculateCounts(state: QueueIndexState): QueueCounts {
  const counts = createEmptyQueueCounts();

  for (const task of state.tasks.values()) {
    counts.total += 1;
    const statusField = STATUS_TO_COUNT_FIELD[task.status];
    counts[statusField] += 1;
  }

  return counts;
}

/**
 * Validate that stored counts match actual task distribution.
 * Returns true if counts are accurate, false if drift detected.
 *
 * @returns True if counts are valid
 */
export function validateCounts(state: QueueIndexState): boolean {
  const calculated = recalculateCounts(state);

  return (
    calculated.total === state.counts.total &&
    calculated.pending === state.counts.pending &&
    calculated.running === state.counts.running &&
    calculated.completed === state.counts.completed &&
    calculated.failed === state.counts.failed &&
    calculated.skipped === state.counts.skipped &&
    calculated.cancelled === state.counts.cancelled
  );
}

/**
 * Repair counts by recalculating from tasks.
 * Use when validation detects drift.
 *
 */
export function repairCounts(state: QueueIndexState): void {
  state.counts = recalculateCounts(state);
  state.dirty = true;
}

/**
 * Mark index as dirty (needs snapshot).
 *
 */
export function markDirty(state: QueueIndexState): void {
  state.dirty = true;
}

/**
 * Check if index needs snapshot.
 *
 * @returns True if index has uncommitted changes
 */
export function isDirty(state: QueueIndexState): boolean {
  return state.dirty;
}

/**
 * Mark index as clean (after snapshot).
 *
 */
export function markClean(state: QueueIndexState, snapshotSeq: number): void {
  state.dirty = false;
  state.snapshotSeq = snapshotSeq;
}

/**
 * Add a new task to the index.
 * Does not persist to WAL - caller handles persistence.
 *
 */
export function addTask(state: QueueIndexState, task: ExecutionTaskData): void {
  // Don't add if already exists
  if (state.tasks.has(task.task_id)) {
    return;
  }

  state.tasks.set(task.task_id, task);
  state.counts.total += 1;
  const statusField = STATUS_TO_COUNT_FIELD[task.status];
  state.counts[statusField] += 1;
  state.dirty = true;
}

/**
 * Remove a task from the index.
 * Does not persist to WAL - caller handles persistence.
 *
 */
export function removeTask(state: QueueIndexState, taskId: string): void {
  const task = state.tasks.get(taskId);

  if (!task) {
    return;
  }

  state.counts.total -= 1;
  const statusField = STATUS_TO_COUNT_FIELD[task.status];
  state.counts[statusField] -= 1;
  state.tasks.delete(taskId);
  state.dirty = true;
}

/**
 * Clear all tasks from the index.
 * Resets to empty state.
 *
 */
export function clearIndex(state: QueueIndexState): void {
  state.tasks.clear();
  state.counts = createEmptyQueueCounts();
  state.lastSeq = 0;
  state.snapshotSeq = 0;
  state.dirty = true;
}

/**
 * Export index state as plain objects for snapshot creation.
 *
 * @returns Plain object representation suitable for JSON serialization
 */
export function exportIndexState(state: QueueIndexState): {
  tasks: Record<string, ExecutionTaskData>;
  counts: QueueCounts;
  lastSeq: number;
} {
  const tasks: Record<string, ExecutionTaskData> = {};

  for (const [taskId, task] of state.tasks) {
    tasks[taskId] = { ...task };
  }

  return {
    tasks,
    counts: { ...state.counts },
    lastSeq: state.lastSeq,
  };
}

/**
 * Get the number of operations since last snapshot.
 * Used for compaction threshold checks.
 *
 * @returns Number of operations since last snapshot
 */
export function getOperationsSinceSnapshot(state: QueueIndexState): number {
  return state.lastSeq - state.snapshotSeq;
}
