import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  hydrateIndex,
  applyOperation,
  getTask,
  getTasksByStatus,
  getCounts,
  areDependenciesCompleted,
  getNextReadyTask,
  getReadyTasks,
  updateTask,
  recalculateCounts,
  validateCounts,
  repairCounts,
  markDirty,
  isDirty,
  markClean,
  addTask,
  removeTask,
  clearIndex,
  exportIndexState,
  getOperationsSinceSnapshot,
} from '../../src/workflows/queueMemoryIndex.js';
import type {
  QueueIndexState,
  QueueOperation,
  ExecutionTaskData,
} from '../../src/workflows/queueTypes.js';
import { createEmptyIndexState, createEmptyQueueCounts } from '../../src/workflows/queueTypes.js';
import { saveSnapshot } from '../../src/workflows/queueSnapshotManager.js';
import {
  appendOperationsBatch,
  initializeOperationsLog,
} from '../../src/workflows/queueOperationsLog.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

describe('queueMemoryIndex', () => {
  let testDir: string;

  const createTaskData = (
    id: string,
    status: ExecutionTaskData['status'] = 'pending'
  ): ExecutionTaskData => ({
    task_id: id,
    feature_id: 'feature-123',
    task_type: 'code_generation',
    status,
    title: `Test task ${id}`,
    description: 'Test description',
    priority: 1,
    dependencies: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const createOperation = (
    op: QueueOperation['op'],
    taskId: string,
    seq: number,
    task?: ExecutionTaskData,
    patch?: Partial<ExecutionTaskData>
  ): QueueOperation => ({
    op,
    taskId,
    seq,
    ts: new Date().toISOString(),
    task,
    patch,
    checksum: 'test-checksum',
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-index-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('hydrateIndex', () => {
    it('should return empty index for missing snapshot and WAL', async () => {
      const state = await hydrateIndex(testDir);

      expect(state.tasks.size).toBe(0);
      expect(state.counts.total).toBe(0);
      expect(state.lastSeq).toBe(0);
      expect(state.dirty).toBe(false);
    });

    it('should load tasks from snapshot', async () => {
      const task1 = createTaskData('task-1');
      const task2 = createTaskData('task-2', 'running');
      const tasks = { 'task-1': task1, 'task-2': task2 } as Record<string, ExecutionTask>;
      const counts = { ...createEmptyQueueCounts(), total: 2, pending: 1, running: 1 };

      await saveSnapshot(testDir, 'feature-123', tasks, counts, 10, {});

      const state = await hydrateIndex(testDir);

      expect(state.tasks.size).toBe(2);
      expect(state.tasks.get('task-1')?.status).toBe('pending');
      expect(state.tasks.get('task-2')?.status).toBe('running');
      expect(state.counts.total).toBe(2);
      expect(state.snapshotSeq).toBe(10);
    });

    it('should replay WAL operations after snapshot seq', async () => {
      const task1 = createTaskData('task-1');
      const tasks = { 'task-1': task1 } as Record<string, ExecutionTask>;
      const counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, {});

      // Initialize WAL and set sequence counter to match snapshot
      await initializeOperationsLog(testDir);
      await fs.writeFile(path.join(testDir, 'queue_sequence.txt'), '5', 'utf-8');

      const newTask = createTaskData('task-2');
      // appendOperationsBatch auto-assigns seq and checksum
      const ops = [
        { op: 'create' as const, taskId: 'task-2', ts: new Date().toISOString(), task: newTask },
        {
          op: 'update' as const,
          taskId: 'task-1',
          ts: new Date().toISOString(),
          patch: { status: 'completed' as const },
        },
      ];
      await appendOperationsBatch(testDir, ops);

      const state = await hydrateIndex(testDir);

      expect(state.tasks.size).toBe(2);
      expect(state.tasks.get('task-1')?.status).toBe('completed');
      expect(state.tasks.get('task-2')).toBeDefined();
      expect(state.lastSeq).toBe(7);
    });
  });

  describe('applyOperation', () => {
    let state: QueueIndexState;

    beforeEach(() => {
      state = createEmptyIndexState();
    });

    it('should add task on create operation', () => {
      const task = createTaskData('task-1');
      const op = createOperation('create', 'task-1', 1, task);

      applyOperation(state, op);

      expect(state.tasks.has('task-1')).toBe(true);
      expect(state.tasks.get('task-1')?.title).toBe('Test task task-1');
    });

    it('should modify task on update operation', () => {
      const task = createTaskData('task-1');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      const op = createOperation('update', 'task-1', 1, undefined, { title: 'Updated title' });
      applyOperation(state, op);

      expect(state.tasks.get('task-1')?.title).toBe('Updated title');
    });

    it('should remove task on delete operation', () => {
      const task = createTaskData('task-1');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      const op = createOperation('delete', 'task-1', 1);
      applyOperation(state, op);

      expect(state.tasks.has('task-1')).toBe(false);
      expect(state.counts.total).toBe(0);
    });

    it('should update counts correctly on create', () => {
      const task = createTaskData('task-1', 'running');
      const op = createOperation('create', 'task-1', 1, task);

      applyOperation(state, op);

      expect(state.counts.total).toBe(1);
      expect(state.counts.running).toBe(1);
      expect(state.counts.pending).toBe(0);
    });

    it('should update counts correctly on status change', () => {
      const task = createTaskData('task-1', 'pending');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      const op = createOperation('update', 'task-1', 1, undefined, { status: 'completed' });
      applyOperation(state, op);

      expect(state.counts.pending).toBe(0);
      expect(state.counts.completed).toBe(1);
    });

    it('should skip operations older than lastSeq', () => {
      state.lastSeq = 5;
      const task = createTaskData('task-1');
      const op = createOperation('create', 'task-1', 3, task);

      applyOperation(state, op);

      expect(state.tasks.has('task-1')).toBe(false);
    });
  });

  describe('getTask', () => {
    it('should return task by ID (O(1))', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1');
      state.tasks.set('task-1', task);

      const result = getTask(state, 'task-1');

      expect(result).toBeDefined();
      expect(result?.task_id).toBe('task-1');
    });

    it('should return undefined for missing task', () => {
      const state = createEmptyIndexState();

      const result = getTask(state, 'nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getTasksByStatus', () => {
    it('should return all tasks with matching status', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.tasks.set('task-2', createTaskData('task-2', 'running'));
      state.tasks.set('task-3', createTaskData('task-3', 'pending'));

      const pendingTasks = getTasksByStatus(state, 'pending');

      expect(pendingTasks).toHaveLength(2);
      expect(pendingTasks.map((t) => t.task_id).sort()).toEqual(['task-1', 'task-3']);
    });

    it('should return empty array for no matches', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const completedTasks = getTasksByStatus(state, 'completed');

      expect(completedTasks).toEqual([]);
    });
  });

  describe('areDependenciesCompleted', () => {
    let state: QueueIndexState;

    beforeEach(() => {
      state = createEmptyIndexState();
    });

    it('should return true when all deps completed', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'completed'));
      state.tasks.set('dep-2', createTaskData('dep-2', 'completed'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph = { 'task-1': ['dep-1', 'dep-2'] };
      const result = areDependenciesCompleted(state, 'task-1', depGraph);

      expect(result).toBe(true);
    });

    it('should return false when deps pending', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'completed'));
      state.tasks.set('dep-2', createTaskData('dep-2', 'pending'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph = { 'task-1': ['dep-1', 'dep-2'] };
      const result = areDependenciesCompleted(state, 'task-1', depGraph);

      expect(result).toBe(false);
    });

    it('should return true when no dependencies', () => {
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph: Record<string, string[]> = {};
      const result = areDependenciesCompleted(state, 'task-1', depGraph);

      expect(result).toBe(true);
    });

    it('should return false when dependency does not exist', () => {
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph = { 'task-1': ['nonexistent'] };
      const result = areDependenciesCompleted(state, 'task-1', depGraph);

      expect(result).toBe(false);
    });
  });

  describe('getNextReadyTask / getReadyTasks', () => {
    let state: QueueIndexState;

    beforeEach(() => {
      state = createEmptyIndexState();
    });

    it('should return pending task with completed deps', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'completed'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph = { 'task-1': ['dep-1'] };
      const ready = getNextReadyTask(state, depGraph);

      expect(ready).not.toBeNull();
      expect(ready?.task_id).toBe('task-1');
    });

    it('should skip tasks with incomplete deps', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'running'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.tasks.set('task-2', createTaskData('task-2', 'pending'));

      const depGraph = { 'task-1': ['dep-1'], 'task-2': [] };
      const ready = getNextReadyTask(state, depGraph);

      expect(ready).not.toBeNull();
      expect(ready?.task_id).toBe('task-2');
    });

    it('should return null when no ready tasks', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'running'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));

      const depGraph = { 'task-1': ['dep-1'] };
      const ready = getNextReadyTask(state, depGraph);

      expect(ready).toBeNull();
    });

    it('should return all ready tasks for parallel execution', () => {
      state.tasks.set('dep-1', createTaskData('dep-1', 'completed'));
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.tasks.set('task-2', createTaskData('task-2', 'pending'));
      state.tasks.set('task-3', createTaskData('task-3', 'pending'));

      const depGraph = { 'task-1': ['dep-1'], 'task-2': [], 'task-3': ['dep-1'] };
      const readyTasks = getReadyTasks(state, depGraph);

      expect(readyTasks).toHaveLength(3);
    });

    it('should return empty array when no tasks are ready', () => {
      state.tasks.set('task-1', createTaskData('task-1', 'completed'));

      const depGraph = {};
      const readyTasks = getReadyTasks(state, depGraph);

      expect(readyTasks).toEqual([]);
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      updateTask(state, 'task-1', { title: 'New title', priority: 5 });

      expect(state.tasks.get('task-1')?.title).toBe('New title');
      expect(state.tasks.get('task-1')?.priority).toBe(5);
    });

    it('should adjust counts on status change', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1', 'pending');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      updateTask(state, 'task-1', { status: 'failed' });

      expect(state.counts.pending).toBe(0);
      expect(state.counts.failed).toBe(1);
      expect(state.dirty).toBe(true);
    });

    it('should not adjust counts when status unchanged', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1', 'pending');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      updateTask(state, 'task-1', { title: 'Updated' });

      expect(state.counts.pending).toBe(1);
    });

    it('should do nothing for nonexistent task', () => {
      const state = createEmptyIndexState();

      updateTask(state, 'nonexistent', { status: 'failed' });

      expect(state.tasks.size).toBe(0);
    });
  });

  describe('recalculateCounts', () => {
    it('should match actual task statuses', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.tasks.set('task-2', createTaskData('task-2', 'running'));
      state.tasks.set('task-3', createTaskData('task-3', 'completed'));
      state.tasks.set('task-4', createTaskData('task-4', 'failed'));

      const counts = recalculateCounts(state);

      expect(counts.total).toBe(4);
      expect(counts.pending).toBe(1);
      expect(counts.running).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
    });
  });

  describe('validateCounts / repairCounts', () => {
    it('should return true when counts are valid', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      expect(validateCounts(state)).toBe(true);
    });

    it('should return false when counts are drifted', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.counts = { ...createEmptyQueueCounts(), total: 5, pending: 3 }; // Wrong

      expect(validateCounts(state)).toBe(false);
    });

    it('should repair counts to match tasks', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1', 'pending'));
      state.counts = { ...createEmptyQueueCounts(), total: 5, pending: 3 };

      repairCounts(state);

      expect(state.counts.total).toBe(1);
      expect(state.counts.pending).toBe(1);
      expect(state.dirty).toBe(true);
    });
  });

  describe('markDirty / isDirty / markClean', () => {
    it('should track dirty state correctly', () => {
      const state = createEmptyIndexState();

      expect(isDirty(state)).toBe(false);

      markDirty(state);
      expect(isDirty(state)).toBe(true);

      markClean(state, 10);
      expect(isDirty(state)).toBe(false);
      expect(state.snapshotSeq).toBe(10);
    });
  });

  describe('addTask / removeTask / clearIndex', () => {
    it('should add task and update counts', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1', 'running');

      addTask(state, task);

      expect(state.tasks.has('task-1')).toBe(true);
      expect(state.counts.total).toBe(1);
      expect(state.counts.running).toBe(1);
      expect(state.dirty).toBe(true);
    });

    it('should not add duplicate task', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };

      addTask(state, createTaskData('task-1', 'completed'));

      expect(state.tasks.get('task-1')?.status).toBe('pending');
      expect(state.counts.total).toBe(1);
    });

    it('should remove task and update counts', () => {
      const state = createEmptyIndexState();
      const task = createTaskData('task-1', 'running');
      state.tasks.set('task-1', task);
      state.counts = { ...createEmptyQueueCounts(), total: 1, running: 1 };

      removeTask(state, 'task-1');

      expect(state.tasks.has('task-1')).toBe(false);
      expect(state.counts.total).toBe(0);
      expect(state.counts.running).toBe(0);
    });

    it('should clear all tasks', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1'));
      state.tasks.set('task-2', createTaskData('task-2'));
      state.counts = { ...createEmptyQueueCounts(), total: 2, pending: 2 };
      state.lastSeq = 10;

      clearIndex(state);

      expect(state.tasks.size).toBe(0);
      expect(state.counts.total).toBe(0);
      expect(state.lastSeq).toBe(0);
      expect(state.dirty).toBe(true);
    });
  });

  describe('exportIndexState / getOperationsSinceSnapshot', () => {
    it('should export state as plain objects', () => {
      const state = createEmptyIndexState();
      state.tasks.set('task-1', createTaskData('task-1'));
      state.counts = { ...createEmptyQueueCounts(), total: 1, pending: 1 };
      state.lastSeq = 15;

      const exported = exportIndexState(state);

      expect(exported.tasks['task-1']).toBeDefined();
      expect(exported.counts.total).toBe(1);
      expect(exported.lastSeq).toBe(15);
    });

    it('should calculate operations since snapshot', () => {
      const state = createEmptyIndexState();
      state.lastSeq = 25;
      state.snapshotSeq = 10;

      const opsSince = getOperationsSinceSnapshot(state);

      expect(opsSince).toBe(15);
    });
  });

  describe('getCounts', () => {
    it('should return copy of counts (O(1))', () => {
      const state = createEmptyIndexState();
      state.counts = { ...createEmptyQueueCounts(), total: 5, pending: 3, completed: 2 };

      const counts = getCounts(state);

      expect(counts.total).toBe(5);
      expect(counts.pending).toBe(3);
      expect(counts.completed).toBe(2);

      // Verify it's a copy
      counts.total = 999;
      expect(state.counts.total).toBe(5);
    });
  });
});
