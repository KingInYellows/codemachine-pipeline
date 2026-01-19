import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createQueueSnapshot,
  initializeQueueFromPlan,
  type TaskPlan,
  loadQueue,
} from '../../src/workflows/queueStore.js';
import { createRunDirectory } from '../../src/persistence/runDirectoryManager.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

describe('queueStore - initializeQueueFromPlan', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-TEST', {
      title: 'Test Feature',
      repo: {
        url: 'https://github.com/test/repo',
        default_branch: 'main',
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Normal Operation', () => {
    it('should initialize queue with 3 tasks from plan', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEATURE-123',
        tasks: [
          {
            id: 'TASK-1',
            title: 'First Task',
            task_type: 'code_generation',
            dependency_ids: [],
          },
          {
            id: 'TASK-2',
            title: 'Second Task',
            task_type: 'review',
            dependency_ids: ['TASK-1'],
          },
          {
            id: 'TASK-3',
            title: 'Third Task',
            task_type: 'testing',
            dependency_ids: ['TASK-2'],
            config: { test_framework: 'vitest' },
            metadata: { priority: 'high' },
          },
        ],
      };

      const result = await initializeQueueFromPlan(runDir, plan);

      expect(result.success).toBe(true);
      expect(result.tasksAffected).toBe(3);
      expect(result.message).toContain('3 task(s)');

      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(3);

      const task1 = tasks.get('TASK-1');
      expect(task1).toBeDefined();
      expect(task1?.feature_id).toBe('FEATURE-123');
      expect(task1?.title).toBe('First Task');
      expect(task1?.task_type).toBe('code_generation');
      expect(task1?.dependency_ids).toEqual([]);

      const task3 = tasks.get('TASK-3');
      expect(task3).toBeDefined();
      expect(task3?.config).toEqual({ test_framework: 'vitest' });
      expect(task3?.metadata).toEqual({ priority: 'high' });
    });

    it('should correctly set feature_id from plan.feature_id', async () => {
      const plan: TaskPlan = {
        feature_id: 'SPECIAL-FEATURE-ID',
        tasks: [
          {
            id: 'TASK-X',
            title: 'Test Task',
            task_type: 'code_generation',
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('TASK-X');
      expect(task?.feature_id).toBe('SPECIAL-FEATURE-ID');

      // Verify queue manifest has correct feature_id
      const queueDir = path.join(runDir, 'queue');
      const manifestPath = path.join(queueDir, 'queue_manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as { feature_id: string };
      expect(manifest.feature_id).toBe('SPECIAL-FEATURE-ID');
    });
  });

  describe('Empty Plan (EC-EXEC-011)', () => {
    it('should return success with no tasks message when plan has 0 tasks', async () => {
      const plan: TaskPlan = {
        feature_id: 'EMPTY-FEATURE',
        tasks: [],
      };

      const result = await initializeQueueFromPlan(runDir, plan);

      expect(result.success).toBe(true);
      expect(result.tasksAffected).toBe(0);
      expect(result.message).toContain('no tasks');

      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(0);
    });
  });

  describe('Task Transformation', () => {
    it('should map all PlanTask fields to ExecutionTask schema', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-MAP',
        tasks: [
          {
            id: 'TASK-FULL',
            title: 'Full Task',
            task_type: 'code_generation',
            dependency_ids: ['DEP-1', 'DEP-2'],
            config: { key: 'value', nested: { prop: 123 } },
            metadata: { author: 'test', version: 2 },
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('TASK-FULL') as ExecutionTask;

      expect(task.task_id).toBe('TASK-FULL');
      expect(task.title).toBe('Full Task');
      expect(task.task_type).toBe('code_generation');
      expect(task.dependency_ids).toEqual(['DEP-1', 'DEP-2']);
      expect(task.config).toEqual({ key: 'value', nested: { prop: 123 } });
      expect(task.metadata).toEqual({ author: 'test', version: 2 });
    });

    it('should set schema_version to 1.0.0', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-VERSION',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');
      expect(task?.schema_version).toBe('1.0.0');
    });

    it('should set status to pending', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-STATUS',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');
      expect(task?.status).toBe('pending');
    });

    it('should set retry_count to 0 and max_retries to 3', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-RETRY',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');
      expect(task?.retry_count).toBe(0);
      expect(task?.max_retries).toBe(3);
    });

    it('should set created_at and updated_at timestamps', async () => {
      const beforeTime = new Date().toISOString();

      const plan: TaskPlan = {
        feature_id: 'FEAT-TIME',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      await initializeQueueFromPlan(runDir, plan);

      const afterTime = new Date().toISOString();
      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');

      expect(task?.created_at).toBeDefined();
      expect(task?.updated_at).toBeDefined();
      expect(task?.created_at).toBe(task?.updated_at);

      // Verify timestamps are within reasonable range
      expect(task!.created_at >= beforeTime).toBe(true);
      expect(task!.created_at <= afterTime).toBe(true);
    });

    it('should omit config when undefined in PlanTask', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-NO-CONFIG',
        tasks: [
          {
            id: 'T1',
            title: 'Task without config',
            task_type: 'code_generation',
            metadata: { key: 'value' },
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1') as ExecutionTask;

      expect('config' in task).toBe(false);
      expect(task.metadata).toEqual({ key: 'value' });
    });

    it('should omit metadata when undefined in PlanTask', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-NO-META',
        tasks: [
          {
            id: 'T1',
            title: 'Task without metadata',
            task_type: 'code_generation',
            config: { key: 'value' },
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1') as ExecutionTask;

      expect('metadata' in task).toBe(false);
      expect(task.config).toEqual({ key: 'value' });
    });

    it('should default dependency_ids to empty array when undefined', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-DEP',
        tasks: [
          {
            id: 'T1',
            title: 'Task',
            task_type: 'code_generation',
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');
      expect(task?.dependency_ids).toEqual([]);
    });

    it('should preserve empty dependency_ids array', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-EMPTY-DEP',
        tasks: [
          {
            id: 'T1',
            title: 'Task',
            task_type: 'code_generation',
            dependency_ids: [],
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T1');
      expect(task?.dependency_ids).toEqual([]);
    });

    it('should preserve populated dependency_ids', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-POP-DEP',
        tasks: [
          {
            id: 'T2',
            title: 'Dependent Task',
            task_type: 'code_generation',
            dependency_ids: ['T1', 'T0'],
          },
        ],
      };

      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('T2');
      expect(task?.dependency_ids).toEqual(['T1', 'T0']);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid runDir gracefully', async () => {
      const invalidDir = '/nonexistent/directory/path';
      const plan: TaskPlan = {
        feature_id: 'FEAT-ERROR',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      const result = await initializeQueueFromPlan(invalidDir, plan);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should return error details with stack trace on failure', async () => {
      const invalidDir = '/invalid/path';
      const plan: TaskPlan = {
        feature_id: 'FEAT-STACK',
        tasks: [{ id: 'T1', title: 'Task', task_type: 'code_generation' }],
      };

      const result = await initializeQueueFromPlan(invalidDir, plan);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toBeTruthy();
      // Should contain stack trace or error message
      expect(typeof result.errors![0]).toBe('string');
    });
  });

  describe('Multiple Task Types', () => {
    it('should handle all supported task types', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-TYPES',
        tasks: [
          { id: 'T1', title: 'Gen', task_type: 'code_generation' },
          { id: 'T2', title: 'Review', task_type: 'review' },
          { id: 'T3', title: 'Test', task_type: 'testing' },
          { id: 'T4', title: 'Docs', task_type: 'documentation' },
          { id: 'T5', title: 'Refactor', task_type: 'refactoring' },
        ],
      };

      const result = await initializeQueueFromPlan(runDir, plan);

      expect(result.success).toBe(true);
      expect(result.tasksAffected).toBe(5);

      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(5);
      expect(tasks.get('T1')?.task_type).toBe('code_generation');
      expect(tasks.get('T2')?.task_type).toBe('review');
      expect(tasks.get('T3')?.task_type).toBe('testing');
      expect(tasks.get('T4')?.task_type).toBe('documentation');
      expect(tasks.get('T5')?.task_type).toBe('refactoring');
    });
  });
});

describe('queueStore - snapshots', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-snap-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-SNAP', {
      title: 'Snapshot Feature',
      repo: {
        url: 'https://github.com/test/repo',
        default_branch: 'main',
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should write queue_snapshot.json in the queue directory', async () => {
    const plan: TaskPlan = {
      feature_id: 'FEATURE-SNAP',
      tasks: [
        {
          id: 'TASK-1',
          title: 'Snapshot Task',
          task_type: 'code_generation',
        },
      ],
    };

    await initializeQueueFromPlan(runDir, plan);

    const result = await createQueueSnapshot(runDir);
    expect(result.success).toBe(true);

    const snapshotPath = path.join(runDir, 'queue', 'queue_snapshot.json');
    const snapshotContent = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(snapshotContent) as { feature_id: string };

    expect(snapshot.feature_id).toBe('FEATURE-SNAP');
  });
});
