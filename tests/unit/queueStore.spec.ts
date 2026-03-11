import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createQueueSnapshot,
  initializeQueue,
  initializeQueueFromPlan,
  type TaskPlan,
  loadQueue,
  updateTaskInQueue,
  verifyQueueIntegrity,
  invalidateV2Cache,
  QueueIntegrityError,
} from '../../src/workflows/queue/queueStore.js';
import { writeManifest } from '../../src/persistence/manifestManager.js';
import { createRunDirectory } from '../../src/persistence/runLifecycle.js';
import { type ExecutionTask } from '../../src/core/models/ExecutionTask.js';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    open: vi.fn(actual.open),
  };
});

describe('queueStore - initializeQueueFromPlan', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-TEST', {
      title: 'Test Feature',
      repoUrl: 'https://github.com/test/repo',
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

      if (!task) {
        throw new Error('Task T1 not found');
      }
      expect(task.created_at >= beforeTime).toBe(true);
      expect(task.created_at <= afterTime).toBe(true);
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
      if (!result.errors) {
        throw new Error('Expected result.errors to be defined');
      }
      expect(result.errors.length).toBeGreaterThan(0);
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
      expect(result.errors?.[0]).toBeTruthy();
      // Should contain stack trace or error message
      expect(typeof result.errors?.[0]).toBe('string');
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

  describe('Queue Updates', () => {
    it('should apply updates from V2 WAL on subsequent load', async () => {
      // V2 Format: Uses WAL (operations.log) instead of V1 queue_updates.jsonl
      const plan: TaskPlan = {
        feature_id: 'FEATURE-UPDATES',
        tasks: [{ id: 'TASK-1', title: 'Update Task', task_type: 'code_generation' }],
      };

      await initializeQueueFromPlan(runDir, plan);

      const initialTasks = await loadQueue(runDir);
      const task = initialTasks.get('TASK-1');
      expect(task).toBeDefined();
      if (!task) {
        throw new Error('Expected task to exist');
      }

      // Use V2 updateTaskInQueue API instead of manually writing to queue_updates.jsonl
      const updateResult = await updateTaskInQueue(runDir, 'TASK-1', {
        status: 'completed',
      });

      expect(updateResult.success).toBe(true);

      // Reload queue to verify update was persisted via V2 WAL
      const updatedTasks = await loadQueue(runDir);
      expect(updatedTasks.get('TASK-1')?.status).toBe('completed');
    });
  });
});

describe('queueStore - fsync durability (CDMCH-67)', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-fsync-test-'));
    runDir = path.join(tempDir, 'run-001');
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should call handle.sync() when writing queue manifest', async () => {
    // Initialize run directory with minimal manifest
    const manifest = {
      schema_version: '1.0.0',
      feature_id: 'test-feature',
      repo: { url: 'https://example.com', default_branch: 'main' },
      status: 'pending' as const,
      execution: { completed_steps: 0 },
      timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      approvals: { pending: [], completed: [] },
      queue: { queue_dir: 'queue', pending_count: 0, completed_count: 0, failed_count: 0 },
      artifacts: {},
      telemetry: { logs_dir: 'logs' },
    };

    await writeManifest(runDir, manifest);

    const queueDir = path.join(runDir, 'queue');
    await fs.mkdir(queueDir, { recursive: true });

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const openMock = vi.mocked(fs.open);
    let syncSpy = vi.spyOn({ sync: async () => undefined }, 'sync');
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      syncSpy.mockRestore();
      syncSpy = vi.spyOn(handle, 'sync');
      return handle;
    });

    try {
      // This should trigger queue manifest write which uses the fsync pattern
      await initializeQueue(runDir, 'test-feature');

      // Verify handle.sync() was called for durability
      expect(syncSpy).toHaveBeenCalled();
    } finally {
      openMock.mockImplementation(actualFs.open);
      syncSpy.mockRestore();
    }
  });
});

describe('queueStore - snapshots', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-snap-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-SNAP', {
      title: 'Snapshot Feature',
      repoUrl: 'https://github.com/test/repo',
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
    // V2 snapshot format uses camelCase fields
    const snapshot = JSON.parse(snapshotContent) as { featureId: string; schemaVersion: string };

    expect(snapshot.featureId).toBe('FEATURE-SNAP');
    expect(snapshot.schemaVersion).toBe('2.0.0');
  });
});

describe('queueStore - verifyQueueIntegrity (CDMCH-69)', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-integrity-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-INTEGRITY', {
      title: 'Integrity Test',
      repoUrl: 'https://github.com/test/repo',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return valid for a clean queue', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [
        { id: 'T1', title: 'Task 1', task_type: 'code_generation' },
        { id: 'T2', title: 'Task 2', task_type: 'code_generation' },
      ],
    } as TaskPlan);

    const result = await verifyQueueIntegrity(runDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.sequenceGaps).toHaveLength(0);
  });

  it('should detect corrupted snapshot', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    } as TaskPlan);

    // Create a snapshot then corrupt it
    await createQueueSnapshot(runDir);

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const snapshotPath = path.join(queueDir, 'queue_snapshot.json');

    try {
      const content = await fs.readFile(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(content);
      snapshot.checksum = 'corrupted';
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot), 'utf-8');
    } catch {
      // Snapshot may not exist for this queue type - that's OK
    }

    const result = await verifyQueueIntegrity(runDir, 'warn-only');
    // Snapshot invalid means valid should be false
    expect(result.snapshotValid).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should report WAL entries checked', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [
        { id: 'T1', title: 'Task 1', task_type: 'code_generation' },
        { id: 'T2', title: 'Task 2', task_type: 'code_generation' },
        { id: 'T3', title: 'Task 3', task_type: 'code_generation' },
      ],
    } as TaskPlan);

    const result = await verifyQueueIntegrity(runDir);
    expect(result.walEntriesChecked).toBeGreaterThanOrEqual(3);
  });

  it('should return valid with null snapshotValid when no snapshot exists', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    } as TaskPlan);

    const result = await verifyQueueIntegrity(runDir);
    expect(result.snapshotValid).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('should handle invalid runDir gracefully without throwing in warn-only mode', async () => {
    const result = await verifyQueueIntegrity('/nonexistent/directory/path', 'warn-only');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should detect sequence gaps in the WAL', async () => {
    // Create a queue with 3 operations
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    });
    await updateTaskInQueue(runDir, 'T1', { status: 'running' });
    await updateTaskInQueue(runDir, 'T1', { status: 'completed' });

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');

    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');

    // Create a gap by removing the second line (operation)
    const newWalContent = [lines[0], lines[2]].join('\n') + '\n';
    await fs.writeFile(walPath, newWalContent, 'utf-8');

    const result = await verifyQueueIntegrity(runDir, 'warn-only');

    expect(result.valid).toBe(false);
    expect(result.sequenceGaps.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('Sequence gap'))).toBe(true);
  });

  it('should throw QueueIntegrityError in fail-fast mode on snapshot corruption', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    } as TaskPlan);

    await createQueueSnapshot(runDir);

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const snapshotPath = path.join(queueDir, 'queue_snapshot.json');

    const content = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content);
    snapshot.checksum = 'corrupted';
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot), 'utf-8');

    try {
      await verifyQueueIntegrity(runDir, 'fail-fast');
      expect.fail('Should have thrown QueueIntegrityError');
    } catch (err) {
      expect(err).toBeInstanceOf(QueueIntegrityError);
      const intErr = err as InstanceType<typeof QueueIntegrityError>;
      expect(intErr.kind).toBe('snapshot-checksum-mismatch');
      expect(intErr.recoveryGuidance).toBeTruthy();
      expect(intErr.location).toContain('queue_snapshot.json');
    }
  });

  it('should NOT throw in warn-only mode on snapshot corruption', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    } as TaskPlan);

    await createQueueSnapshot(runDir);

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const snapshotPath = path.join(queueDir, 'queue_snapshot.json');

    const content = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content);
    snapshot.checksum = 'corrupted';
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot), 'utf-8');

    const result = await verifyQueueIntegrity(runDir, 'warn-only');
    expect(result.valid).toBe(false);
    expect(result.snapshotValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should throw QueueIntegrityError in fail-fast mode on sequence gap', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    });
    await updateTaskInQueue(runDir, 'T1', { status: 'running' });
    await updateTaskInQueue(runDir, 'T1', { status: 'completed' });

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');

    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');
    // Remove middle entry to create gap
    await fs.writeFile(walPath, [lines[0], lines[2]].join('\n') + '\n', 'utf-8');

    try {
      await verifyQueueIntegrity(runDir, 'fail-fast');
      expect.fail('Should have thrown QueueIntegrityError');
    } catch (err) {
      expect(err).toBeInstanceOf(QueueIntegrityError);
      const intErr = err as InstanceType<typeof QueueIntegrityError>;
      expect(intErr.kind).toBe('sequence-gap');
      expect(intErr.sequenceRange).toBeDefined();
      expect(intErr.recoveryGuidance).toBeTruthy();
    }
  });

  it('should count WAL checksum failures accurately', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [
        { id: 'T1', title: 'Task 1', task_type: 'code_generation' },
        { id: 'T2', title: 'Task 2', task_type: 'code_generation' },
      ],
    });

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');

    // Corrupt one entry's checksum
    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');
    const entry = JSON.parse(lines[0]);
    entry.checksum = 'badchecksum';
    lines[0] = JSON.stringify(entry);
    await fs.writeFile(walPath, lines.join('\n') + '\n', 'utf-8');

    const result = await verifyQueueIntegrity(runDir, 'warn-only');
    expect(result.walChecksumFailures).toBeGreaterThanOrEqual(1);
    expect(result.valid).toBe(false);
  });

  it('should throw QueueIntegrityError for WAL checksum failure in fail-fast mode', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    });

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');

    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');
    const entry = JSON.parse(lines[0]);
    entry.checksum = 'badchecksum';
    lines[0] = JSON.stringify(entry);
    await fs.writeFile(walPath, lines.join('\n') + '\n', 'utf-8');

    try {
      await verifyQueueIntegrity(runDir, 'fail-fast');
      expect.fail('Should have thrown QueueIntegrityError');
    } catch (err) {
      expect(err).toBeInstanceOf(QueueIntegrityError);
      const intErr = err as InstanceType<typeof QueueIntegrityError>;
      expect(intErr.kind).toBe('wal-checksum-mismatch');
    }
  });

  it('loadQueue should throw QueueIntegrityError when integrity fails in fail-fast mode', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [{ id: 'T1', title: 'Task 1', task_type: 'code_generation' }],
    });

    // Corrupt WAL checksum
    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');
    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');
    const entry = JSON.parse(lines[0]);
    entry.checksum = 'badchecksum';
    lines[0] = JSON.stringify(entry);
    await fs.writeFile(walPath, lines.join('\n') + '\n', 'utf-8');

    // Reset integrity cache so it re-checks
    invalidateV2Cache(runDir);

    // fail-fast is the default mode; loadQueue calls verifyQueueIntegrity
    await expect(loadQueue(runDir)).rejects.toThrow(QueueIntegrityError);
  });

  it('loadQueue should succeed in warn-only mode despite corruption', async () => {
    await initializeQueueFromPlan(runDir, {
      feature_id: 'FEATURE-INTEGRITY',
      tasks: [
        { id: 'T1', title: 'Task 1', task_type: 'code_generation' },
        { id: 'T2', title: 'Task 2', task_type: 'code_generation' },
      ],
    });

    const { readManifest } = await import('../../src/persistence/manifestManager.js');
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);
    const walPath = path.join(queueDir, 'queue_operations.log');
    const walContent = await fs.readFile(walPath, 'utf-8');
    const lines = walContent.trim().split('\n');
    // Corrupt first entry
    const entry = JSON.parse(lines[0]);
    entry.checksum = 'badchecksum';
    lines[0] = JSON.stringify(entry);
    await fs.writeFile(walPath, lines.join('\n') + '\n', 'utf-8');

    invalidateV2Cache(runDir);
    process.env.QUEUE_INTEGRITY_MODE = 'warn-only';
    try {
      // Should not throw - warn-only mode loads despite corruption
      const tasks = await loadQueue(runDir);
      // At least the uncorrupted task should load
      expect(tasks.size).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.QUEUE_INTEGRITY_MODE;
    }
  });
});
