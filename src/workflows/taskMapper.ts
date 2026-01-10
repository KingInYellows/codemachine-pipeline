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

export interface WorkflowMapping {
  workflow: string;
  command: 'start' | 'run';
  useNativeEngine: boolean;
}

const TASK_TYPE_TO_WORKFLOW: Record<ExecutionTaskType, WorkflowMapping> = {
  code_generation: { workflow: 'codemachine start', command: 'start', useNativeEngine: false },
  testing: { workflow: 'native-autofix', command: 'run', useNativeEngine: true },
  pr_creation: { workflow: 'codemachine run pr', command: 'run', useNativeEngine: false },
  deployment: { workflow: 'native-deployment', command: 'run', useNativeEngine: true },
  review: { workflow: 'codemachine run review', command: 'run', useNativeEngine: false },
  refactoring: { workflow: 'codemachine start', command: 'start', useNativeEngine: false },
  documentation: { workflow: 'codemachine run docs', command: 'run', useNativeEngine: false },
  other: { workflow: 'codemachine start', command: 'start', useNativeEngine: false },
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

const SUPPORTED_ENGINES: readonly ExecutionEngineType[] = [
  'claude',
  'codex',
  'openai',
] as const;

export function getSupportedEngines(): readonly ExecutionEngineType[] {
  return SUPPORTED_ENGINES;
}

export function isEngineSupported(engine: string): engine is ExecutionEngineType {
  return SUPPORTED_ENGINES.includes(engine as ExecutionEngineType);
}

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