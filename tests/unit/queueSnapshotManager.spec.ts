import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  computeSnapshotChecksum,
  verifySnapshotChecksum,
  loadSnapshot,
  saveSnapshot,
  deleteSnapshot,
  snapshotExists,
  getSnapshotMetadata,
} from '../../src/workflows/queueSnapshotManager.js';
import type { QueueSnapshotV2, QueueCounts, ExecutionTaskData } from '../../src/workflows/queueTypes.js';
import { createEmptyQueueCounts } from '../../src/workflows/queueTypes.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

describe('queueSnapshotManager', () => {
  let testDir: string;

  const createTaskData = (id: string): ExecutionTaskData => ({
    task_id: id,
    feature_id: 'feature-123',
    task_type: 'code_generation',
    status: 'pending',
    title: 'Test task',
    description: 'Test description',
    priority: 1,
    dependencies: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const createCounts = (overrides: Partial<QueueCounts> = {}): QueueCounts => ({
    ...createEmptyQueueCounts(),
    ...overrides,
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('computeSnapshotChecksum', () => {
    it('should compute deterministic checksum for same data', () => {
      const tasks = { 'task-1': createTaskData('task-1') };
      const counts = createCounts({ total: 1, pending: 1 });
      const deps = { 'task-1': [] };

      const checksum1 = computeSnapshotChecksum(tasks, counts, deps);
      const checksum2 = computeSnapshotChecksum(tasks, counts, deps);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('should compute different checksums for different data', () => {
      const tasks1 = { 'task-1': createTaskData('task-1') };
      const tasks2 = { 'task-2': createTaskData('task-2') };
      const counts = createCounts({ total: 1 });
      const deps = {};

      const checksum1 = computeSnapshotChecksum(tasks1, counts, deps);
      const checksum2 = computeSnapshotChecksum(tasks2, counts, deps);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('verifySnapshotChecksum', () => {
    it('should return true for valid snapshot', () => {
      const tasks = { 'task-1': createTaskData('task-1') };
      const counts = createCounts({ total: 1, pending: 1 });
      const deps = { 'task-1': [] };
      const checksum = computeSnapshotChecksum(tasks, counts, deps);

      const snapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 5,
        tasks,
        counts,
        dependencyGraph: deps,
        timestamp: new Date().toISOString(),
        checksum,
      };

      expect(verifySnapshotChecksum(snapshot)).toBe(true);
    });

    it('should return false for tampered snapshot', () => {
      const tasks = { 'task-1': createTaskData('task-1') };
      const counts = createCounts({ total: 1, pending: 1 });
      const deps = { 'task-1': [] };
      const checksum = computeSnapshotChecksum(tasks, counts, deps);

      const snapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 5,
        tasks,
        counts: { ...counts, total: 999 }, // Tampered
        dependencyGraph: deps,
        timestamp: new Date().toISOString(),
        checksum,
      };

      expect(verifySnapshotChecksum(snapshot)).toBe(false);
    });
  });

  describe('loadSnapshot', () => {
    it('should return null for non-existent file', async () => {
      const result = await loadSnapshot(testDir);
      expect(result).toBeNull();
    });

    it('should return valid snapshot', async () => {
      const tasks = { 'task-1': createTaskData('task-1') };
      const counts = createCounts({ total: 1, pending: 1 });

      await saveSnapshot(testDir, 'feature-123', tasks as Record<string, ExecutionTask>, counts, 10, {});

      const result = await loadSnapshot(testDir);

      expect(result).not.toBeNull();
      expect(result!.featureId).toBe('feature-123');
      expect(result!.snapshotSeq).toBe(10);
      expect(Object.keys(result!.tasks)).toHaveLength(1);
    });

    it('should return null for invalid JSON', async () => {
      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      await fs.writeFile(snapshotPath, 'not valid json', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadSnapshot(testDir);
      warnSpy.mockRestore();

      expect(result).toBeNull();
    });

    it('should return null for invalid schema version', async () => {
      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      const badSnapshot = {
        schemaVersion: '1.0.0', // Wrong version
        featureId: 'feature-123',
        tasks: {},
        counts: createCounts(),
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };
      await fs.writeFile(snapshotPath, JSON.stringify(badSnapshot), 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadSnapshot(testDir);
      warnSpy.mockRestore();

      expect(result).toBeNull();
    });

    it('should return null for checksum mismatch', async () => {
      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      const badSnapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 5,
        tasks: { 'task-1': createTaskData('task-1') },
        counts: createCounts({ total: 1 }),
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'invalid_checksum_value',
      };
      await fs.writeFile(snapshotPath, JSON.stringify(badSnapshot), 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadSnapshot(testDir);
      warnSpy.mockRestore();

      expect(result).toBeNull();
    });
  });

  describe('saveSnapshot', () => {
    it('should create snapshot file', async () => {
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, pending: 1 });

      await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, {});

      const exists = await snapshotExists(testDir);
      expect(exists).toBe(true);
    });

    it('should use atomic write (temp file pattern)', async () => {
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1 });

      await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, {});

      // After save, no temp files should remain
      const files = await fs.readdir(testDir);
      const tempFiles = files.filter(f => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should compute correct checksum', async () => {
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, pending: 1 });

      const snapshot = await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, { 'task-1': [] });

      expect(verifySnapshotChecksum(snapshot)).toBe(true);
    });

    it('should set schema version to 2.0.0', async () => {
      const tasks = {} as Record<string, ExecutionTask>;
      const counts = createCounts();

      const snapshot = await saveSnapshot(testDir, 'feature-123', tasks, counts, 0, {});

      expect(snapshot.schemaVersion).toBe('2.0.0');
    });

    it('should preserve all task data', async () => {
      const taskData = createTaskData('task-1');
      taskData.status = 'running';
      taskData.priority = 5;
      const tasks = { 'task-1': taskData } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, running: 1 });

      const snapshot = await saveSnapshot(testDir, 'feature-123', tasks, counts, 10, { 'task-1': ['dep-1'] });

      expect(snapshot.tasks['task-1'].status).toBe('running');
      expect(snapshot.tasks['task-1'].priority).toBe(5);
      expect(snapshot.dependencyGraph['task-1']).toEqual(['dep-1']);
    });

    it('should persist data durably (fsync before rename pattern)', async () => {
      // This test verifies the durability pattern works correctly
      // The implementation uses: open -> write -> sync -> close -> rename
      // We verify the end result: data persists and is readable
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, pending: 1 });

      // Save snapshot
      const savedSnapshot = await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, { 'task-1': [] });

      // Verify snapshot was persisted correctly
      const loadedSnapshot = await loadSnapshot(testDir);
      expect(loadedSnapshot).not.toBeNull();
      expect(loadedSnapshot!.snapshotSeq).toBe(savedSnapshot.snapshotSeq);
      expect(loadedSnapshot!.checksum).toBe(savedSnapshot.checksum);

      // Verify no temp files remain (atomic write completed)
      const files = await fs.readdir(testDir);
      const tempFiles = files.filter((f) => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should handle write errors without leaving temp files', async () => {
      // Create a read-only directory to force a write error
      const readOnlyDir = path.join(testDir, 'readonly');
      await fs.mkdir(readOnlyDir);

      // First create a valid snapshot
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1 });
      await saveSnapshot(readOnlyDir, 'feature-123', tasks, counts, 1, {});

      // Make directory read-only (this will cause write to fail on next attempt)
      await fs.chmod(readOnlyDir, 0o444);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        // This should fail due to permission denied
        await saveSnapshot(readOnlyDir, 'feature-123', tasks, counts, 2, {});
        // If we get here, the write succeeded (CI might run as root)
      } catch {
        // Expected error - verify no temp files left
        await fs.chmod(readOnlyDir, 0o755); // Restore permissions to check
        const files = await fs.readdir(readOnlyDir);
        const tempFiles = files.filter((f) => f.includes('.tmp'));
        expect(tempFiles).toHaveLength(0);
      } finally {
        await fs.chmod(readOnlyDir, 0o755); // Restore for cleanup
        warnSpy.mockRestore();
      }
    });
  });

  describe('checksum integrity verification (CDMCH-69)', () => {
    it('should reject snapshot with corrupted checksum on load', async () => {
      // Save a valid snapshot first
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, pending: 1 });
      await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, { 'task-1': [] });

      // Corrupt the checksum in the file
      const snapshotPath = path.join(testDir, 'queue_snapshot.json');
      const content = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
      content.checksum = 'deadbeef'.repeat(8); // 64-char fake checksum
      await fs.writeFile(snapshotPath, JSON.stringify(content), 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadSnapshot(testDir);
      warnSpy.mockRestore();

      // loadSnapshot must return null for checksum mismatch (CDMCH-69)
      expect(result).toBeNull();
    });

    it('should accept snapshot with valid SHA-256 checksum', async () => {
      const tasks = { 'task-1': createTaskData('task-1') } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 1, pending: 1 });
      await saveSnapshot(testDir, 'feature-123', tasks, counts, 5, { 'task-1': [] });

      const result = await loadSnapshot(testDir);
      expect(result).not.toBeNull();
      expect(result!.checksum).toHaveLength(64); // SHA-256 = 64 hex chars
      expect(verifySnapshotChecksum(result!)).toBe(true);
    });

    it('should use SHA-256 algorithm for snapshot checksums', () => {
      const tasks = { 'task-1': createTaskData('task-1') };
      const counts = createCounts({ total: 1 });
      const checksum = computeSnapshotChecksum(tasks, counts, {});
      // SHA-256 outputs 64 hex characters
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('fsync durability (CDMCH-67)', () => {
    it('should use handle.sync() in snapshot write path', async () => {
      const source = await fs.readFile(
        path.join(__dirname, '../../src/workflows/queueSnapshotManager.ts'),
        'utf-8'
      );
      // queueSnapshotManager.ts line 199: await handle.sync()
      expect(source).toContain('await handle.sync()');
    });
  });

  describe('deleteSnapshot', () => {
    it('should delete existing file', async () => {
      const tasks = {} as Record<string, ExecutionTask>;
      await saveSnapshot(testDir, 'feature-123', tasks, createCounts(), 0, {});
      expect(await snapshotExists(testDir)).toBe(true);

      await deleteSnapshot(testDir);

      expect(await snapshotExists(testDir)).toBe(false);
    });

    it('should not error for non-existent file', async () => {
      await expect(deleteSnapshot(testDir)).resolves.not.toThrow();
    });
  });

  describe('snapshotExists', () => {
    it('should return false when no file', async () => {
      const exists = await snapshotExists(testDir);
      expect(exists).toBe(false);
    });

    it('should return true when file exists', async () => {
      const tasks = {} as Record<string, ExecutionTask>;
      await saveSnapshot(testDir, 'feature-123', tasks, createCounts(), 0, {});

      const exists = await snapshotExists(testDir);
      expect(exists).toBe(true);
    });
  });

  describe('getSnapshotMetadata', () => {
    it('should return null when no snapshot', async () => {
      const metadata = await getSnapshotMetadata(testDir);
      expect(metadata).toBeNull();
    });

    it('should return correct metadata without loading tasks', async () => {
      const task1 = createTaskData('task-1');
      const task2 = createTaskData('task-2');
      const tasks = { 'task-1': task1, 'task-2': task2 } as Record<string, ExecutionTask>;
      const counts = createCounts({ total: 2, pending: 2 });

      await saveSnapshot(testDir, 'feature-123', tasks, counts, 42, {});

      const metadata = await getSnapshotMetadata(testDir);

      expect(metadata).not.toBeNull();
      expect(metadata!.exists).toBe(true);
      expect(metadata!.snapshotSeq).toBe(42);
      expect(metadata!.taskCount).toBe(2);
      expect(metadata!.timestamp).toBeDefined();
    });
  });
});
