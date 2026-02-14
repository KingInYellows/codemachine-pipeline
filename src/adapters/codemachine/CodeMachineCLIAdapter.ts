import { spawn } from 'node:child_process';
import * as semver from 'semver';
import { resolveBinary, type BinaryResolutionResult } from './binaryResolver.js';
import type { CodeMachineExecutionResult } from '../../workflows/codemachineTypes.js';
import type { ExecutionConfig } from '../../core/config/RepoConfig.js';
import type { StructuredLogger } from '../../telemetry/logger.js';
import { getErrorMessage } from '../../utils/errors.js';
import { filterEnvironment as filterEnv } from '../../utils/envFilter.js';

export interface CodeMachineCLIAdapterOptions {
  config: ExecutionConfig;
  logger?: StructuredLogger | undefined;
}

export interface AvailabilityResult {
  available: boolean;
  version?: string;
  binaryPath?: string;
  source?: BinaryResolutionResult['source'];
  error?: string;
}

/**
 * Adapter that wraps CodeMachine-CLI binary interactions.
 *
 * Responsibilities:
 * - Binary resolution (delegates to binaryResolver)
 * - Availability + version checking
 * - Spawning with shell:false, timeout, output capture
 * - Credential delegation via stdin
 */
export class CodeMachineCLIAdapter {
  private readonly config: ExecutionConfig;
  private readonly logger: StructuredLogger | undefined;
  private executing = false;

  constructor(options: CodeMachineCLIAdapterOptions) {
    this.config = options.config;
    this.logger = options.logger;
  }

  /**
   * Check if CodeMachine-CLI is available and meets version requirements.
   */
  async validateAvailability(): Promise<AvailabilityResult> {
    const resolution = await resolveBinary();
    if (!resolution.resolved || !resolution.binaryPath) {
      return { available: false, error: resolution.error ?? 'Binary not found' };
    }

    // Run --version to get actual version
    const versionResult = await this.runCommand(resolution.binaryPath, ['--version'], {
      timeoutMs: 5000,
    });

    if (versionResult.exitCode !== 0) {
      return {
        available: false,
        binaryPath: resolution.binaryPath,
        source: resolution.source,
        error: `Version check failed (exit ${versionResult.exitCode}): ${versionResult.stderr}`,
      };
    }

    const version = versionResult.stdout.trim().split('\n')[0]?.trim();

    // Check minimum version if configured
    const minVersion = this.config.codemachine_cli_version;
    if (minVersion && version) {
      const cleaned = semver.coerce(version)?.version ?? null;
      if (cleaned && !semver.satisfies(cleaned, `>=${minVersion}`)) {
        return {
          available: false,
          version: cleaned,
          binaryPath: resolution.binaryPath,
          source: resolution.source,
          error: `Version ${cleaned} does not meet minimum ${minVersion}`,
        };
      }
    }

    return {
      available: true,
      version: version ?? undefined,
      binaryPath: resolution.binaryPath,
      source: resolution.source,
    };
  }

  /**
   * Execute a CodeMachine-CLI command with full lifecycle management.
   */
  async execute(
    args: string[],
    options: {
      workspaceDir: string;
      timeoutMs: number;
      runDir?: string;
      taskId?: string;
      credentials?: Record<string, string>;
    }
  ): Promise<CodeMachineExecutionResult> {
    if (this.executing) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Another execution is already in progress',
        durationMs: 0,
        timedOut: false,
        killed: false,
      };
    }

    this.executing = true;
    try {
      return await this.executeInternal(args, options);
    } finally {
      this.executing = false;
    }
  }

  private async executeInternal(
    args: string[],
    options: {
      workspaceDir: string;
      timeoutMs: number;
      runDir?: string;
      taskId?: string;
      credentials?: Record<string, string>;
    }
  ): Promise<CodeMachineExecutionResult> {
    const startTime = Date.now();

    const resolution = await resolveBinary();
    if (!resolution.resolved || !resolution.binaryPath) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: resolution.error ?? 'Binary not found',
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
      };
    }

    const binaryPath = resolution.binaryPath;
    const maxBuffer =
      this.config.max_log_buffer_size && this.config.max_log_buffer_size > 0
        ? this.config.max_log_buffer_size
        : 10 * 1024 * 1024; // 10 MB default
    let totalBufferSize = 0;
    let bufferLimitReached = false;

    this.logger?.info('Starting CodeMachine-CLI execution', {
      binary: binaryPath,
      source: resolution.source,
      argCount: args.length,
      workspaceDir: options.workspaceDir,
      timeoutMs: options.timeoutMs,
    });

    // Filter environment
    const env = this.filterEnvironment();

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let killed = false;
      let hasExited = false;

      let child;
      try {
        child = spawn(binaryPath, args, {
          cwd: options.workspaceDir,
          env,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: `Failed to spawn: ${getErrorMessage(error)}`,
          durationMs: Date.now() - startTime,
          timedOut: false,
          killed: false,
        });
        return;
      }

      const pid = child.pid;

      // Pipe credentials via stdin if provided
      if (options.credentials && Object.keys(options.credentials).length > 0) {
        try {
          child.stdin.write(JSON.stringify(options.credentials) + '\n');
        } catch (error) {
          this.logger?.warn('Failed to write credentials to stdin, killing process', {
            taskId: options.taskId,
            error: getErrorMessage(error),
          });
          child.kill('SIGTERM');
          resolve({
            exitCode: 1,
            stdout: '',
            stderr: `Failed to deliver credentials: ${getErrorMessage(error)}`,
            durationMs: Date.now() - startTime,
            timedOut: false,
            killed: false,
          });
          return;
        }
      }
      child.stdin.end();

      // Timeout: SIGTERM → 5s grace → SIGKILL
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!hasExited) {
            killed = true;
            child.kill('SIGKILL');
          }
        }, 5000);
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (!bufferLimitReached) {
          totalBufferSize += chunk.length;
          if (totalBufferSize > maxBuffer) {
            bufferLimitReached = true;
            this.logger?.warn('Large output detected, truncating in-memory buffer', {
              taskId: options.taskId,
              bufferSize: totalBufferSize,
            });
          } else {
            stdoutChunks.push(chunk);
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (!bufferLimitReached) {
          totalBufferSize += chunk.length;
          if (totalBufferSize > maxBuffer) {
            bufferLimitReached = true;
            this.logger?.warn('Large output detected, truncating in-memory buffer', {
              taskId: options.taskId,
              bufferSize: totalBufferSize,
            });
          } else {
            stderrChunks.push(chunk);
          }
        }
      });

      child.on('close', (code) => {
        hasExited = true;
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startTime;

        this.logger?.info('CodeMachine-CLI execution completed', {
          exitCode: code,
          durationMs,
          timedOut,
          killed,
        });

        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          durationMs,
          timedOut,
          killed,
          pid,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);

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

  private async runCommand(
    binaryPath: string,
    args: string[],
    opts: { timeoutMs: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(binaryPath, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: opts.timeoutMs,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      child.on('error', (error) => {
        resolve({ exitCode: 1, stdout, stderr: getErrorMessage(error) });
      });
    });
  }

  private filterEnvironment(): Record<string, string> {
    // Note: DEBUG intentionally excluded (unlike codeMachineRunner) — prevents internal state leaks
    return filterEnv({
      additional: this.config.env_allowlist ?? [],
      includeDebug: false,
      includeTmpdir: true,
    });
  }
}
