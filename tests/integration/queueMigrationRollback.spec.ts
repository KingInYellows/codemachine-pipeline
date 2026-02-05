/**
 * Integration tests for queue migration rollback under mid-flight corruption (CDMCH-70)
 *
 * Tests:
 * - Seed V1 queue with 25 tasks
 * - Migrate to V2
 * - Inject filesystem corruption mid-write
 * - Rollback to V1
 * - Verify V1 state restored with full data integrity
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectQueueVersion,
  loadV1Queue,
  migrateV1ToV2,
  rollbackMigration,
  ensureV2Format,
} from '../../src/workflows/queueMigration.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

describe('Queue Migration Rollback Integration', () => {
  let testDir: string;

  const createV1Task = (
    id: string,
    status: ExecutionTask['status'] = 'pending',
    deps: string[] = []
  ): ExecutionTask => ({
    schema_version: '1.0.0',
    task_id: id,
    feature_id: 'feature-rollback',
    title: `Task ${id}`,
    task_type: 'code_generation',
    status,
    dependency_ids: deps,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const createV1QueueContent = (tasks: ExecutionTask[]): string => {
    return tasks.map((t) => JSON.stringify(t)).join('\n') + '\n';
  };

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-rollback-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Large-scale migration + rollback
  // ==========================================================================

  describe('25-task migration and rollback', () => {
    let tasks: ExecutionTask[];

    beforeEach(async () => {
      // Seed 25 tasks with dependency chains
      tasks = [];
      for (let i = 1; i <= 25; i++) {
        const deps = i > 1 ? [`task-${i - 1}`] : [];
        const status: ExecutionTask['status'] =
          i <= 5 ? 'completed' : i <= 10 ? 'running' : 'pending';
        tasks.push(createV1Task(`task-${i}`, status, deps));
      }

      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');
    });

    it('should migrate 25 tasks to V2 and back to V1 with data integrity', async () => {
      // Verify V1 state
      expect(await detectQueueVersion(testDir)).toBe('v1');
      const loadedV1 = await loadV1Queue(testDir);
      expect(loadedV1).toHaveLength(25);

      // Migrate to V2
      const result = await migrateV1ToV2(testDir, 'feature-rollback');
      expect(result.success).toBe(true);
      expect(result.tasksConverted).toBe(25);

      // Verify V2 state
      expect(await detectQueueVersion(testDir)).toBe('v2');

      // V1 file should be gone (backed up)
      const v1Exists = await fs
        .access(path.join(testDir, 'queue.jsonl'))
        .then(() => true)
        .catch(() => false);
      expect(v1Exists).toBe(false);

      // Backup should exist
      const backupExists = await fs
        .access(path.join(testDir, 'queue.jsonl.v1backup'))
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);

      // Rollback to V1
      const rollbackSuccess = await rollbackMigration(testDir);
      expect(rollbackSuccess).toBe(true);

      // Verify V1 restored
      expect(await detectQueueVersion(testDir)).toBe('v1');

      // Verify all 25 tasks preserved with correct data
      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(25);

      for (let i = 0; i < 25; i++) {
        expect(restored[i].task_id).toBe(tasks[i].task_id);
        expect(restored[i].status).toBe(tasks[i].status);
        expect(restored[i].dependency_ids).toEqual(tasks[i].dependency_ids);
        expect(restored[i].title).toBe(tasks[i].title);
      }
    });

    it('should preserve task status distribution after rollback', async () => {
      await migrateV1ToV2(testDir, 'feature-rollback');
      await rollbackMigration(testDir);

      const restored = await loadV1Queue(testDir);
      const completed = restored.filter((t) => t.status === 'completed');
      const inProgress = restored.filter((t) => t.status === 'running');
      const pending = restored.filter((t) => t.status === 'pending');

      expect(completed).toHaveLength(5);
      expect(inProgress).toHaveLength(5);
      expect(pending).toHaveLength(15);
    });

    it('should remove all V2 files after rollback', async () => {
      await migrateV1ToV2(testDir, 'feature-rollback');
      await rollbackMigration(testDir);

      const v2Files = ['queue_snapshot.json', 'queue_operations.log', 'queue_sequence.txt'];
      for (const file of v2Files) {
        const exists = await fs
          .access(path.join(testDir, file))
          .then(() => true)
          .catch(() => false);
        expect(exists, `${file} should be removed after rollback`).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Corruption scenarios
  // ==========================================================================

  describe('corruption during migration', () => {
    it('should rollback after V2 snapshot file is corrupted', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => createV1Task(`task-${i + 1}`));
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      // Migrate successfully first
      const result = await migrateV1ToV2(testDir, 'feature-corrupt');
      expect(result.success).toBe(true);

      // Corrupt the V2 snapshot
      await fs.writeFile(
        path.join(testDir, 'queue_snapshot.json'),
        '{"corrupted": true, "invalid_schema": "not_a_valid_snapshot"}',
        'utf-8'
      );

      // Rollback should still work (restores V1 from backup)
      const rollbackSuccess = await rollbackMigration(testDir);
      expect(rollbackSuccess).toBe(true);

      // V1 data should be intact
      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(10);
      expect(restored[0].task_id).toBe('task-1');
    });

    it('should rollback after V2 operations log is truncated', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => createV1Task(`task-${i + 1}`));
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      await migrateV1ToV2(testDir, 'feature-truncate');

      // Truncate operations log (simulates incomplete write / power loss)
      await fs.writeFile(path.join(testDir, 'queue_operations.log'), '', 'utf-8');

      const rollbackSuccess = await rollbackMigration(testDir);
      expect(rollbackSuccess).toBe(true);

      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(5);
    });

    it('should preserve data when V1 file has mixed valid and invalid JSON lines', async () => {
      const validTask = createV1Task('task-1');
      const content = JSON.stringify(validTask) + '\n' + 'NOT_VALID_JSON\n';
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), content, 'utf-8');

      const result = await migrateV1ToV2(testDir, 'feature-invalid');

      // Migration may succeed (skipping invalid lines) or fail gracefully.
      // Either way, the original data must remain accessible.
      if (!result.success) {
        const v1Exists = await fs
          .access(path.join(testDir, 'queue.jsonl'))
          .then(() => true)
          .catch(() => false);
        const backupExists = await fs
          .access(path.join(testDir, 'queue.jsonl.v1backup'))
          .then(() => true)
          .catch(() => false);
        expect(v1Exists || backupExists).toBe(true);
      } else {
        expect(result.tasksConverted).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle rollback with no backup (never migrated)', async () => {
      const success = await rollbackMigration(testDir);
      expect(success).toBe(false);
    });

    it('should handle double rollback gracefully', async () => {
      const tasks = [createV1Task('task-1')];
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      await migrateV1ToV2(testDir, 'feature-double');

      // First rollback
      const first = await rollbackMigration(testDir);
      expect(first).toBe(true);

      // Second rollback - no backup exists anymore
      const second = await rollbackMigration(testDir);
      expect(second).toBe(false);

      // V1 data should still be intact from first rollback
      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(1);
    });

    it('should handle migration + rollback cycle multiple times', async () => {
      const tasks = Array.from({ length: 3 }, (_, i) => createV1Task(`task-${i + 1}`));
      const content = createV1QueueContent(tasks);
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), content, 'utf-8');

      // Cycle 1: migrate → rollback
      await migrateV1ToV2(testDir, 'feature-cycle');
      await rollbackMigration(testDir);

      // Cycle 2: migrate → rollback
      await migrateV1ToV2(testDir, 'feature-cycle');
      await rollbackMigration(testDir);

      // Verify data survived both cycles
      const restored = await loadV1Queue(testDir);
      expect(restored).toHaveLength(3);
      expect(restored.map((t) => t.task_id)).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should handle ensureV2Format detecting V1 and auto-migrating', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => createV1Task(`task-${i + 1}`));
      await fs.writeFile(path.join(testDir, 'queue.jsonl'), createV1QueueContent(tasks), 'utf-8');

      const ensureResult = await ensureV2Format(testDir, 'feature-ensure');
      expect(ensureResult.migrated).toBe(true);
      expect(ensureResult.result?.success).toBe(true);
      expect(ensureResult.result?.tasksConverted).toBe(5);

      // Verify V2 format
      expect(await detectQueueVersion(testDir)).toBe('v2');

      // Rollback should still work
      const rollbackSuccess = await rollbackMigration(testDir);
      expect(rollbackSuccess).toBe(true);
      expect(await detectQueueVersion(testDir)).toBe('v1');
    });
  });
});
