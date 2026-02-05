import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  shouldCompact,
  compact,
  maybeCompact,
  pruneCompletedTasks,
  compactWithState,
} from '../../src/workflows/queueCompactionEngine.js';
import { loadSnapshot } from '../../src/workflows/queueSnapshotManager.js';
import {
  appendOperation,
  initializeOperationsLog,
  readOperations,
} from '../../src/workflows/queueOperationsLog.js';
import type { ExecutionTaskData, QueueIndexState } from '../../src/workflows/queueTypes.js';

describe('queueCompactionEngine', () => {
  let testDir: string;
  let queueDir: string;

  const createTaskData = (
    id: string,
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' = 'pending'
  ): ExecutionTaskData => ({
    task_id: id,
    feature_id: 'feature-test',
    task_type: 'code_generation',
    status,
    title: `Task ${id}`,
    description: 'Test description',
    priority: 1,
    dependencies: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compaction-test-'));
    queueDir = path.join(testDir, 'queue');
    await fs.mkdir(queueDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('shouldCompact', () => {
    it('should return needed: false when under thresholds', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      const result = await shouldCompact(queueDir, { maxUpdates: 1000, maxBytes: 5 * 1024 * 1024 });

      expect(result.needed).toBe(false);
      expect(result.reason).toBe('Thresholds not exceeded');
      expect(result.stats.operations).toBe(1);
    });

    it('should return needed: true when operations exceed threshold', async () => {
      await initializeOperationsLog(queueDir);
      for (let i = 0; i < 10; i++) {
        await appendOperation(queueDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const result = await shouldCompact(queueDir, { maxUpdates: 5 });

      expect(result.needed).toBe(true);
      expect(result.reason).toContain('WAL operation count');
      expect(result.stats.operations).toBe(10);
    });

    it('should return needed: true when bytes exceed threshold', async () => {
      await initializeOperationsLog(queueDir);
      for (let i = 0; i < 5; i++) {
        await appendOperation(queueDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const result = await shouldCompact(queueDir, { maxUpdates: 1000, maxBytes: 100 });

      expect(result.needed).toBe(true);
      expect(result.reason).toContain('WAL size');
    });

    it('should return correct stats', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });
      await appendOperation(queueDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'running' },
      });

      const result = await shouldCompact(queueDir);

      expect(result.stats.operations).toBe(2);
      expect(result.stats.bytes).toBeGreaterThan(0);
    });
  });

  describe('compact', () => {
    it('should merge WAL into snapshot', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-2',
        task: createTaskData('task-2'),
      });

      const result = await compact(testDir, queueDir, 'feature-test', {});

      expect(result.compacted).toBe(true);
      expect(result.snapshotSeq).toBe(2);

      const snapshot = await loadSnapshot(queueDir);
      expect(snapshot).not.toBeNull();
      expect(Object.keys(snapshot!.tasks)).toHaveLength(2);
    });

    it('should truncate WAL after compaction', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await compact(testDir, queueDir, 'feature-test', {});

      const operations = await readOperations(queueDir);
      expect(operations).toHaveLength(0);
    });

    it('should return correct snapshot sequence', async () => {
      await initializeOperationsLog(queueDir);
      for (let i = 1; i <= 5; i++) {
        await appendOperation(queueDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const result = await compact(testDir, queueDir, 'feature-test', {});

      expect(result.snapshotSeq).toBe(5);
    });

    it('should handle empty WAL', async () => {
      await initializeOperationsLog(queueDir);

      const result = await compact(testDir, queueDir, 'feature-test', {});

      expect(result.compacted).toBe(false);
      expect(result.snapshotSeq).toBe(0);
    });
  });

  describe('maybeCompact', () => {
    it('should compact when thresholds exceeded', async () => {
      await initializeOperationsLog(queueDir);
      for (let i = 0; i < 10; i++) {
        await appendOperation(queueDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const result = await maybeCompact(testDir, queueDir, 'feature-test', {}, { maxUpdates: 5 });

      expect(result.compacted).toBe(true);
      expect(result.snapshotSeq).toBe(10);
    });

    it('should skip when under thresholds', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      const result = await maybeCompact(
        testDir,
        queueDir,
        'feature-test',
        {},
        { maxUpdates: 1000 }
      );

      expect(result.compacted).toBe(false);
    });

    it('should return compacted: false when skipped', async () => {
      await initializeOperationsLog(queueDir);

      const result = await maybeCompact(
        testDir,
        queueDir,
        'feature-test',
        {},
        { maxUpdates: 1000 }
      );

      expect(result.compacted).toBe(false);
      expect(result.snapshotSeq).toBe(0);
    });
  });

  describe('pruneCompletedTasks', () => {
    it('should remove completed tasks with no dependents', () => {
      const state: QueueIndexState = {
        tasks: new Map([
          ['task-1', createTaskData('task-1', 'completed')],
          ['task-2', createTaskData('task-2', 'pending')],
        ]),
        counts: {
          total: 2,
          pending: 1,
          running: 0,
          completed: 1,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 2,
        snapshotSeq: 0,
        dirty: false,
      };

      const pruned = pruneCompletedTasks(state, {});

      expect(pruned).toBe(1);
      expect(state.tasks.has('task-1')).toBe(false);
      expect(state.tasks.has('task-2')).toBe(true);
      expect(state.counts.total).toBe(1);
      expect(state.counts.completed).toBe(0);
    });

    it('should keep completed tasks that are dependencies', () => {
      const state: QueueIndexState = {
        tasks: new Map([
          ['task-1', createTaskData('task-1', 'completed')],
          ['task-2', createTaskData('task-2', 'pending')],
        ]),
        counts: {
          total: 2,
          pending: 1,
          running: 0,
          completed: 1,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 2,
        snapshotSeq: 0,
        dirty: false,
      };
      const dependencyGraph = { 'task-2': ['task-1'] };

      const pruned = pruneCompletedTasks(state, dependencyGraph);

      expect(pruned).toBe(0);
      expect(state.tasks.has('task-1')).toBe(true);
    });

    it('should return count of pruned tasks', () => {
      const state: QueueIndexState = {
        tasks: new Map([
          ['task-1', createTaskData('task-1', 'completed')],
          ['task-2', createTaskData('task-2', 'failed')],
          ['task-3', createTaskData('task-3', 'pending')],
        ]),
        counts: {
          total: 3,
          pending: 1,
          running: 0,
          completed: 1,
          failed: 1,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 3,
        snapshotSeq: 0,
        dirty: false,
      };

      const pruned = pruneCompletedTasks(state, {});

      expect(pruned).toBe(2);
      expect(state.tasks.size).toBe(1);
    });

    it('should prune terminal tasks when all dependents are also terminal', () => {
      const state: QueueIndexState = {
        tasks: new Map([
          ['task-1', createTaskData('task-1', 'completed')],
          ['task-2', createTaskData('task-2', 'completed')],
        ]),
        counts: {
          total: 2,
          pending: 0,
          running: 0,
          completed: 2,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 2,
        snapshotSeq: 0,
        dirty: false,
      };
      const dependencyGraph = { 'task-2': ['task-1'] };

      const pruned = pruneCompletedTasks(state, dependencyGraph);

      expect(pruned).toBe(2);
      expect(state.tasks.size).toBe(0);
    });
  });

  describe('Atomicity', () => {
    it('should ensure compaction is atomic (snapshot + truncate together)', async () => {
      await initializeOperationsLog(queueDir);
      for (let i = 0; i < 5; i++) {
        await appendOperation(queueDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      await compact(testDir, queueDir, 'feature-test', {});

      const snapshot = await loadSnapshot(queueDir);
      const operations = await readOperations(queueDir);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.snapshotSeq).toBe(5);
      expect(operations).toHaveLength(0);
    });

    it('should use file locking during compaction', async () => {
      await initializeOperationsLog(queueDir);
      await appendOperation(queueDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      const result = await compact(testDir, queueDir, 'feature-test', {});

      expect(result.compacted).toBe(true);

      const lockFile = path.join(testDir, '.codemachine.lock');
      const lockExists = await fs
        .access(lockFile)
        .then(() => true)
        .catch(() => false);
      expect(lockExists).toBe(false);
    });
  });

  describe('compactWithState', () => {
    it('should compact with provided state', async () => {
      await initializeOperationsLog(queueDir);
      const state: QueueIndexState = {
        tasks: new Map([['task-1', createTaskData('task-1')]]),
        counts: {
          total: 1,
          pending: 1,
          running: 0,
          completed: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 1,
        snapshotSeq: 0,
        dirty: true,
      };

      const result = await compactWithState(testDir, queueDir, 'feature-test', state, {});

      expect(result.compacted).toBe(true);
      expect(result.snapshotSeq).toBe(1);

      const snapshot = await loadSnapshot(queueDir);
      expect(snapshot).not.toBeNull();
      expect(Object.keys(snapshot!.tasks)).toHaveLength(1);
    });

    it('should prune tasks when pruneCompleted is enabled', async () => {
      await initializeOperationsLog(queueDir);
      const state: QueueIndexState = {
        tasks: new Map([
          ['task-1', createTaskData('task-1', 'completed')],
          ['task-2', createTaskData('task-2', 'pending')],
        ]),
        counts: {
          total: 2,
          pending: 1,
          running: 0,
          completed: 1,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
        lastSeq: 2,
        snapshotSeq: 0,
        dirty: true,
      };

      const result = await compactWithState(
        testDir,
        queueDir,
        'feature-test',
        state,
        {},
        { pruneCompleted: true }
      );

      expect(result.prunedTasks).toBe(1);
      expect(state.tasks.size).toBe(1);
    });
  });
});
