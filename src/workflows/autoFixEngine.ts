import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import { StandardMetrics } from '../telemetry/metrics';
import {
  ExecutionTaskStatus,
  ExecutionTaskType,
  type ValidationResult as ExecutionValidationTelemetry,
} from '../telemetry/executionMetrics';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import { endExecutionSpan, startExecutionSpan } from '../telemetry/executionTelemetry';
import type {
  ValidationCommandConfig,
  ValidationCommandType,
} from '../core/validation/validationCommandConfig';
import {
  type ValidationAttempt,
  type ValidationResult,
  getValidationCommand,
  getAttemptCount,
  hasExceededRetryLimit,
  recordValidationAttempt,
  generateAttemptId,
  summarizeError,
  getRequiredCommands,
} from './validationRegistry';

/**
 * Auto-Fix Engine
 *
 * Orchestrates validation command execution with auto-fix retry loops.
 * Implements bounded retry policy with exponential backoff.
 *
 * Implements:
 * - ADR-7: Validation auto-fix loop with capped retries
 * - FR-14: Deterministic validation with audit trails
 * - Command execution with timeout enforcement
 * - stdout/stderr capture and summarization
 * - Retry backoff policy
 *
 * Used by: validate CLI command, execution engine, PR workflow
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Auto-fix execution options
 */
export interface AutoFixOptions {
  /** Whether to attempt auto-fix if supported */
  enableAutoFix: boolean;
  /** Whether to respect retry limits */
  respectRetryLimits: boolean;
  /** Override maximum retries (if respectRetryLimits is false) */
  maxRetriesOverride?: number;
  /** Override timeout (milliseconds) */
  timeoutOverride?: number;
  /** Working directory override */
  cwdOverride?: string;
  /** Environment variables to merge */
  envOverride?: Record<string, string>;
}

/**
 * Auto-fix execution result
 */
export interface AutoFixResult {
  /** Whether all required validations passed */
  success: boolean;
  /** Validation results by command type */
  results: Map<ValidationCommandType, ValidationResult>;
  /** Total attempts across all commands */
  totalAttempts: number;
  /** Auto-fix successes */
  autoFixSuccesses: number;
  /** Commands that exceeded retry limit */
  exceededRetryLimits: ValidationCommandType[];
  /** Summary message */
  summary: string;
}

// ============================================================================
// Auto-Fix Engine
// ============================================================================

/**
 * Execute validation command with auto-fix retry loop
 *
 * @param runDir - Run directory path
 * @param commandType - Validation command type
 * @param options - Execution options
 * @param logger - Structured logger instance
 * @param metrics - Metrics collector instance
 * @returns Validation result
 */
export async function executeValidationWithAutoFix(
  runDir: string,
  commandType: ValidationCommandType,
  options: AutoFixOptions,
  logger?: StructuredLogger,
  metrics?: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<ValidationResult> {
  const startTime = Date.now();
  const taskId = `validation:${commandType}`;
  telemetry?.logs?.taskStarted(taskId, ExecutionTaskType.VALIDATION, {
    command_type: commandType,
    auto_fix_enabled: options.enableAutoFix,
  });
  telemetry?.metrics?.recordTaskLifecycle(
    taskId,
    ExecutionTaskType.VALIDATION,
    ExecutionTaskStatus.STARTED
  );
  const span = startExecutionSpan(telemetry, `validation.${commandType}`, {
    task_id: taskId,
    command_type: commandType,
  });

  logger?.info('Starting validation execution', { command_type: commandType });

  // Load command configuration
  const command = await getValidationCommand(runDir, commandType);
  if (!command) {
    throw new Error(`Validation command not found: ${commandType}`);
  }

  // Check retry limit
  if (options.respectRetryLimits && (await hasExceededRetryLimit(runDir, commandType))) {
    const attemptCount = await getAttemptCount(runDir, commandType);
    logger?.warn('Retry limit exceeded', {
      command_type: commandType,
      attempt_count: attemptCount,
      max_retries: command.max_retries,
    });

    throw new Error(
      `Validation command "${commandType}" has exceeded retry limit (${attemptCount} attempts, max ${command.max_retries + 1})`
    );
  }

  // Determine max attempts
  const maxAttempts = options.respectRetryLimits
    ? command.max_retries + 1
    : options.maxRetriesOverride
      ? options.maxRetriesOverride + 1
      : command.max_retries + 1;

  let lastResult: ValidationResult | undefined;
  let attemptNumber = 0;

  // Retry loop
  while (attemptNumber < maxAttempts) {
    attemptNumber++;

    const isAutoFixAttempt =
      attemptNumber > 1 && options.enableAutoFix && command.supports_auto_fix;

    logger?.info('Executing validation attempt', {
      command_type: commandType,
      attempt_number: attemptNumber,
      max_attempts: maxAttempts,
      auto_fix_attempt: isAutoFixAttempt,
    });

    // Execute command
    const result = await executeValidationCommand(
      runDir,
      command,
      attemptNumber,
      isAutoFixAttempt,
      options,
      logger,
      metrics,
      telemetry
    );

    lastResult = result;
    span?.addEvent('validation.attempt', {
      attempt_number: attemptNumber,
      success: result.success,
      duration_ms: result.durationMs,
      auto_fix_attempt: isAutoFixAttempt,
    });

    // Record attempt
    await recordValidationAttempt(runDir, result.attempt, logger);

    // Check if validation passed
    if (result.success) {
      logger?.info('Validation passed', {
        command_type: commandType,
        attempt_number: attemptNumber,
        duration_ms: Date.now() - startTime,
        auto_fix_used: isAutoFixAttempt,
      });

      metrics?.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: `validation.${commandType}`,
        result: 'success',
        auto_fix: isAutoFixAttempt.toString(),
      });

      const totalDuration = Date.now() - startTime;
      telemetry?.metrics?.recordTaskLifecycle(
        taskId,
        ExecutionTaskType.VALIDATION,
        ExecutionTaskStatus.COMPLETED,
        totalDuration
      );
      telemetry?.logs?.taskCompleted(taskId, ExecutionTaskType.VALIDATION, totalDuration, {
        command_type: commandType,
        attempt_number: attemptNumber,
        auto_fix_attempt: isAutoFixAttempt,
      });
      span?.setAttribute('validation.attempts', attemptNumber);
      span?.setAttribute('validation.success', true);
      endExecutionSpan(span, true);
      return result;
    }

    // Check if we should retry
    if (attemptNumber < maxAttempts) {
      const backoffMs = command.backoff_ms * attemptNumber;
      logger?.info('Validation failed, retrying after backoff', {
        command_type: commandType,
        attempt_number: attemptNumber,
        backoff_ms: backoffMs,
        will_auto_fix: options.enableAutoFix && command.supports_auto_fix,
      });

      await sleep(backoffMs);
    }
  }

  // All attempts exhausted
  logger?.error('Validation failed after all attempts', {
    command_type: commandType,
    total_attempts: attemptNumber,
    duration_ms: Date.now() - startTime,
  });

  metrics?.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
    command: `validation.${commandType}`,
    result: 'failure',
    attempts: attemptNumber.toString(),
  });

  const failureError = new Error(
    lastResult?.errorSummary ?? `Validation command "${commandType}" failed`
  );
  const totalDuration = Date.now() - startTime;
  telemetry?.metrics?.recordTaskLifecycle(
    taskId,
    ExecutionTaskType.VALIDATION,
    ExecutionTaskStatus.FAILED,
    totalDuration
  );
  telemetry?.logs?.taskFailed(taskId, ExecutionTaskType.VALIDATION, failureError, totalDuration, {
    command_type: commandType,
    attempt_number: attemptNumber,
  });
  span?.setAttribute('validation.attempts', attemptNumber);
  span?.setAttribute('validation.success', false);
  endExecutionSpan(span, false, failureError.message);

  return lastResult!;
}

/**
 * Execute all required validation commands with auto-fix
 *
 * @param runDir - Run directory path
 * @param commandTypes - Command types to execute (defaults to all required)
 * @param options - Execution options
 * @param logger - Structured logger instance
 * @param metrics - Metrics collector instance
 * @returns Auto-fix result summary
 */
export async function executeAllValidations(
  runDir: string,
  commandTypes: ValidationCommandType[] | undefined,
  options: AutoFixOptions,
  logger?: StructuredLogger,
  metrics?: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<AutoFixResult> {
  const startTime = Date.now();

  logger?.info('Starting validation suite execution', {
    command_types: commandTypes?.join(', ') ?? 'all required',
  });

  // Determine which commands to run
  const targetCommands =
    commandTypes ?? (await getRequiredCommands(runDir)).map((command) => command.type);

  if (targetCommands.length === 0) {
    const summary = buildValidationSummary(new Map(), [], 0, 0);
    logger?.info('No required validation commands configured', { runDir });
    return {
      success: true,
      results: new Map(),
      totalAttempts: 0,
      autoFixSuccesses: 0,
      exceededRetryLimits: [],
      summary,
    };
  }

  const results = new Map<ValidationCommandType, ValidationResult>();
  const exceededRetryLimits: ValidationCommandType[] = [];
  let totalAttempts = 0;
  let autoFixSuccesses = 0;

  // Execute each command sequentially (to avoid resource conflicts)
  for (const commandType of targetCommands) {
    try {
      const result = await executeValidationWithAutoFix(
        runDir,
        commandType,
        options,
        logger,
        metrics,
        telemetry
      );

      results.set(commandType, result);
      totalAttempts += result.attempt.attempt_number;

      if (result.attempt.auto_fix_attempted && result.success) {
        autoFixSuccesses++;
      }
    } catch (error) {
      // Check if error is due to retry limit
      if (error instanceof Error && error.message.includes('exceeded retry limit')) {
        exceededRetryLimits.push(commandType);
        logger?.warn('Command exceeded retry limit', { command_type: commandType });
      } else {
        throw error;
      }
    }
  }

  // Determine overall success
  const success = targetCommands.every((cmd) => {
    const result = results.get(cmd);
    return result?.success ?? false;
  });

  // Build summary message
  const summary = buildValidationSummary(
    results,
    exceededRetryLimits,
    totalAttempts,
    autoFixSuccesses
  );

  logger?.info('Validation suite execution completed', {
    success,
    total_attempts: totalAttempts,
    auto_fix_successes: autoFixSuccesses,
    duration_ms: Date.now() - startTime,
  });

  return {
    success,
    results,
    totalAttempts,
    autoFixSuccesses,
    exceededRetryLimits,
    summary,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Execute a single validation command
 */
async function executeValidationCommand(
  runDir: string,
  command: ValidationCommandConfig,
  attemptNumber: number,
  isAutoFixAttempt: boolean,
  options: AutoFixOptions,
  logger?: StructuredLogger,
  metrics?: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<ValidationResult> {
  const attemptId = generateAttemptId();
  const startedAt = new Date().toISOString();
  const repoRoot = resolveRepoRoot(runDir);

  // Determine command to execute
  const commandTemplate =
    isAutoFixAttempt && command.auto_fix_command ? command.auto_fix_command : command.command;

  // Determine working directory
  const cwd = resolveWorkingDirectory(repoRoot, command.cwd, options.cwdOverride);

  // Render command with template context
  const templateContext = buildCommandTemplateContext(
    runDir,
    repoRoot,
    cwd,
    command.template_context
  );
  const renderedCommand = applyCommandTemplate(commandTemplate, templateContext);

  // Merge environment variables
  const env = {
    ...process.env,
    ...(command.env ?? {}),
    ...(options.envOverride ?? {}),
  };

  // Determine timeout
  const timeout = options.timeoutOverride ?? command.timeout_ms;

  logger?.debug('Executing shell command', {
    command: renderedCommand,
    command_template: commandTemplate,
    cwd,
    timeout_ms: timeout,
    attempt_id: attemptId,
  });

  // Execute command
  const execOptions: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeout: number;
    logger?: StructuredLogger;
  } = {
    cwd,
    env,
    timeout,
  };

  if (logger) {
    execOptions.logger = logger;
  }

  const { exitCode, stdout, stderr, durationMs } = await executeShellCommand(
    renderedCommand,
    execOptions
  );

  const completedAt = new Date().toISOString();

  // Save stdout/stderr to files
  const { stdoutPath, stderrPath } = await saveCommandOutput(
    runDir,
    command.type,
    attemptId,
    stdout,
    stderr
  );

  // Summarize errors
  const errorSummary = exitCode !== 0 ? summarizeError(stderr) : undefined;

  // Build attempt record
  const attempt: ValidationAttempt = {
    attempt_id: attemptId,
    command_type: command.type,
    attempt_number: attemptNumber,
    exit_code: exitCode,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    auto_fix_attempted: isAutoFixAttempt,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    error_summary: errorSummary,
    metadata: {
      command: renderedCommand,
      command_template: commandTemplate,
      cwd,
      timeout_ms: timeout,
    },
  };

  // Record metrics
  metrics?.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, durationMs, {
    command: `validation.${command.type}`,
  });

  const validationResult: ValidationResult = {
    success: exitCode === 0,
    commandType: command.type,
    exitCode,
    durationMs,
    stdout,
    stderr,
    attempt,
  };

  if (typeof errorSummary !== 'undefined') {
    validationResult.errorSummary = errorSummary;
  }

  const telemetryPayload: ExecutionValidationTelemetry = {
    passed: validationResult.success,
    durationMs,
    ...(validationResult.success
      ? {}
      : {
          errorCount: 1,
          errorTypes: [`validation.${command.type}`],
        }),
  };
  const telemetryTaskId = `validation:${command.type}`;
  telemetry?.metrics?.recordValidationRun(telemetryPayload);
  telemetry?.logs?.validationCompleted(telemetryTaskId, telemetryPayload);

  return validationResult;
}

/**
 * Execute shell command with timeout
 */
async function executeShellCommand(
  command: string,
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeout: number;
    logger?: StructuredLogger;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    // Parse command into shell and args
    const childProcess = spawn(command, {
      cwd: options.cwd,
      env: options.env as Record<string, string>,
      shell: true,
      timeout: options.timeout,
    });

    // Set timeout handler
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      childProcess.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
      }, 5000);
    }, options.timeout);

    // Capture stdout
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    // Capture stderr
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Handle exit
    childProcess.on('close', (code) => {
      clearTimeout(timeoutHandle);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const durationMs = Date.now() - startTime;

      const exitCode = timedOut ? 124 : (code ?? 1); // 124 = timeout exit code (convention)

      if (timedOut) {
        options.logger?.warn('Command timed out', {
          command,
          timeout_ms: options.timeout,
          duration_ms: durationMs,
        });
      }

      resolve({
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\n\nCommand timed out after ${options.timeout}ms` : stderr,
        durationMs,
      });
    });

    // Handle errors
    childProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);

      options.logger?.error('Command execution error', {
        command,
        error: error.message,
      });

      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: `Command execution error: ${error.message}`,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/**
 * Save command output to run directory
 */
async function saveCommandOutput(
  runDir: string,
  commandType: ValidationCommandType,
  attemptId: string,
  stdout: string,
  stderr: string
): Promise<{ stdoutPath: string; stderrPath: string }> {
  const outputDir = path.join(runDir, 'validation', 'outputs');
  await fs.mkdir(outputDir, { recursive: true });

  const stdoutPath = `validation/outputs/${commandType}_${attemptId}.stdout.txt`;
  const stderrPath = `validation/outputs/${commandType}_${attemptId}.stderr.txt`;

  const stdoutAbsPath = path.join(runDir, stdoutPath);
  const stderrAbsPath = path.join(runDir, stderrPath);

  await Promise.all([
    fs.writeFile(stdoutAbsPath, stdout, 'utf-8'),
    fs.writeFile(stderrAbsPath, stderr, 'utf-8'),
  ]);

  return { stdoutPath, stderrPath };
}

function resolveRepoRoot(runDir: string): string {
  return path.resolve(runDir, '..', '..', '..');
}

function resolveWorkingDirectory(repoRoot: string, commandCwd: string, override?: string): string {
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
  }

  return path.isAbsolute(commandCwd) ? commandCwd : path.resolve(repoRoot, commandCwd);
}

function buildCommandTemplateContext(
  runDir: string,
  repoRoot: string,
  commandCwd: string,
  templateContext?: Record<string, string>
): Record<string, string> {
  return {
    feature_id: path.basename(runDir),
    run_dir: runDir,
    repo_root: repoRoot,
    command_cwd: commandCwd,
    ...(templateContext ?? {}),
  };
}

function applyCommandTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => context[key] ?? '');
}

/**
 * Build human-readable validation summary
 */
function buildValidationSummary(
  results: Map<ValidationCommandType, ValidationResult>,
  exceededRetryLimits: ValidationCommandType[],
  totalAttempts: number,
  autoFixSuccesses: number
): string {
  const lines: string[] = [];

  lines.push('Validation Summary:');
  lines.push('');

  if (results.size === 0) {
    lines.push('  No commands executed');
  }

  // Results by command
  for (const [commandType, result] of results.entries()) {
    const status = result.success ? '✓ PASS' : '✗ FAIL';
    const attempts =
      result.attempt.attempt_number > 1 ? ` (${result.attempt.attempt_number} attempts)` : '';
    const autoFix = result.attempt.auto_fix_attempted && result.success ? ' [auto-fixed]' : '';

    lines.push(`  ${status} ${commandType}${attempts}${autoFix}`);

    if (!result.success && result.errorSummary) {
      const errorPreview = result.errorSummary.split('\n')[0];
      lines.push(`      Error: ${errorPreview}`);
    }
  }

  // Retry limit warnings
  if (exceededRetryLimits.length > 0) {
    lines.push('');
    lines.push('⚠ Commands exceeded retry limit:');
    for (const commandType of exceededRetryLimits) {
      lines.push(`  - ${commandType}`);
    }
  }

  // Statistics
  lines.push('');
  lines.push(`Total attempts: ${totalAttempts}`);
  if (autoFixSuccesses > 0) {
    lines.push(`Auto-fix successes: ${autoFixSuccesses}`);
  }

  return lines.join('\n');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
