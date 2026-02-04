import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask';
import type { ExecutionConfig } from '../../src/core/config/RepoConfig';
import type { ExecutionContext } from '../../src/workflows/executionStrategy';
import type { RunnerResult } from '../../src/workflows/codeMachineRunner';
import type { NormalizedResult } from '../../src/workflows/resultNormalizer';

vi.mock('../../src/workflows/codeMachineRunner', () => ({
  runCodeMachine: vi.fn(),
  validateCliAvailability: vi.fn(),
}));

vi.mock('../../src/workflows/taskMapper', () => ({
  mapTaskToWorkflow: vi.fn(),
  shouldUseNativeEngine: vi.fn(),
}));

vi.mock('../../src/workflows/resultNormalizer', () => ({
  normalizeResult: vi.fn(),
  isRecoverableError: vi.fn(),
}));

import {
  CodeMachineStrategy,
  createCodeMachineStrategy,
} from '../../src/workflows/codeMachineStrategy';
import { runCodeMachine, validateCliAvailability } from '../../src/workflows/codeMachineRunner';
import { mapTaskToWorkflow, shouldUseNativeEngine } from '../../src/workflows/taskMapper';
import { normalizeResult, isRecoverableError } from '../../src/workflows/resultNormalizer';

const mockRunCodeMachine = vi.mocked(runCodeMachine);
const mockValidateCliAvailability = vi.mocked(validateCliAvailability);
const mockMapTaskToWorkflow = vi.mocked(mapTaskToWorkflow);
const mockShouldUseNativeEngine = vi.mocked(shouldUseNativeEngine);
const mockNormalizeResult = vi.mocked(normalizeResult);
const mockIsRecoverableError = vi.mocked(isRecoverableError);

function createMockConfig(overrides?: Partial<ExecutionConfig>): ExecutionConfig {
  return {
    codemachine_cli_path: '/usr/bin/codemachine',
    default_engine: 'claude',
    task_timeout_ms: 1800000,
    max_parallel_tasks: 1,
    max_log_buffer_size: 10 * 1024 * 1024,
    env_allowlist: [],
    max_retries: 3,
    retry_backoff_ms: 5000,
    log_rotation_mb: 100,
    log_rotation_keep: 3,
    log_rotation_compress: false,
    ...overrides,
  };
}

function createMockTask(overrides?: Partial<ExecutionTask>): ExecutionTask {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    task_id: 'task-001',
    feature_id: 'feat-001',
    title: 'Implement authentication',
    task_type: 'code_generation',
    status: 'pending',
    dependency_ids: [],
    retry_count: 0,
    max_retries: 3,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    runDir: '/tmp/runs/run-001',
    workspaceDir: '/workspace/project',
    logPath: '/tmp/runs/run-001/logs/task-001.log',
    timeoutMs: 300000,
    ...overrides,
  };
}

function createMockRunnerResult(overrides?: Partial<RunnerResult>): RunnerResult {
  return {
    taskId: 'task-001',
    exitCode: 0,
    stdout: 'Task completed successfully',
    stderr: '',
    durationMs: 1500,
    timedOut: false,
    killed: false,
    ...overrides,
  };
}

function createMockNormalizedResult(overrides?: Partial<NormalizedResult>): NormalizedResult {
  return {
    success: true,
    exitCode: 0,
    stdout: 'Task completed successfully',
    stderr: '',
    durationMs: 1500,
    timedOut: false,
    killed: false,
    errorCategory: 'none',
    redactedStdout: 'Task completed successfully',
    redactedStderr: '',
    artifacts: ['output.ts'],
    status: 'completed',
    summary: 'Task completed successfully',
    recoverable: false,
    ...overrides,
  };
}

describe('CodeMachineStrategy', () => {
  let config: ExecutionConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createMockConfig();
  });

  describe('createCodeMachineStrategy', () => {
    it('creates a CodeMachineStrategy instance', () => {
      const strategy = createCodeMachineStrategy({ config });

      expect(strategy).toBeInstanceOf(CodeMachineStrategy);
    });

    it('creates an instance with optional logger', () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
      const strategy = createCodeMachineStrategy({ config, logger });

      expect(strategy).toBeInstanceOf(CodeMachineStrategy);
    });
  });

  describe('name', () => {
    it('returns codemachine', () => {
      const strategy = new CodeMachineStrategy({ config });

      expect(strategy.name).toBe('codemachine');
    });
  });

  describe('canHandle', () => {
    it('returns true when shouldUseNativeEngine returns false', () => {
      mockShouldUseNativeEngine.mockReturnValue(false);
      const strategy = new CodeMachineStrategy({ config });
      const task = createMockTask({ task_type: 'code_generation' });

      const result = strategy.canHandle(task);

      expect(result).toBe(true);
      expect(mockShouldUseNativeEngine).toHaveBeenCalledWith('code_generation');
    });

    it('returns false when shouldUseNativeEngine returns true', () => {
      mockShouldUseNativeEngine.mockReturnValue(true);
      const strategy = new CodeMachineStrategy({ config });
      const task = createMockTask({ task_type: 'testing' });

      const result = strategy.canHandle(task);

      expect(result).toBe(false);
      expect(mockShouldUseNativeEngine).toHaveBeenCalledWith('testing');
    });

    it('returns true for pr_creation tasks', () => {
      mockShouldUseNativeEngine.mockReturnValue(false);
      const strategy = new CodeMachineStrategy({ config });
      const task = createMockTask({ task_type: 'pr_creation' });

      const result = strategy.canHandle(task);

      expect(result).toBe(true);
    });

    it('returns false for deployment tasks', () => {
      mockShouldUseNativeEngine.mockReturnValue(true);
      const strategy = new CodeMachineStrategy({ config });
      const task = createMockTask({ task_type: 'deployment' });

      const result = strategy.canHandle(task);

      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('runs codeMachine and returns normalized result on success', async () => {
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult();
      const normalized = createMockNormalizedResult();

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(false);

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.execute(task, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.summary).toBe('Task completed successfully');
      expect(result.recoverable).toBe(false);
      expect(result.durationMs).toBe(1500);
      expect(result.artifacts).toEqual(['output.ts']);
      expect(result.errorMessage).toBeUndefined();

      expect(mockMapTaskToWorkflow).toHaveBeenCalledWith('code_generation');
      expect(mockRunCodeMachine).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          taskId: 'task-001',
          prompt: 'Implement authentication',
          workspaceDir: '/workspace/project',
          timeoutMs: 300000,
        })
      );
      expect(mockNormalizeResult).toHaveBeenCalledWith(runnerResult);
    });

    it('includes errorMessage when error category is not none', async () => {
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult({ exitCode: 1, stderr: 'Something failed' });
      const normalized: NormalizedResult = {
        ...createMockNormalizedResult(),
        success: false,
        exitCode: 1,
        errorCategory: 'unknown',
        redactedStdout: 'Partial output',
        redactedStderr: 'Something failed',
        status: 'failed',
        timedOut: false,
        killed: false,
        recoverable: true,
        artifacts: [],
      };

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(true);

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.execute(task, context);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Something failed');
      expect(result.recoverable).toBe(true);
    });

    it('maps timeout status correctly', async () => {
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult({ exitCode: 124, timedOut: true });
      const normalized: NormalizedResult = {
        ...createMockNormalizedResult(),
        success: false,
        exitCode: 124,
        timedOut: true,
        killed: false,
        errorCategory: 'timeout',
        status: 'timeout',
        redactedStdout: 'Partial output',
        redactedStderr: 'Timed out',
        recoverable: true,
        artifacts: [],
      };

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(true);

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.execute(task, context);

      expect(result.status).toBe('timeout');
      expect(result.recoverable).toBe(true);
    });

    it('maps killed status correctly', async () => {
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult({ exitCode: 137, killed: true });
      const normalized: NormalizedResult = {
        ...createMockNormalizedResult(),
        success: false,
        exitCode: 137,
        timedOut: false,
        killed: true,
        errorCategory: 'killed',
        status: 'killed',
        redactedStdout: 'Partial output',
        redactedStderr: 'Process killed',
        recoverable: true,
        artifacts: [],
      };

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(true);

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.execute(task, context);

      expect(result.status).toBe('killed');
    });

    it('handles errors from runCodeMachine gracefully', async () => {
      const task = createMockTask();
      const context = createMockContext();

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockRejectedValue(new Error('CLI process crashed'));

      const strategy = new CodeMachineStrategy({ config });

      await expect(strategy.execute(task, context)).rejects.toThrow('CLI process crashed');
    });

    it('uses spec_path from task config when available', async () => {
      const task = createMockTask({
        config: { spec_path: 'specs/custom.md' },
      });
      const context = createMockContext();
      const runnerResult = createMockRunnerResult();
      const normalized = createMockNormalizedResult();

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(false);

      const strategy = new CodeMachineStrategy({ config });
      await strategy.execute(task, context);

      expect(mockRunCodeMachine).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          specPath: expect.stringContaining('specs/custom.md'),
        })
      );
    });

    it('generates default spec path when task config has no spec_path', async () => {
      const task = createMockTask({ config: undefined });
      const context = createMockContext();
      const runnerResult = createMockRunnerResult();
      const normalized = createMockNormalizedResult();

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(false);

      const strategy = new CodeMachineStrategy({ config });
      await strategy.execute(task, context);

      expect(mockRunCodeMachine).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          specPath: expect.stringContaining('task-001.md'),
        })
      );
    });

    it('truncates summary to 500 characters from redactedStdout', async () => {
      const longOutput = 'x'.repeat(600);
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult();
      const normalized: NormalizedResult = {
        ...createMockNormalizedResult(),
        redactedStdout: longOutput,
      };

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(false);

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.execute(task, context);

      expect(result.summary).toBe('x'.repeat(500));
      expect(result.summary.length).toBe(500);
    });

    it('passes logger to runner options when logger is provided', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as never;
      const task = createMockTask();
      const context = createMockContext();
      const runnerResult = createMockRunnerResult();
      const normalized = createMockNormalizedResult();

      mockMapTaskToWorkflow.mockReturnValue({
        workflow: 'codemachine start',
        command: 'start',
        useNativeEngine: false,
      });
      mockRunCodeMachine.mockResolvedValue(runnerResult);
      mockNormalizeResult.mockReturnValue(normalized);
      mockIsRecoverableError.mockReturnValue(false);

      const strategy = new CodeMachineStrategy({ config, logger });
      await strategy.execute(task, context);

      expect(mockRunCodeMachine).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          logger,
        })
      );
    });
  });

  describe('validatePrerequisites', () => {
    it('delegates to validateCliAvailability and returns valid when CLI is available', async () => {
      mockValidateCliAvailability.mockResolvedValue({
        available: true,
        version: '1.2.3',
      });

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.validatePrerequisites();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(mockValidateCliAvailability).toHaveBeenCalledWith('/usr/bin/codemachine');
    });

    it('returns errors when CLI is not available', async () => {
      mockValidateCliAvailability.mockResolvedValue({
        available: false,
        error: 'CLI not found at /usr/bin/codemachine',
      });

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.validatePrerequisites();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('CLI not found at /usr/bin/codemachine');
    });

    it('uses fallback message when error is undefined', async () => {
      mockValidateCliAvailability.mockResolvedValue({
        available: false,
      });

      const strategy = new CodeMachineStrategy({ config });
      const result = await strategy.validatePrerequisites();

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['CodeMachine CLI not available']);
    });
  });
});
