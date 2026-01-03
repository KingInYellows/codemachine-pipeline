import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutionConfig, ExecutionEngineType } from '../core/config/RepoConfig.js';
import type { StructuredLogger } from '../telemetry/logger.js';

export const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  TIMEOUT: 124,
  SIGKILL: 137,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface RunnerOptions {
  taskId: string;
  prompt: string;
  engine?: ExecutionEngineType;
  workspaceDir: string;
  specPath?: string;
  timeoutMs: number;
  envAllowlist: string[];
  logger?: StructuredLogger;
}

export interface RunnerResult {
  taskId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}

export async function validateCliPath(cliPath: string): Promise<boolean> {
  if (path.isAbsolute(cliPath)) {
    try {
      await fs.access(cliPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function filterEnvironment(allowlist: string[]): Record<string, string> {
  const filtered: Record<string, string> = {};

  const alwaysAllowed = ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL'];
  const allAllowed = new Set([...alwaysAllowed, ...allowlist]);

  for (const key of allAllowed) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  return filtered;
}

function buildArgs(options: RunnerOptions, engine: ExecutionEngineType): string[] {
  const args: string[] = ['run'];

  if (options.workspaceDir) {
    args.push('-d', options.workspaceDir);
  }

  if (options.specPath) {
    args.push('--spec', options.specPath);
  }

  // The engine and prompt should be separate arguments.
  // No need for manual quoting or escaping when shell: false is used.
  args.push(engine, options.prompt);

  return args;
}

export async function runCodeMachine(
  config: ExecutionConfig,
  options: RunnerOptions
): Promise<RunnerResult> {
  const startTime = Date.now();
  const engine = options.engine ?? config.default_engine;

  const isValid = await validateCliPath(config.codemachine_cli_path);
  if (!isValid) {
    return {
      taskId: options.taskId,
      exitCode: EXIT_CODES.FAILURE,
      stdout: '',
      stderr: `CodeMachine CLI not found or not executable: ${config.codemachine_cli_path}`,
      durationMs: Date.now() - startTime,
      timedOut: false,
      killed: false,
    };
  }

  const args = buildArgs(options, engine);
  const env = filterEnvironment(options.envAllowlist);

  options.logger?.info('Starting CodeMachine execution', {
    task_id: options.taskId,
    engine,
    cli_path: config.codemachine_cli_path,
    workspace: options.workspaceDir,
    timeout_ms: options.timeoutMs,
  });

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let killed = false;

    let childProcess: ChildProcess;
    try {
      childProcess = spawn(config.codemachine_cli_path, args, {
        cwd: options.workspaceDir,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({
        taskId: options.taskId,
        exitCode: EXIT_CODES.FAILURE,
        stdout: '',
        stderr: `Failed to spawn CodeMachine CLI: ${message}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
      });
      return;
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      childProcess.kill('SIGTERM');

      setTimeout(() => {
        if (!childProcess.killed) {
          killed = true;
          childProcess.kill('SIGKILL');
        }
      }, 5000);
    }, options.timeoutMs);

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    childProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    childProcess.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const durationMs = Date.now() - startTime;

      let exitCode: number;
      if (timedOut) {
        exitCode = EXIT_CODES.TIMEOUT;
      } else if (signal === 'SIGKILL') {
        exitCode = EXIT_CODES.SIGKILL;
      } else {
        exitCode = code ?? EXIT_CODES.FAILURE;
      }

      if (timedOut) {
        options.logger?.warn('CodeMachine execution timed out', {
          task_id: options.taskId,
          timeout_ms: options.timeoutMs,
          duration_ms: durationMs,
          killed,
        });
      } else {
        options.logger?.info('CodeMachine execution completed', {
          task_id: options.taskId,
          exit_code: exitCode,
          duration_ms: durationMs,
        });
      }

      resolve({
        taskId: options.taskId,
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\n\nExecution timed out after ${options.timeoutMs}ms` : stderr,
        durationMs,
        timedOut,
        killed,
      });
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);

      options.logger?.error('CodeMachine execution error', {
        task_id: options.taskId,
        error: error.message,
      });

      resolve({
        taskId: options.taskId,
        exitCode: EXIT_CODES.FAILURE,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: `Execution error: ${error.message}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
      });
    });
  });
}

export function isSuccess(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.SUCCESS;
}

export function isRecoverable(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.FAILURE && !result.timedOut;
}
