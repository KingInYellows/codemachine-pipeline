/**
 * Execution Engine Telemetry
 *
 * Provides specialized metrics and logging helpers for the execution engine,
 * instrumenting task lifecycle events, validation runs, diff generation, and
 * agent cost tracking.
 *
 * Key features:
 * - Per-task execution metrics (start, completion, failure)
 * - Diff statistics histograms (files changed, line counts)
 * - Validation duration tracking
 * - Queue depth gauges
 * - Agent cost counters (integrated with CostTracker)
 *
 * Implements Observability Rulebook and Iteration I3 execution telemetry requirements.
 */

import type { MetricsCollector, Labels } from './metrics';
import type { LogContext } from '../core/sharedTypes';
import type { LoggerInterface } from './logger';
import { LATENCY_BUCKETS } from './metrics';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Execution task status
 */
export enum ExecutionTaskStatus {
  STARTED = 'started',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Execution task type (mirrors ExecutionTask schema)
 */
export enum ExecutionTaskType {
  CODE_GENERATION = 'code_generation',
  TESTING = 'testing',
  PR_CREATION = 'pr_creation',
  DEPLOYMENT = 'deployment',
  REVIEW = 'review',
  REFACTORING = 'refactoring',
  DOCUMENTATION = 'documentation',
  OTHER = 'other',
  VALIDATION = 'validation',
  PATCH_APPLICATION = 'patch_application',
  GIT_OPERATION = 'git_operation',
  CUSTOM = 'custom',
}

/**
 * CodeMachine execution status
 */
export type CodeMachineExecutionStatus = 'success' | 'failure' | 'timeout';

/**
 * Diff statistics summary
 */
export interface DiffStats {
  /** Number of files changed */
  filesChanged: number;
  /** Lines inserted */
  insertions: number;
  /** Lines deleted */
  deletions: number;
  /** Patch ID for correlation */
  patchId?: string;
}

/**
 * Validation result summary
 */
export interface ValidationResult {
  /** Validation passed */
  passed: boolean;
  /** Validation duration in milliseconds */
  durationMs: number;
  /** Number of errors encountered */
  errorCount?: number;
  /** Error types */
  errorTypes?: string[];
}

export type { LoggerInterface };

/**
 * Execution metrics options
 */
export interface ExecutionMetricsOptions {
  /** Run directory path */
  runDir: string;
  /** Run ID (feature_id) */
  runId: string;
  /** Component identifier */
  component?: string;
  /** Optional logger for error reporting */
  logger?: LoggerInterface;
}

// ============================================================================
// Standard Execution Metric Names
// ============================================================================

/**
 * Standard metric names for execution engine telemetry
 */
export const ExecutionMetrics = {
  // Task lifecycle metrics
  EXECUTION_TASKS_TOTAL: 'execution_tasks_total',
  EXECUTION_TASK_DURATION_MS: 'execution_task_duration_ms',

  // Validation metrics
  VALIDATION_DURATION_SECONDS: 'validation_duration_seconds',
  VALIDATION_ERRORS_TOTAL: 'validation_errors_total',
  VALIDATION_RUNS_TOTAL: 'validation_runs_total',

  // Diff statistics
  DIFF_FILES_CHANGED: 'diff_files_changed',
  DIFF_LINES_TOTAL: 'diff_lines_total',
  DIFF_OPERATIONS_TOTAL: 'diff_operations_total',

  // Queue depth
  EXECUTION_QUEUE_DEPTH: 'execution_queue_depth',
  EXECUTION_QUEUE_PENDING: 'execution_queue_pending',
  EXECUTION_QUEUE_COMPLETED: 'execution_queue_completed',
  EXECUTION_QUEUE_FAILED: 'execution_queue_failed',

  // Agent cost tracking
  AGENT_COST_TOKENS_TOTAL: 'agent_cost_tokens_total',
  AGENT_COST_USD_TOTAL: 'agent_cost_usd_total',

  // CodeMachine execution metrics
  CODEMACHINE_EXECUTION_TOTAL: 'codemachine_execution_total',
  CODEMACHINE_EXECUTION_DURATION_MS: 'codemachine_execution_duration_ms',
  CODEMACHINE_RETRY_TOTAL: 'codemachine_retry_total',
} as const;

/**
 * Histogram buckets for diff size measurements (file counts)
 */
export const DIFF_SIZE_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

/**
 * Histogram buckets for line count measurements
 */
export const LINE_COUNT_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Histogram buckets for validation durations (seconds)
 */
export const VALIDATION_DURATION_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120];

// ============================================================================
// Execution Metrics Helper
// ============================================================================

/**
 * Specialized metrics helper for execution engine instrumentation
 */
export class ExecutionMetricsHelper {
  private readonly metrics: MetricsCollector;
  private readonly options: Required<Omit<ExecutionMetricsOptions, 'logger'>>;
  private readonly logger?: LoggerInterface;
  private readonly defaultLabels: Labels;

  constructor(metrics: MetricsCollector, options: ExecutionMetricsOptions) {
    this.metrics = metrics;
    this.options = {
      runDir: options.runDir,
      runId: options.runId,
      component: options.component ?? 'execution',
    };
    if (options.logger) {
      this.logger = options.logger;
    }

    this.defaultLabels = {
      run_id: this.options.runId,
      component: this.options.component,
    };
  }

  /**
   * Log an error message via injected logger or console fallback
   */
  private logError(message: string, context?: LogContext): void {
    if (this.logger) {
      this.logger.error(message, context);
    } else {
      console.error(message, context);
    }
  }

  /**
   * Record task lifecycle event (start, completion, failure)
   */
  recordTaskLifecycle(
    taskId: string,
    taskType: ExecutionTaskType,
    status: ExecutionTaskStatus,
    durationMs?: number
  ): void {
    try {
      const labels: Labels = {
        ...this.defaultLabels,
        task_id: taskId,
        task_type: taskType,
        status,
      };

      // Increment task counter
      this.metrics.increment(
        ExecutionMetrics.EXECUTION_TASKS_TOTAL,
        labels,
        1,
        'Total execution tasks by status and type'
      );

      // Record duration for completed/failed tasks
      if (
        durationMs !== undefined &&
        (status === ExecutionTaskStatus.COMPLETED || status === ExecutionTaskStatus.FAILED)
      ) {
        this.metrics.observe(
          ExecutionMetrics.EXECUTION_TASK_DURATION_MS,
          durationMs,
          { ...this.defaultLabels, task_type: taskType },
          LATENCY_BUCKETS,
          'Execution task duration distribution in milliseconds'
        );
      }
    } catch (error) {
      // Never throw from instrumentation code
      this.logError('[ExecutionMetrics] Failed to record task lifecycle', {
        error: error instanceof Error ? error.message : String(error),
        taskId,
        taskType,
        status,
      });
    }
  }

  /**
   * Record CodeMachine execution metrics
   */
  recordCodeMachineExecution(
    engine: string,
    status: CodeMachineExecutionStatus,
    durationMs: number
  ): void {
    try {
      this.metrics.increment(
        ExecutionMetrics.CODEMACHINE_EXECUTION_TOTAL,
        { ...this.defaultLabels, engine, status },
        1,
        'Total CodeMachine executions by engine and status'
      );

      this.metrics.observe(
        ExecutionMetrics.CODEMACHINE_EXECUTION_DURATION_MS,
        durationMs,
        { ...this.defaultLabels, engine },
        LATENCY_BUCKETS,
        'CodeMachine execution duration distribution in milliseconds'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to record CodeMachine execution', {
        error: error instanceof Error ? error.message : String(error),
        engine,
        status,
      });
    }
  }

  /**
   * Record CodeMachine retry count
   */
  recordCodeMachineRetry(engine: string): void {
    try {
      this.metrics.increment(
        ExecutionMetrics.CODEMACHINE_RETRY_TOTAL,
        { ...this.defaultLabels, engine },
        1,
        'Total CodeMachine retries by engine'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to record CodeMachine retry', {
        error: error instanceof Error ? error.message : String(error),
        engine,
      });
    }
  }

  /**
   * Record validation run metrics
   */
  recordValidationRun(result: ValidationResult): void {
    try {
      const labels: Labels = {
        ...this.defaultLabels,
        passed: String(result.passed),
      };

      // Increment validation run counter
      this.metrics.increment(
        ExecutionMetrics.VALIDATION_RUNS_TOTAL,
        labels,
        1,
        'Total validation runs by result'
      );

      // Record validation duration (convert to seconds for Prometheus convention)
      const durationSeconds = result.durationMs / 1000;
      this.metrics.observe(
        ExecutionMetrics.VALIDATION_DURATION_SECONDS,
        durationSeconds,
        labels,
        VALIDATION_DURATION_BUCKETS,
        'Validation duration distribution in seconds'
      );

      // Record error count if validation failed
      if (!result.passed && result.errorCount !== undefined) {
        // Record each error type separately to avoid label value issues
        const errorTypes = result.errorTypes ?? ['unknown'];
        for (const errorType of errorTypes) {
          this.metrics.increment(
            ExecutionMetrics.VALIDATION_ERRORS_TOTAL,
            { ...this.defaultLabels, error_type: errorType },
            1,
            'Total validation errors by type'
          );
        }
      }
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to record validation run', {
        error: error instanceof Error ? error.message : String(error),
        passed: result.passed,
      });
    }
  }

  /**
   * Record diff statistics
   */
  recordDiffStats(stats: DiffStats): void {
    try {
      const baseLabels: Labels = {
        ...this.defaultLabels,
        ...(stats.patchId ? { patch_id: stats.patchId } : {}),
      };

      // Record files changed histogram
      this.metrics.observe(
        ExecutionMetrics.DIFF_FILES_CHANGED,
        stats.filesChanged,
        baseLabels,
        DIFF_SIZE_BUCKETS,
        'Number of files changed in diff'
      );

      // Record line insertions
      this.metrics.observe(
        ExecutionMetrics.DIFF_LINES_TOTAL,
        stats.insertions,
        { ...baseLabels, operation: 'insertion' },
        LINE_COUNT_BUCKETS,
        'Lines added/removed in diff'
      );

      // Record line deletions
      this.metrics.observe(
        ExecutionMetrics.DIFF_LINES_TOTAL,
        stats.deletions,
        { ...baseLabels, operation: 'deletion' },
        LINE_COUNT_BUCKETS,
        'Lines added/removed in diff'
      );

      // Increment diff operations counter
      this.metrics.increment(
        ExecutionMetrics.DIFF_OPERATIONS_TOTAL,
        baseLabels,
        1,
        'Total diff generation operations'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to record diff stats', {
        error: error instanceof Error ? error.message : String(error),
        filesChanged: stats.filesChanged,
      });
    }
  }

  /**
   * Set current queue depth metrics (snapshot)
   */
  setQueueDepth(pending: number, completed: number, failed: number): void {
    try {
      const labels = this.defaultLabels;

      this.metrics.gauge(
        ExecutionMetrics.EXECUTION_QUEUE_PENDING,
        pending,
        labels,
        'Number of pending execution tasks'
      );

      this.metrics.gauge(
        ExecutionMetrics.EXECUTION_QUEUE_COMPLETED,
        completed,
        labels,
        'Number of completed execution tasks'
      );

      this.metrics.gauge(
        ExecutionMetrics.EXECUTION_QUEUE_FAILED,
        failed,
        labels,
        'Number of failed execution tasks'
      );

      this.metrics.gauge(
        ExecutionMetrics.EXECUTION_QUEUE_DEPTH,
        pending + completed + failed,
        labels,
        'Total execution queue depth'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to set queue depth', {
        error: error instanceof Error ? error.message : String(error),
        pending,
        completed,
        failed,
      });
    }
  }

  /**
   * Record agent cost usage (token-based)
   *
   * Note: Prefer using CostTracker.recordUsage() for comprehensive cost tracking.
   * This method provides execution-specific counters for quick aggregation.
   */
  recordAgentCost(model: string, promptTokens: number, completionTokens: number): void {
    try {
      const labels: Labels = {
        ...this.defaultLabels,
        model,
      };

      // Record prompt tokens
      this.metrics.increment(
        ExecutionMetrics.AGENT_COST_TOKENS_TOTAL,
        { ...labels, type: 'prompt' },
        promptTokens,
        'Agent token usage (prompt and completion)'
      );

      // Record completion tokens
      this.metrics.increment(
        ExecutionMetrics.AGENT_COST_TOKENS_TOTAL,
        { ...labels, type: 'completion' },
        completionTokens,
        'Agent token usage (prompt and completion)'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to record agent cost', {
        error: error instanceof Error ? error.message : String(error),
        model,
      });
    }
  }

  /**
   * Set agent cost USD total (from CostTracker state)
   */
  setAgentCostUsd(totalCostUsd: number): void {
    try {
      this.metrics.gauge(
        ExecutionMetrics.AGENT_COST_USD_TOTAL,
        totalCostUsd,
        this.defaultLabels,
        'Total agent cost in USD'
      );
    } catch (error) {
      this.logError('[ExecutionMetrics] Failed to set agent cost USD', {
        error: error instanceof Error ? error.message : String(error),
        totalCostUsd,
      });
    }
  }

  /**
   * Flush metrics to disk
   */
  async flush(): Promise<void> {
    try {
      await this.metrics.flush();
    } catch (error) {
      // Log the failure but don't throw - metrics collection should not crash the application
      this.logError('[ExecutionMetrics] Failed to flush metrics to disk', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create execution metrics helper
 */
export function createExecutionMetrics(
  metrics: MetricsCollector,
  options: ExecutionMetricsOptions
): ExecutionMetricsHelper {
  return new ExecutionMetricsHelper(metrics, options);
}
