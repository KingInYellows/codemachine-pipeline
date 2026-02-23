import * as semver from 'semver';
import { resolveBinary, type BinaryResolutionResult } from './binaryResolver.js';
import type { CodeMachineExecutionResult } from './types.js';
import type { ExecutionConfig } from '../../core/config/RepoConfig.js';
import type { StructuredLogger } from '../../telemetry/logger.js';
import { filterEnvironment as filterEnv } from '../../utils/envFilter.js';
import { runProcess } from '../../utils/processRunner.js';

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
    const maxBufferSize =
      this.config.max_log_buffer_size && this.config.max_log_buffer_size > 0
        ? this.config.max_log_buffer_size
        : undefined; // processRunner uses its own default (10 MiB)

    this.logger?.info('Starting CodeMachine-CLI execution', {
      binary: binaryPath,
      source: resolution.source,
      argCount: args.length,
      workspaceDir: options.workspaceDir,
      timeoutMs: options.timeoutMs,
    });

    const env = this.filterEnvironment();

    // Credentials with non-empty values are forwarded via stdin
    const stdinData =
      options.credentials && Object.keys(options.credentials).length > 0
        ? options.credentials
        : undefined;

    const result = await runProcess(binaryPath, args, {
      cwd: options.workspaceDir,
      env,
      timeoutMs: options.timeoutMs,
      ...(maxBufferSize !== undefined ? { maxBufferSize } : {}),
      ...(stdinData !== undefined ? { stdinData } : {}),
      onBufferLimitExceeded: (totalBytes) => {
        this.logger?.warn('Large output detected, truncating in-memory buffer', {
          taskId: options.taskId,
          bufferSize: totalBytes,
        });
      },
    });

    this.logger?.info('CodeMachine-CLI execution completed', {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      killed: result.killed,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      killed: result.killed,
      pid: result.pid,
    };
  }

  private async runCommand(
    binaryPath: string,
    args: string[],
    opts: { timeoutMs: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await runProcess(binaryPath, args, { timeoutMs: opts.timeoutMs });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
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
