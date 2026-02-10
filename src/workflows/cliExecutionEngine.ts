import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ExecutionTask, canRetry, areDependenciesCompleted } from '../core/models/ExecutionTask.js';
import { RepoConfig } from '../core/config/RepoConfig.js';
import { ExecutionStrategy, ExecutionContext } from './executionStrategy.js';
import { updateTaskInQueue, loadQueue } from './queueStore.js';
import { validateCliAvailability } from './codeMachineRunner.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { ExecutionLogWriter } from '../telemetry/logWriters.js';
import {
  ExecutionTaskStatus,
  ExecutionTaskType,
  type CodeMachineExecutionStatus,
} from '../telemetry/executionMetrics.js';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry.js';
import { getErrorMessage } from '../utils/errors.js';

type TaskTypeString = ExecutionTask['task_type'];

const TASK_TYPE_TO_ENUM: Record<string, ExecutionTaskType> = {
  code_generation: ExecutionTaskType.CODE_GENERATION,
  testing: ExecutionTaskType.TESTING,
  pr_creation: ExecutionTaskType.PR_CREATION,
  deployment: ExecutionTaskType.DEPLOYMENT,
  review: ExecutionTaskType.REVIEW,
  refactoring: ExecutionTaskType.REFACTORING,
  documentation: ExecutionTaskType.DOCUMENTATION,
  other: ExecutionTaskType.OTHER,
  validation: ExecutionTaskType.VALIDATION,
  patch_application: ExecutionTaskType.PATCH_APPLICATION,
  git_operation: ExecutionTaskType.GIT_OPERATION,
  custom: ExecutionTaskType.CUSTOM,
};

function toExecutionTaskType(taskType: TaskTypeString): ExecutionTaskType {
  return TASK_TYPE_TO_ENUM[taskType] ?? ExecutionTaskType.OTHER;
}

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateTaskId(taskId: string): boolean {
  if (!TASK_ID_PATTERN.test(taskId)) {
    return false;
  }
  if (taskId.includes('..')) {
    return false;
  }
  return true;
}

function isPathContained(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

async function captureArtifacts(
  runDir: string,
  task: ExecutionTask,
  workspaceDir: string,
  strategyArtifacts: string[],
  logger?: StructuredLogger
): Promise<string[]> {
  if (!validateTaskId(task.task_id)) {
    logger?.warn('Invalid task ID format, skipping artifact capture', { taskId: task.task_id });
    return [];
  }

  const artifactDir = path.join(runDir, 'artifacts', task.task_id);

  if (!isPathContained(runDir, artifactDir)) {
    logger?.error('Artifact directory escapes run directory', { artifactDir, runDir });
    return [];
  }

  try {
    await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger?.warn('Failed to create artifact directory', {
      error: getErrorMessage(err),
      taskId: task.task_id,
    });
    return [];
  }

  const artifacts: string[] = [];

  for (const artifactPath of strategyArtifacts) {
    try {
      const sourcePath = path.isAbsolute(artifactPath)
        ? artifactPath
        : path.join(workspaceDir, artifactPath);

      if (!isPathContained(workspaceDir, sourcePath)) {
        logger?.warn('Artifact path escapes workspace', { artifactPath, workspaceDir });
        continue;
      }

      const stats = await fs.stat(sourcePath).catch(() => null);
      if (!stats) {
        continue;
      }

      const artifactName = path.basename(artifactPath);
      const destPath = path.join(artifactDir, artifactName);

      if (!isPathContained(artifactDir, destPath)) {
        logger?.warn('Artifact destination escapes artifact directory', { destPath, artifactDir });
        continue;
      }

      await fs.copyFile(sourcePath, destPath);
      artifacts.push(artifactName);
    } catch (err) {
      logger?.warn('Artifact capture failed', {
        error: getErrorMessage(err),
        artifactPath,
        taskId: task.task_id,
      });
    }
  }

  return artifacts;
}

/**
 * Configuration options for constructing a {@link CLIExecutionEngine}.
 */
export interface ExecutionEngineOptions {
  runDir: string;
  config: RepoConfig;
  strategies: ExecutionStrategy[];
  dryRun?: boolean;
  logger?: StructuredLogger;
  logWriter?: ExecutionLogWriter;
  telemetry?: ExecutionTelemetry;
}

/**
 * Summary of an execution run, reporting task outcome counts.
 */
export interface ExecutionResult {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  permanentlyFailedTasks: number;
  skippedTasks: number;
}

/**
 * Result of a prerequisite validation check before execution can proceed.
 */
export interface PrerequisiteResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const DEFAULT_EXECUTION_CONFIG = {
  task_timeout_ms: 1800000,
  max_parallel_tasks: 1,
  max_retries: 3,
  retry_backoff_ms: 5000,
  codemachine_cli_path: 'codemachine',
  default_engine: 'claude' as const,
  workspace_dir: undefined,
  log_rotation_mb: 100,
  log_rotation_keep: 3,
  log_rotation_compress: false,
};

/**
 * CLI Execution Engine
 *
 * Orchestrates the execution of queued tasks by matching each task to a
 * registered {@link ExecutionStrategy}, executing with bounded parallelism,
 * and handling retries with exponential backoff.
 *
 * Algorithm (execute loop):
 * 1. Load the task queue from the run directory
 * 2. While capacity is available, select ready tasks (running > pending > retryable)
 * 3. Dispatch tasks up to `max_parallel_tasks` concurrently
 * 4. On completion, update counters and queue depth metrics
 * 5. On failure, apply exponential backoff and re-enqueue if retries remain
 *
 * Supports dry-run mode, graceful stop, artifact capture with path-traversal
 * protection, and telemetry/metrics integration.
 */
export class CLIExecutionEngine {
  private readonly runDir: string;
  private readonly config: RepoConfig;
  private readonly strategies: ExecutionStrategy[];
  private readonly dryRun: boolean;
  private readonly logger: StructuredLogger | undefined;
  private readonly logWriter: ExecutionLogWriter | undefined;
  private readonly telemetry: ExecutionTelemetry | undefined;
  private stopped = false;

  /**
   * Create a new CLIExecutionEngine.
   *
   * @param options - Engine configuration including runDir, RepoConfig, strategies, and optional logger/telemetry
   */
  constructor(options: ExecutionEngineOptions) {
    this.runDir = options.runDir;
    this.config = options.config;
    this.strategies = options.strategies;
    this.dryRun = options.dryRun ?? false;
    this.logger = options.logger;
    this.telemetry = options.telemetry;
    this.logWriter = options.logWriter ?? options.telemetry?.logs;
  }

  /**
   * Validate that all prerequisites for execution are met.
   *
   * Checks CLI availability, workspace directory existence, strategy
   * registration, and queue loadability. Errors are fatal blockers;
   * warnings are informational (e.g., empty queue or no strategies).
   *
   * @returns A {@link PrerequisiteResult} with `valid`, `errors`, and `warnings`
   */
  async validatePrerequisites(): Promise<PrerequisiteResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;

    const cliPath = executionConfig.codemachine_cli_path;
    const cliCheck = await validateCliAvailability(cliPath);
    if (!cliCheck.available) {
      errors.push(
        `CodeMachine CLI not available at '${cliPath}': ${cliCheck.error ?? 'unknown error'}`
      );
    }

    const workspaceDir = executionConfig.workspace_dir || this.runDir;
    try {
      const stats = await fs.stat(workspaceDir);
      if (!stats.isDirectory()) {
        errors.push(`Workspace path is not a directory: ${workspaceDir}`);
      }
    } catch {
      errors.push(`Workspace directory does not exist: ${workspaceDir}`);
    }

    if (this.strategies.length === 0) {
      warnings.push('No execution strategies registered');
    }

    try {
      const queue = await loadQueue(this.runDir);
      if (queue.size === 0) {
        warnings.push('Queue is empty - no tasks to execute');
      }
    } catch {
      errors.push('Failed to load execution queue');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute all pending tasks in the queue with bounded parallelism.
   *
   * Tasks are selected in priority order: running (resumed) > pending > retryable.
   * Up to `max_parallel_tasks` run concurrently via `Promise.race`. Each completed
   * task updates the result counters and queue depth metrics. The loop exits when
   * no tasks remain or {@link stop} has been called and in-flight tasks drain.
   *
   * @returns An {@link ExecutionResult} summarizing task outcomes
   */
  async execute(): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      permanentlyFailedTasks: 0,
      skippedTasks: 0,
    };

    const queue = await loadQueue(this.runDir);
    result.totalTasks = queue.size;

    if (result.totalTasks === 0) {
      this.logger?.info('No tasks in queue');
      return result;
    }

    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    const maxParallelTasks = Math.max(1, executionConfig.max_parallel_tasks ?? 1);

    this.logger?.info('Starting execution', {
      totalTasks: result.totalTasks,
      maxParallelTasks,
    });

    type TaskOutcome = {
      taskId: string;
      success: boolean;
      permanentlyFailed: boolean;
      task: ExecutionTask;
    };

    const inFlight = new Map<string, Promise<TaskOutcome>>();

    const runTask = async (task: ExecutionTask): Promise<TaskOutcome> => {
      try {
        const taskResult = await this.executeTask(task);
        return {
          taskId: task.task_id,
          success: taskResult.success,
          permanentlyFailed: taskResult.permanentlyFailed,
          task,
        };
      } catch (error) {
        await this.handleTaskError(task, error);
        this.logger?.error('Unexpected error executing task', {
          taskId: task.task_id,
          error: getErrorMessage(error),
        });
        return {
          taskId: task.task_id,
          success: false,
          permanentlyFailed: false,
          task,
        };
      }
    };

    while (true) {
      if (!this.stopped) {
        const capacity = maxParallelTasks - inFlight.size;
        if (capacity > 0) {
          const readyTasks = await this.getReadyTasks(new Set(inFlight.keys()), capacity);
          for (const task of readyTasks) {
            inFlight.set(task.task_id, runTask(task));
          }

          if (readyTasks.length === 0 && inFlight.size === 0) {
            this.logger?.info('No more pending tasks');
            break;
          }
        }
      } else if (inFlight.size === 0) {
        break;
      }

      if (inFlight.size === 0) {
        continue;
      }

      const completed = await Promise.race(inFlight.values());
      inFlight.delete(completed.taskId);

      if (completed.success) {
        result.completedTasks++;
      } else if (completed.permanentlyFailed) {
        result.permanentlyFailedTasks++;
        this.logger?.error('Task permanently failed', {
          taskId: completed.taskId,
          retryCount: completed.task.retry_count,
        });
      } else {
        result.failedTasks++;
      }

      // Update queue depth metrics after each task completion
      const pending =
        result.totalTasks -
        result.completedTasks -
        result.failedTasks -
        result.permanentlyFailedTasks -
        result.skippedTasks;
      this.telemetry?.metrics?.setQueueDepth(
        pending,
        result.completedTasks,
        result.failedTasks + result.permanentlyFailedTasks
      );
    }

    this.logger?.info('Execution complete', {
      totalTasks: result.totalTasks,
      completedTasks: result.completedTasks,
      failedTasks: result.failedTasks,
      permanentlyFailedTasks: result.permanentlyFailedTasks,
      skippedTasks: result.skippedTasks,
    });
    return result;
  }

  /**
   * Execute a single task using the first matching strategy.
   *
   * Algorithm:
   * 1. Find a strategy that can handle the task type
   * 2. If no strategy matches, mark the task as skipped (permanently failed)
   * 3. In dry-run mode, mark the task as completed without actual execution
   * 4. Otherwise, delegate to the strategy and process the result
   * 5. On failure, apply retry backoff and re-enqueue if retries remain
   * 6. Capture artifacts (success or failure) with path-traversal protection
   *
   * @param task - The execution task to run
   * @returns An object with `success` and `permanentlyFailed` flags
   */
  async executeTask(
    task: ExecutionTask
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
    const strategy = this.findStrategy(task);

    if (!strategy) {
      this.logger?.warn('No strategy found for task', {
        taskId: task.task_id,
        taskType: task.task_type,
      });
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'skipped',
        last_error: {
          message: 'No execution strategy available',
          timestamp: new Date().toISOString(),
          recoverable: false,
        },
      });
      this.logWriter?.taskSkipped(
        task.task_id,
        toExecutionTaskType(task.task_type),
        'no_strategy',
        { reason: 'No execution strategy available' }
      );
      this.telemetry?.metrics?.recordTaskLifecycle(
        task.task_id,
        toExecutionTaskType(task.task_type),
        ExecutionTaskStatus.SKIPPED
      );
      return { success: false, permanentlyFailed: true };
    }

    await updateTaskInQueue(this.runDir, task.task_id, { status: 'running' });
    this.logger?.info('Executing task', { taskId: task.task_id, strategy: strategy.name });
    this.logWriter?.taskStarted(task.task_id, toExecutionTaskType(task.task_type), {
      strategy: strategy.name,
    });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      toExecutionTaskType(task.task_type),
      ExecutionTaskStatus.STARTED
    );
    const startTime = Date.now();

    if (this.dryRun) {
      this.logger?.info('Dry run - skipping actual execution', { taskId: task.task_id });
      await updateTaskInQueue(this.runDir, task.task_id, { status: 'completed' });
      this.logWriter?.taskCompleted(task.task_id, toExecutionTaskType(task.task_type), 0, {
        strategy: strategy.name,
        dry_run: true,
      });
      this.telemetry?.metrics?.recordTaskLifecycle(
        task.task_id,
        toExecutionTaskType(task.task_type),
        ExecutionTaskStatus.COMPLETED,
        0
      );
      return { success: true, permanentlyFailed: false };
    }

    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    const context: ExecutionContext = {
      runDir: this.runDir,
      workspaceDir: executionConfig.workspace_dir || this.runDir,
      logPath: path.join(this.runDir, 'logs', `${task.task_id}.log`),
      timeoutMs: executionConfig.task_timeout_ms,
    };

    await fs.mkdir(path.dirname(context.logPath), { recursive: true });

    const strategyResult = await strategy.execute(task, context);
    const durationMs = strategyResult.durationMs ?? Date.now() - startTime;

    if (strategyResult.success) {
      const artifacts = await captureArtifacts(
        this.runDir,
        task,
        context.workspaceDir,
        strategyResult.artifacts,
        this.logger
      );
      if (strategy.name === 'codemachine') {
        const engine = executionConfig.default_engine;
        this.telemetry?.metrics?.recordCodeMachineExecution(engine, 'success', durationMs);
      }
      this.logWriter?.taskCompleted(task.task_id, toExecutionTaskType(task.task_type), durationMs, {
        strategy: strategy.name,
        summary: strategyResult.summary,
        artifactsCaptured: artifacts.length,
      });
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'completed',
        metadata: { summary: strategyResult.summary, artifacts },
      });
      this.telemetry?.metrics?.recordTaskLifecycle(
        task.task_id,
        toExecutionTaskType(task.task_type),
        ExecutionTaskStatus.COMPLETED,
        durationMs
      );
      return { success: true, permanentlyFailed: false };
    }

    const updatedTask: ExecutionTask = {
      ...task,
      status: 'failed',
      retry_count: task.retry_count + 1,
      last_error: {
        message: strategyResult.errorMessage ?? 'Unknown error',
        timestamp: new Date().toISOString(),
        recoverable: strategyResult.recoverable,
      },
    };

    const canRetryTask = canRetry(updatedTask);
    const status: CodeMachineExecutionStatus =
      strategyResult.status === 'timeout' ? 'timeout' : 'failure';
    if (strategy.name === 'codemachine') {
      const engine = executionConfig.default_engine;
      this.telemetry?.metrics?.recordCodeMachineExecution(engine, status, durationMs);
      if (canRetryTask) {
        this.telemetry?.metrics?.recordCodeMachineRetry(engine);
      }
    }
    this.logWriter?.taskFailed(
      task.task_id,
      toExecutionTaskType(task.task_type),
      new Error(strategyResult.errorMessage ?? 'Unknown error'),
      durationMs,
      {
        strategy: strategy.name,
        recoverable: strategyResult.recoverable,
        retryCount: updatedTask.retry_count,
        willRetry: canRetryTask,
      }
    );

    // Capture failure artifacts for debugging
    let failureArtifacts: string[] = [];
    try {
      failureArtifacts = await captureArtifacts(
        this.runDir,
        task,
        context.workspaceDir,
        strategyResult.artifacts ?? [],
        this.logger
      );
    } catch (err) {
      this.logger?.warn('Failed to capture failure artifacts', {
        error: getErrorMessage(err),
        taskId: task.task_id,
      });
    }

    if (canRetryTask) {
      await this.applyRetryBackoff(updatedTask.retry_count);
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'pending',
        retry_count: updatedTask.retry_count,
        last_error: updatedTask.last_error,
        metadata: {
          ...task.metadata,
          failureArtifacts,
        },
      });
      this.logger?.info('Task failed, will retry', {
        taskId: task.task_id,
        retryCount: updatedTask.retry_count,
        artifactsCaptured: failureArtifacts.length,
      });
      this.telemetry?.metrics?.recordTaskLifecycle(
        task.task_id,
        toExecutionTaskType(task.task_type),
        ExecutionTaskStatus.FAILED,
        durationMs
      );
      return { success: false, permanentlyFailed: false };
    }

    await updateTaskInQueue(this.runDir, task.task_id, {
      status: 'failed',
      retry_count: updatedTask.retry_count,
      last_error: updatedTask.last_error,
      metadata: {
        ...task.metadata,
        failureArtifacts,
      },
    });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      toExecutionTaskType(task.task_type),
      ExecutionTaskStatus.FAILED,
      durationMs
    );

    return { success: false, permanentlyFailed: true };
  }

  /**
   * Request a graceful stop of the execution loop.
   *
   * In-flight tasks will be allowed to complete, but no new tasks will be
   * dispatched. The {@link execute} method will return once all in-flight
   * tasks have finished.
   */
  stop(): void {
    this.stopped = true;
    this.logger?.info('Execution stop requested');
  }

  private async getReadyTasks(inFlight: Set<string>, limit: number): Promise<ExecutionTask[]> {
    const tasks = await loadQueue(this.runDir);
    const ready: ExecutionTask[] = [];
    const seen = new Set<string>();

    const consider = (task: ExecutionTask): void => {
      if (ready.length >= limit) {
        return;
      }
      if (inFlight.has(task.task_id) || seen.has(task.task_id)) {
        return;
      }
      if (!areDependenciesCompleted(task, tasks)) {
        return;
      }
      ready.push(task);
      seen.add(task.task_id);
    };

    for (const task of tasks.values()) {
      if (task.status === 'running') {
        consider(task);
      }
    }

    for (const task of tasks.values()) {
      if (task.status === 'pending') {
        consider(task);
      }
    }

    for (const task of tasks.values()) {
      if (canRetry(task)) {
        consider(task);
      }
    }

    return ready;
  }

  private findStrategy(task: ExecutionTask): ExecutionStrategy | undefined {
    return this.strategies.find((s) => s.canHandle(task));
  }

  private async applyRetryBackoff(retryCount: number): Promise<void> {
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    const baseBackoffMs = executionConfig.retry_backoff_ms;
    const backoffMs = Math.min(baseBackoffMs * Math.pow(2, retryCount - 1), 60000);

    this.logger?.debug('Applying retry backoff', { retryCount, backoffMs });
    await sleep(backoffMs);
  }

  private async handleTaskError(task: ExecutionTask, error: unknown): Promise<void> {
    const errorMessage = getErrorMessage(error);

    await updateTaskInQueue(this.runDir, task.task_id, {
      status: 'failed',
      retry_count: task.retry_count + 1,
      last_error: {
        message: errorMessage,
        timestamp: new Date().toISOString(),
        recoverable: true,
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
