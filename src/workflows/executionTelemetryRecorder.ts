import { ExecutionTask } from '../core/models/ExecutionTask.js';
import { ExecutionStrategy } from './executionStrategy.js';
import { ExecutionStrategyResult } from './executionStrategy.js';
import { ExecutionLogWriter } from '../telemetry/logWriters.js';
import {
  ExecutionTaskStatus,
  type CodeMachineExecutionStatus,
} from '../telemetry/executionMetrics.js';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry.js';
import { CODEMACHINE_STRATEGY_NAMES } from './codemachineTypes.js';
import { DEFAULT_EXECUTION_CONFIG } from '../core/config/RepoConfig.js';
import type { RepoConfig } from '../core/config/RepoConfig.js';

/**
 * Records telemetry (metrics + structured log events) for a single task's
 * execution lifecycle. All methods are fire-and-forget helpers so that the
 * execution engine stays focused on orchestration logic.
 */
export class ExecutionTelemetryRecorder {
  private readonly telemetry: ExecutionTelemetry | undefined;
  private readonly logWriter: ExecutionLogWriter | undefined;
  private readonly config: RepoConfig;

  constructor(
    config: RepoConfig,
    telemetry?: ExecutionTelemetry,
    logWriter?: ExecutionLogWriter
  ) {
    this.config = config;
    this.telemetry = telemetry;
    this.logWriter = logWriter;
  }

  recordTaskStarted(task: ExecutionTask, strategyName: string): void {
    this.logWriter?.taskStarted(task.task_id, task.task_type, { strategy: strategyName });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      task.task_type,
      ExecutionTaskStatus.STARTED
    );
  }

  recordNoStrategy(task: ExecutionTask): void {
    this.logWriter?.taskSkipped(task.task_id, task.task_type, 'no_strategy', {
      reason: 'No execution strategy available',
    });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      task.task_type,
      ExecutionTaskStatus.SKIPPED
    );
  }

  recordDryRun(task: ExecutionTask, strategyName: string): void {
    this.logWriter?.taskCompleted(task.task_id, task.task_type, 0, {
      strategy: strategyName,
      dry_run: true,
    });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      task.task_type,
      ExecutionTaskStatus.COMPLETED,
      0
    );
  }

  recordSuccess(
    task: ExecutionTask,
    strategy: ExecutionStrategy,
    strategyResult: ExecutionStrategyResult,
    durationMs: number,
    artifactsCaptured: number
  ): void {
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    if (CODEMACHINE_STRATEGY_NAMES.has(strategy.name)) {
      this.telemetry?.metrics?.recordCodeMachineExecution(
        executionConfig.default_engine,
        'success',
        durationMs
      );
    }
    this.logWriter?.taskCompleted(task.task_id, task.task_type, durationMs, {
      strategy: strategy.name,
      summary: strategyResult.summary,
      artifactsCaptured,
    });
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      task.task_type,
      ExecutionTaskStatus.COMPLETED,
      durationMs
    );
  }

  recordFailure(
    task: ExecutionTask,
    strategy: ExecutionStrategy,
    strategyResult: ExecutionStrategyResult,
    durationMs: number,
    retryCount: number,
    willRetry: boolean
  ): void {
    const executionConfig = this.config.execution ?? DEFAULT_EXECUTION_CONFIG;
    const cmStatus: CodeMachineExecutionStatus =
      strategyResult.status === 'timeout' ? 'timeout' : 'failure';
    if (CODEMACHINE_STRATEGY_NAMES.has(strategy.name)) {
      this.telemetry?.metrics?.recordCodeMachineExecution(
        executionConfig.default_engine,
        cmStatus,
        durationMs
      );
      if (willRetry) {
        this.telemetry?.metrics?.recordCodeMachineRetry(executionConfig.default_engine);
      }
    }
    this.logWriter?.taskFailed(
      task.task_id,
      task.task_type,
      new Error(strategyResult.errorMessage ?? 'Unknown error'),
      durationMs,
      {
        strategy: strategy.name,
        recoverable: strategyResult.recoverable,
        retryCount,
        willRetry,
      }
    );
    this.telemetry?.metrics?.recordTaskLifecycle(
      task.task_id,
      task.task_type,
      ExecutionTaskStatus.FAILED,
      durationMs
    );
  }

  recordQueueDepth(
    pending: number,
    completed: number,
    failed: number
  ): void {
    this.telemetry?.metrics?.setQueueDepth(pending, completed, failed);
  }
}
