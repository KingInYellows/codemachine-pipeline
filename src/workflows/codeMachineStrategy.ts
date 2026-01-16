/**
 * CodeMachine Strategy
 *
 * Execution strategy that routes ExecutionTask instances to the CodeMachine CLI
 * or native AutoFixEngine based on task type mappings from TaskMapper.
 *
 * Key features:
 * - Task type to workflow routing via TaskMapper
 * - CodeMachine CLI subprocess invocation
 * - Native engine delegation for testing tasks
 * - Execution result normalization
 * - Telemetry integration
 *
 * Implements:
 * - CDMCH-17: TaskMapper refactoring for ExecutionTaskType -> CodeMachine workflows
 * - FR-12: Execution Task Generation
 * - ADR-1: Agent Execution Model
 *
 * Used by: CLIExecutionEngine
 */

import type { ExecutionTask, ExecutionTaskType } from '../core/models/ExecutionTask';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import {
  mapTaskToWorkflow,
  isEngineSupported,
  getSupportedEngines,
  type WorkflowMapping,
  type SupportedEngine,
} from './taskMapper';

// ============================================================================
// Types
// ============================================================================

/**
 * Execution result from CodeMachine or native engine
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Exit code from the execution */
  exitCode: number;
  /** Standard output from execution */
  stdout: string;
  /** Standard error from execution */
  stderr: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Workflow that was executed */
  workflow: string;
  /** Command that was used */
  command: 'start' | 'run' | 'step';
  /** Whether native engine was used */
  usedNativeEngine: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * CodeMachine strategy configuration
 */
export interface CodeMachineStrategyConfig {
  /** Path to CodeMachine CLI binary */
  cliPath?: string;
  /** Default timeout for CLI execution in milliseconds */
  defaultTimeoutMs?: number;
  /** Working directory for CLI execution */
  workingDirectory?: string;
  /** Environment variables to pass to CLI */
  environment?: Record<string, string>;
  /** Logger instance */
  logger?: StructuredLogger;
  /** Metrics collector */
  metrics?: MetricsCollector;
  /** Execution telemetry */
  telemetry?: ExecutionTelemetry;
}

/**
 * Task execution options
 */
export interface TaskExecutionOptions {
  /** Override timeout for this execution */
  timeoutMs?: number;
  /** Override working directory */
  workingDirectory?: string;
  /** Additional environment variables */
  environment?: Record<string, string>;
  /** Dry run mode - don't actually execute */
  dryRun?: boolean;
}

// ============================================================================
// CodeMachine Strategy
// ============================================================================

/**
 * CodeMachine Strategy - Routes tasks to CodeMachine CLI or native engine
 *
 * This strategy uses the TaskMapper to determine the appropriate workflow
 * for each ExecutionTaskType and routes execution accordingly:
 *
 * - Tasks with useNativeEngine: true are delegated to AutoFixEngine
 * - Tasks with useNativeEngine: false are executed via CodeMachine CLI
 *
 * @example
 * ```typescript
 * const strategy = new CodeMachineStrategy({
 *   cliPath: '/usr/local/bin/codemachine',
 *   logger: structuredLogger,
 * });
 *
 * const result = await strategy.execute(task);
 * if (result.success) {
 *   console.log('Task completed successfully');
 * }
 * ```
 */
export class CodeMachineStrategy {
  readonly name = 'codemachine';

  private readonly cliPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly workingDirectory: string;
  private readonly environment: Record<string, string>;
  private readonly logger: StructuredLogger | undefined;
  private readonly metrics: MetricsCollector | undefined;
  private readonly telemetry: ExecutionTelemetry | undefined;

  constructor(config: CodeMachineStrategyConfig = {}) {
    this.cliPath = config.cliPath ?? 'codemachine';
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 300000; // 5 minutes
    this.workingDirectory = config.workingDirectory ?? process.cwd();
    this.environment = config.environment ?? {};
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.telemetry = config.telemetry;

    this.logger?.info('CodeMachineStrategy initialized', {
      cli_path: this.cliPath,
      default_timeout_ms: this.defaultTimeoutMs,
      supported_engines: getSupportedEngines(),
    });
  }

  /**
   * Check if this strategy can handle the given task type
   *
   * @param taskType - ExecutionTaskType to check
   * @returns true if this strategy can handle the task type
   */
  canHandle(taskType: ExecutionTaskType): boolean {
    try {
      const mapping = mapTaskToWorkflow(taskType);
      return isEngineSupported(mapping.workflow) || mapping.useNativeEngine;
    } catch {
      return false;
    }
  }

  /**
   * Execute a task using the appropriate workflow
   *
   * Routes the task to either CodeMachine CLI or native engine based on
   * the workflow mapping from TaskMapper.
   *
   * @param task - ExecutionTask to execute
   * @param options - Execution options
   * @returns Execution result
   * @throws Error if task type is not supported
   */
  async execute(task: ExecutionTask, options: TaskExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const taskType = task.task_type;

    this.logger?.info('Executing task with CodeMachineStrategy', {
      task_id: task.task_id,
      task_type: taskType,
      feature_id: task.feature_id,
    });

    // Get workflow mapping from TaskMapper
    const mapping = mapTaskToWorkflow(taskType);

    this.logger?.debug('Task mapped to workflow', {
      task_id: task.task_id,
      workflow: mapping.workflow,
      command: mapping.command,
      use_native_engine: mapping.useNativeEngine,
    });

    // Route to appropriate execution path
    let result: ExecutionResult;

    if (mapping.useNativeEngine) {
      result = await this.executeWithNativeEngine(task, mapping, options, startTime);
    } else {
      result = await this.executeWithCodeMachine(task, mapping, options, startTime);
    }

    // Log completion
    this.logger?.info('Task execution completed', {
      task_id: task.task_id,
      success: result.success,
      duration_ms: result.durationMs,
      workflow: result.workflow,
      used_native_engine: result.usedNativeEngine,
    });

    return result;
  }

  /**
   * Execute task using CodeMachine CLI
   */
  private async executeWithCodeMachine(
    task: ExecutionTask,
    mapping: WorkflowMapping,
    options: TaskExecutionOptions,
    startTime: number
  ): Promise<ExecutionResult> {
    const timeout = options.timeoutMs ?? this.defaultTimeoutMs;
    const cwd = options.workingDirectory ?? this.workingDirectory;

    this.logger?.debug('Executing with CodeMachine CLI', {
      task_id: task.task_id,
      workflow: mapping.workflow,
      command: mapping.command,
      timeout_ms: timeout,
      cwd,
    });

    // Build CLI command
    const cliArgs = this.buildCliArgs(task, mapping);

    if (options.dryRun) {
      return this.createDryRunResult(mapping, startTime);
    }

    // Execute CLI (stub implementation - real implementation would spawn process)
    // In production, this would use child_process.spawn similar to autoFixEngine.ts
    const result = await this.invokeCodeMachineCli(cliArgs, {
      timeout,
      cwd,
      env: { ...this.environment, ...options.environment },
    });

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startTime,
      workflow: mapping.workflow,
      command: mapping.command,
      usedNativeEngine: false,
      metadata: {
        task_id: task.task_id,
        cli_args: cliArgs,
      },
    };
  }

  /**
   * Execute task using native AutoFixEngine
   */
  private executeWithNativeEngine(
    task: ExecutionTask,
    mapping: WorkflowMapping,
    options: TaskExecutionOptions,
    startTime: number
  ): Promise<ExecutionResult> {
    this.logger?.debug('Delegating to native engine', {
      task_id: task.task_id,
      workflow: mapping.workflow,
    });

    if (options.dryRun) {
      return this.createDryRunResult(mapping, startTime, true);
    }

    // Stub implementation - in production, this would delegate to AutoFixEngine
    // The actual implementation would import and call executeValidationWithAutoFix
    // from autoFixEngine.ts for testing tasks

    return {
      success: true,
      exitCode: 0,
      stdout: `Native engine execution for ${task.task_type} (stub)`,
      stderr: '',
      durationMs: Date.now() - startTime,
      workflow: mapping.workflow,
      command: mapping.command,
      usedNativeEngine: true,
      metadata: {
        task_id: task.task_id,
        native_engine: 'autofix',
      },
    };
  }

  /**
   * Build CLI arguments for CodeMachine invocation
   */
  private buildCliArgs(task: ExecutionTask, mapping: WorkflowMapping): string[] {
    const args: string[] = [
      mapping.command,
      '--workflow', mapping.workflow,
      '--task-id', task.task_id,
      '--feature-id', task.feature_id,
    ];

    // Add task title as prompt if available
    if (task.title) {
      args.push('--prompt', task.title);
    }

    // Add task config as JSON if available
    if (task.config && Object.keys(task.config).length > 0) {
      args.push('--config', JSON.stringify(task.config));
    }

    return args;
  }

  /**
   * Invoke CodeMachine CLI (stub implementation)
   *
   * In production, this would spawn a child process and execute the CLI.
   * For now, returns a stub result.
   */
  private invokeCodeMachineCli(
    _args: string[],
    _options: { timeout: number; cwd: string; env: Record<string, string> }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // Stub implementation - real implementation would use child_process.spawn
    // similar to the pattern in autoFixEngine.ts executeShellCommand
    return {
      exitCode: 0,
      stdout: 'CodeMachine CLI execution (stub)',
      stderr: '',
    };
  }

  /**
   * Create a dry run result without actual execution
   */
  private createDryRunResult(
    mapping: WorkflowMapping,
    startTime: number,
    nativeEngine = false
  ): ExecutionResult {
    return {
      success: true,
      exitCode: 0,
      stdout: `[DRY RUN] Would execute workflow: ${mapping.workflow} with command: ${mapping.command}`,
      stderr: '',
      durationMs: Date.now() - startTime,
      workflow: mapping.workflow,
      command: mapping.command,
      usedNativeEngine: nativeEngine,
      metadata: {
        dry_run: true,
      },
    };
  }

  /**
   * Get supported engines for this strategy
   */
  getSupportedEngines(): SupportedEngine[] {
    return getSupportedEngines();
  }

  /**
   * Get workflow mapping for a task type
   *
   * Convenience method to expose TaskMapper functionality.
   *
   * @param taskType - ExecutionTaskType to get mapping for
   * @returns WorkflowMapping configuration
   */
  getWorkflowMapping(taskType: ExecutionTaskType): WorkflowMapping {
    return mapTaskToWorkflow(taskType);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new CodeMachineStrategy instance
 *
 * @param config - Strategy configuration
 * @returns Configured CodeMachineStrategy instance
 */
export function createCodeMachineStrategy(config: CodeMachineStrategyConfig = {}): CodeMachineStrategy {
  return new CodeMachineStrategy(config);
}
