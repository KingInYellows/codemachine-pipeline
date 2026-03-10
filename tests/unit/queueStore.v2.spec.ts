import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  initializeQueueFromPlan,
  type TaskPlan,
  loadQueue,
  updateTaskInQueue,
  getNextTask,
  invalidateV2Cache,
} from '../../src/workflows/queue/queueStore.js';
import { createRunDirectory } from '../../src/persistence/runDirectoryManager.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

/**
 * V2-Specific Queue Store Tests
 *
 * Tests Issue #45: Queue Store V2 Integration (Layer 7)
 *
 * Verifies:
 * - V2 format detection
 * - WAL (Write-Ahead Log) integration
 * - Compaction triggers and snapshot updates
 * - Backward compatibility with existing APIs
 */
describe('queueStore V2 Integration', () => {
  let tempDir: string;
  let runDir: string;

  // Helper to create a task plan
  const createPlan = (tasks: Array<{ id: string; deps?: string[] }>): TaskPlan => ({
    feature_id: 'FEAT-V2-TEST',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: `Task ${t.id}`,
      task_type: 'code_generation' as const,
      dependency_ids: t.deps ?? [],
    })),
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-v2-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-V2-TEST', {
      title: 'V2 Test Feature',
      repoUrl: 'https://github.com/test/repo',
    });
  });

  afterEach(async () => {
    // Invalidate cache to prevent cross-test pollution
    invalidateV2Cache(runDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // V2 Format Detection and Auto-Migration
  // ==========================================================================

  describe('V2 Format Detection', () => {
    it('should load V2 format correctly when snapshot exists', async () => {
      // Initialize queue (V2 WAL format)
      const plan = createPlan([{ id: 'task-1' }, { id: 'task-2' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Load queue - should work regardless of format
      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(2);
      expect(tasks.get('task-1')).toBeDefined();
      expect(tasks.get('task-2')).toBeDefined();
    });

    it('should use V2 format on first access', async () => {
      // Create V2 format queue (initializeQueueFromPlan creates V2 format)
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Invalidate cache to force re-hydration
      invalidateV2Cache(runDir);

      // Access queue - uses V2 format
      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(1);

      // Subsequent access should use cached V2 state
      const tasksAgain = await loadQueue(runDir);
      expect(tasksAgain.size).toBe(1);
    });
  });

  // ==========================================================================
  // WAL (Write-Ahead Log) Integration
  // ==========================================================================

  describe('WAL Integration', () => {
    it('should append created tasks to legacy queue.jsonl for validators/tools', async () => {
      const plan = createPlan([{ id: 'task-1' }, { id: 'task-2' }]);
      await initializeQueueFromPlan(runDir, plan);

      const queueDir = path.join(runDir, 'queue');
      const queuePath = path.join(queueDir, 'queue.jsonl');
      const content = await fs.readFile(queuePath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      expect(lines.length).toBeGreaterThanOrEqual(2);
      const ids = lines.map((line) => (JSON.parse(line) as { task_id?: string }).task_id);
      expect(ids).toContain('task-1');
      expect(ids).toContain('task-2');
    });

    it('should append updates to WAL file (queue_operations.log)', async () => {
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Update task - should append to WAL
      const result = await updateTaskInQueue(runDir, 'task-1', {
        status: 'running',
      });

      expect(result.success).toBe(true);

      // Verify WAL file exists and contains the update
      const queueDir = path.join(runDir, 'queue');
      const walPath = path.join(queueDir, 'queue_operations.log');

      const walExists = await fs
        .access(walPath)
        .then(() => true)
        .catch(() => false);
      expect(walExists).toBe(true);

      const walContent = await fs.readFile(walPath, 'utf-8');
      expect(walContent.length).toBeGreaterThan(0);

      // Parse the WAL entry and verify it has the update operation
      const lines = walContent
        .trim()
        .split('\n')
        .filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1);

      // V2 WAL format: {op, seq, ts, taskId, patch, checksum}
      const lastEntry = JSON.parse(lines[lines.length - 1]) as {
        op: string;
        taskId: string;
        patch?: { status?: string };
      };
      expect(lastEntry.taskId).toBe('task-1');
      expect(lastEntry.op).toBe('update');
      expect(lastEntry.patch?.status).toBe('running');
    });

    it('should track updates count in cache', async () => {
      const plan = createPlan([{ id: 'task-1' }, { id: 'task-2' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Perform multiple updates
      await updateTaskInQueue(runDir, 'task-1', { status: 'running' });
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });
      await updateTaskInQueue(runDir, 'task-2', { status: 'running' });

      // Verify tasks reflect latest state
      const tasks = await loadQueue(runDir);
      const task1 = tasks.get('task-1');
      const task2 = tasks.get('task-2');

      expect(task1?.status).toBe('completed');
      expect(task2?.status).toBe('running');
    });

    it('should preserve task updates after cache invalidation', async () => {
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Update task
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });

      // Invalidate cache (but don't delete WAL files)
      invalidateV2Cache(runDir);

      // Reload queue - should read from V2 WAL (snapshot + operations log)
      const tasks = await loadQueue(runDir);
      const task = tasks.get('task-1');

      expect(task?.status).toBe('completed');
    });
  });

  // ==========================================================================
  // Compaction Trigger Tests
  // ==========================================================================

  describe('Compaction Trigger', () => {
    it('should update manifest counts after operations', async () => {
      const plan = createPlan([{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Update tasks
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });
      await updateTaskInQueue(runDir, 'task-2', { status: 'failed' });

      // Read run manifest to verify counts (V2 updates run manifest, not queue manifest)
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // V2 stores counts in manifest.queue
      expect(manifest.queue.completed_count).toBe(1);
      expect(manifest.queue.failed_count).toBe(1);
      expect(manifest.queue.pending_count).toBe(1);
    });

    it('should handle compaction gracefully when triggered', async () => {
      // Create a larger queue to test compaction scenarios
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        id: `task-${i}`,
        deps: i > 0 ? [`task-${i - 1}`] : [],
      }));
      const plan = createPlan(tasks);
      await initializeQueueFromPlan(runDir, plan);

      // Complete multiple tasks to trigger potential compaction
      for (let i = 0; i < 10; i++) {
        await updateTaskInQueue(runDir, `task-${i}`, { status: 'completed' });
      }

      // Verify queue state is consistent
      const loadedTasks = await loadQueue(runDir);
      expect(loadedTasks.size).toBe(20);

      let completedCount = 0;
      for (const task of loadedTasks.values()) {
        if (task.status === 'completed') completedCount++;
      }
      expect(completedCount).toBe(10);
    });
  });

  // ==========================================================================
  // Backward Compatibility
  // ==========================================================================

  describe('Backward Compatibility', () => {
    it('should return Map<string, ExecutionTask> from loadQueue', async () => {
      const plan = createPlan([{ id: 'task-1' }, { id: 'task-2' }]);
      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);

      // Verify return type is Map
      expect(tasks instanceof Map).toBe(true);
      expect(tasks.size).toBe(2);

      // Verify Map API works
      expect(tasks.has('task-1')).toBe(true);
      expect(tasks.has('task-2')).toBe(true);
      expect(tasks.has('nonexistent')).toBe(false);

      // Verify iteration works
      const ids: string[] = [];
      for (const [taskId] of tasks) {
        ids.push(taskId);
      }
      expect(ids).toContain('task-1');
      expect(ids).toContain('task-2');
    });

    it('should work with getNextTask using V2 internals', async () => {
      const plan = createPlan([
        { id: 'task-1' },
        { id: 'task-2', deps: ['task-1'] },
        { id: 'task-3', deps: ['task-2'] },
      ]);
      await initializeQueueFromPlan(runDir, plan);

      // First task should be task-1 (no deps)
      const first = await getNextTask(runDir);
      expect(first?.task_id).toBe('task-1');

      // Complete task-1
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });

      // Next should be task-2 (deps now satisfied)
      const second = await getNextTask(runDir);
      expect(second?.task_id).toBe('task-2');
    });

    it('should maintain ExecutionTask schema compatibility', async () => {
      const plan: TaskPlan = {
        feature_id: 'FEAT-COMPAT',
        tasks: [
          {
            id: 'task-full',
            title: 'Full Task',
            task_type: 'code_generation',
            dependency_ids: ['dep-1'],
            config: { key: 'value' },
            metadata: { priority: 'high' },
          },
        ],
      };
      await initializeQueueFromPlan(runDir, plan);

      const tasks = await loadQueue(runDir);
      const task = tasks.get('task-full') as ExecutionTask;

      // Verify all ExecutionTask fields are present
      expect(task.schema_version).toBe('1.0.0');
      expect(task.task_id).toBe('task-full');
      expect(task.feature_id).toBe('FEAT-COMPAT');
      expect(task.title).toBe('Full Task');
      expect(task.task_type).toBe('code_generation');
      expect(task.status).toBe('pending');
      expect(task.dependency_ids).toEqual(['dep-1']);
      expect(task.retry_count).toBe(0);
      expect(task.max_retries).toBe(3);
      expect(task.created_at).toBeDefined();
      expect(task.updated_at).toBeDefined();
      expect(task.config).toEqual({ key: 'value' });
      expect(task.metadata).toEqual({ priority: 'high' });
    });

    it('should handle concurrent read/write operations', async () => {
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Simulate concurrent operations
      const operations = [
        updateTaskInQueue(runDir, 'task-1', { status: 'running' }),
        loadQueue(runDir),
        updateTaskInQueue(runDir, 'task-1', { retry_count: 1 }),
      ];

      const results = await Promise.all(operations);

      // All operations should succeed
      expect((results[0] as { success: boolean }).success).toBe(true);
      expect(results[1] instanceof Map).toBe(true);
      expect((results[2] as { success: boolean }).success).toBe(true);

      // Final state should be consistent
      const finalTasks = await loadQueue(runDir);
      const task = finalTasks.get('task-1');
      expect(task).toBeDefined();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should return error for non-existent task update', async () => {
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      const result = await updateTaskInQueue(runDir, 'nonexistent-task', {
        status: 'running',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should handle updates with unchanged status gracefully', async () => {
      const plan = createPlan([{ id: 'task-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Update status
      await updateTaskInQueue(runDir, 'task-1', { status: 'running' });

      // Update same status again
      const result = await updateTaskInQueue(runDir, 'task-1', {
        status: 'running',
      });

      expect(result.success).toBe(true);

      const tasks = await loadQueue(runDir);
      expect(tasks.get('task-1')?.status).toBe('running');
    });
  });

  // ==========================================================================
  // Fsync Durability Tests
  // ==========================================================================

  describe('writeQueueManifest fsync durability', () => {
    it('should persist manifest durably (fsync before rename pattern)', async () => {
      // This test verifies the durability pattern works correctly
      // The implementation uses: open -> write -> sync -> close -> rename
      // We verify the end result: data persists and queue is loadable
      const plan = createPlan([
        { id: 'task-durable-1' },
        { id: 'task-durable-2', deps: ['task-durable-1'] },
      ]);

      await initializeQueueFromPlan(runDir, plan);

      // Verify queue was persisted correctly
      const tasks = await loadQueue(runDir);
      expect(tasks.size).toBe(2);
      expect(tasks.has('task-durable-1')).toBe(true);
      expect(tasks.has('task-durable-2')).toBe(true);

      // Verify no temp files remain in the queue directory (atomic write completed)
      const queueDir = path.join(runDir, 'queue');
      const files = await fs.readdir(queueDir);
      const tempFiles = files.filter((f) => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should use atomic write pattern (no partial writes)', async () => {
      // Initialize queue
      const plan = createPlan([{ id: 'task-atomic-1' }]);
      await initializeQueueFromPlan(runDir, plan);

      // Update task multiple times
      await updateTaskInQueue(runDir, 'task-atomic-1', { status: 'running' });
      await updateTaskInQueue(runDir, 'task-atomic-1', { status: 'completed' });

      // Clear cache and reload to verify persistence
      invalidateV2Cache(runDir);
      const tasks = await loadQueue(runDir);

      // Verify final state is consistent
      expect(tasks.get('task-atomic-1')?.status).toBe('completed');

      // Verify no temp files remain
      const queueDir = path.join(runDir, 'queue');
      const files = await fs.readdir(queueDir);
      const tempFiles = files.filter((f) => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });
});
