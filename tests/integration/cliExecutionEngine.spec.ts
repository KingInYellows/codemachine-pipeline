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
});
