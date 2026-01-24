import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CLIExecutionEngine } from '../../src/workflows/cliExecutionEngine';
import { CodeMachineStrategy } from '../../src/workflows/codeMachineStrategy';
import { createRunDirectory, updateManifest, setCurrentStep, setLastStep } from '../../src/persistence/runDirectoryManager';
import {
  initializeQueue,
  appendToQueue,
  loadQueue,
  updateTaskInQueue,
  createQueueSnapshot,
} from '../../src/workflows/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { analyzeResumeState, prepareResume } from '../../src/workflows/resumeCoordinator';
import { RepoConfig } from '../../src/core/config/RepoConfig';
import { ExecutionLogWriter } from '../../src/telemetry/logWriters';
import { ExecutionTaskType } from '../../src/telemetry/executionMetrics';

const MOCK_CLI_PATH = path.resolve(__dirname, '../fixtures/mock-cli/codemachine');

/**
 * CLIExecutionEngine Resume Flow E2E Tests
 *
 * These tests combine:
 * 1. Real CLIExecutionEngine execution with mock CLI
 * 2. Crash simulation (interrupt mid-execution)
 * 3. Resume coordinator (restore and resume)
 * 4. Full verification (tasks complete correctly)
 */
describe('CLIExecutionEngine Resume Flow E2E', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;
  let baseConfig: RepoConfig;

  beforeEach(async () => {
    featureId = `resume-e2e-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-e2e-'));
    pipelineDir = path.join(workspaceDir, '.ai-feature-pipeline');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });

    // Create base config with mock CLI
    baseConfig = {
      schema_version: '1.0',
      platform: 'github',
      provider: {
        type: 'github',
        base_url: 'https://api.github.com',
      },
      repository: {
        owner: 'test',
        repo: 'resume-e2e-repo',
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
      repoUrl: 'https://github.com/test/resume-e2e-repo.git',
      defaultBranch: 'main',
      title: 'Resume E2E Test',
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

    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create CLIExecutionEngine with CodeMachineStrategy
   */
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

  describe('Resume after crash with pending tasks', () => {
    it('should resume after crash with pending tasks', async () => {
      // Step 1: Set up task queue with dependencies
      const tasks = [
        createExecutionTask('task-1', featureId, 'First task', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Second task', 'code_generation', {
          dependencyIds: ['task-1'],
        }),
        createExecutionTask('task-3', featureId, 'Third task', 'code_generation', {
          dependencyIds: ['task-2'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Step 2: Simulate partial execution - complete first task
      process.env.MOCK_BEHAVIOR = 'success';

      let taskCount = 0;
      const engine = createEngine();

      // Override engine to stop after first task
      const originalExecute = engine.executeTask.bind(engine);
      engine.executeTask = async (task) => {
        taskCount++;
        const result = await originalExecute(task);
        if (taskCount === 1) {
          // Simulate crash after first task
          await updateManifest(runDir, { status: 'in_progress' });
          await setLastStep(runDir, 'task-1');
          await setCurrentStep(runDir, 'task-2');
          engine.stop(); // Stop execution
        }
        return result;
      };

      const firstResult = await engine.execute();

      expect(firstResult.completedTasks).toBe(1);

      // Step 3: Verify crash state
      const analysis = await analyzeResumeState(runDir);
      expect(analysis.status).toBe('in_progress');
      expect(analysis.lastStep).toBe('task-1');
      expect(analysis.currentStep).toBe('task-2');
      expect(analysis.queueState.completed).toBe(1);
      expect(analysis.queueState.pending).toBe(2);
      expect(analysis.canResume).toBe(true);

      // Step 4: Prepare resume
      await prepareResume(runDir);

      // Step 5: Resume execution
      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(2); // task-2 and task-3
      expect(resumeResult.failedTasks).toBe(0);

      // Step 6: Verify all tasks completed
      const queue = await loadQueue(runDir);
      expect(queue.get('task-1')?.status).toBe('completed');
      expect(queue.get('task-2')?.status).toBe('completed');
      expect(queue.get('task-3')?.status).toBe('completed');
    });

    it('should retry failed tasks on resume', async () => {
      // Step 1: Create task that will fail initially
      const tasks = [
        createExecutionTask('retry-task', featureId, 'Retry test', 'code_generation', {
          maxRetries: 3,
        }),
      ];
      await appendToQueue(runDir, tasks);

      // Step 2: First run - task fails
      process.env.MOCK_BEHAVIOR = 'failure';

      const firstEngine = createEngine({ max_retries: 0 }); // No automatic retries
      await firstEngine.execute();

      // Verify task failed
      let queue = await loadQueue(runDir);
      expect(queue.get('retry-task')?.status).toBe('failed');
      expect(queue.get('retry-task')?.retry_count).toBeGreaterThan(0);

      // Step 3: Reset task for retry on resume
      await updateTaskInQueue(runDir, 'retry-task', {
        status: 'pending',
      });

      // Step 4: Resume with success behavior
      process.env.MOCK_BEHAVIOR = 'success';

      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(1);

      // Verify task completed on retry
      queue = await loadQueue(runDir);
      expect(queue.get('retry-task')?.status).toBe('completed');
    });
  });

  describe('Preserve completed task results', () => {
    it('should preserve completed task results', async () => {
      // Step 1: Create tasks with artifacts
      const tasks = [
        createExecutionTask('gen-prd', featureId, 'Generate PRD', 'documentation'),
        createExecutionTask('gen-spec', featureId, 'Generate Spec', 'documentation', {
          dependencyIds: ['gen-prd'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      // Step 2: Execute first task and create artifacts
      process.env.MOCK_BEHAVIOR = 'success';
      process.env.MOCK_STDOUT = 'Generated PRD artifact\nGenerated: prd.md';

      // Create artifact file
      await fs.writeFile(path.join(runDir, 'prd.md'), '# PRD Content', 'utf-8');

      const engine = createEngine();

      // Execute first task only
      const task1 = tasks[0];
      await engine.executeTask(task1);

      // Step 3: Verify artifact was captured
      const artifactDir = path.join(runDir, 'artifacts', 'gen-prd');
      const artifactExists = await fs
        .stat(artifactDir)
        .then(() => true)
        .catch(() => false);
      expect(artifactExists).toBe(true);

      // Step 4: Simulate crash
      await updateManifest(runDir, { status: 'in_progress' });
      await setLastStep(runDir, 'gen-prd');

      // Step 5: Resume and complete second task
      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(1); // Only gen-spec

      // Step 6: Verify first task artifacts still exist
      const artifactStillExists = await fs
        .stat(artifactDir)
        .then(() => true)
        .catch(() => false);
      expect(artifactStillExists).toBe(true);
    });
  });

  describe('Handle dependency ordering on resume', () => {
    it('should handle dependency ordering on resume', async () => {
      // Create diamond dependency:
      //   task-1 (base)
      //   ├─> task-2
      //   └─> task-3
      //       └─> task-4 (depends on both task-2 and task-3)
      const tasks = [
        createExecutionTask('task-1', featureId, 'Base', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Branch A', 'code_generation', {
          dependencyIds: ['task-1'],
        }),
        createExecutionTask('task-3', featureId, 'Branch B', 'code_generation', {
          dependencyIds: ['task-1'],
        }),
        createExecutionTask('task-4', featureId, 'Merge', 'code_generation', {
          dependencyIds: ['task-2', 'task-3'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      // Complete task-1 and task-2
      process.env.MOCK_BEHAVIOR = 'success';

      await updateTaskInQueue(runDir, 'task-1', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await updateTaskInQueue(runDir, 'task-2', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });

      // Simulate crash before task-3
      await updateManifest(runDir, { status: 'in_progress' });
      await setLastStep(runDir, 'task-2');

      // Resume
      const resumeEngine = createEngine();
      const resumeResult = await resumeEngine.execute();

      expect(resumeResult.completedTasks).toBe(2); // task-3 and task-4

      // Verify execution order
      const queue = await loadQueue(runDir);
      const task3 = queue.get('task-3');
      const task4 = queue.get('task-4');

      expect(task3?.status).toBe('completed');
      expect(task4?.status).toBe('completed');

      // task-4 should complete after task-3
      if (task3?.completed_at && task4?.completed_at) {
        expect(new Date(task4.completed_at).getTime()).toBeGreaterThanOrEqual(
          new Date(task3.completed_at).getTime()
        );
      }
    });
  });

  describe('Detect corrupted queue and halt safely', () => {
    it('should detect corrupted queue and halt safely', async () => {
      // Step 1: Create valid queue
      const tasks = [
        createExecutionTask('task-1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Task 2', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      // Step 2: Corrupt queue file
      const queuePath = path.join(runDir, 'queue', 'queue.jsonl');
      await fs.appendFile(queuePath, '\n{corrupted json}\n', 'utf-8');

      // Step 3: Attempt resume
      const analysis = await analyzeResumeState(runDir);

      expect(analysis.canResume).toBe(false);
      expect(analysis.queueValidation?.valid).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_CORRUPTED',
          severity: 'blocker',
        })
      );

      // Step 4: Verify resume is blocked
      await expect(prepareResume(runDir)).rejects.toThrow(/Cannot resume/);
    });
  });

  describe('Respect parallel execution limits', () => {
    it('should respect parallel execution limits', async () => {
      // Create 5 independent tasks
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createExecutionTask(`task-${i}`, featureId, `Task ${i}`, 'code_generation')
      );
      await appendToQueue(runDir, tasks);

      process.env.MOCK_BEHAVIOR = 'success';

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      // Track concurrent executions
      const configWithParallel: Partial<RepoConfig['execution']> = {
        max_parallel_tasks: 2,
      };

      const engine = createEngine(configWithParallel);

      // Spy on executeTask to track concurrency
      const originalExecute = engine.executeTask.bind(engine);
      engine.executeTask = async (task) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate work
        const result = await originalExecute(task);
        currentConcurrent--;
        return result;
      };

      await engine.execute();

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('Capture artifacts correctly after resume', () => {
    it('should capture artifacts correctly after resume', async () => {
      const tasks = [
        createExecutionTask('pre-crash', featureId, 'Pre-crash task', 'code_generation'),
        createExecutionTask('post-crash', featureId, 'Post-crash task', 'documentation'),
      ];
      await appendToQueue(runDir, tasks);

      // Execute first task
      process.env.MOCK_BEHAVIOR = 'success';
      await fs.writeFile(path.join(runDir, 'artifact1.txt'), 'First artifact', 'utf-8');

      const engine = createEngine();
      await engine.executeTask(tasks[0]);

      // Verify first artifact captured
      const artifact1Dir = path.join(runDir, 'artifacts', 'pre-crash');
      expect(await fs.stat(artifact1Dir).then(() => true).catch(() => false)).toBe(true);

      // Simulate crash
      await updateManifest(runDir, { status: 'in_progress' });
      await setLastStep(runDir, 'pre-crash');

      // Resume and execute second task
      await fs.writeFile(path.join(runDir, 'artifact2.txt'), 'Second artifact', 'utf-8');

      const resumeEngine = createEngine();
      await resumeEngine.execute();

      // Verify second artifact captured
      const artifact2Dir = path.join(runDir, 'artifacts', 'post-crash');
      expect(await fs.stat(artifact2Dir).then(() => true).catch(() => false)).toBe(true);
    });
  });

  describe('Emit telemetry events correctly after resume', () => {
    it('should emit telemetry events correctly after resume', async () => {
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
        child: vi.fn(),
      };
      mockLogger.child.mockImplementation(() => mockLogger);

      const logWriter = new ExecutionLogWriter(mockLogger as never, {
        runDir,
        runId: featureId,
      });

      const taskStartedSpy = vi.spyOn(logWriter, 'taskStarted');
      const taskCompletedSpy = vi.spyOn(logWriter, 'taskCompleted');

      const tasks = [
        createExecutionTask('telemetry-1', featureId, 'First', 'code_generation'),
        createExecutionTask('telemetry-2', featureId, 'Second', 'code_generation'),
      ];
      await appendToQueue(runDir, tasks);

      process.env.MOCK_BEHAVIOR = 'success';

      // First execution - complete one task
      const config: RepoConfig = {
        ...baseConfig,
        execution: baseConfig.execution,
      };
      const strategy = new CodeMachineStrategy({ config: config.execution });

      const engine = new CLIExecutionEngine({
        runDir,
        config,
        strategies: [strategy],
        logWriter,
      });

      await engine.executeTask(tasks[0]);

      // Crash
      await updateManifest(runDir, { status: 'in_progress' });
      await setLastStep(runDir, 'telemetry-1');

      // Resume
      const resumeEngine = new CLIExecutionEngine({
        runDir,
        config,
        strategies: [strategy],
        logWriter,
      });

      await resumeEngine.execute();

      // Verify events for both runs
      expect(taskStartedSpy).toHaveBeenCalledWith(
        'telemetry-1',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Object)
      );
      expect(taskCompletedSpy).toHaveBeenCalledWith(
        'telemetry-1',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Number),
        expect.any(Object)
      );

      expect(taskStartedSpy).toHaveBeenCalledWith(
        'telemetry-2',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Object)
      );
      expect(taskCompletedSpy).toHaveBeenCalledWith(
        'telemetry-2',
        ExecutionTaskType.CODE_GENERATION,
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('Test both successful resume and error conditions', () => {
    it('should handle successful complete resume cycle', async () => {
      // Create complete workflow
      const tasks = [
        createExecutionTask('prd', featureId, 'PRD', 'code_generation'),
        createExecutionTask('spec', featureId, 'Spec', 'code_generation', {
          dependencyIds: ['prd'],
        }),
        createExecutionTask('impl', featureId, 'Implementation', 'code_generation', {
          dependencyIds: ['spec'],
        }),
        createExecutionTask('test', featureId, 'Testing', 'code_generation', {
          dependencyIds: ['impl'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      process.env.MOCK_BEHAVIOR = 'success';

      // First run - complete first 2 tasks
      await updateTaskInQueue(runDir, 'prd', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await updateTaskInQueue(runDir, 'spec', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'spec');
      await updateManifest(runDir, { status: 'in_progress' });

      // Analyze state
      const analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);
      expect(analysis.queueState.completed).toBe(2);
      expect(analysis.queueState.pending).toBe(2);

      // Prepare and resume
      await prepareResume(runDir);

      const resumeEngine = createEngine();
      const result = await resumeEngine.execute();

      expect(result.completedTasks).toBe(2); // impl and test
      expect(result.failedTasks).toBe(0);

      // Verify final state
      const queue = await loadQueue(runDir);
      expect(queue.get('prd')?.status).toBe('completed');
      expect(queue.get('spec')?.status).toBe('completed');
      expect(queue.get('impl')?.status).toBe('completed');
      expect(queue.get('test')?.status).toBe('completed');
    });

    it('should handle resume with partial failures', async () => {
      const tasks = [
        createExecutionTask('task-ok', featureId, 'Success', 'code_generation'),
        createExecutionTask('task-fail', featureId, 'Will Fail', 'code_generation', {
          maxRetries: 1,
        }),
        createExecutionTask('task-blocked', featureId, 'Blocked', 'testing', {
          dependencyIds: ['task-fail'],
        }),
      ];
      await appendToQueue(runDir, tasks);

      // Complete first task
      await updateTaskInQueue(runDir, 'task-ok', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'task-ok');
      await updateManifest(runDir, { status: 'in_progress' });

      // Resume - second task will fail
      process.env.MOCK_BEHAVIOR = 'failure';

      const resumeEngine = createEngine({ max_retries: 1 });
      const result = await resumeEngine.execute();

      expect(result.completedTasks).toBe(0);
      expect(result.permanentlyFailedTasks).toBeGreaterThan(0);

      // Verify blocked task never executed
      const queue = await loadQueue(runDir);
      expect(queue.get('task-ok')?.status).toBe('completed');
      expect(queue.get('task-fail')?.status).toBe('failed');
      expect(queue.get('task-blocked')?.status).toBe('pending'); // Blocked by failed dependency
    });
  });
});
