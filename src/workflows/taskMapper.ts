import * as path from 'node:path';
import type { ExecutionTask, ExecutionTaskType } from '../core/models/ExecutionTask.js';
import type { ExecutionEngineType } from '../core/config/RepoConfig.js';
import type { RunnerResult } from './codeMachineRunner.js';
import { extractArtifactPaths } from './resultNormalizer.js';

export interface CodeMachineCommand {
  command: 'run' | 'start';
  args: string[];
  engine: ExecutionEngineType;
  workingDir: string;
  specPath?: string;
  prompt?: string;
}

export interface TaskExecutionResult {
  status: 'completed' | 'failed';
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: {
    message: string;
    code: string;
    recoverable: boolean;
  };
  artifacts?: string[];
}

/**
 * Valid primary commands for CodeMachine CLI
 * Used for security validation to prevent command injection
 */
export const ALLOWED_COMMANDS = ['start', 'run'] as const;
export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

/**
 * Valid subcommands for 'run' command
 * Used for security validation to prevent command injection
 */
export const ALLOWED_SUBCOMMANDS = ['pr', 'review', 'docs'] as const;
export type AllowedSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];

/**
 * Mapping from task type to workflow execution configuration
 */
export interface WorkflowMapping {
  /** Full workflow name for display/logging (e.g., "codemachine run pr") */
  workflow: string;
  /** Primary command to execute ('start' or 'run') */
  command: AllowedCommand;
  /** Optional subcommand for 'run' command (pr, review, docs) */
  subcommand?: AllowedSubcommand;
  /** Whether to use native engine instead of CodeMachine CLI */
  useNativeEngine: boolean;
}

/**
 * Complete command structure for CodeMachine CLI execution
 */
export interface CommandStructure {
  /** CLI executable name */
  executable: string;
  /** Primary command ('start' or 'run') */
  command: string;
  /** Optional subcommand for 'run' command */
  subcommand?: string;
  /** Additional command arguments (flags, options, positional args) */
  args: string[];
}

const TASK_TYPE_TO_WORKFLOW: Record<ExecutionTaskType, WorkflowMapping> = {
  code_generation: {
    workflow: 'codemachine start',
    command: 'start',
    useNativeEngine: false,
  },
  testing: {
    workflow: 'native-autofix',
    command: 'run',
    useNativeEngine: true,
  },
  pr_creation: {
    workflow: 'codemachine run pr',
    command: 'run',
    subcommand: 'pr',
    useNativeEngine: false,
  },
  deployment: {
    workflow: 'native-deployment',
    command: 'run',
    useNativeEngine: true,
  },
  review: {
    workflow: 'codemachine run review',
    command: 'run',
    subcommand: 'review',
    useNativeEngine: false,
  },
  refactoring: {
    workflow: 'codemachine start',
    command: 'start',
    useNativeEngine: false,
  },
  documentation: {
    workflow: 'codemachine run docs',
    command: 'run',
    subcommand: 'docs',
    useNativeEngine: false,
  },
  other: {
    workflow: 'codemachine start',
    command: 'start',
    useNativeEngine: false,
  },
};

// Helper to extract agent ID for backward compatibility
const TASK_TYPE_TO_AGENT: Record<ExecutionTaskType, string> = {
  code_generation: 'code-generator',
  testing: 'test-runner',
  pr_creation: 'pr-creator',
  deployment: 'deployer',
  review: 'code-reviewer',
  refactoring: 'refactorer',
  documentation: 'doc-writer',
  other: 'general',
};

export function mapTaskToWorkflow(taskType: ExecutionTaskType): WorkflowMapping {
  return TASK_TYPE_TO_WORKFLOW[taskType];
}

export function shouldUseNativeEngine(taskType: ExecutionTaskType): boolean {
  return TASK_TYPE_TO_WORKFLOW[taskType].useNativeEngine;
}

const SUPPORTED_ENGINES: readonly ExecutionEngineType[] = ['claude', 'codex', 'openai'] as const;

export function getSupportedEngines(): readonly ExecutionEngineType[] {
  return SUPPORTED_ENGINES;
}

export function isEngineSupported(engine: string): engine is ExecutionEngineType {
  return SUPPORTED_ENGINES.includes(engine as ExecutionEngineType);
}

export function assertEngineSupported(engine: string): asserts engine is ExecutionEngineType {
  if (!isEngineSupported(engine)) {
    const supportedList = SUPPORTED_ENGINES.join(', ');
    const error = new Error(`Engine '${engine}' not supported. Supported: ${supportedList}`);
    (error as { code?: string }).code = 'EC-EXEC-007';
    throw error;
  }
}

/**
 * Type guard to check if a string is a valid command
 */
export function isValidCommand(command: string): command is AllowedCommand {
  return ALLOWED_COMMANDS.includes(command as AllowedCommand);
}

/**
 * Type guard to check if a string is a valid subcommand
 */
export function isValidSubcommand(subcommand: string): subcommand is AllowedSubcommand {
  return ALLOWED_SUBCOMMANDS.includes(subcommand as AllowedSubcommand);
}

/**
 * Validate command structure for security
 * @throws Error if command or subcommand is invalid
 */
export function validateCommandStructure(structure: CommandStructure): void {
  if (!isValidCommand(structure.command)) {
    const error = new Error(
      `Invalid command: '${structure.command}'. Allowed: ${ALLOWED_COMMANDS.join(', ')}`
    );
    (error as { code?: string }).code = 'EC-EXEC-008';
    throw error;
  }

  if (structure.subcommand !== undefined && !isValidSubcommand(structure.subcommand)) {
    const error = new Error(
      `Invalid subcommand: '${structure.subcommand}'. Allowed: ${ALLOWED_SUBCOMMANDS.join(', ')}`
    );
    (error as { code?: string }).code = 'EC-EXEC-009';
    throw error;
  }

  // Validate that 'start' command doesn't have a subcommand
  if (structure.command === 'start' && structure.subcommand !== undefined) {
    const error = new Error(`Command 'start' does not support subcommands`);
    (error as { code?: string }).code = 'EC-EXEC-010';
    throw error;
  }
}

/**
 * Get the command structure for a task type
 *
 * Returns the base command structure without additional arguments.
 * Use buildCommandArgs() to get the complete argument list.
 *
 * @param taskType - The execution task type
 * @returns Command structure with executable, command, and optional subcommand
 */
export function getCommandStructure(taskType: ExecutionTaskType): CommandStructure {
  const { command, subcommand } = TASK_TYPE_TO_WORKFLOW[taskType];

  const structure: CommandStructure = {
    executable: 'codemachine',
    command,
    args: [],
  };

  // Only include subcommand if defined (exactOptionalPropertyTypes compliance)
  if (subcommand !== undefined) {
    structure.subcommand = subcommand;
  }

  return structure;
}

/**
 * Options for building command arguments
 */
export interface BuildCommandArgsOptions {
  /** Task prompt or description */
  prompt: string;
  /** Workspace directory path (absolute) */
  workspaceDir: string;
  /** Optional specification file path */
  specPath?: string;
  /** Execution engine (required for 'start' command, defaults to 'claude') */
  engine?: ExecutionEngineType;
}

/**
 * Build complete command arguments for CodeMachine CLI execution
 *
 * Constructs the full argument array based on task type and options.
 * Arguments are ordered correctly for subprocess execution.
 *
 * @param taskType - The execution task type
 * @param options - Execution options with prompt, workspace, etc.
 * @returns Array of command arguments ready for spawn()
 *
 * @example
 * // For code_generation task
 * buildCommandArgs('code_generation', {
 *   prompt: 'Implement auth',
 *   workspaceDir: '/workspace',
 *   specPath: '/spec.md',
 *   engine: 'claude'
 * })
 * // Returns: ['start', '-d', '/workspace', '--spec', '/spec.md', 'claude', 'Implement auth']
 *
 * @example
 * // For pr_creation task
 * buildCommandArgs('pr_creation', {
 *   prompt: 'Create PR',
 *   workspaceDir: '/workspace'
 * })
 * // Returns: ['run', 'pr', '-d', '/workspace', 'Create PR']
 */
export function buildCommandArgs(
  taskType: ExecutionTaskType,
  options: BuildCommandArgsOptions
): string[] {
  const mapping = TASK_TYPE_TO_WORKFLOW[taskType];
  const args: string[] = [];

  // Add primary command
  args.push(mapping.command);

  // Add subcommand if present (for 'run' command)
  if (mapping.subcommand) {
    args.push(mapping.subcommand);
  }

  // Add workspace directory flag
  if (options.workspaceDir) {
    args.push('-d', options.workspaceDir);
  }

  // Add spec file flag if provided
  if (options.specPath) {
    args.push('--spec', options.specPath);
  }

  // Add engine for 'start' command (required)
  if (mapping.command === 'start') {
    const engine = options.engine ?? 'claude';
    assertEngineSupported(engine);
    args.push(engine);
  }

  // Add prompt as final positional argument
  args.push(options.prompt);

  return args;
}

/**
 * @deprecated Use buildCommandArgs() instead.
 * This function is maintained for backward compatibility.
 */
export function mapTaskToCommand(
  task: ExecutionTask,
  options: {
    engine: ExecutionEngineType;
    workingDir: string;
    specPath?: string;
    inputFiles?: string[];
    tailLines?: number;
  }
): CodeMachineCommand {
  assertEngineSupported(options.engine);

  const agentId =
    (task.config?.agent_id as string | undefined) ?? TASK_TYPE_TO_AGENT[task.task_type];

  const prompt = (task.config?.prompt as string | undefined) ?? task.title;

  let agentSpec = agentId;
  const modifiers: string[] = [];

  if (options.inputFiles && options.inputFiles.length > 0) {
    const sanitizedFiles = options.inputFiles
      .map((f) => sanitizeFilePath(f, options.workingDir))
      .filter((f): f is string => f !== null);

    if (sanitizedFiles.length > 0) {
      modifiers.push(`input:${sanitizedFiles.join(';')}`);
    }
  }

  if (options.tailLines && options.tailLines > 0) {
    modifiers.push(`tail:${options.tailLines}`);
  }

  if (modifiers.length > 0) {
    agentSpec = `${agentId}[${modifiers.join(',')}]`;
  }

  const args = ['run', agentSpec, prompt];

  if (options.workingDir) {
    args.push('--dir', options.workingDir);
  }

  if (options.specPath) {
    args.push('--spec', options.specPath);
  }

  const result: CodeMachineCommand = {
    command: 'run',
    args,
    engine: options.engine,
    workingDir: options.workingDir,
    prompt,
  };

  if (options.specPath !== undefined) {
    result.specPath = options.specPath;
  }

  return result;
}

export function mapResultToTaskUpdate(
  result: RunnerResult,
  _task: ExecutionTask
): TaskExecutionResult {
  if (result.exitCode === 0) {
    return {
      status: 'completed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      artifacts: extractArtifactPaths(result.stdout),
    };
  }

  const errorInfo = classifyError(result);

  return {
    status: 'failed',
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    error: {
      message: errorInfo.message,
      code: errorInfo.code,
      recoverable: errorInfo.recoverable,
    },
  };
}

interface ErrorClassification {
  message: string;
  code: string;
  recoverable: boolean;
}

function classifyError(result: RunnerResult): ErrorClassification {
  const combinedOutput = `${result.stderr}\n${result.stdout}`.toLowerCase();

  if (result.exitCode === 124) {
    return {
      message: 'Task execution timed out',
      code: 'TIMEOUT',
      recoverable: true,
    };
  }

  if (result.exitCode === 137) {
    return {
      message: 'Task was killed (SIGKILL)',
      code: 'KILLED',
      recoverable: true,
    };
  }

  if (result.exitCode === 130) {
    return {
      message: 'Task was interrupted (SIGINT)',
      code: 'INTERRUPTED',
      recoverable: false,
    };
  }

  if (combinedOutput.includes('rate limit') || combinedOutput.includes('429')) {
    return {
      message: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      recoverable: true,
    };
  }

  if (
    combinedOutput.includes('authentication') ||
    combinedOutput.includes('unauthorized') ||
    combinedOutput.includes('401')
  ) {
    return {
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
      recoverable: false,
    };
  }

  if (
    combinedOutput.includes('network') ||
    combinedOutput.includes('econnrefused') ||
    combinedOutput.includes('etimedout')
  ) {
    return {
      message: 'Network error',
      code: 'NETWORK_ERROR',
      recoverable: true,
    };
  }

  if (combinedOutput.includes('validation') || combinedOutput.includes('invalid')) {
    return {
      message: 'Validation error',
      code: 'VALIDATION_ERROR',
      recoverable: false,
    };
  }

  const stderrFirstLine = result.stderr.split('\n')[0]?.trim() || 'Unknown error';

  return {
    message: stderrFirstLine.slice(0, 200),
    code: 'EXECUTION_ERROR',
    recoverable: true,
  };
}

function sanitizeFilePath(filePath: string, workingDir: string): string | null {
  if (filePath.includes('..')) return null;
  if (filePath.includes('\0')) return null;

  const resolved = path.resolve(workingDir, filePath);
  if (!resolved.startsWith(path.resolve(workingDir))) {
    return null;
  }

  return filePath;
}

export function buildSequentialScript(
  tasks: ExecutionTask[],
  options: {
    engine: ExecutionEngineType;
    workingDir: string;
  }
): string {
  const scripts = tasks.map((task) => {
    const cmd = mapTaskToCommand(task, options);
    return cmd.args[1];
  });

  return scripts.join(' && ');
}

export function buildParallelScript(
  tasks: ExecutionTask[],
  options: {
    engine: ExecutionEngineType;
    workingDir: string;
  }
): string {
  const scripts = tasks.map((task) => {
    const cmd = mapTaskToCommand(task, options);
    return cmd.args[1];
  });

  return scripts.join(' & ');
}
