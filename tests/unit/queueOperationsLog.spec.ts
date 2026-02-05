import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendOperation,
  readOperations,
  getLastSequence,
  truncateOperationsLog,
  getOperationsLogStats,
  initializeOperationsLog,
  appendOperationsBatch,
  computeOperationChecksum,
  verifyOperationChecksum,
} from '../../src/workflows/queueOperationsLog.js';
import type { QueueOperation } from '../../src/workflows/queueTypes.js';
import type { ExecutionTaskData } from '../../src/workflows/queueTypes.js';

describe('queueOperationsLog', () => {
  let testDir: string;

  // Helper to create valid task data
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

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-ops-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('computeOperationChecksum', () => {
    it('should compute deterministic checksum for same operation', () => {
      const op = {
        op: 'create' as const,
        seq: 1,
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
        task: createTaskData('task-1'),
      };

      const checksum1 = computeOperationChecksum(op);
      const checksum2 = computeOperationChecksum(op);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(8); // SHA-256 truncated to 8 hex chars
    });

    it('should compute different checksums for different operations', () => {
      const op1 = {
        op: 'create' as const,
        seq: 1,
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
      };
      const op2 = {
        op: 'create' as const,
        seq: 2,
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
      };

      expect(computeOperationChecksum(op1)).not.toBe(computeOperationChecksum(op2));
    });
  });

  describe('verifyOperationChecksum', () => {
    it('should return true for valid checksum', () => {
      const op = {
        op: 'create' as const,
        seq: 1,
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
      };
      const checksum = computeOperationChecksum(op);
      const fullOp: QueueOperation = { ...op, checksum };

      expect(verifyOperationChecksum(fullOp)).toBe(true);
    });

    it('should return false for tampered operation', () => {
      const op = {
        op: 'create' as const,
        seq: 1,
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
      };
      const checksum = computeOperationChecksum(op);
      const fullOp: QueueOperation = { ...op, checksum, seq: 999 }; // tampered seq

      expect(verifyOperationChecksum(fullOp)).toBe(false);
    });
  });

  describe('appendOperation', () => {
    it('should append operation with auto-assigned sequence number', async () => {
      await initializeOperationsLog(testDir);

      const result = await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      expect(result.seq).toBe(1);
      expect(result.checksum).toBeDefined();
      expect(result.checksum).toHaveLength(8);
    });

    it('should auto-increment sequence numbers', async () => {
      await initializeOperationsLog(testDir);

      const op1 = await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      const op2 = await appendOperation(testDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'running' },
      });

      const op3 = await appendOperation(testDir, {
        op: 'delete',
        ts: new Date().toISOString(),
        taskId: 'task-1',
      });

      expect(op1.seq).toBe(1);
      expect(op2.seq).toBe(2);
      expect(op3.seq).toBe(3);
    });

    it('should create file if it does not exist', async () => {
      // No init - just directly append
      const result = await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      expect(result.seq).toBe(1);

      const logPath = path.join(testDir, 'queue_operations.log');
      const exists = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should compute correct checksum', async () => {
      await initializeOperationsLog(testDir);

      const result = await appendOperation(testDir, {
        op: 'create',
        ts: '2024-01-15T10:00:00.000Z',
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      expect(verifyOperationChecksum(result)).toBe(true);
    });
  });

  describe('readOperations', () => {
    it('should return empty array for non-existent file', async () => {
      const operations = await readOperations(testDir);
      expect(operations).toEqual([]);
    });

    it('should return all operations from file', async () => {
      await initializeOperationsLog(testDir);

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await appendOperation(testDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'running' },
      });

      const operations = await readOperations(testDir);
      expect(operations).toHaveLength(2);
      expect(operations[0].seq).toBe(1);
      expect(operations[1].seq).toBe(2);
    });

    it('should filter by afterSeq correctly', async () => {
      await initializeOperationsLog(testDir);

      for (let i = 1; i <= 5; i++) {
        await appendOperation(testDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const operations = await readOperations(testDir, 3);
      expect(operations).toHaveLength(2);
      expect(operations[0].seq).toBe(4);
      expect(operations[1].seq).toBe(5);
    });

    it('should skip corrupted/invalid lines gracefully', async () => {
      await initializeOperationsLog(testDir);

      // Append a valid operation
      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      // Manually append corrupted line
      const logPath = path.join(testDir, 'queue_operations.log');
      await fs.appendFile(logPath, 'not valid json\n', 'utf-8');
      await fs.appendFile(logPath, '{"op":"invalid","seq":"not-number"}\n', 'utf-8');

      // Append another valid operation
      await appendOperation(testDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'completed' },
      });

      // Suppress console.warn during test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const operations = await readOperations(testDir);

      warnSpy.mockRestore();

      // Should have 2 valid operations (skipped corrupted ones)
      expect(operations).toHaveLength(2);
      expect(operations[0].seq).toBe(1);
      expect(operations[1].seq).toBe(2);
    });

    it('should handle empty file', async () => {
      await initializeOperationsLog(testDir);
      const operations = await readOperations(testDir);
      expect(operations).toEqual([]);
    });
  });

  describe('getLastSequence', () => {
    it('should return 0 for non-existent file', async () => {
      const seq = await getLastSequence(testDir);
      expect(seq).toBe(0);
    });

    it('should return 0 for empty file', async () => {
      await initializeOperationsLog(testDir);
      const seq = await getLastSequence(testDir);
      expect(seq).toBe(0);
    });

    it('should return correct sequence after appends', async () => {
      await initializeOperationsLog(testDir);

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-2',
        task: createTaskData('task-2'),
      });

      const seq = await getLastSequence(testDir);
      expect(seq).toBe(2);
    });
  });

  describe('truncateOperationsLog', () => {
    it('should truncate file to empty', async () => {
      await initializeOperationsLog(testDir);

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await truncateOperationsLog(testDir);

      const operations = await readOperations(testDir);
      expect(operations).toHaveLength(0);

      const seq = await getLastSequence(testDir);
      expect(seq).toBe(0);
    });

    it('should work on non-existent file (no error)', async () => {
      // Should not throw
      await expect(truncateOperationsLog(testDir)).resolves.not.toThrow();
    });
  });

  describe('getOperationsLogStats', () => {
    it('should return exists: false for missing file', async () => {
      const stats = await getOperationsLogStats(testDir);
      expect(stats.exists).toBe(false);
      expect(stats.sizeBytes).toBe(0);
      expect(stats.operationCount).toBe(0);
    });

    it('should return correct size and count', async () => {
      await initializeOperationsLog(testDir);

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await appendOperation(testDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'running' },
      });

      const stats = await getOperationsLogStats(testDir);
      expect(stats.exists).toBe(true);
      expect(stats.operationCount).toBe(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should count match number of operations', async () => {
      await initializeOperationsLog(testDir);

      for (let i = 0; i < 10; i++) {
        await appendOperation(testDir, {
          op: 'create',
          ts: new Date().toISOString(),
          taskId: `task-${i}`,
          task: createTaskData(`task-${i}`),
        });
      }

      const stats = await getOperationsLogStats(testDir);
      expect(stats.operationCount).toBe(10);
    });
  });

  describe('appendOperationsBatch', () => {
    it('should append multiple operations atomically', async () => {
      await initializeOperationsLog(testDir);

      const ops = [
        {
          op: 'create' as const,
          ts: new Date().toISOString(),
          taskId: 'task-1',
          task: createTaskData('task-1'),
        },
        {
          op: 'create' as const,
          ts: new Date().toISOString(),
          taskId: 'task-2',
          task: createTaskData('task-2'),
        },
        {
          op: 'create' as const,
          ts: new Date().toISOString(),
          taskId: 'task-3',
          task: createTaskData('task-3'),
        },
      ];

      const results = await appendOperationsBatch(testDir, ops);

      expect(results).toHaveLength(3);
      expect(results[0].seq).toBe(1);
      expect(results[1].seq).toBe(2);
      expect(results[2].seq).toBe(3);

      const operations = await readOperations(testDir);
      expect(operations).toHaveLength(3);
    });

    it('should return empty array for empty input', async () => {
      await initializeOperationsLog(testDir);
      const results = await appendOperationsBatch(testDir, []);
      expect(results).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle large sequence numbers', async () => {
      await initializeOperationsLog(testDir);

      // Write a large sequence number to counter file
      const counterPath = path.join(testDir, 'queue_sequence.txt');
      await fs.writeFile(counterPath, '999999', 'utf-8');

      const result = await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      expect(result.seq).toBe(1000000);
    });

    it('should handle unicode in task IDs', async () => {
      await initializeOperationsLog(testDir);

      const result = await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-unicode-\u4e2d\u6587-\u0434\u0430',
        task: createTaskData('task-unicode'),
      });

      expect(result.taskId).toBe('task-unicode-\u4e2d\u6587-\u0434\u0430');

      const operations = await readOperations(testDir);
      expect(operations[0].taskId).toBe('task-unicode-\u4e2d\u6587-\u0434\u0430');
    });

    it('should skip operations with corrupted checksums', async () => {
      await initializeOperationsLog(testDir);

      // Append valid operation
      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      // Manually append operation with bad checksum
      const logPath = path.join(testDir, 'queue_operations.log');
      const badOp = {
        op: 'create',
        seq: 2,
        ts: new Date().toISOString(),
        taskId: 'task-2',
        checksum: 'bad12345', // Wrong checksum
      };
      await fs.appendFile(logPath, JSON.stringify(badOp) + '\n', 'utf-8');

      // Append another valid operation
      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-3',
        task: createTaskData('task-3'),
      });

      // Suppress console.warn during test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const operations = await readOperations(testDir);

      warnSpy.mockRestore();

      // Should skip the bad checksum operation
      expect(operations).toHaveLength(2);
      expect(operations.map((o) => o.taskId)).toEqual(['task-1', 'task-3']);
    });

    it('should recover sequence from WAL when counter file is corrupted', async () => {
      await initializeOperationsLog(testDir);

      // Append some operations
      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
      });

      await appendOperation(testDir, {
        op: 'create',
        ts: new Date().toISOString(),
        taskId: 'task-2',
        task: createTaskData('task-2'),
      });

      // Corrupt the counter file
      const counterPath = path.join(testDir, 'queue_sequence.txt');
      await fs.writeFile(counterPath, 'not-a-number', 'utf-8');

      // Suppress console.warn during test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should recover from WAL
      const seq = await getLastSequence(testDir);

      warnSpy.mockRestore();

      expect(seq).toBe(2);
    });

    it('should handle operations with patch field', async () => {
      await initializeOperationsLog(testDir);

      const result = await appendOperation(testDir, {
        op: 'update',
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'completed', priority: 10 },
      });

      expect(result.patch).toEqual({ status: 'completed', priority: 10 });

      const operations = await readOperations(testDir);
      expect(operations[0].patch).toEqual({ status: 'completed', priority: 10 });
    });
  });
});
