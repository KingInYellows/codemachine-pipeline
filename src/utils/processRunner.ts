/**
 * Shared child process lifecycle utility.
 *
 * Consolidates the spawn/buffer-collection/SIGTERM-SIGKILL/exit-code pattern
 * that was duplicated across codeMachineRunner.ts and CodeMachineCLIAdapter.ts.
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { getErrorMessage } from './errors.js';

/** Default in-memory buffer cap (10 MiB). */
export const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

/** Grace period between SIGTERM and SIGKILL (ms). */
const SIGKILL_GRACE_MS = 5000;

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  pid?: number | undefined;
}

export interface ProcessRunOptions {
  /** Working directory passed to spawn. */
  cwd?: string | undefined;
  /** Environment variables passed to spawn (shell: false is always enforced). */
  env?: Record<string, string> | undefined;
  /**
   * Maximum combined stdout+stderr bytes to keep in memory.
   * Chunks beyond this limit are discarded from the in-memory buffer
   * (they may still be handled by onData if provided).
   * Defaults to DEFAULT_MAX_BUFFER_SIZE.
   */
  maxBufferSize?: number | undefined;
  /**
   * Milliseconds before sending SIGTERM. After SIGTERM a 5 s grace period
   * elapses before SIGKILL is sent. Pass 0 or omit to disable.
   */
  timeoutMs?: number | undefined;
  /**
   * Called for every stdout chunk before buffer accounting.
   * Return false to prevent the chunk from being added to the in-memory buffer
   * (useful for streaming to a log file without buffering).
   */
  onStdoutChunk?: ((chunk: Buffer) => void) | undefined;
  /**
   * Called for every stderr chunk before buffer accounting.
   */
  onStderrChunk?: ((chunk: Buffer) => void) | undefined;
  /**
   * Called when the combined in-memory buffer limit is first exceeded.
   */
  onBufferLimitExceeded?: ((totalBytes: number) => void) | undefined;
  /**
   * If provided, JSON-serialised and written to stdin then the stream is
   * closed. Otherwise stdin is closed immediately (or kept open per stdio).
   */
  stdinData?: Record<string, string> | undefined;
  /**
   * stdio config for the spawned process.
   * Defaults to ['ignore', 'pipe', 'pipe'] when stdinData is absent,
   * or ['pipe', 'pipe', 'pipe'] when stdinData is provided.
   */
  stdio?: SpawnOptions['stdio'] | undefined;
}

/**
 * Run an external command with managed lifecycle:
 * - shell:false spawn
 * - configurable in-memory buffer cap with optional overflow callback
 * - optional SIGTERM → 5 s grace → SIGKILL timeout
 * - normalised exit-code (timedOut → 124, SIGKILL signal → 137)
 *
 * Throws only for programming errors (bad arguments). Process failures are
 * surfaced via the returned result.
 */
export async function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  const startTime = Date.now();
  const maxBuffer =
    options.maxBufferSize !== undefined && options.maxBufferSize > 0
      ? options.maxBufferSize
      : DEFAULT_MAX_BUFFER_SIZE;

  const defaultStdio: SpawnOptions['stdio'] =
    options.stdinData !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
  const stdio = options.stdio ?? defaultStdio;

  let child;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      ...(options.timeoutMs && options.timeoutMs > 0 ? { timeout: options.timeoutMs } : {}),
      stdio,
    });
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to spawn process: ${getErrorMessage(error)}`,
      durationMs: Date.now() - startTime,
      timedOut: false,
      killed: false,
    };
  }

  const pid = child.pid;

  // Write optional stdin data then close the stream
  if (options.stdinData !== undefined) {
    try {
      child.stdin?.write(JSON.stringify(options.stdinData) + '\n');
    } catch (error) {
      child.kill('SIGTERM');
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Failed to write stdin data: ${getErrorMessage(error)}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
        pid,
      };
    }
  }
  child.stdin?.end();

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let killed = false;
    let hasExited = false;
    let totalBufferSize = 0;
    let bufferLimitReached = false;

    // ── Timeout management ───────────────────────────────────────────────
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!hasExited) {
            killed = true;
            child.kill('SIGKILL');
          }
        }, SIGKILL_GRACE_MS);
      }, options.timeoutMs);
    }

    // ── Buffer accounting helper ─────────────────────────────────────────
    const accountChunk = (chunk: Buffer, target: Buffer[]): void => {
      if (!bufferLimitReached) {
        totalBufferSize += chunk.length;
        if (totalBufferSize > maxBuffer) {
          bufferLimitReached = true;
          options.onBufferLimitExceeded?.(totalBufferSize);
        } else {
          target.push(chunk);
        }
      }
    };

    // ── Stream handlers ──────────────────────────────────────────────────
    child.stdout?.on('data', (chunk: Buffer) => {
      options.onStdoutChunk?.(chunk);
      accountChunk(chunk, stdoutChunks);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      options.onStderrChunk?.(chunk);
      accountChunk(chunk, stderrChunks);
    });

    // ── Exit handling ────────────────────────────────────────────────────
    const buildResult = (code: number | null, signal: NodeJS.Signals | null): ProcessRunResult => {
      let exitCode: number;
      if (timedOut) {
        exitCode = 124;
      } else if (signal === 'SIGKILL') {
        exitCode = 137;
      } else {
        exitCode = code ?? 1;
      }

      return {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        durationMs: Date.now() - startTime,
        timedOut,
        killed,
        pid,
      };
    };

    child.on('close', (code, signal) => {
      hasExited = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      resolve(buildResult(code, signal));
    });

    child.on('error', (error) => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: `Execution error: ${getErrorMessage(error)}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
        pid,
      });
    });
  });
}
