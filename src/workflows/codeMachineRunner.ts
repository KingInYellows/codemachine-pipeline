import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
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
  logger?: StructuredLogger;
  logPath?: string;
}

const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

export interface RunnerResult {
  taskId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}

/**
 * Validate CLI path for security issues
 * Prevents shell injection via path traversal or command chaining
 */
export function validateCliPath(cliPath: string): { valid: boolean; error?: string } {
  // SECURITY: Check for path traversal and command injection characters
  if (cliPath.includes('..')) {
    return { valid: false, error: 'CLI path contains path traversal characters (..)' };
  }
  if (cliPath.includes(';') || cliPath.includes('|') || cliPath.includes('&')) {
    return { valid: false, error: 'CLI path contains shell metacharacters' };
  }
  if (cliPath.includes('\n') || cliPath.includes('\r')) {
    return { valid: false, error: 'CLI path contains newline characters' };
  }
  if (cliPath.trim() !== cliPath) {
    return { valid: false, error: 'CLI path contains leading or trailing whitespace' };
  }
  if (cliPath.length === 0) {
    return { valid: false, error: 'CLI path is empty' };
  }
  return { valid: true };
}

/**
 * Check if CodeMachine CLI is available and get version
 */
export async function validateCliAvailability(
  cliPath: string
): Promise<{ available: boolean; version?: string; error?: string }> {
  // First validate the path itself
  const pathValidation = validateCliPath(cliPath);
  if (!pathValidation.valid) {
    return { available: false, error: pathValidation.error ?? 'Invalid CLI path' };
  }

  // If absolute path, check if executable
  if (path.isAbsolute(cliPath)) {
    try {
      await fs.access(cliPath, fs.constants.X_OK);
    } catch (err) {
      const errorDetail = err instanceof Error ? err.message : String(err);
      return { available: false, error: `CLI not accessible at ${cliPath}: ${errorDetail}` };
    }
  }

  // Try to get version
  return new Promise((resolve) => {
    const childProcess = spawn(cliPath, ['--version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    childProcess.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        // Extract version from output (typically first line)
        const version = stdout.trim().split('\n')[0]?.trim();
        resolve({ available: true, version });
      } else {
        resolve({
          available: false,
          error: `CLI returned exit code ${code}: ${stderr || stdout}`.trim(),
        });
      }
    });

    childProcess.on('error', (error) => {
      resolve({
        available: false,
        error: `Failed to execute CLI: ${error.message}`,
      });
    });
  });
}

function filterEnvironment(): Record<string, string> {
  const filtered: Record<string, string> = {};

  const alwaysAllowed = ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'NODE_ENV', 'DEBUG', 'LOG_LEVEL'];

  for (const key of alwaysAllowed) {
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

  const pathValidation = validateCliPath(config.codemachine_cli_path);
  if (!pathValidation.valid) {
    return {
      taskId: options.taskId,
      exitCode: EXIT_CODES.FAILURE,
      stdout: '',
      stderr: pathValidation.error ?? `Invalid CLI path: ${config.codemachine_cli_path}`,
      durationMs: Date.now() - startTime,
      timedOut: false,
      killed: false,
    };
  }

  const args = buildArgs(options, engine);
  const env = filterEnvironment();

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

    let logStream: WriteStream | undefined;
    let totalBufferSize = 0;
    let bufferLimitReached = false;

    if (options.logPath) {
      logStream = createWriteStream(options.logPath, { flags: 'a', mode: 0o600 });
      logStream.on('error', (err) => {
        options.logger?.warn('Log stream error, disabling file logging', {
          task_id: options.taskId,
          logPath: options.logPath,
          error: err.message,
        });
        logStream = undefined;
      });
    }

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      logStream?.write(chunk);
      if (!bufferLimitReached) {
        totalBufferSize += chunk.length;
        const maxBuffer = DEFAULT_MAX_BUFFER_SIZE;
        if (totalBufferSize > maxBuffer) {
          bufferLimitReached = true;
          options.logger?.warn('Large output detected, streaming to file only', {
            task_id: options.taskId,
            buffer_size: totalBufferSize,
          });
        } else {
          stdoutChunks.push(chunk);
        }
      }
    });

    childProcess.stderr?.on('data', (chunk: Buffer) => {
      logStream?.write(chunk);
      if (!bufferLimitReached) {
        totalBufferSize += chunk.length;
        const maxBuffer = DEFAULT_MAX_BUFFER_SIZE;
        if (totalBufferSize > maxBuffer) {
          bufferLimitReached = true;
          options.logger?.warn('Large output detected, streaming to file only', {
            task_id: options.taskId,
            buffer_size: totalBufferSize,
          });
        } else {
          stderrChunks.push(chunk);
        }
      }
    });

    childProcess.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      logStream?.end();

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
      logStream?.end();

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
