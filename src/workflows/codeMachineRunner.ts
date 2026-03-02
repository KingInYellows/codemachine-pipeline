import * as fs from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { ExecutionConfig, ExecutionEngineType } from '../core/config/RepoConfig.js';
import type { StructuredLogger } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import { filterEnvironment as filterEnv } from '../utils/envFilter.js';
import { validateCliPath } from '../validation/cliPath.js';
import { runProcess } from '../utils/processRunner.js';
export { validateCliPath };

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
        error: getErrorMessage(error),
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
      const errorDetail = getErrorMessage(err);
      return { available: false, error: `CLI not accessible at ${cliPath}: ${errorDetail}` };
    }
  }

  // Try to get version
  const result = await runProcess(cliPath, ['--version'], { timeoutMs: 5000 });

  if (result.exitCode === 0) {
    const version = result.stdout.trim().split('\n')[0]?.trim();
    return { available: true, version };
  }

  return {
    available: false,
    error:
      result.stderr.startsWith('Execution error:') ||
      result.stderr.startsWith('Failed to spawn process:')
        ? `Failed to execute CLI: ${result.stderr}`.trim()
        : `CLI returned exit code ${result.exitCode}: ${result.stderr || result.stdout}`.trim(),
  };
}

function filterEnvironment(allowlist: string[]): Record<string, string> {
  return filterEnv({ additional: allowlist, includeDebug: true });
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
  const envAllowlist = [...(config.env_allowlist ?? []), ...(options.envAllowlist ?? [])].filter(
    (value) => value.length > 0
  );
  const env = filterEnvironment(envAllowlist);

  options.logger?.info('Starting CodeMachine execution', {
    task_id: options.taskId,
    engine,
    cli_path: config.codemachine_cli_path,
    workspace: options.workspaceDir,
    timeout_ms: options.timeoutMs,
  });

  // ── Log-stream setup (specific to codeMachineRunner) ────────────────────
  let initialLogSize = 0;
  if (options.logPath) {
    try {
      const stats = await fs.stat(options.logPath);
      initialLogSize = stats.size;
    } catch {
      initialLogSize = 0;
    }
  }

  let logStream: WriteStream | undefined;
  let logSize = initialLogSize;
  let logQueue: Promise<void> = Promise.resolve();
  let enqueueLogWrite: (chunk: Buffer) => void = () => undefined;

  if (options.logPath) {
    const logPath = options.logPath;
    const attachLogStream = (): WriteStream => {
      const stream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
      stream.on('error', (err) => {
        options.logger?.warn('Log stream error, disabling file logging', {
          task_id: options.taskId,
          logPath,
          error: err.message,
        });
        logStream = undefined;
      });
      return stream;
    };

    logStream = attachLogStream();

    enqueueLogWrite = (chunk: Buffer): void => {
      if (!logPath || !logStream) {
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

          await new Promise<void>((innerResolve) => {
            if (!streamToClose) {
              innerResolve();
              return;
            }
            streamToClose.end(() => innerResolve());
          });

          await rotateLogFiles(
            logPath,
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

  // ── Spawn via shared utility ─────────────────────────────────────────────
  const maxBufferSize =
    config.max_log_buffer_size && config.max_log_buffer_size > 0
      ? config.max_log_buffer_size
      : undefined;

  const result = await runProcess(config.codemachine_cli_path, args, {
    cwd: options.workspaceDir,
    env,
    timeoutMs: options.timeoutMs,
    ...(maxBufferSize !== undefined ? { maxBufferSize } : {}),
    onStdoutChunk: enqueueLogWrite,
    onStderrChunk: enqueueLogWrite,
    onBufferLimitExceeded: (totalBytes) => {
      options.logger?.warn('Large output detected, streaming to file only', {
        task_id: options.taskId,
        buffer_size: totalBytes,
      });
    },
  });

  // Flush log stream after process exits
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

  // ── Map result to RunnerResult ───────────────────────────────────────────
  if (result.timedOut) {
    options.logger?.warn('CodeMachine execution timed out', {
      task_id: options.taskId,
      timeout_ms: options.timeoutMs,
      duration_ms: result.durationMs,
      killed: result.killed,
    });
  } else {
    if (result.exitCode !== EXIT_CODES.SUCCESS) {
      const rawError = result.stderr || result.stdout || 'Unknown error';
      const error = rawError
        .replace(/^Execution error:\s*/u, '')
        .replace(/^Failed to spawn process:\s*/u, '');
      options.logger?.error('CodeMachine execution error', {
        task_id: options.taskId,
        error,
      });
    } else {
      options.logger?.info('CodeMachine execution completed', {
        task_id: options.taskId,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
      });
    }
  }

  return {
    taskId: options.taskId,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.timedOut
      ? `${result.stderr}\n\nExecution timed out after ${options.timeoutMs}ms`
      : result.stderr.startsWith('Failed to spawn process:')
        ? result.stderr.replace('Failed to spawn process:', 'Failed to spawn CodeMachine CLI:')
        : result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    killed: result.killed,
  };
}

export function isSuccess(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.SUCCESS;
}

export function isRecoverable(result: RunnerResult): boolean {
  return result.exitCode === EXIT_CODES.FAILURE && !result.timedOut;
}
