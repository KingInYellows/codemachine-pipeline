/**
 * Execution Strategy Contract
 *
 * Defines the pluggable strategy pattern for task execution. The execution
 * engine selects a strategy via `canHandle()` and delegates work via
 * `execute()`. Implementations include CodeMachineCLIStrategy (preferred)
 * and CodeMachineStrategy (legacy fallback).
 */

import type { ExecutionTask } from '../core/models/ExecutionTask.js';

/** Runtime context passed to strategy `execute()` */
export interface ExecutionContext {
  /** Absolute path to the run directory */
  runDir: string;
  /** Absolute path to the workspace root */
  workspaceDir: string;
  /** Absolute path to the log file for this execution */
  logPath: string;
  /** Maximum execution time in milliseconds before timeout */
  timeoutMs: number;
}

/** Result returned by a strategy after task execution */
export interface ExecutionStrategyResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Terminal status of the execution */
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  /** Human-readable summary of the execution outcome */
  summary: string;
  /** Error message if the execution failed */
  errorMessage?: string;
  /** Whether the failure is recoverable via retry */
  recoverable: boolean;
  /** Wall-clock execution duration in milliseconds */
  durationMs: number;
  /** Paths to artifacts produced during execution */
  artifacts: string[];
}

/** Pluggable execution strategy for running tasks */
export interface ExecutionStrategy {
  /** Unique name identifying this strategy */
  readonly name: string;
  /** Returns true if this strategy can execute the given task */
  canHandle(task: ExecutionTask): boolean;
  /** Executes the task and returns a result */
  execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult>;
}
