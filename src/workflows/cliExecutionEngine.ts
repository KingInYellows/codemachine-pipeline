import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ExecutionTask, canRetry } from '../core/models/ExecutionTask.js';
import { RepoConfig } from '../core/config/RepoConfig.js';
import { ExecutionStrategy, ExecutionContext } from './executionStrategy.js';
import { getNextTask, updateTaskInQueue, loadQueue } from './queueStore.js';
import { validateCliAvailability } from './codeMachineRunner.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { ExecutionLogWriter } from '../telemetry/logWriters.js';
import { ExecutionTaskType } from '../telemetry/executionMetrics.js';

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
    logger?.warn('Failed to create artifact directory', { error: err, taskId: task.task_id });
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
        error: err instanceof Error ? err.message : String(err),
        artifactPath,
        taskId: task.task_id,
      });
    }
  }

  return artifacts;
}

export interface ExecutionEngineOptions {
  runDir: string;
  config: RepoConfig;
  strategies: ExecutionStrategy[];
  dryRun?: boolean;
  logger?: StructuredLogger;
  logWriter?: ExecutionLogWriter;
}

export interface ExecutionResult {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  permanentlyFailedTasks: number;
  skippedTasks: number;
}

export interface PrerequisiteResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const DEFAULT_EXECUTION_CONFIG = {
  task_timeout_ms: 1800000,
  max_retries: 3,
  retry_backoff_ms: 5000,
  codemachine_cli_path: 'codemachine',
  default_engine: 'claude' as const,
  workspace_dir: undefined,
  log_rotation_mb: 100,
  log_rotation_keep: 3,
  log_rotation_compress: false,
};

export class CLIExecutionEngine {
  private readonly runDir: string;
  private readonly config: RepoConfig;
  private readonly strategies: ExecutionStrategy[];
  private readonly dryRun: boolean;
  private readonly logger: StructuredLogger | undefined;
  private readonly logWriter: ExecutionLogWriter | undefined;
  private stopped = false;

  constructor(options: ExecutionEngineOptions) {
    this.runDir = options.runDir;
    this.config = options.config;
    this.strategies = options.strategies;
    this.dryRun = options.dryRun ?? false;
    this.logger = options.logger;
    this.logWriter = options.logWriter;
  }

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

    this.logger?.info('Starting execution', { totalTasks: result.totalTasks });

    while (!this.stopped) {
      const task = await getNextTask(this.runDir);
      if (!task) {
        this.logger?.info('No more pending tasks');
        break;
      }

      try {
        const taskResult = await this.executeTask(task);

        if (taskResult.success) {
          result.completedTasks++;
        } else if (taskResult.permanentlyFailed) {
          result.permanentlyFailedTasks++;
          this.logger?.error('Task permanently failed', {
            taskId: task.task_id,
            retryCount: task.retry_count,
          });
        } else {
          result.failedTasks++;
        }
      } catch (error) {
        result.failedTasks++;
        this.logger?.error('Unexpected error executing task', {
          taskId: task.task_id,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.handleTaskError(task, error);
      }
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
      return { success: false, permanentlyFailed: true };
    }

    await updateTaskInQueue(this.runDir, task.task_id, { status: 'running' });
    this.logger?.info('Executing task', { taskId: task.task_id, strategy: strategy.name });
    this.logWriter?.taskStarted(task.task_id, toExecutionTaskType(task.task_type), {
      strategy: strategy.name,
    });
    const startTime = Date.now();

    if (this.dryRun) {
      this.logger?.info('Dry run - skipping actual execution', { taskId: task.task_id });
      await updateTaskInQueue(this.runDir, task.task_id, { status: 'completed' });
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

    if (strategyResult.success) {
      const durationMs = Date.now() - startTime;
      const artifacts = await captureArtifacts(
        this.runDir,
        task,
        context.workspaceDir,
        strategyResult.artifacts,
        this.logger
      );
      this.logWriter?.taskCompleted(task.task_id, toExecutionTaskType(task.task_type), durationMs, {
        strategy: strategy.name,
        summary: strategyResult.summary,
        artifactsCaptured: artifacts.length,
      });
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'completed',
        metadata: { summary: strategyResult.summary },
      });
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

    if (canRetryTask) {
      await this.applyRetryBackoff(updatedTask.retry_count);
      await updateTaskInQueue(this.runDir, task.task_id, {
        status: 'pending',
        retry_count: updatedTask.retry_count,
        last_error: updatedTask.last_error,
      });
      this.logger?.info('Task failed, will retry', {
        taskId: task.task_id,
        retryCount: updatedTask.retry_count,
      });
      return { success: false, permanentlyFailed: false };
    }

    await updateTaskInQueue(this.runDir, task.task_id, {
      status: 'failed',
      retry_count: updatedTask.retry_count,
      last_error: updatedTask.last_error,
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

  private async applyRetryBackoff(retryCount: number): Promise<void> {
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    const baseBackoffMs = executionConfig.retry_backoff_ms;
    const backoffMs = Math.min(baseBackoffMs * Math.pow(2, retryCount - 1), 60000);

    this.logger?.debug('Applying retry backoff', { retryCount, backoffMs });
    await sleep(backoffMs);
  }

  private async handleTaskError(task: ExecutionTask, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

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
