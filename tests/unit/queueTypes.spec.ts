import { describe, it, expect } from 'vitest';
import {
  isQueueOperation,
  isQueueSnapshotV2,
  createEmptyQueueCounts,
  createDefaultCompactionConfig,
  createEmptyIndexState,
  type QueueOperation,
  type QueueSnapshotV2,
  type ExecutionTaskData,
} from '../../src/workflows/queueTypes';

describe('queueTypes', () => {
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

  describe('isQueueOperation', () => {
    it('should return true for valid create operation', () => {
      const op: QueueOperation = {
        op: 'create',
        seq: 1,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(true);
    });

    it('should return true for valid update operation', () => {
      const op: QueueOperation = {
        op: 'update',
        seq: 2,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        patch: { status: 'running' },
        checksum: 'def456',
      };

      expect(isQueueOperation(op)).toBe(true);
    });

    it('should return true for valid delete operation', () => {
      const op: QueueOperation = {
        op: 'delete',
        seq: 3,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'ghi789',
      };

      expect(isQueueOperation(op)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isQueueOperation(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isQueueOperation(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isQueueOperation('string')).toBe(false);
      expect(isQueueOperation(123)).toBe(false);
      expect(isQueueOperation(true)).toBe(false);
    });

    it('should return false for invalid operation type', () => {
      const op = {
        op: 'invalid',
        seq: 1,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(false);
    });

    it('should return false for negative sequence number', () => {
      const op = {
        op: 'create',
        seq: -1,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(false);
    });

    it('should return false for non-integer sequence number', () => {
      const op = {
        op: 'create',
        seq: 1.5,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(false);
    });

    it('should return false for missing required fields', () => {
      expect(isQueueOperation({ op: 'create' })).toBe(false);
      expect(isQueueOperation({ op: 'create', seq: 1 })).toBe(false);
      expect(isQueueOperation({ op: 'create', seq: 1, ts: 'ts' })).toBe(false);
      expect(isQueueOperation({ op: 'create', seq: 1, ts: 'ts', taskId: 'id' })).toBe(false);
    });

    it('should accept zero sequence number', () => {
      const op = {
        op: 'create',
        seq: 0,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(true);
    });

    it('should accept large sequence numbers', () => {
      const op = {
        op: 'create',
        seq: Number.MAX_SAFE_INTEGER,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(true);
    });
  });

  describe('isQueueSnapshotV2', () => {
    const createValidSnapshot = (): QueueSnapshotV2 => ({
      schemaVersion: '2.0.0',
      featureId: 'feature-123',
      snapshotSeq: 10,
      tasks: {},
      counts: createEmptyQueueCounts(),
      dependencyGraph: {},
      timestamp: new Date().toISOString(),
      checksum: 'sha256-abc123',
    });

    it('should return true for valid snapshot', () => {
      const snapshot = createValidSnapshot();

      expect(isQueueSnapshotV2(snapshot)).toBe(true);
    });

    it('should return true for snapshot with tasks', () => {
      const snapshot = createValidSnapshot();
      snapshot.tasks['task-1'] = createTaskData('task-1');
      snapshot.tasks['task-2'] = createTaskData('task-2');

      expect(isQueueSnapshotV2(snapshot)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isQueueSnapshotV2(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isQueueSnapshotV2(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isQueueSnapshotV2('string')).toBe(false);
      expect(isQueueSnapshotV2(123)).toBe(false);
      expect(isQueueSnapshotV2([])).toBe(false);
    });

    it('should reject v1 snapshots (wrong schema version)', () => {
      const v1Snapshot = {
        schemaVersion: '1.0.0',
        featureId: 'feature-123',
        snapshotSeq: 10,
        tasks: {},
        counts: createEmptyQueueCounts(),
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };

      expect(isQueueSnapshotV2(v1Snapshot)).toBe(false);
    });

    it('should reject snapshots with invalid schema version', () => {
      const invalidSnapshot = {
        schemaVersion: '3.0.0',
        featureId: 'feature-123',
        snapshotSeq: 10,
        tasks: {},
        counts: {},
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };

      expect(isQueueSnapshotV2(invalidSnapshot)).toBe(false);
    });

    it('should reject snapshots with non-integer snapshotSeq', () => {
      const invalidSnapshot = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 10.5,
        tasks: {},
        counts: {},
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };

      expect(isQueueSnapshotV2(invalidSnapshot)).toBe(false);
    });

    it('should reject snapshots with null tasks', () => {
      const invalidSnapshot = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 10,
        tasks: null,
        counts: {},
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };

      expect(isQueueSnapshotV2(invalidSnapshot)).toBe(false);
    });

    it('should reject snapshots missing required fields', () => {
      expect(isQueueSnapshotV2({ schemaVersion: '2.0.0' })).toBe(false);
      expect(isQueueSnapshotV2({ schemaVersion: '2.0.0', featureId: 'f' })).toBe(false);
    });

    it('should accept empty tasks object', () => {
      const snapshot = createValidSnapshot();
      snapshot.tasks = {};

      expect(isQueueSnapshotV2(snapshot)).toBe(true);
    });
  });

  describe('Serialization', () => {
    it('should serialize QueueOperation to valid JSON', () => {
      const op: QueueOperation = {
        op: 'create',
        seq: 1,
        ts: '2024-01-15T10:30:00.000Z',
        taskId: 'task-1',
        task: createTaskData('task-1'),
        checksum: 'abc123',
      };

      const json = JSON.stringify(op);
      const parsed = JSON.parse(json);

      expect(isQueueOperation(parsed)).toBe(true);
      expect(parsed.op).toBe('create');
      expect(parsed.seq).toBe(1);
    });

    it('should serialize QueueSnapshotV2 to valid JSON', () => {
      const snapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 10,
        tasks: { 'task-1': createTaskData('task-1') },
        counts: createEmptyQueueCounts(),
        dependencyGraph: { 'task-2': ['task-1'] },
        timestamp: '2024-01-15T10:30:00.000Z',
        checksum: 'sha256-abc123',
      };

      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json);

      expect(isQueueSnapshotV2(parsed)).toBe(true);
      expect(parsed.schemaVersion).toBe('2.0.0');
      expect(parsed.tasks['task-1']).toBeDefined();
    });

    it('should preserve data in round-trip serialization for QueueOperation', () => {
      const op: QueueOperation = {
        op: 'update',
        seq: 42,
        ts: '2024-01-15T10:30:00.000Z',
        taskId: 'task-123',
        patch: { status: 'completed', priority: 5 },
        checksum: 'checksum-xyz',
      };

      const roundTripped = JSON.parse(JSON.stringify(op));

      expect(roundTripped.op).toBe(op.op);
      expect(roundTripped.seq).toBe(op.seq);
      expect(roundTripped.ts).toBe(op.ts);
      expect(roundTripped.taskId).toBe(op.taskId);
      expect(roundTripped.patch?.status).toBe(op.patch?.status);
      expect(roundTripped.checksum).toBe(op.checksum);
    });

    it('should preserve data in round-trip serialization for QueueSnapshotV2', () => {
      const snapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'my-feature',
        snapshotSeq: 999,
        tasks: {
          't1': createTaskData('t1'),
          't2': createTaskData('t2'),
        },
        counts: { total: 2, pending: 1, running: 1, completed: 0, failed: 0, skipped: 0, cancelled: 0 },
        dependencyGraph: { 't2': ['t1'] },
        timestamp: '2024-01-15T10:30:00.000Z',
        checksum: 'sha256-snapshot',
      };

      const roundTripped = JSON.parse(JSON.stringify(snapshot));

      expect(roundTripped.schemaVersion).toBe(snapshot.schemaVersion);
      expect(roundTripped.featureId).toBe(snapshot.featureId);
      expect(roundTripped.snapshotSeq).toBe(snapshot.snapshotSeq);
      expect(Object.keys(roundTripped.tasks)).toHaveLength(2);
      expect(roundTripped.counts.total).toBe(2);
      expect(roundTripped.dependencyGraph['t2']).toEqual(['t1']);
    });
  });

  describe('createEmptyQueueCounts', () => {
    it('should create counts with all fields set to zero', () => {
      const counts = createEmptyQueueCounts();

      expect(counts.total).toBe(0);
      expect(counts.pending).toBe(0);
      expect(counts.running).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.skipped).toBe(0);
      expect(counts.cancelled).toBe(0);
    });

    it('should return a new object each time', () => {
      const counts1 = createEmptyQueueCounts();
      const counts2 = createEmptyQueueCounts();

      counts1.total = 5;

      expect(counts2.total).toBe(0);
    });
  });

  describe('createDefaultCompactionConfig', () => {
    it('should create config with default values', () => {
      const config = createDefaultCompactionConfig();

      expect(config.maxUpdates).toBe(1000);
      expect(config.maxBytes).toBe(5 * 1024 * 1024); // 5MB
      expect(config.pruneCompleted).toBe(false);
    });

    it('should return a new object each time', () => {
      const config1 = createDefaultCompactionConfig();
      const config2 = createDefaultCompactionConfig();

      config1.maxUpdates = 500;

      expect(config2.maxUpdates).toBe(1000);
    });
  });

  describe('createEmptyIndexState', () => {
    it('should create empty index state with default values', () => {
      const state = createEmptyIndexState();

      expect(state.tasks).toBeInstanceOf(Map);
      expect(state.tasks.size).toBe(0);
      expect(state.counts.total).toBe(0);
      expect(state.lastSeq).toBe(0);
      expect(state.snapshotSeq).toBe(0);
      expect(state.dirty).toBe(false);
    });

    it('should return a new object each time', () => {
      const state1 = createEmptyIndexState();
      const state2 = createEmptyIndexState();

      state1.tasks.set('task-1', createTaskData('task-1'));
      state1.lastSeq = 10;

      expect(state2.tasks.size).toBe(0);
      expect(state2.lastSeq).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string taskId in operation', () => {
      const op = {
        op: 'create',
        seq: 1,
        ts: new Date().toISOString(),
        taskId: '',
        checksum: 'abc123',
      };

      // Empty string is still a string, so type guard passes
      expect(isQueueOperation(op)).toBe(true);
    });

    it('should handle zero counts as valid', () => {
      const snapshot: QueueSnapshotV2 = {
        schemaVersion: '2.0.0',
        featureId: 'feature-123',
        snapshotSeq: 0,
        tasks: {},
        counts: createEmptyQueueCounts(),
        dependencyGraph: {},
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };

      expect(isQueueSnapshotV2(snapshot)).toBe(true);
    });

    it('should handle operations with both task and patch (unusual but valid)', () => {
      const op: QueueOperation = {
        op: 'create',
        seq: 1,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        task: createTaskData('task-1'),
        patch: { status: 'running' },
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(true);
    });

    it('should handle operations with neither task nor patch', () => {
      const op: QueueOperation = {
        op: 'delete',
        seq: 1,
        ts: new Date().toISOString(),
        taskId: 'task-1',
        checksum: 'abc123',
      };

      expect(isQueueOperation(op)).toBe(true);
    });
  });
});
