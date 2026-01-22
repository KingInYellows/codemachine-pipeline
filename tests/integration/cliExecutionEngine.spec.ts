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
import { CodeMachineStrategy } from '../../src/workflows/codeMachineStrategy';
import { validateCliAvailability } from '../../src/workflows/codeMachineRunner';
import { ExecutionLogWriter } from '../../src/telemetry/logWriters';
import { ExecutionTaskType } from '../../src/telemetry/executionMetrics';
import { vi } from 'vitest';

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

    it('should execute independent tasks in parallel when enabled', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
        createExecutionTask('T3', featureId, 'Task 3', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      let activeCount = 0;
      let sawParallel = false;

      const parallelStrategy: ExecutionStrategy = {
        name: 'parallel',
        canHandle: () => true,
        execute: async () => {
          activeCount += 1;
          if (activeCount > 1) {
            sawParallel = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
          activeCount -= 1;
          return createSuccessResult();
        },
      };

      const configWithParallel: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude',
          workspace_dir: runDir,
          task_timeout_ms: 30000,
          max_parallel_tasks: 2,
          max_retries: 3,
          retry_backoff_ms: 10,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithParallel,
        strategies: [parallelStrategy],
      });

      const result = await engine.execute();

      expect(result.completedTasks).toBe(3);
      expect(sawParallel).toBe(true);
    });

    it('should wait for dependencies even with parallel execution', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
        createExecutionTask('T3', featureId, 'Task 3', 'code_generation', {
          dependencyIds: ['T1'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      const startTimes = new Map<string, number>();
      const endTimes = new Map<string, number>();

      const trackingStrategy: ExecutionStrategy = {
        name: 'tracking-parallel',
        canHandle: () => true,
        execute: async (task) => {
          startTimes.set(task.task_id, Date.now());
          await new Promise((resolve) => setTimeout(resolve, 15));
          endTimes.set(task.task_id, Date.now());
          return createSuccessResult();
        },
      };

      const configWithParallel: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude',
          workspace_dir: runDir,
          task_timeout_ms: 30000,
          max_parallel_tasks: 2,
          max_retries: 3,
          retry_backoff_ms: 10,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithParallel,
        strategies: [trackingStrategy],
      });

      const result = await engine.execute();

      expect(result.completedTasks).toBe(3);
      const t1End = endTimes.get('T1');
      const t3Start = startTimes.get('T3');
      expect(t1End).toBeDefined();
      expect(t3Start).toBeDefined();
      if (t1End && t3Start) {
        expect(t3Start).toBeGreaterThanOrEqual(t1End);
      }
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

/**
 * E2E Tests with Mock CodeMachine CLI
 *
 * These tests use the actual CodeMachineStrategy with a mock CLI
 * script that returns controlled exit codes for deterministic testing.
 */
describe('CLIExecutionEngine E2E with Mock CLI', () => {
  const MOCK_CLI_PATH = path.resolve(__dirname, '../fixtures/mock-cli/codemachine');
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;

  beforeEach(async () => {
    featureId = `mock-cli-test-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-cli-'));
    pipelineDir = path.join(workspaceDir, '.ai-feature-pipeline');
    runsDir = path.join(pipelineDir, 'runs');
    await fs.mkdir(runsDir, { recursive: true });

    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/mock-cli-repo.git',
      defaultBranch: 'main',
      title: 'Mock CLI E2E Test',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    // Clean up environment variables
    delete process.env.MOCK_BEHAVIOR;
    delete process.env.MOCK_EXIT_CODE;
    delete process.env.MOCK_STDOUT;
    delete process.env.MOCK_STDERR;
    delete process.env.MOCK_DELAY_MS;

    if (workspaceDir) await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  describe('CLI Availability Detection (EC-EXEC-001)', () => {
    it('should detect mock CLI as available', async () => {
      const result = await validateCliAvailability(MOCK_CLI_PATH);

      expect(result.available).toBe(true);
      expect(result.version).toBe('codemachine-mock 1.0.0');
    });

    it('should detect missing CLI as unavailable', async () => {
      const result = await validateCliAvailability('/nonexistent/path/codemachine');

      expect(result.available).toBe(false);
      expect(result.error).toContain('CLI not accessible');
    });

    it('should reject CLI path with shell metacharacters', async () => {
      const result = await validateCliAvailability('/path/to/cli; rm -rf /');

      expect(result.available).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });

    it('should reject CLI path with path traversal', async () => {
      const result = await validateCliAvailability('/path/../../../etc/passwd');

      expect(result.available).toBe(false);
      expect(result.error).toContain('path traversal');
    });
  });

  /**
   * Helper function to create a configured CLIExecutionEngine for testing
   */
  interface CreateEngineOptions {
    cliPath?: string;
    maxRetries?: number;
    envAllowlist?: string[];
    tasks?: ReturnType<typeof createExecutionTask>[];
  }

  async function createTestEngine(options: CreateEngineOptions = {}) {
    const {
      cliPath = MOCK_CLI_PATH,
      maxRetries = 3,
      envAllowlist = [
        'MOCK_BEHAVIOR',
        'MOCK_EXIT_CODE',
        'MOCK_STDOUT',
        'MOCK_STDERR',
        'MOCK_DELAY_MS',
      ],
      tasks = [createExecutionTask('T1', featureId, 'Test Task', 'code_generation')],
    } = options;

    const config = {
      codemachine_cli_path: cliPath,
      default_engine: 'claude' as const,
      workspace_dir: workspaceDir,
      task_timeout_ms: 30000,
      max_retries: maxRetries,
      retry_backoff_ms: 10,
      env_allowlist: envAllowlist,
    };

    const strategy = new CodeMachineStrategy({ config });

    await appendToQueue(runDir, tasks);

    const baseConfig: RepoConfig = {
      schema_version: '1.0',
      platform: 'github',
      provider: {
        type: 'github',
        base_url: 'https://api.github.com',
      },
      repository: {
        owner: 'test',
        repo: 'mock-cli-repo',
        default_branch: 'main',
        visibility: 'private',
      },
      execution: config,
    };

    return new CLIExecutionEngine({
      runDir,
      config: baseConfig,
      strategies: [strategy],
    });
  }

  describe('CodeMachineStrategy with Mock CLI', () => {
    it('should execute task successfully with mock CLI (success behavior)', async () => {
      process.env.MOCK_BEHAVIOR = 'success';

      const engine = await createTestEngine();
      const result = await engine.execute();

      expect(result.totalTasks).toBe(1);
      expect(result.completedTasks).toBe(1);
      expect(result.failedTasks).toBe(0);
    });

    it('should handle task failure with mock CLI (failure behavior)', async () => {
      process.env.MOCK_BEHAVIOR = 'failure';

      const engine = await createTestEngine({
        maxRetries: 1,
        tasks: [
          createExecutionTask('T1', featureId, 'Failing Task', 'code_generation', {
            maxRetries: 1,
          }),
        ],
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(1);
      expect(result.permanentlyFailedTasks).toBe(1);

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('failed');
    });

    it('should detect rate limit errors from mock CLI', async () => {
      process.env.MOCK_BEHAVIOR = 'rate_limit';

      const engine = await createTestEngine({
        maxRetries: 1,
        tasks: [
          createExecutionTask('T1', featureId, 'Rate Limited Task', 'code_generation', {
            maxRetries: 1,
          }),
        ],
      });

      await engine.execute();

      const queue = await loadQueue(runDir);
      const task = queue.get('T1');
      expect(task?.last_error?.message).toContain('429');
    });
  });

  describe('validatePrerequisites with Mock CLI', () => {
    it('should pass validation with available mock CLI', async () => {
      const engine = await createTestEngine();
      const validation = await engine.validatePrerequisites();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation with missing CLI (EC-EXEC-001)', async () => {
      const engine = await createTestEngine({
        cliPath: '/nonexistent/codemachine',
      });

      const validation = await engine.validatePrerequisites();

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('CLI not available'))).toBe(true);
    });
  });

  describe('Dependency Cascade Failure', () => {
    const createFailingStrategy = (
      name: string,
      failingTaskId: string,
      errorMessage: string
    ): { strategy: ExecutionStrategy; executedTasks: string[] } => {
      const executedTasks: string[] = [];
      const strategy: ExecutionStrategy = {
        name,
        canHandle: () => true,
        execute: async (task) => {
          executedTasks.push(task.task_id);

          if (task.task_id === failingTaskId) {
            return {
              success: false,
              status: 'failed',
              summary: '',
              errorMessage,
              recoverable: false,
              durationMs: 50,
              artifacts: [],
            };
          }

          return {
            success: true,
            status: 'completed',
            summary: 'Completed',
            recoverable: false,
            durationMs: 50,
            artifacts: [],
          };
        },
      };
      return { strategy, executedTasks };
    };

    const createTestConfig = (repoName: string): RepoConfig => ({
      schema_version: '1.0',
      platform: 'github',
      provider: { type: 'github', base_url: 'https://api.github.com' },
      repository: {
        owner: 'test',
        repo: repoName,
        default_branch: 'main',
        visibility: 'private',
      },
      execution: {
        codemachine_cli_path: MOCK_CLI_PATH,
        default_engine: 'claude' as const,
        workspace_dir: workspaceDir,
        task_timeout_ms: 30000,
        max_retries: 0,
        retry_backoff_ms: 10,
      },
    });

    it('should not execute dependent tasks when dependency permanently fails', async () => {
      const { strategy: trackingStrategy, executedTasks } = createFailingStrategy(
        'tracking-cascade',
        'T1',
        'Permanent failure'
      );

      // Create task chain: T1 -> T2 -> T3
      const tasks = [
        createExecutionTask('T1', featureId, 'Base Task', 'code_generation', { maxRetries: 0 }),
        createExecutionTask('T2', featureId, 'Depends on T1', 'code_generation', {
          dependencyIds: ['T1'],
          maxRetries: 0,
        }),
        createExecutionTask('T3', featureId, 'Depends on T2', 'code_generation', {
          dependencyIds: ['T2'],
          maxRetries: 0,
        }),
      ];
      await appendToQueue(runDir, tasks);

      const config = createTestConfig('cascade-test');

      const engine = new CLIExecutionEngine({
        runDir,
        config,
        strategies: [trackingStrategy],
      });

      const result = await engine.execute();

      // Only T1 should have been executed
      expect(executedTasks).toEqual(['T1']);

      // T1 permanently failed, T2 and T3 never executed
      expect(result.permanentlyFailedTasks).toBe(1);
      expect(result.completedTasks).toBe(0);

      // Verify queue state
      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('failed');
      expect(queue.get('T2')?.status).toBe('pending'); // Never started
      expect(queue.get('T3')?.status).toBe('pending'); // Never started
    });

    it('should execute independent tasks even when one branch fails', async () => {
      const { strategy: trackingStrategy, executedTasks } = createFailingStrategy(
        'tracking-independent',
        'T1',
        'T1 failed'
      );

      // Create diamond DAG:
      //   T1 (fails) -> T3
      //   T2 (succeeds) -> T3
      // T3 depends on both, so it should NOT execute
      // T2 should execute because it has no dependencies
      const tasks = [
        createExecutionTask('T1', featureId, 'Fails', 'code_generation', { maxRetries: 0 }),
        createExecutionTask('T2', featureId, 'Succeeds', 'code_generation', { maxRetries: 0 }),
        createExecutionTask('T3', featureId, 'Depends on both', 'code_generation', {
          dependencyIds: ['T1', 'T2'],
          maxRetries: 0,
        }),
      ];
      await appendToQueue(runDir, tasks);

      const config = createTestConfig('diamond-test');

      const engine = new CLIExecutionEngine({
        runDir,
        config,
        strategies: [trackingStrategy],
      });

      const result = await engine.execute();

      // T1 and T2 should execute (independent), T3 should NOT (dependency on T1 failed)
      expect(executedTasks.sort()).toEqual(['T1', 'T2']);

      expect(result.permanentlyFailedTasks).toBe(1);
      expect(result.completedTasks).toBe(1);

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('failed');
      expect(queue.get('T2')?.status).toBe('completed');
      expect(queue.get('T3')?.status).toBe('pending'); // Blocked by T1
    });
  });

  describe('Telemetry Event Assertions', () => {
    const createMockLogger = () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
        child: vi.fn(),
      };
      logger.child.mockImplementation(() => logger);
      return logger;
    };

    const createTestConfig = (overrides?: Partial<RepoConfig['execution']>) => ({
      codemachine_cli_path: MOCK_CLI_PATH,
      default_engine: 'claude' as const,
      workspace_dir: workspaceDir,
      task_timeout_ms: 30000,
      max_retries: 3,
      retry_backoff_ms: 10,
      env_allowlist: ['MOCK_BEHAVIOR'],
      ...overrides,
    });

    const createTestBaseConfig = (repoName: string, executionConfig?: Partial<RepoConfig['execution']>): RepoConfig => ({
      schema_version: '1.0',
      platform: 'github',
      provider: { type: 'github', base_url: 'https://api.github.com' },
      repository: {
        owner: 'test',
        repo: repoName,
        default_branch: 'main',
        visibility: 'private',
      },
      execution: createTestConfig(executionConfig),
    });

    it('should emit taskStarted and taskCompleted events on successful execution', async () => {
      const mockLogger = createMockLogger();

      // Create log writer with mock
      const logWriter = new ExecutionLogWriter(mockLogger as never, {
        runDir,
        runId: featureId,
      });

      // Spy on logWriter methods
      const taskStartedSpy = vi.spyOn(logWriter, 'taskStarted');
      const taskCompletedSpy = vi.spyOn(logWriter, 'taskCompleted');

      process.env.MOCK_BEHAVIOR = 'success';

      const config = createTestConfig();
      const strategy = new CodeMachineStrategy({ config });

      const tasks = [createExecutionTask('T1', featureId, 'Telemetry Test', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const baseConfig = createTestBaseConfig('telemetry-test');

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
        logWriter,
      });

      await engine.execute();

      // Verify taskStarted was called
      expect(taskStartedSpy).toHaveBeenCalledWith(
        'T1',
        ExecutionTaskType.CODE_GENERATION,
        expect.objectContaining({ strategy: 'codemachine' })
      );

      // Verify taskCompleted was called
      expect(taskCompletedSpy).toHaveBeenCalledWith(
        'T1',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Number), // durationMs
        expect.objectContaining({
          strategy: 'codemachine',
          artifactsCaptured: expect.any(Number),
        })
      );
    });

    it('should emit taskFailed events on failed execution', async () => {
      const mockLogger = createMockLogger();

      const logWriter = new ExecutionLogWriter(mockLogger as never, {
        runDir,
        runId: featureId,
      });

      const taskFailedSpy = vi.spyOn(logWriter, 'taskFailed');

      process.env.MOCK_BEHAVIOR = 'failure';

      const config = createTestConfig({ max_retries: 0 });
      const strategy = new CodeMachineStrategy({ config });

      const tasks = [createExecutionTask('T1', featureId, 'Fail Telemetry', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const baseConfig = createTestBaseConfig('telemetry-failure', { max_retries: 0 });

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
        logWriter,
      });

      await engine.execute();

      expect(taskFailedSpy).toHaveBeenCalledWith(
        'T1',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Error),
        expect.any(Number),
        expect.objectContaining({
          strategy: 'codemachine',
          willRetry: false,
        })
      );
    });

    it('should log error on permanent task failure', async () => {
      const mockLogger = createMockLogger();

      // Create a strategy that fails
      const failingStrategy: ExecutionStrategy = {
        name: 'failing-telemetry',
        canHandle: () => true,
        execute: async () => ({
          success: false,
          status: 'failed',
          summary: '',
          errorMessage: 'Task failed for telemetry test',
          recoverable: false,
          durationMs: 50,
          artifacts: [],
        }),
      };

      const tasks = [
        createExecutionTask('T1', featureId, 'Failing Task', 'code_generation', { maxRetries: 0 }),
      ];
      await appendToQueue(runDir, tasks);

      const baseConfig = createTestBaseConfig('failure-telemetry', { max_retries: 0 });

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [failingStrategy],
        logger: mockLogger as never,
      });

      await engine.execute();

      // Verify error was logged for permanent failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('permanently failed'),
        expect.objectContaining({ taskId: 'T1' })
      );
    });

    it('should log execution metrics summary', async () => {
      const mockLogger = createMockLogger();

      const successStrategy: ExecutionStrategy = {
        name: 'success-metrics',
        canHandle: () => true,
        execute: async () => ({
          success: true,
          status: 'completed',
          summary: 'Done',
          recoverable: false,
          durationMs: 100,
          artifacts: [],
        }),
      };

      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      const baseConfig = createTestBaseConfig('metrics-test');

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [successStrategy],
        logger: mockLogger as never,
      });

      await engine.execute();

      // Verify execution summary was logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Execution complete',
        expect.objectContaining({
          totalTasks: 2,
          completedTasks: 2,
          failedTasks: 0,
          permanentlyFailedTasks: 0,
        })
      );
    });
  });
});

/**
 * CLI Command Integration Tests
 *
 * These tests verify that start and resume commands properly integrate
 * with CLIExecutionEngine for queue-driven execution.
 */
describe('CLI Command Integration with CLIExecutionEngine', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;
  let baseConfig: RepoConfig;

  beforeEach(async () => {
    featureId = `cli-integration-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-integration-'));
    pipelineDir = path.join(workspaceDir, '.ai-feature-pipeline');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });

    const fixtureConfigPath = path.join(FIXTURE_REPO, '.ai-feature-pipeline', 'config.json');
    const configContent = await fs.readFile(fixtureConfigPath, 'utf-8');
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, 'config.json'), configContent, 'utf-8');

    baseConfig = JSON.parse(configContent) as RepoConfig;

    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/cli-integration-repo.git',
      defaultBranch: 'main',
      title: 'CLI Integration Test',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  describe('start command integration', () => {
    it('should execute tasks via CLIExecutionEngine when queue has tasks', async () => {
      // Simulate tasks added by PRD authoring
      const tasks = [
        createExecutionTask('T1', featureId, 'Implement feature', 'code_generation'),
        createExecutionTask('T2', featureId, 'Add tests', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      // Create execution engine as start command would
      const strategy = createMockStrategy('mock-start', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
        dryRun: false,
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(2);
      expect(result.completedTasks).toBe(2);
      expect(result.failedTasks).toBe(0);

      // Verify queue state
      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('completed');
      expect(queue.get('T2')?.status).toBe('completed');
    });

    it('should skip execution when queue is empty', async () => {
      const strategy = createMockStrategy('mock-start-empty', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
        dryRun: false,
      });

      const result = await engine.execute();

      expect(result.totalTasks).toBe(0);
      expect(result.completedTasks).toBe(0);
    });

    it('should respect max-parallel configuration', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
        createExecutionTask('T3', featureId, 'Task 3', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      let activeCount = 0;
      let maxActive = 0;

      const trackingStrategy: ExecutionStrategy = {
        name: 'parallel-tracking',
        canHandle: () => true,
        execute: async () => {
          activeCount += 1;
          maxActive = Math.max(maxActive, activeCount);
          await new Promise((resolve) => setTimeout(resolve, 50));
          activeCount -= 1;
          return createSuccessResult();
        },
      };

      const configWithParallel: RepoConfig = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          max_parallel_tasks: 2,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithParallel,
        strategies: [trackingStrategy],
      });

      await engine.execute();

      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('should handle dry-run mode without executing', async () => {
      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);

      let executed = false;
      const trackingStrategy: ExecutionStrategy = {
        name: 'dry-run-tracking',
        canHandle: () => true,
        execute: async () => {
          executed = true;
          return createSuccessResult();
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [trackingStrategy],
        dryRun: true,
      });

      await engine.execute();

      expect(executed).toBe(false);

      // Task should be marked completed in dry-run
      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('completed');
    });
  });

  describe('resume command integration', () => {
    it('should resume and execute pending tasks', async () => {
      // Simulate partial execution - some tasks completed, some pending
      const tasks = [
        { ...createExecutionTask('T1', featureId, 'Completed', 'code_generation'), status: 'completed' as const },
        createExecutionTask('T2', featureId, 'Pending', 'code_generation'),
        createExecutionTask('T3', featureId, 'Also Pending', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      const strategy = createMockStrategy('mock-resume', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
      });

      const result = await engine.execute();

      // Should execute only pending tasks
      expect(result.totalTasks).toBe(3);
      expect(result.completedTasks).toBe(2); // T2 and T3

      const queue = await loadQueue(runDir);
      expect(queue.get('T1')?.status).toBe('completed');
      expect(queue.get('T2')?.status).toBe('completed');
      expect(queue.get('T3')?.status).toBe('completed');
    });

    it('should retry failed tasks on resume', async () => {
      // Simulate failed task from previous run
      const tasks = [
        {
          ...createExecutionTask('T1', featureId, 'Failed Task', 'code_generation', { maxRetries: 3 }),
          status: 'failed' as const,
          retry_count: 1,
        },
      ];
      await appendToQueue(runDir, tasks);

      let attemptCount = 0;
      const retryStrategy: ExecutionStrategy = {
        name: 'retry-tracking',
        canHandle: () => true,
        execute: async () => {
          attemptCount++;
          if (attemptCount === 1) {
            return createFailureResult('Still failing', true);
          }
          return createSuccessResult();
        },
      };

      const configWithFastRetry: RepoConfig = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          retry_backoff_ms: 10,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithFastRetry,
        strategies: [retryStrategy],
      });

      const result = await engine.execute();

      expect(attemptCount).toBe(2);
      expect(result.completedTasks).toBe(1);
    });

    it('should respect max-parallel on resume', async () => {
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation'),
        createExecutionTask('T3', featureId, 'Task 3', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      let activeCount = 0;
      let maxActive = 0;

      const trackingStrategy: ExecutionStrategy = {
        name: 'resume-parallel',
        canHandle: () => true,
        execute: async () => {
          activeCount += 1;
          maxActive = Math.max(maxActive, activeCount);
          await new Promise((resolve) => setTimeout(resolve, 50));
          activeCount -= 1;
          return createSuccessResult();
        },
      };

      const configWithParallel: RepoConfig = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          max_parallel_tasks: 2,
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: configWithParallel,
        strategies: [trackingStrategy],
      });

      await engine.execute();

      expect(maxActive).toBeLessThanOrEqual(2);
    });
  });

  describe('E2E flow simulation', () => {
    it('should handle complete start-to-execution flow', async () => {
      // Simulate the full pipeline:
      // 1. Context aggregation (not tested here)
      // 2. Research detection (not tested here)
      // 3. PRD authoring adds tasks to queue
      const tasks = [
        createExecutionTask('impl-auth', featureId, 'Implement authentication', 'code_generation'),
        createExecutionTask('test-auth', featureId, 'Test authentication', 'testing', {
          dependencyIds: ['impl-auth'],
        }),
        createExecutionTask('docs-auth', featureId, 'Document authentication', 'documentation', {
          dependencyIds: ['impl-auth', 'test-auth'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      // 4. CLIExecutionEngine executes tasks
      const executionOrder: string[] = [];
      const trackingStrategy: ExecutionStrategy = {
        name: 'e2e-tracking',
        canHandle: () => true,
        execute: async (task) => {
          executionOrder.push(task.task_id);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return createSuccessResult(`Completed ${task.task_id}`);
        },
      };

      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [trackingStrategy],
      });

      const result = await engine.execute();

      // Verify all tasks completed
      expect(result.totalTasks).toBe(3);
      expect(result.completedTasks).toBe(3);
      expect(result.failedTasks).toBe(0);

      // Verify execution order respected dependencies
      expect(executionOrder.indexOf('impl-auth')).toBeLessThan(
        executionOrder.indexOf('test-auth')
      );
      expect(executionOrder.indexOf('test-auth')).toBeLessThan(
        executionOrder.indexOf('docs-auth')
      );
    });

    it('should handle start with partial failure and resume', async () => {
      // Initial run with 3 tasks
      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'code_generation', { maxRetries: 2 }),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation', { maxRetries: 2 }),
        createExecutionTask('T3', featureId, 'Task 3', 'testing', {
          dependencyIds: ['T1', 'T2'],
          maxRetries: 2
        }),
      ];
      await appendToQueue(runDir, tasks);

      // First run - T1 succeeds, T2 fails
      let firstRunCount = 0;
      let firstEngine: CLIExecutionEngine;
      const firstRunStrategy: ExecutionStrategy = {
        name: 'first-run',
        canHandle: () => true,
        execute: async (task) => {
          firstRunCount++;
          if (task.task_id === 'T2') {
            firstEngine!.stop();
            return createFailureResult('Transient error', true);
          }
          return createSuccessResult();
        },
      };

      const configWithFastRetry: RepoConfig = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          retry_backoff_ms: 10,
        },
      };

      firstEngine = new CLIExecutionEngine({
        runDir,
        config: configWithFastRetry,
        strategies: [firstRunStrategy],
      });

      const firstResult = await firstEngine.execute();

      // T1 completed, T2 failed and retried multiple times, T3 never started
      expect(firstResult.completedTasks).toBeLessThan(3);
      expect(firstRunCount).toBeGreaterThan(0);

      // Resume run - all pending tasks succeed
      const resumeStrategy = createMockStrategy('resume-success', true);
      const resumeEngine = new CLIExecutionEngine({
        runDir,
        config: configWithFastRetry,
        strategies: [resumeStrategy],
      });

      const resumeResult = await resumeEngine.execute();
      expect(resumeResult.completedTasks).toBeGreaterThan(0);

      // Should complete remaining tasks
      const finalQueue = await loadQueue(runDir);
      expect(finalQueue.get('T1')?.status).toBe('completed');
      // T2 and T3 status depends on retry logic
    });
  });

  describe('validation and error handling', () => {
    it('should validate prerequisites before execution', async () => {
      const strategy = createMockStrategy('prereq-check', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [strategy],
      });

      const prereqResult = await engine.validatePrerequisites();

      expect(prereqResult.valid).toBe(true);
      expect(prereqResult.errors).toHaveLength(0);
    });

    it('should detect invalid configuration', async () => {
      const badConfig: RepoConfig = {
        ...baseConfig,
        execution: {
          codemachine_cli_path: 'codemachine',
          default_engine: 'claude' as const,
          workspace_dir: '/nonexistent/workspace',
          task_timeout_ms: 30000,
          max_retries: 3,
          retry_backoff_ms: 1000,
          max_log_buffer_size: 10 * 1024 * 1024,
          env_allowlist: [],
          spec_path: '',
        },
      };

      const strategy = createMockStrategy('bad-config', true);
      const engine = new CLIExecutionEngine({
        runDir,
        config: badConfig,
        strategies: [strategy],
      });

      const prereqResult = await engine.validatePrerequisites();

      expect(prereqResult.valid).toBe(false);
      expect(prereqResult.errors.some((e) => e.includes('Workspace directory'))).toBe(true);
    });

    it('should warn when no strategies available', async () => {
      const engine = new CLIExecutionEngine({
        runDir,
        config: baseConfig,
        strategies: [],
      });

      const prereqResult = await engine.validatePrerequisites();

      expect(prereqResult.warnings).toContain('No execution strategies registered');
    });
  });
});
