import { describe, it, expect } from 'vitest';
import {
  createExecutionTask,
  parseExecutionTask,
  serializeExecutionTask,
  canRetry,
  areDependenciesCompleted,
  getTaskDuration,
  formatExecutionTaskValidationErrors,
} from '../../../src/core/models/ExecutionTask';
import type { ExecutionTask } from '../../../src/core/models/ExecutionTask';

describe('ExecutionTask model', () => {
  // -----------------------------------------------------------------------
  // createExecutionTask
  // -----------------------------------------------------------------------

  describe('createExecutionTask', () => {
    it('should create a task with sensible defaults', () => {
      const task = createExecutionTask('t-1', 'feat-1', 'Generate code', 'code_generation');

      expect(task.task_id).toBe('t-1');
      expect(task.feature_id).toBe('feat-1');
      expect(task.title).toBe('Generate code');
      expect(task.task_type).toBe('code_generation');
      expect(task.status).toBe('pending');
      expect(task.schema_version).toBe('1.0.0');
      expect(task.retry_count).toBe(0);
      expect(task.max_retries).toBe(3);
      expect(task.dependency_ids).toEqual([]);
      expect(task.created_at).toBeDefined();
      expect(task.updated_at).toBeDefined();
      // optional fields should be undefined
      expect(task.config).toBeUndefined();
      expect(task.assigned_agent).toBeUndefined();
      expect(task.trace_id).toBeUndefined();
      expect(task.metadata).toBeUndefined();
    });

    it('should accept all optional fields', () => {
      const task = createExecutionTask('t-2', 'feat-2', 'Run tests', 'testing', {
        config: { timeout: 30000 },
        assignedAgent: 'agent-007',
        dependencyIds: ['t-1'],
        maxRetries: 5,
        traceId: 'trace-abc',
        metadata: { priority: 'high' },
      });

      expect(task.config).toEqual({ timeout: 30000 });
      expect(task.assigned_agent).toBe('agent-007');
      expect(task.dependency_ids).toEqual(['t-1']);
      expect(task.max_retries).toBe(5);
      expect(task.trace_id).toBe('trace-abc');
      expect(task.metadata).toEqual({ priority: 'high' });
    });
  });

  // -----------------------------------------------------------------------
  // parseExecutionTask
  // -----------------------------------------------------------------------

  describe('parseExecutionTask', () => {
    it('should parse a valid task object', () => {
      const task = createExecutionTask('t-1', 'feat-1', 'My task', 'review');
      const result = parseExecutionTask(task);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.task_id).toBe('t-1');
        expect(result.data.task_type).toBe('review');
      }
    });

    it('should return errors for invalid input', () => {
      const result = parseExecutionTask({ task_id: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        // Each error should have path and message
        for (const err of result.errors) {
          expect(err).toHaveProperty('path');
          expect(err).toHaveProperty('message');
        }
      }
    });

    it('should reject completely empty input', () => {
      const result = parseExecutionTask({});
      expect(result.success).toBe(false);
    });

    it('should reject extra unknown fields (strict mode)', () => {
      const task = createExecutionTask('t-1', 'feat-1', 'My task', 'other');
      const withExtra = { ...task, bogus_field: 'bad' };
      const result = parseExecutionTask(withExtra);

      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // serializeExecutionTask round-trip
  // -----------------------------------------------------------------------

  describe('serializeExecutionTask', () => {
    it('should round-trip through serialize then parse', () => {
      const original = createExecutionTask('t-rt', 'feat-rt', 'Round trip', 'deployment');
      const json = serializeExecutionTask(original);
      const parsed = parseExecutionTask(JSON.parse(json));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.task_id).toBe('t-rt');
        expect(parsed.data.title).toBe('Round trip');
      }
    });

    it('should produce compact JSON when pretty is false', () => {
      const task = createExecutionTask('t-c', 'f-c', 'Compact', 'other');
      const compact = serializeExecutionTask(task, false);

      // Compact JSON has no newlines
      expect(compact).not.toContain('\n');
    });

    it('should produce indented JSON when pretty is true', () => {
      const task = createExecutionTask('t-p', 'f-p', 'Pretty', 'other');
      const pretty = serializeExecutionTask(task, true);

      expect(pretty).toContain('\n');
    });
  });

  // -----------------------------------------------------------------------
  // canRetry
  // -----------------------------------------------------------------------

  describe('canRetry', () => {
    function makeFailedTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
      const base = createExecutionTask('t-retry', 'f-1', 'Retryable', 'code_generation');
      return {
        ...base,
        status: 'failed',
        retry_count: 1,
        max_retries: 3,
        ...overrides,
      } as ExecutionTask;
    }

    it('should return true when failed, under max retries, and recoverable', () => {
      const task = makeFailedTask({
        last_error: {
          message: 'timeout',
          timestamp: new Date().toISOString(),
          recoverable: true,
        },
      });

      expect(canRetry(task)).toBe(true);
    });

    it('should return true when failed with no last_error (recoverable defaults to true)', () => {
      const task = makeFailedTask({ last_error: undefined });
      expect(canRetry(task)).toBe(true);
    });

    it('should return false when max retries reached', () => {
      const task = makeFailedTask({ retry_count: 3, max_retries: 3 });
      expect(canRetry(task)).toBe(false);
    });

    it('should return false when last_error.recoverable is false', () => {
      const task = makeFailedTask({
        last_error: {
          message: 'fatal',
          timestamp: new Date().toISOString(),
          recoverable: false,
        },
      });

      expect(canRetry(task)).toBe(false);
    });

    it('should return false when status is not failed', () => {
      const task = makeFailedTask({ status: 'running' });
      expect(canRetry(task)).toBe(false);
    });

    it('should return false when status is completed', () => {
      const task = makeFailedTask({ status: 'completed' });
      expect(canRetry(task)).toBe(false);
    });

    it('should return false when status is pending', () => {
      const task = makeFailedTask({ status: 'pending' });
      expect(canRetry(task)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // areDependenciesCompleted
  // -----------------------------------------------------------------------

  describe('areDependenciesCompleted', () => {
    function makeTask(id: string, status: string, deps: string[] = []): ExecutionTask {
      const base = createExecutionTask(id, 'f-1', `Task ${id}`, 'other');
      return { ...base, status, dependency_ids: deps } as ExecutionTask;
    }

    it('should return true when all dependencies are completed', () => {
      const dep1 = makeTask('d-1', 'completed');
      const dep2 = makeTask('d-2', 'completed');
      const task = makeTask('t-1', 'pending', ['d-1', 'd-2']);

      const allTasks = new Map<string, ExecutionTask>([
        ['d-1', dep1],
        ['d-2', dep2],
        ['t-1', task],
      ]);

      expect(areDependenciesCompleted(task, allTasks)).toBe(true);
    });

    it('should return false when some dependencies are not completed', () => {
      const dep1 = makeTask('d-1', 'completed');
      const dep2 = makeTask('d-2', 'running');
      const task = makeTask('t-1', 'pending', ['d-1', 'd-2']);

      const allTasks = new Map<string, ExecutionTask>([
        ['d-1', dep1],
        ['d-2', dep2],
        ['t-1', task],
      ]);

      expect(areDependenciesCompleted(task, allTasks)).toBe(false);
    });

    it('should return false when a dependency does not exist in the map', () => {
      const task = makeTask('t-1', 'pending', ['missing-dep']);
      const allTasks = new Map<string, ExecutionTask>([['t-1', task]]);

      expect(areDependenciesCompleted(task, allTasks)).toBe(false);
    });

    it('should return true when task has no dependencies', () => {
      const task = makeTask('t-1', 'pending', []);
      const allTasks = new Map<string, ExecutionTask>([['t-1', task]]);

      expect(areDependenciesCompleted(task, allTasks)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getTaskDuration
  // -----------------------------------------------------------------------

  describe('getTaskDuration', () => {
    it('should return duration in ms when both timestamps are set', () => {
      const base = createExecutionTask('t-dur', 'f-1', 'Timed', 'testing');
      const task = {
        ...base,
        started_at: '2025-01-15T10:00:00.000Z',
        completed_at: '2025-01-15T10:00:05.500Z',
      } as ExecutionTask;

      expect(getTaskDuration(task)).toBe(5500);
    });

    it('should return undefined when started_at is missing', () => {
      const base = createExecutionTask('t-dur2', 'f-1', 'No start', 'testing');
      const task = {
        ...base,
        started_at: undefined,
        completed_at: '2025-01-15T10:00:05.000Z',
      } as ExecutionTask;

      expect(getTaskDuration(task)).toBeUndefined();
    });

    it('should return undefined when completed_at is missing', () => {
      const base = createExecutionTask('t-dur3', 'f-1', 'No end', 'testing');
      const task = {
        ...base,
        started_at: '2025-01-15T10:00:00.000Z',
        completed_at: undefined,
      } as ExecutionTask;

      expect(getTaskDuration(task)).toBeUndefined();
    });

    it('should return undefined when both timestamps are missing', () => {
      const task = createExecutionTask('t-dur4', 'f-1', 'Neither', 'testing');
      expect(getTaskDuration(task)).toBeUndefined();
    });

    it('should return 0 when start and end are the same', () => {
      const ts = '2025-01-15T10:00:00.000Z';
      const base = createExecutionTask('t-dur5', 'f-1', 'Instant', 'testing');
      const task = { ...base, started_at: ts, completed_at: ts } as ExecutionTask;

      expect(getTaskDuration(task)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // formatExecutionTaskValidationErrors
  // -----------------------------------------------------------------------

  describe('formatExecutionTaskValidationErrors', () => {
    it('should produce readable output with path and message', () => {
      const errors = [
        { path: 'task_id', message: 'Required' },
        { path: 'status', message: 'Invalid enum value' },
      ];

      const output = formatExecutionTaskValidationErrors(errors);

      expect(output).toContain('ExecutionTask validation failed:');
      expect(output).toContain('task_id: Required');
      expect(output).toContain('status: Invalid enum value');
      expect(output).toContain('data_model_dictionary.md');
    });

    it('should handle an empty errors array', () => {
      const output = formatExecutionTaskValidationErrors([]);

      expect(output).toContain('ExecutionTask validation failed:');
      // Should still include the schema doc reference
      expect(output).toContain('data_model_dictionary.md');
    });

    it('should handle a single error', () => {
      const output = formatExecutionTaskValidationErrors([
        { path: 'root', message: 'Expected object, received string' },
      ]);

      expect(output).toContain('root: Expected object, received string');
    });
  });
});
