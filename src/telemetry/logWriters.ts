/**
 * Execution Log Writers
 *
 * Provides specialized log writer helpers for execution engine events,
 * ensuring consistent message formatting and structured context fields
 * across all execution lifecycle events.
 *
 * Key features:
 * - Typed methods for task lifecycle events
 * - Diff generation logging with patch IDs and statistics
 * - Validation result logging with error details
 * - Queue state change logging
 * - Consistent context field naming
 *
 * Implements Observability Rulebook log schema requirements.
 */

import { LogLevel, type StructuredLogger } from './logger';
import type { DiffStats, ValidationResult, ExecutionTaskType } from './executionMetrics';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Execution log writer options
 */
export interface ExecutionLogWriterOptions {
  /** Run directory path */
  runDir: string;
  /** Run ID (feature_id) */
  runId: string;
}

/**
 * Context fields for task events
 */
export interface TaskContext {
  /** Task ID */
  task_id: string;
  /** Execution task type */
  execution_task_type: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Context fields for diff events
 */
export interface DiffContext extends TaskContext {
  /** Patch ID for correlation */
  patch_id?: string;
  /** Diff statistics */
  diff_stats?: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
}

/**
 * Context fields for validation events
 */
export interface ValidationContext extends TaskContext {
  /** Validation duration in milliseconds */
  validation_duration_ms: number;
  /** Validation passed */
  passed: boolean;
  /** Error count */
  error_count?: number;
  /** Error types */
  error_types?: string[];
}

// ============================================================================
// Execution Log Writer
// ============================================================================

/**
 * Specialized log writer for execution engine events
 */
export class ExecutionLogWriter {
  private readonly logger: StructuredLogger;

  constructor(logger: StructuredLogger, _options: ExecutionLogWriterOptions) {
    this.logger = logger;
  }

  /**
   * Log task started event
   */
  taskStarted(taskId: string, taskType: ExecutionTaskType, additionalContext?: Record<string, unknown>): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: taskType,
      ...additionalContext,
    };

    this.logger.info(`Execution task started: ${taskId}`, context);
  }

  /**
   * Log task completed event
   */
  taskCompleted(
    taskId: string,
    taskType: ExecutionTaskType,
    durationMs: number,
    additionalContext?: Record<string, unknown>
  ): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: taskType,
      duration_ms: durationMs,
      ...additionalContext,
    };

    this.logger.info(`Execution task completed: ${taskId} (${durationMs}ms)`, context);
  }

  /**
   * Log task failed event
   */
  taskFailed(
    taskId: string,
    taskType: ExecutionTaskType,
    error: Error,
    durationMs?: number,
    additionalContext?: Record<string, unknown>
  ): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: taskType,
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...additionalContext,
    };

    this.logger.logError(LogLevel.ERROR, `Execution task failed: ${taskId}`, error, context);
  }

  /**
   * Log task skipped event
   */
  taskSkipped(taskId: string, taskType: ExecutionTaskType, reason: string, additionalContext?: Record<string, unknown>): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: taskType,
      skip_reason: reason,
      ...additionalContext,
    };

    this.logger.info(`Execution task skipped: ${taskId} (${reason})`, context);
  }

  /**
   * Log diff generation event
   */
  diffGenerated(taskId: string, patchId: string, stats: DiffStats): void {
    const context: DiffContext = {
      task_id: taskId,
      execution_task_type: 'patch_application',
      patch_id: patchId,
      diff_stats: {
        files_changed: stats.filesChanged,
        insertions: stats.insertions,
        deletions: stats.deletions,
      },
    };

    this.logger.info(
      `Diff generated for task ${taskId}: ${stats.filesChanged} files, +${stats.insertions}/-${stats.deletions} lines`,
      context
    );
  }

  /**
   * Log validation completed event
   */
  validationCompleted(taskId: string, result: ValidationResult): void {
    const context: ValidationContext = {
      task_id: taskId,
      execution_task_type: 'validation',
      validation_duration_ms: result.durationMs,
      passed: result.passed,
      ...(result.errorCount !== undefined ? { error_count: result.errorCount } : {}),
      ...(result.errorTypes !== undefined ? { error_types: result.errorTypes } : {}),
    };

    const statusText = result.passed ? 'passed' : 'failed';
    const errorText = result.errorCount ? ` (${result.errorCount} errors)` : '';

    this.logger.info(`Validation ${statusText} for task ${taskId}${errorText}`, context);
  }

  /**
   * Log validation error details
   */
  validationError(taskId: string, errorType: string, errorMessage: string, additionalContext?: Record<string, unknown>): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: 'validation',
      error_type: errorType,
      ...additionalContext,
    };

    this.logger.warn(`Validation error in task ${taskId}: ${errorType} - ${errorMessage}`, context);
  }

  /**
   * Log queue state change
   */
  queueStateChanged(pending: number, completed: number, failed: number): void {
    const context = {
      queue_depth: pending + completed + failed,
      pending_count: pending,
      completed_count: completed,
      failed_count: failed,
    };

    this.logger.debug(`Queue state: ${pending} pending, ${completed} completed, ${failed} failed`, context);
  }

  /**
   * Log patch application event
   */
  patchApplied(taskId: string, patchId: string, targetBranch: string, commitSha?: string): void {
    const context: DiffContext = {
      task_id: taskId,
      execution_task_type: 'patch_application',
      patch_id: patchId,
      target_branch: targetBranch,
      ...(commitSha ? { commit_sha: commitSha } : {}),
    };

    this.logger.info(`Patch ${patchId} applied to branch ${targetBranch}`, context);
  }

  /**
   * Log git operation event
   */
  gitOperation(taskId: string, operation: string, details: Record<string, unknown>): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: 'git_operation',
      git_operation: operation,
      ...details,
    };

    this.logger.info(`Git operation: ${operation}`, context);
  }

  /**
   * Log agent invocation event
   */
  agentInvoked(taskId: string, agentType: string, model: string, promptTokens?: number, completionTokens?: number): void {
    const context: TaskContext = {
      task_id: taskId,
      execution_task_type: 'code_generation',
      agent_type: agentType,
      model,
      ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
      ...(completionTokens !== undefined ? { completion_tokens: completionTokens } : {}),
    };

    this.logger.info(`Agent invoked for task ${taskId}: ${agentType} (${model})`, context);
  }

  /**
   * Log cost warning event
   */
  costWarning(message: string, currentCost: number, budgetLimit: number): void {
    const context = {
      current_cost_usd: currentCost,
      budget_limit_usd: budgetLimit,
      percentage_used: (currentCost / budgetLimit) * 100,
    };

    this.logger.warn(`Cost warning: ${message}`, context);
  }

  /**
   * Flush pending log writes
   */
  async flush(): Promise<void> {
    await this.logger.flush();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create execution log writer
 */
export function createExecutionLogWriter(logger: StructuredLogger, options: ExecutionLogWriterOptions): ExecutionLogWriter {
  return new ExecutionLogWriter(logger, options);
}
