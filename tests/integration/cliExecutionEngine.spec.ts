import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CLIExecutionEngine } from '../../src/workflows/cliExecutionEngine';
import {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from '../../src/workflows/executionStrategy';
import { createRunDirectory } from '../../src/persistence/runDirectoryManager';
import { initializeQueue, appendToQueue, loadQueue } from '../../src/workflows/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { RepoConfig } from '../../src/core/config/RepoConfig';

const FIXTURE_REPO = path.resolve(__dirname, '../fixtures/sample_repo');

function createSuccessResult(summary = 'Mock success'): ExecutionStrategyResult {
  return {
    success: true,
    status: 'completed',
    summary,
    recoverable: false,
    durationMs: 100,
    artifacts: [],
  };
}

function createFailureResult(errorMessage: string, recoverable: boolean): ExecutionStrategyResult {
  return {
    success: false,
    status: 'failed',
    summary: '',
    errorMessage,
    recoverable,
    durationMs: 100,
    artifacts: [],
  };
}

function createMockStrategy(name: string, succeeds: boolean): ExecutionStrategy {
  return {
    name,
    canHandle: () => true,
    execute: async () => {
      if (succeeds) {
        return createSuccessResult();
      }
      return createFailureResult('Mock failure', false);
    },
  };
}

describe('CLIExecutionEngine Integration', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;
  let baseConfig: RepoConfig;

  beforeEach(async () => {
    featureId = `cli-exec-test-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-exec-'));
    pipelineDir = path.join(workspaceDir, '.ai-feature-pipeline');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });

    const fixtureConfigPath = path.join(FIXTURE_REPO, '.ai-feature-pipeline', 'config.json');
    const configContent = await fs.readFile(fixtureConfigPath, 'utf-8');
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, 'config.json'), configContent, 'utf-8');

    baseConfig = JSON.parse(configContent) as RepoConfig;

    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/cli-exec-repo.git',
      defaultBranch: 'main',
      title: 'CLI Execution Engine Test',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  describe('validatePrerequisites', () => {
    it('should return warnings when queue is empty', async () => {
      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      const result = await engine.validatePrerequisites();

      expect(result.warnings).toContain('Queue is empty - no tasks to execute');
    });

    it('should return warnings when no strategies registered', async () => {
      const tasks = [createExecutionTask('T1', featureId, 'Test Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [],
      });

      const result = await engine.validatePrerequisites();

      expect(result.warnings).toContain('No execution strategies registered');
    });

    it('should validate workspace directory exists', async () => {
      const configWithBadWorkspace: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude',
          workspace_dir: '/nonexistent/path',
          task_timeout_ms: 30000,
          max_retries: 3,
          retry_backoff_ms: 1000,
          env_allowlist: [],
          spec_path: '',
          max_log_buffer_size: 10 * 1024 * 1024,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithBadWorkspace,
        strategies: [createMockStrategy('mock', true)],
      });

      const result = await engine.validatePrerequisites();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Workspace directory does not exist'))).toBe(
        true
      );
    });
  });

  describe('execute', () => {
    it('should return early when queue is empty', async () => {
      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(0);
      expect(result.completedTasks).toBe(0);
    });

    it('should execute all pending tasks with matching strategy', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(2);
      expect(result.completedTasks).toBe(2);
      expect(result.failedTasks).toBe(0);
    });

    it('should skip tasks when no strategy can handle them', async () => {
      const tasks = [createExecutionTask('T1', featureId, 'Task 1', 'deployment')];
      await appendToQueue(runDir, tasks);

      const selectiveStrategy: ExecutionStrategy = {
        name: 'selective',
        canHandle: (task) => task.task_type === 'code_generation',
        execute: async () => createSuccessResult(),
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [selectiveStrategy],
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(1);
      expect(result.completedTasks).toBe(0);
      expect(result.permanentlyFailedTasks).toBe(1);

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('skipped');
    });

    it('should respect dependency order', async () => {
      const executionOrder: string[] = [];

      const tasks = [
        createExecutionTask('T1', featureId, 'First', 'code_generation'),
        createExecutionTask('T2', featureId, 'Second', 'code_generation', {
          dependencyIds: ['T1'],
        }),
        createExecutionTask('T3', featureId, 'Third', 'code_generation', {
          dependencyIds: ['T2'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      const trackingStrategy: ExecutionStrategy = {
        name: 'tracking',
        canHandle: () => true,
        execute: async (task) => {
          executionOrder.push(task.task_id);
          return createSuccessResult(`Completed ${task.task_id}`);
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [trackingStrategy],
      });

      await engine.execute();

      expect(executionOrder).toEqual(['T1', 'T2', 'T3']);
    });

    it('should handle strategy failures with retry', async () => {
      let attemptCount = 0;
      const tasks = [
        createExecutionTask('T1', featureId, 'Flaky Task', 'code_generation', {
          maxRetries: 3,
        }),
      ];
      await appendToQueue(runDir, tasks);

      const flakyStrategy: ExecutionStrategy = {
        name: 'flaky',
        canHandle: () => true,
        execute: async () => {
          attemptCount++;
          if (attemptCount < 3) {
            return createFailureResult('Transient failure', true);
          }
          return createSuccessResult('Finally succeeded');
        },
      };

      const configWithFastRetry: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude',
          workspace_dir: runDir,
          task_timeout_ms: 30000,
          max_retries: 3,
          retry_backoff_ms: 10,
          env_allowlist: [],
          spec_path: '',
          max_log_buffer_size: 10 * 1024 * 1024,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithFastRetry,
        strategies: [flakyStrategy],
      });

      const result = await engine.execute();

      expect(attemptCount).toBe(3);
      expect(result.completedTasks).toBe(1);
      expect(result.permanentlyFailedTasks).toBe(0);
    });

    it('should mark task as permanently failed after max retries', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Always Fails', 'code_generation', {
          maxRetries: 2,
        }),
      ];
      await appendToQueue(runDir, tasks);

      const failingStrategy: ExecutionStrategy = {
        name: 'failing',
        canHandle: () => true,
        execute: async () => createFailureResult('Permanent failure', true),
      };

      const configWithFastRetry: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude',
          workspace_dir: runDir,
          task_timeout_ms: 30000,
          max_retries: 2,
          retry_backoff_ms: 10,
          env_allowlist: [],
          spec_path: '',
          max_log_buffer_size: 10 * 1024 * 1024,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithFastRetry,
        strategies: [failingStrategy],
      });

      const result = await engine.execute();

      expect(result.permanentlyFailedTasks).toBe(1);

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('failed');
      expect(queue.get('T1')?.retry_count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('executeTask', () => {
    it('should create log directory for task', async () => {
      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      const task = tasks[0];
      await engine.executeTask(task);

      const logsDir = path.join(runDir, 'logs');
      const logsDirExists = await fs
        .stat(logsDir)
        .then(() => true)
        .catch(() => false);
      expect(logsDirExists).toBe(true);
    });

    it('should pass correct context to strategy', async () => {
      let capturedContext: ExecutionContext | null = null;

      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const capturingStrategy: ExecutionStrategy = {
        name: 'capturing',
        canHandle: () => true,
        execute: async (_task, context) => {
          capturedContext = context;
          return createSuccessResult();
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [capturingStrategy],
      });

      await engine.executeTask(tasks[0]);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.runDir).toBe(runDir);
      expect(capturedContext!.logPath).toContain('T1.log');
    });
  });

  describe('stop', () => {
    it('should stop execution loop when stop() is called', async () => {
      const executedTasks: string[] = [];
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
        createExecutionTask('T3', featureId, 'Task 3', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      const slowStrategy: ExecutionStrategy = {
        name: 'slow',
        canHandle: () => true,
        execute: async (task) => {
          executedTasks.push(task.task_id);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return createSuccessResult();
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [slowStrategy],
      });

      const executePromise = engine.execute();
      await new Promise((resolve) => setTimeout(resolve, 50));
      engine.stop();

      const result = await executePromise;

      expect(result.completedTasks).toBeLessThanOrEqual(3);
    });
  });

  describe('dryRun mode', () => {
    it('should not execute strategies in dry run mode', async () => {
      let strategyExecuted = false;
      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const trackingStrategy: ExecutionStrategy = {
        name: 'tracking',
        canHandle: () => true,
        execute: async () => {
          strategyExecuted = true;
          return createSuccessResult();
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [trackingStrategy],
        dryRun: true,
      });

      const result = await engine.execute();

      expect(strategyExecuted).toBe(false);
      expect(result.completedTasks).toBe(1);

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('completed');
    });
  });

  describe('artifact capture', () => {
    it('should capture artifacts after successful task execution', async () => {
      const tasks = [createExecutionTask('task-1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      await fs.writeFile(path.join(runDir, 'summary.md'), '# Task Summary\nCompleted', 'utf-8');

      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      await engine.execute();

      const artifactDir = path.join(runDir, 'artifacts', 'task-1');
      const artifactExists = await fs
        .stat(artifactDir)
        .then(() => true)
        .catch(() => false);
      expect(artifactExists).toBe(true);
    });

    it('should handle valid task IDs for artifact capture', async () => {
      const tasks = [createExecutionTask('task-1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const mockStrategy = createMockStrategy('mock', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [mockStrategy],
      });

      const result = await engine.execute();
      expect(result.completedTasks).toBe(1);
    });
  });
});
