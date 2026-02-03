import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectQueueVersion,
  needsMigration,
  loadV1Queue,
  buildInitialSnapshot,
  migrateV1ToV2,
  rollbackMigration,
  ensureV2Format,
} from '../../src/workflows/queueMigration.js';
import { saveSnapshot } from '../../src/workflows/queueSnapshotManager.js';
import { createEmptyQueueCounts } from '../../src/workflows/queueTypes.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

/**
 * Unit tests for queue migration (V1 to V2 format)
 *
 * Tests Issue #45: Queue WAL Optimization Layer 6
 */
describe('queueMigration', () => {
  let testDir: string;

  // Helper to create a valid V1 task for JSONL format
  const createV1Task = (id: string, status: ExecutionTask['status'] = 'pending', deps: string[] = []): ExecutionTask => ({
    schema_version: '1.0.0',
    task_id: id,
    feature_id: 'feature-123',
    title: `Task ${id}`,
    task_type: 'code_generation',
    status,
    dependency_ids: deps,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Helper to create V1 queue.jsonl content
  const createV1QueueContent = (tasks: ExecutionTask[]): string => {
    return tasks.map((t) => JSON.stringify(t)).join('\n') + '\n';
  };

  // Helper to create V2 snapshot file
  const createV2Snapshot = async (queueDir: string): Promise<void> => {
    await saveSnapshot(queueDir, 'feature-123', {}, createEmptyQueueCounts(), 0, {});
  };

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-migration-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // detectQueueVersion
  // ==========================================================================

  describe('detectQueueVersion', () => {
    it('should return "none" for empty directory', async () => {
      const version = await detectQueueVersion(testDir);
      expect(version).toBe('none');
    });

    it('should return "v1" when queue.jsonl exists', async () => {
      const task = createV1Task('task-1');
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([task]), 'utf-8');

      const version = await detectQueueVersion(testDir);
      expect(version).toBe('v1');
    });

    it('should return "v2" when queue_snapshot.json exists with schema 2.0.0', async () => {
      await createV2Snapshot(testDir);

      const version = await detectQueueVersion(testDir);
      expect(version).toBe('v2');
    });

    it('should return "v2" when both V1 and V2 files exist (V2 takes precedence)', async () => {
      const task = createV1Task('task-1');
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([task]), 'utf-8');
      await createV2Snapshot(testDir);

      const version = await detectQueueVersion(testDir);
      expect(version).toBe('v2');
    });

    it('should return "v1" if snapshot exists but has wrong schema version', async () => {
      const badSnapshot = { schemaVersion: '1.0.0', featureId: 'test' };
      await fs.writeFile(path.join(testDir, 'queue_snapshot.json'), JSON.stringify(badSnapshot), 'utf-8');
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([createV1Task('task-1')]), 'utf-8');

      const version = await detectQueueVersion(testDir);
      expect(version).toBe('v1');
    });
  });

  // ==========================================================================
  // needsMigration
  // ==========================================================================

  describe('needsMigration', () => {
    it('should return false for V2 format', async () => {
      await createV2Snapshot(testDir);

      const result = await needsMigration(testDir);
      expect(result).toBe(false);
    });

    it('should return true for V1 format', async () => {
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([createV1Task('task-1')]), 'utf-8');

      const result = await needsMigration(testDir);
      expect(result).toBe(true);
    });

    it('should return false for empty directory', async () => {
      const result = await needsMigration(testDir);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // loadV1Queue
  // ==========================================================================

  describe('loadV1Queue', () => {
    it('should load tasks from JSONL file', async () => {
      const tasks = [createV1Task('task-1'), createV1Task('task-2'), createV1Task('task-3')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const loaded = await loadV1Queue(testDir);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((t) => t.task_id)).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should handle empty file', async () => {
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), '', 'utf-8');

      const loaded = await loadV1Queue(testDir);
      expect(loaded).toHaveLength(0);
    });

    it('should skip malformed lines gracefully', async () => {
      const validTask = createV1Task('task-valid');
      const content = [
        JSON.stringify(validTask),
        'not valid json',
        '{"invalid": "schema"}',
        JSON.stringify(createV1Task('task-2')),
      ].join('\n');

      await fs.writeFile(path.join(testDir, 'queue.jsonl'), content, 'utf-8');

      const loaded = await loadV1Queue(testDir);
      expect(loaded).toHaveLength(2);
      expect(loaded.map((t) => t.task_id)).toEqual(['task-valid', 'task-2']);
    });

    it('should return empty array for non-existent file', async () => {
      const loaded = await loadV1Queue(testDir);
      expect(loaded).toHaveLength(0);
    });

    it('should apply updates from queue_updates.jsonl', async () => {
      const task1 = createV1Task('task-1', 'pending');
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([task1]), 'utf-8');

      const updatedTask1 = { ...task1, status: 'completed' as const };
      await fs.writeFile(path.join(testDir, 'queue_updates.jsonl'), createV1QueueContent([updatedTask1]), 'utf-8');

      const loaded = await loadV1Queue(testDir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].status).toBe('completed');
    });
  });

  // ==========================================================================
  // buildInitialSnapshot
  // ==========================================================================

  describe('buildInitialSnapshot', () => {
    it('should create correct task map', () => {
      const tasks = [createV1Task('task-1'), createV1Task('task-2')] as ExecutionTask[];

      const { tasks: taskRecord } = buildInitialSnapshot(tasks, 'feature-123');

      expect(Object.keys(taskRecord)).toHaveLength(2);
      expect(taskRecord['task-1']).toBeDefined();
      expect(taskRecord['task-2']).toBeDefined();
    });

    it('should calculate correct counts', () => {
      const tasks = [
        createV1Task('task-1', 'pending'),
        createV1Task('task-2', 'running'),
        createV1Task('task-3', 'completed'),
        createV1Task('task-4', 'failed'),
        createV1Task('task-5', 'skipped'),
        createV1Task('task-6', 'cancelled'),
      ] as ExecutionTask[];

      const { counts } = buildInitialSnapshot(tasks, 'feature-123');

      expect(counts.total).toBe(6);
      expect(counts.pending).toBe(1);
      expect(counts.running).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
      expect(counts.skipped).toBe(1);
      expect(counts.cancelled).toBe(1);
    });

    it('should extract dependency graph', () => {
      const tasks = [
        createV1Task('task-1', 'pending', []),
        createV1Task('task-2', 'pending', ['task-1']),
        createV1Task('task-3', 'pending', ['task-1', 'task-2']),
      ] as ExecutionTask[];

      const { dependencyGraph } = buildInitialSnapshot(tasks, 'feature-123');

      expect(dependencyGraph['task-1']).toBeUndefined(); // No deps
      expect(dependencyGraph['task-2']).toEqual(['task-1']);
      expect(dependencyGraph['task-3']).toEqual(['task-1', 'task-2']);
    });
  });

  // ==========================================================================
  // migrateV1ToV2
  // ==========================================================================

  describe('migrateV1ToV2', () => {
    it('should create V2 snapshot from V1 tasks', async () => {
      const tasks = [createV1Task('task-1'), createV1Task('task-2')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const result = await migrateV1ToV2(testDir, 'feature-123');

      expect(result.success).toBe(true);
      expect(result.tasksConverted).toBe(2);

      // Verify V2 snapshot exists
      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      const snapshotContent = await fs.readFile(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(snapshotContent);
      expect(snapshot.schemaVersion).toBe('2.0.0');
      expect(Object.keys(snapshot.tasks)).toHaveLength(2);
    });

    it('should back up V1 files', async () => {
      const tasks = [createV1Task('task-1')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');
      await fs.writeFile(path.join(testDir, 'queue_updates.jsonl'), '', 'utf-8');

      const result = await migrateV1ToV2(testDir, 'feature-123');

      expect(result.success).toBe(true);
      expect(result.backupPath).toContain('.v1backup');

      // Verify backups exist
      const backupExists = await fs.access(path.join(testDir, 'queue.jsonl.v1backup')).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });

    it('should return successful result with correct version info', async () => {
      const tasks = [createV1Task('task-1')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const result = await migrateV1ToV2(testDir, 'feature-123');

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe('1.0.0');
      expect(result.toVersion).toBe('2.0.0');
      expect(result.tasksConverted).toBe(1);
    });

    it('should preserve all task data during migration', async () => {
      const task = createV1Task('task-1', 'running', ['dep-1', 'dep-2']);
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent([task]), 'utf-8');

      await migrateV1ToV2(testDir, 'feature-123');

      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
      const migratedTask = snapshot.tasks['task-1'];

      expect(migratedTask.task_id).toBe('task-1');
      expect(migratedTask.status).toBe('running');
      expect(migratedTask.dependency_ids).toEqual(['dep-1', 'dep-2']);
      expect(migratedTask.feature_id).toBe('feature-123');
    });
  });

  // ==========================================================================
  // rollbackMigration
  // ==========================================================================

  describe('rollbackMigration', () => {
    it('should restore V1 files from backup', async () => {
      // Create V1 queue and migrate
      const tasks = [createV1Task('task-1')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');
      await migrateV1ToV2(testDir, 'feature-123');

      // Verify V1 file is gone
      const v1ExistsBefore = await fs.access(path.join(testDir, 'queue.jsonl')).then(() => true).catch(() => false);
      expect(v1ExistsBefore).toBe(false);

      // Rollback
      const success = await rollbackMigration(testDir);
      expect(success).toBe(true);

      // Verify V1 file is restored
      const v1ExistsAfter = await fs.access(path.join(testDir, 'queue.jsonl')).then(() => true).catch(() => false);
      expect(v1ExistsAfter).toBe(true);

      // Verify content preserved
      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(1);
      expect(restored[0].task_id).toBe('task-1');
    });

    it('should return false if no backup exists', async () => {
      const success = await rollbackMigration(testDir);
      expect(success).toBe(false);
    });

    it('should remove V2 files during rollback', async () => {
      const tasks = [createV1Task('task-1')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');
      await migrateV1ToV2(testDir, 'feature-123');

      await rollbackMigration(testDir);

      const snapshotExists = await fs.access(path.join(testDir, 'queue_snapshot.json')).then(() => true).catch(() => false);
      expect(snapshotExists).toBe(false);
    });
  });

  // ==========================================================================
  // ensureV2Format
  // ==========================================================================

  describe('ensureV2Format', () => {
    it('should migrate if V1 format detected', async () => {
      const tasks = [createV1Task('task-1'), createV1Task('task-2')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const { migrated, result } = await ensureV2Format(testDir, 'feature-123');

      expect(migrated).toBe(true);
      expect(result?.success).toBe(true);
      expect(result?.tasksConverted).toBe(2);
    });

    it('should skip migration if already V2', async () => {
      await createV2Snapshot(testDir);

      const { migrated, result } = await ensureV2Format(testDir, 'feature-123');

      expect(migrated).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should return migrated: false for empty directory', async () => {
      const { migrated, result } = await ensureV2Format(testDir, 'feature-123');

      expect(migrated).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should initialize empty operations log for new queue', async () => {
      await ensureV2Format(testDir, 'feature-123');

      const opsLogExists = await fs.access(path.join(testDir, 'queue_operations.log')).then(() => true).catch(() => false);
      expect(opsLogExists).toBe(true);
    });

    it('should invalidate cache after successful migration (CDMCH-73)', async () => {
      // Set up V1 queue and perform initial migration
      const tasks = [createV1Task('task-1'), createV1Task('task-2')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const { migrated, result } = await ensureV2Format(testDir, 'feature-123');

      expect(migrated).toBe(true);
      expect(result?.success).toBe(true);

      // Verify cache was invalidated by checking that subsequent calls
      // see the already-migrated V2 queue (not stale cached data)
      const version = await detectQueueVersion(testDir);
      expect(version).toBe('v2');

      // Second migration call should detect V2 format and skip migration
      const second = await ensureV2Format(testDir, 'feature-123');
      expect(second.migrated).toBe(false);
      expect(second.result).toBeUndefined();
    });
  });

  // ==========================================================================
  // ESLint no-empty catch block verification (CDMCH-68)
  // ==========================================================================

  describe('empty catch block guard (CDMCH-68)', () => {
    it('should enforce no-empty via eslint js.configs.recommended', async () => {
      const eslintConfig = await fs.readFile(
        path.join(__dirname, '../../eslint.config.cjs'),
        'utf-8'
      );
      // ESLint config includes js.configs.recommended which enables no-empty
      expect(eslintConfig).toContain('js.configs.recommended');
    });
  });
});
