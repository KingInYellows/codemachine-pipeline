/**
 * Crash Recovery E2E Tests (CDMCH-74)
 *
 * Tests the full crash → resume path:
 * 1. Set up run directory and populate queue
 * 2. Execute partially (simulate mid-execution crash)
 * 3. Verify manifest/queue consistency in crash state
 * 4. Resume execution
 * 5. Verify exactly-once task processing (no duplicates, no skips)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CLIExecutionEngine } from '../../src/workflows/cliExecutionEngine';
import { CodeMachineStrategy } from '../../src/workflows/codeMachineStrategy';
import {
  updateManifest,
  readManifest,
  setCurrentStep,
  setLastStep,
} from '../../src/persistence/manifestManager';
import { createRunDirectory } from '../../src/persistence/runLifecycle';
import {
  initializeQueue,
  appendToQueue,
  loadQueue,
  updateTaskInQueue,
  createQueueSnapshot,
} from '../../src/workflows/queue/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { analyzeResumeState, prepareResume } from '../../src/workflows/resumeCoordinator';
import { RepoConfig } from '../../src/core/config/RepoConfig';

const MOCK_CLI_PATH = path.resolve(__dirname, '../fixtures/mock-cli/codemachine');

describe('Crash Recovery E2E', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;
  let baseConfig: RepoConfig;

  beforeEach(async () => {
    featureId = `crash-recovery-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crash-recovery-'));
    pipelineDir = path.join(workspaceDir, '.codepipe');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });

    baseConfig = {
      schema_version: '1.0',
      platform: 'github',
      provider: {
        type: 'github',
        base_url: 'https://api.github.com',
      },
      repository: {
        owner: 'test',
        repo: 'crash-recovery-repo',
        default_branch: 'main',
        visibility: 'private',
      },
      execution: {
        codemachine_cli_path: MOCK_CLI_PATH,
        default_engine: 'claude',
        workspace_dir: workspaceDir,
        task_timeout_ms: 30000,
        max_retries: 3,
        retry_backoff_ms: 10,
        env_allowlist: [
          'MOCK_BEHAVIOR',
          'MOCK_EXIT_CODE',
          'MOCK_STDOUT',
          'MOCK_STDERR',
          'MOCK_DELAY_MS',
        ],
      },
    };

    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/crash-recovery-repo.git',
      defaultBranch: 'main',
      title: 'Crash Recovery E2E Test',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    delete process.env.MOCK_BEHAVIOR;
    delete process.env.MOCK_EXIT_CODE;
    delete process.env.MOCK_STDOUT;
    delete process.env.MOCK_STDERR;
    delete process.env.MOCK_DELAY_MS;

    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  function createEngine(configOverrides?: Partial<RepoConfig['execution']>) {
    const config: RepoConfig = {
      ...baseConfig,
      execution: {
        ...baseConfig.execution,
        ...configOverrides,
      },
    };

    const strategy = new CodeMachineStrategy({ config: config.execution });

    return new CLIExecutionEngine({
      runDir,
      config,
      strategies: [strategy],
    });
  }

  // ==========================================================================
  // Crash → Resume → Exactly-Once Processing
  // ==========================================================================

  describe('crash and resume with exactly-once semantics', () => {
    it('should complete all tasks exactly once after crash mid-execution', async () => {
      // Setup: 4 tasks in a chain
      const tasks = [
        createExecutionTask('task-1', featureId, 'First task', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Second task', 'code_generation', {
          dependencyIds: ['task-1'],
        }),
        createExecutionTask('task-3', featureId, 'Third task', 'code_generation', {
          dependencyIds: ['task-2'],
        }),
        createExecutionTask('task-4', featureId, 'Fourth task', 'code_generation', {
          dependencyIds: ['task-3'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Phase 1: Execute first 2 tasks, then crash
      process.env.MOCK_BEHAVIOR = 'success';

      let taskCount = 0;
      const engine = createEngine();
      const originalExecute = engine.executeTask.bind(engine);
      engine.executeTask = async (task) => {
        taskCount++;
        const result = await originalExecute(task);
        if (taskCount === 2) {
          // Simulate crash after 2nd task
          await updateManifest(runDir, { status: 'in_progress' });
          await setLastStep(runDir, 'task-2');
          await setCurrentStep(runDir, 'task-3');
          engine.stop();
        }
        return result;
      };

      const firstResult = await engine.execute();
      expect(firstResult.completedTasks).toBe(2);

      // Phase 2: Verify crash state
      const analysis = await analyzeResumeState(runDir);
      expect(analysis.status).toBe('in_progress');
      expect(analysis.canResume).toBe(true);
      expect(analysis.queueState.completed).toBe(2);
      expect(analysis.queueState.pending).toBe(2);

      // Phase 3: Resume
      await prepareResume(runDir);

      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(2); // task-3 and task-4
      expect(resumeResult.failedTasks).toBe(0);

      // Phase 4: Verify exactly-once — all 4 tasks completed, none duplicated
      const queue = await loadQueue(runDir);
      expect(queue.get('task-1')?.status).toBe('completed');
      expect(queue.get('task-2')?.status).toBe('completed');
      expect(queue.get('task-3')?.status).toBe('completed');
      expect(queue.get('task-4')?.status).toBe('completed');
    });

    it('should handle crash before any task completes', async () => {
      const tasks = [
        createExecutionTask('task-a', featureId, 'Task A', 'code_generation'),
        createExecutionTask('task-b', featureId, 'Task B', 'code_generation', {
          dependencyIds: ['task-a'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Simulate crash state with no tasks completed
      await updateManifest(runDir, { status: 'in_progress' });

      const analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);
      expect(analysis.queueState.pending).toBe(2);
      expect(analysis.queueState.completed).toBe(0);

      // Resume should execute all tasks
      process.env.MOCK_BEHAVIOR = 'success';
      await prepareResume(runDir);

      const engine = createEngine();
      const result = await engine.execute();

      expect(result.completedTasks).toBe(2);

      const queue = await loadQueue(runDir);
      expect(queue.get('task-a')?.status).toBe('completed');
      expect(queue.get('task-b')?.status).toBe('completed');
    });
  });

  // ==========================================================================
  // Manifest / Queue Consistency
  // ==========================================================================

  describe('manifest and queue consistency after crash', () => {
    it('should maintain consistent manifest status during crash state', async () => {
      const tasks = [
        createExecutionTask('consist-1', featureId, 'Consistency test', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      // Set to in_progress (simulate mid-execution)
      await updateManifest(runDir, { status: 'in_progress' });

      // Manifest should reflect crash state
      const manifest = await readManifest(runDir);
      expect(manifest.status).toBe('in_progress');

      // Queue should show task still pending
      const queue = await loadQueue(runDir);
      expect(queue.get('consist-1')?.status).toBe('pending');
    });

    it('should preserve queue snapshot across crash boundary', async () => {
      const tasks = [
        createExecutionTask('snap-1', featureId, 'Snap task 1', 'code_generation'),
        createExecutionTask('snap-2', featureId, 'Snap task 2', 'code_generation'),
        createExecutionTask('snap-3', featureId, 'Snap task 3', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Simulate crash
      await updateManifest(runDir, { status: 'in_progress' });

      // Queue state should be recoverable
      const queue = await loadQueue(runDir);
      expect(queue.size).toBe(3);
      expect(queue.get('snap-1')).toBeDefined();
      expect(queue.get('snap-2')).toBeDefined();
      expect(queue.get('snap-3')).toBeDefined();
    });
  });

  // ==========================================================================
  // Failed task recovery on resume
  // ==========================================================================

  describe('failed task recovery', () => {
    it('should resume after a task failure and retry successfully', async () => {
      const tasks = [
        createExecutionTask('fail-task', featureId, 'Will fail then succeed', 'code_generation', {
          maxRetries: 3,
        }),
        createExecutionTask('next-task', featureId, 'After recovery', 'code_generation', {
          dependencyIds: ['fail-task'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      // First run: task fails
      process.env.MOCK_BEHAVIOR = 'failure';
      const firstEngine = createEngine({ max_retries: 0 });
      await firstEngine.execute();

      let queue = await loadQueue(runDir);
      expect(queue.get('fail-task')?.status).toBe('failed');

      // Reset failed task for retry
      await updateTaskInQueue(runDir, 'fail-task', { status: 'pending' });

      // Second run: task succeeds
      process.env.MOCK_BEHAVIOR = 'success';
      const resumeEngine = createEngine();
      const result = await resumeEngine.execute();

      expect(result.completedTasks).toBe(2);
      expect(result.failedTasks).toBe(0);

      queue = await loadQueue(runDir);
      expect(queue.get('fail-task')?.status).toBe('completed');
      expect(queue.get('next-task')?.status).toBe('completed');
    });
  });

  // ==========================================================================
  // Diamond dependency after crash
  // ==========================================================================

  describe('diamond dependency recovery', () => {
    it('should correctly handle diamond deps after crash at fork point', async () => {
      // Diamond:  A → B, A → C, B+C → D
      const tasks = [
        createExecutionTask('dia-a', featureId, 'Base', 'code_generation'),
        createExecutionTask('dia-b', featureId, 'Left fork', 'code_generation', {
          dependencyIds: ['dia-a'],
        }),
        createExecutionTask('dia-c', featureId, 'Right fork', 'code_generation', {
          dependencyIds: ['dia-a'],
        }),
        createExecutionTask('dia-d', featureId, 'Join', 'code_generation', {
          dependencyIds: ['dia-b', 'dia-c'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Execute only task A, then crash
      process.env.MOCK_BEHAVIOR = 'success';

      let taskCount = 0;
      const engine = createEngine();
      const originalExecute = engine.executeTask.bind(engine);
      engine.executeTask = async (task) => {
        taskCount++;
        const result = await originalExecute(task);
        if (taskCount === 1) {
          await updateManifest(runDir, { status: 'in_progress' });
          await setLastStep(runDir, 'dia-a');
          engine.stop();
        }
        return result;
      };

      await engine.execute();

      // Resume — should complete B, C, D respecting deps
      await prepareResume(runDir);

      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(3); // B, C, D

      const queue = await loadQueue(runDir);
      expect(queue.get('dia-a')?.status).toBe('completed');
      expect(queue.get('dia-b')?.status).toBe('completed');
      expect(queue.get('dia-c')?.status).toBe('completed');
      expect(queue.get('dia-d')?.status).toBe('completed');
    });
  });
});
