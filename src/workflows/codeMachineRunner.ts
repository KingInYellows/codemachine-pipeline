import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
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
  envAllowlist?: string[];
  logger?: StructuredLogger;
  logPath?: string;
}

const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;
const DEFAULT_LOG_ROTATION_MB = 100;
const DEFAULT_LOG_ROTATION_KEEP = 3;

export interface RunnerResult {
  taskId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}

async function gzipFileInPlace(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath);
  const compressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.gzip(content, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
  await fs.writeFile(filePath, compressed);
}

async function rotateLogFiles(
  logPath: string,
  keep: number,
  compress: boolean,
  logger?: StructuredLogger,
  taskId?: string
): Promise<void> {
  if (keep <= 0) {
    return;
  }

  const oldest = `${logPath}.${keep}`;
  await fs.rm(oldest, { force: true }).catch(() => undefined);

  for (let index = keep - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const destination = `${logPath}.${index + 1}`;
    await fs.rename(source, destination).catch(() => undefined);
  }

  const rotatedPath = `${logPath}.1`;
  const rotated = await fs.rename(logPath, rotatedPath).then(
    () => true,
    () => false
  );

  if (!rotated) {
    return;
  }

  if (compress) {
    await gzipFileInPlace(rotatedPath).catch((error) => {
      logger?.warn('Log rotation compression failed', {
        task_id: taskId,
        log_path: rotatedPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  logger?.warn('Log rotation occurred', {
    task_id: taskId,
    log_path: logPath,
    rotated_path: rotatedPath,
    compressed: compress,
  });
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

function filterEnvironment(allowlist: string[]): Record<string, string> {
  const filtered: Record<string, string> = {};

  const alwaysAllowed = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TERM',
    'LANG',
    'LC_ALL',
    'NODE_ENV',
    'DEBUG',
    'LOG_LEVEL',
  ];

  const allowlistSet = new Set([...alwaysAllowed, ...allowlist]);

  for (const key of allowlistSet) {
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
  const logRotationMb = config.log_rotation_mb ?? DEFAULT_LOG_ROTATION_MB;
  const logRotationKeep = config.log_rotation_keep ?? DEFAULT_LOG_ROTATION_KEEP;
  const logRotationCompress = config.log_rotation_compress ?? false;
  const logRotationBytes = logRotationMb * 1024 * 1024;

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
  const envAllowlist = [
    ...(config.env_allowlist ?? []),
    ...(options.envAllowlist ?? []),
  ].filter((value) => value.length > 0);
  const env = filterEnvironment(envAllowlist);

  options.logger?.info('Starting CodeMachine execution', {
    task_id: options.taskId,
    engine,
    cli_path: config.codemachine_cli_path,
    workspace: options.workspaceDir,
    timeout_ms: options.timeoutMs,
  });

  let initialLogSize = 0;
  if (options.logPath) {
    try {
      const stats = await fs.stat(options.logPath);
      initialLogSize = stats.size;
    } catch {
      initialLogSize = 0;
    }
  }

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
    let logSize = initialLogSize;
    let logQueue: Promise<void> = Promise.resolve();
    let enqueueLogWrite: (chunk: Buffer) => void = () => undefined;
    let totalBufferSize = 0;
    let bufferLimitReached = false;
    const maxBuffer =
      config.max_log_buffer_size && config.max_log_buffer_size > 0
        ? config.max_log_buffer_size
        : DEFAULT_MAX_BUFFER_SIZE;

    if (options.logPath) {
      const attachLogStream = (): WriteStream => {
        const stream = createWriteStream(options.logPath!, { flags: 'a', mode: 0o600 });
        stream.on('error', (err) => {
          options.logger?.warn('Log stream error, disabling file logging', {
            task_id: options.taskId,
            logPath: options.logPath,
            error: err.message,
          });
          logStream = undefined;
        });
        return stream;
      };

      logStream = attachLogStream();

      enqueueLogWrite = (chunk: Buffer): void => {
        if (!options.logPath || !logStream) {
          return;
        }

        logQueue = logQueue.then(async () => {
          if (!logStream) {
            return;
          }

          if (logSize + chunk.length > logRotationBytes) {
            const streamToClose = logStream;
            logStream = undefined;
            logSize = 0;

            await new Promise<void>((resolve) => {
              if (!streamToClose) {
                resolve();
                return;
              }
              streamToClose.end(() => resolve());
            });

            await rotateLogFiles(
              options.logPath!,
              logRotationKeep,
              logRotationCompress,
              options.logger,
              options.taskId
            );

            logStream = attachLogStream();
          }

          logStream?.write(chunk);
          logSize += chunk.length;
        });
      };
    }

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      enqueueLogWrite(chunk);
      if (!bufferLimitReached) {
        totalBufferSize += chunk.length;
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
      enqueueLogWrite(chunk);
      if (!bufferLimitReached) {
        totalBufferSize += chunk.length;
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
      const finalize = async (): Promise<void> => {
        try {
          await logQueue;
        } catch {
          // Ignore log queue errors on shutdown
        }

        if (logStream) {
          await new Promise<void>((flushResolve) => {
            logStream?.end(() => flushResolve());
          });
        }

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
      };

      void finalize();
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);
      const finalize = async (): Promise<void> => {
        try {
          await logQueue;
        } catch {
          // Ignore log queue errors on shutdown
        }

        if (logStream) {
          await new Promise<void>((flushResolve) => {
            logStream?.end(() => flushResolve());
          });
        }

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
      };

      void finalize();
    });
  });
}

export function isSuccess(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.SUCCESS;
}

export function isRecoverable(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.FAILURE && !result.timedOut;
}
