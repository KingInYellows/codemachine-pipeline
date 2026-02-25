import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ExecutionTask, canRetry } from '../core/models/ExecutionTask.js';
import { RepoConfig } from '../core/config/RepoConfig.js';
import {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy.js';
import { updateTaskInQueue, loadQueue } from './queueStore.js';
import { validateCliAvailability } from './codeMachineRunner.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { ExecutionLogWriter } from '../telemetry/logWriters.js';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry.js';
import { getErrorMessage } from '../utils/errors.js';
import { DEFAULT_EXECUTION_CONFIG } from '../core/config/RepoConfig.js';
import { getReadyTasks, applyRetryBackoff } from './executionDependencyResolver.js';
import { ExecutionTelemetryRecorder } from './executionTelemetryRecorder.js';
import { validateTaskId, captureArtifacts } from './executionArtifactCapture.js';

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

/** Outcome record produced by a single in-flight task promise. */
interface TaskOutcome {
  taskId: string;
  success: boolean;
  permanentlyFailed: boolean;
  task: ExecutionTask;
}

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
  private readonly telemetryRecorder: ExecutionTelemetryRecorder;
  private stopped = false;

  constructor(options: ExecutionEngineOptions) {
    this.runDir = options.runDir;
    this.config = options.config;
    this.strategies = options.strategies;
    this.dryRun = options.dryRun ?? false;
    this.logger = options.logger;
    this.logWriter = options.logWriter ?? options.telemetry?.logs;
    this.telemetryRecorder = new ExecutionTelemetryRecorder(
      options.config,
      options.telemetry,
      this.logWriter
    );
  }

  /**
   * Validate that all prerequisites for execution are met.
   */
  async validatePrerequisites(): Promise<PrerequisiteResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;

    const cliPath = executionConfig.codemachine_cli_path;
    const cliCheck = await validateCliAvailability(cliPath);
    if (!cliCheck.available) {
      const cliStrategyAvailable = this.strategies.some(
        (s) =>
          s.name === 'codemachine-cli' &&
          s.canHandle({ task_type: 'code_generation' } as ExecutionTask)
      );
      if (cliStrategyAvailable) {
        warnings.push(`Legacy CLI not found at '${cliPath}'; using codemachine-cli strategy`);
      } else {
        errors.push(
          `CodeMachine CLI not available at '${cliPath}': ${cliCheck.error ?? 'unknown error'}`
        );
      }
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

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Execute all pending tasks in the queue with bounded parallelism.
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

    this.logger?.info('Starting execution', { totalTasks: result.totalTasks, maxParallelTasks });

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
        return { taskId: task.task_id, success: false, permanentlyFailed: false, task };
      }
    };

    while (true) {
      if (!this.stopped) {
        const done = await this.fillTaskBatch(inFlight, maxParallelTasks, runTask);
        if (done) break;
      } else if (inFlight.size === 0) {
        break;
      }

      const completed = await Promise.race(inFlight.values());
      inFlight.delete(completed.taskId);
      this.recordTaskOutcome(result, completed);
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

  private async fillTaskBatch(
    inFlight: Map<string, Promise<TaskOutcome>>,
    maxParallelTasks: number,
    runTask: (task: ExecutionTask) => Promise<TaskOutcome>
  ): Promise<boolean> {
    const capacity = maxParallelTasks - inFlight.size;
    if (capacity <= 0) return false;

    const readyTasks = await getReadyTasks(this.runDir, new Set(inFlight.keys()), capacity);
    for (const task of readyTasks) {
      inFlight.set(task.task_id, runTask(task));
    }

    if (readyTasks.length === 0 && inFlight.size === 0) {
      this.logger?.info('No more pending tasks');
      return true;
    }
    return false;
  }

  private recordTaskOutcome(result: ExecutionResult, completed: TaskOutcome): void {
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

    const pending =
      result.totalTasks -
      result.completedTasks -
      result.failedTasks -
      result.permanentlyFailedTasks -
      result.skippedTasks;
    this.telemetryRecorder.recordQueueDepth(
      pending,
      result.completedTasks,
      result.failedTasks + result.permanentlyFailedTasks
    );
  }

  async executeTask(
    task: ExecutionTask
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
    if (!validateTaskId(task.task_id)) {
      this.logger?.warn('Invalid task ID format, rejecting task', { taskId: task.task_id });
      return { success: false, permanentlyFailed: true };
    }

    const strategy = this.findStrategy(task);
    if (!strategy) {
      return this.handleNoStrategy(task);
    }

    await updateTaskInQueue(this.runDir, task.task_id, { status: 'running' });
    this.logger?.info('Executing task', { taskId: task.task_id, strategy: strategy.name });
    this.telemetryRecorder.recordTaskStarted(task, strategy.name);
    const startTime = Date.now();

    if (this.dryRun) {
      return this.handleDryRun(task, strategy.name);
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
      return this.handleSuccess(task, strategy, strategyResult, context, durationMs);
    }

    return this.handleFailure(task, strategy, strategyResult, context, durationMs);
  }

  private async handleNoStrategy(
    task: ExecutionTask
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
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
    this.telemetryRecorder.recordNoStrategy(task);
    return { success: false, permanentlyFailed: true };
  }

  private async handleDryRun(
    task: ExecutionTask,
    strategyName: string
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
    this.logger?.info('Dry run - skipping actual execution', { taskId: task.task_id });
    await updateTaskInQueue(this.runDir, task.task_id, { status: 'completed' });
    this.telemetryRecorder.recordDryRun(task, strategyName);
    return { success: true, permanentlyFailed: false };
  }

  private async handleSuccess(
    task: ExecutionTask,
    strategy: ExecutionStrategy,
    strategyResult: ExecutionStrategyResult,
    context: ExecutionContext,
    durationMs: number
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
    const artifacts = await captureArtifacts(
      this.runDir,
      task,
      context.workspaceDir,
      strategyResult.artifacts,
      this.logger
    );
    this.telemetryRecorder.recordSuccess(task, strategy, strategyResult, durationMs, artifacts.length);
    await updateTaskInQueue(this.runDir, task.task_id, {
      status: 'completed',
      metadata: { summary: strategyResult.summary, artifacts },
    });
    return { success: true, permanentlyFailed: false };
  }

  private async handleFailure(
    task: ExecutionTask,
    strategy: ExecutionStrategy,
    strategyResult: ExecutionStrategyResult,
    context: ExecutionContext,
    durationMs: number
  ): Promise<{ success: boolean; permanentlyFailed: boolean }> {
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
    this.telemetryRecorder.recordFailure(
      task,
      strategy,
      strategyResult,
      durationMs,
      updatedTask.retry_count,
      canRetryTask
    );

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
      await applyRetryBackoff(updatedTask.retry_count, this.config, this.logger);
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'pending',
        retry_count: updatedTask.retry_count,
        last_error: updatedTask.last_error,
        metadata: { ...task.metadata, failureArtifacts },
      });
      this.logger?.info('Task failed, will retry', {
        taskId: task.task_id,
        retryCount: updatedTask.retry_count,
        artifactsCaptured: failureArtifacts.length,
      });
      return { success: false, permanentlyFailed: false };
    }

    await updateTaskInQueue(this.runDir, task.task_id, {
      status: 'failed',
      retry_count: updatedTask.retry_count,
      last_error: updatedTask.last_error,
      metadata: { ...task.metadata, failureArtifacts },
    });
    return { success: false, permanentlyFailed: true };
  }

  stop(): void {
    this.stopped = true;
    this.logger?.info('Execution stop requested');
  }

  private findStrategy(task: ExecutionTask): ExecutionStrategy | undefined {
    return this.strategies.find((s) => s.canHandle(task));
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
