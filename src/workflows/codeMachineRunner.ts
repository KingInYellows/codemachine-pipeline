import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * CodeMachine CLI Runner
 *
 * Provides a reusable utility to spawn and manage CodeMachine CLI processes
 * with reliable timeout handling, log streaming to disk, and graceful termination.
 *
 * Implements:
 * - REQ-EXEC-001: Process execution with shell: true
 * - REQ-EXEC-013: Two-stage termination (SIGTERM -> 10s -> SIGKILL)
 * - Exit code mapping: 0 = success, 1 = failure, 124 = timeout
 * - Environment sanitization to prevent credential leakage
 *
 * Used by: CLI execution engine, workflow orchestration
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Options for running the CodeMachine CLI
 */
export interface CodeMachineRunnerOptions {
  /** Path to the CodeMachine CLI executable */
  cliPath: string;
  /** AI engine to use for code generation */
  engine: 'claude' | 'codex' | 'openai';
  /** Working directory for the CLI process */
  workspaceDir: string;
  /** Path to the specification file */
  specPath: string;
  /** Timeout in milliseconds before termination */
  timeoutMs: number;
  /** Path to the log file for stdout/stderr streaming */
  logPath: string;
  /** Additional environment variables to pass to the process */
  env?: Record<string, string>;
}

/**
 * Result from running the CodeMachine CLI
 */
export interface CodeMachineResult {
  /** Exit code from the process (0 = success, 1 = failure, 124 = timeout) */
  exitCode: number;
  /** Captured stdout content */
  stdout: string;
  /** Captured stderr content */
  stderr: string;
  /** Total execution duration in milliseconds */
  durationMs: number;
  /** Whether the process was terminated due to timeout */
  timedOut: boolean;
  /** Whether the process was killed (by timeout or signal) */
  killed: boolean;
}

/**
 * Result from validating CLI availability
 */
export interface CliAvailabilityResult {
  /** Whether the CLI is available and executable */
  available: boolean;
  /** CLI version string if available */
  version?: string;
  /** Error message if CLI is not available */
  error?: string;
}

// ============================================================================
// Environment Sanitization
// ============================================================================

/**
 * Whitelist of environment variables that are safe to pass to child processes.
 * This prevents credential leakage by only allowing known-safe variables.
 */
const ENV_WHITELIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_ENV',
  'NODE_OPTIONS',
]);

/**
 * Create a sanitized environment object from the current process environment.
 * Only includes whitelisted variables plus any explicit overrides.
 *
 * @param overrides - Additional environment variables to include
 * @returns Sanitized environment object
 */
function createSanitizedEnv(overrides?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  // Copy whitelisted variables from current environment
  for (const key of ENV_WHITELIST) {
    const value = process.env[key];
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  // Merge explicit overrides (these are intentionally passed by the caller)
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================================
// Log File Management
// ============================================================================

/**
 * Ensure the log file directory exists and create/truncate the log file.
 *
 * @param logPath - Path to the log file
 */
function ensureLogFile(logPath: string): void {
  const logDir = path.dirname(logPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Create or truncate the log file
  fs.writeFileSync(logPath, '', 'utf-8');
}

/**
 * Append data to the log file.
 *
 * @param logPath - Path to the log file
 * @param data - Data to append
 * @param stream - Stream identifier ('stdout' or 'stderr')
 */
function appendToLog(logPath: string, data: string, stream: 'stdout' | 'stderr'): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${stream}] `;
  const lines = data.split('\n').map((line) => (line ? prefix + line : '')).join('\n');
  fs.appendFileSync(logPath, lines, 'utf-8');
}

// ============================================================================
// Main Runner Function
// ============================================================================

/**
 * Run the CodeMachine CLI with the specified options.
 *
 * Features:
 * - Spawns CLI with shell: true for cross-platform compatibility
 * - Streams stdout/stderr to log file in real-time
 * - Implements graceful termination: SIGTERM -> 10s grace -> SIGKILL
 * - Maps exit codes: 0 = success, 1 = failure, 124 = timeout
 * - Sanitizes environment to prevent credential leakage
 *
 * @param options - Runner options
 * @returns Promise resolving to execution result
 */
export async function runCodeMachine(options: CodeMachineRunnerOptions): Promise<CodeMachineResult> {
  const startTime = Date.now();

  // Ensure log file exists
  ensureLogFile(options.logPath);

  // Build command arguments
  const args = [
    '--engine', options.engine,
    '--spec', options.specPath,
  ];

  // Build full command string for shell execution
  const command = `"${options.cliPath}" ${args.map((arg) => `"${arg}"`).join(' ')}`;

  // Create sanitized environment
  const env = createSanitizedEnv(options.env);

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let killed = false;
    let killHandle: NodeJS.Timeout | undefined;

    // Spawn the process with shell: true
    const childProcess = spawn(command, {
      cwd: options.workspaceDir,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Set up timeout handler
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killed = true;

      // Send SIGTERM for graceful shutdown
      childProcess.kill('SIGTERM');

      // Force kill after 10 seconds if still alive
      killHandle = setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
      }, 10000);
    }, options.timeoutMs);

    // Capture and stream stdout
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      const data = chunk.toString('utf-8');
      appendToLog(options.logPath, data, 'stdout');
    });

    // Capture and stream stderr
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      const data = chunk.toString('utf-8');
      appendToLog(options.logPath, data, 'stderr');
    });

    // Handle process exit
    childProcess.on('close', (code, signal) => {
      // Clear timeouts
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle) {
        clearTimeout(killHandle);
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const durationMs = Date.now() - startTime;

      // Determine if process was killed by signal
      if (signal) {
        killed = true;
      }

      // Map exit code according to specification
      let exitCode: number;
      if (timedOut) {
        exitCode = 124; // Timeout exit code (convention)
      } else if (code === 0) {
        exitCode = 0; // Success
      } else {
        exitCode = 1; // Generic failure (original code preserved in logs)
      }

      // Log final status
      const finalStatus = timedOut
        ? `Process timed out after ${options.timeoutMs}ms`
        : `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
      appendToLog(options.logPath, `\n--- ${finalStatus} ---\n`, 'stderr');

      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs,
        timedOut,
        killed,
      });
    });

    // Handle spawn errors
    childProcess.on('error', (error) => {
      // Clear timeouts
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle) {
        clearTimeout(killHandle);
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const durationMs = Date.now() - startTime;

      // Log error
      const errorMessage = `Process spawn error: ${error.message}`;
      appendToLog(options.logPath, errorMessage, 'stderr');

      resolve({
        exitCode: 1,
        stdout,
        stderr: errorMessage,
        durationMs,
        timedOut: false,
        killed: false,
      });
    });
  });
}

// ============================================================================
// CLI Availability Check
// ============================================================================

/**
 * Validate that the CodeMachine CLI is available and executable.
 *
 * Executes the CLI with --version flag to verify:
 * - The CLI exists at the specified path
 * - The CLI is executable
 * - The CLI responds with version information
 *
 * @param cliPath - Path to the CodeMachine CLI executable
 * @returns Promise resolving to availability result
 */
export async function validateCliAvailability(cliPath: string): Promise<CliAvailabilityResult> {
  return new Promise((resolve) => {
    const command = `"${cliPath}" --version`;
    const env = createSanitizedEnv();

    const childProcess = spawn(command, {
      shell: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // Set a reasonable timeout for version check (10 seconds)
    const timeoutHandle = setTimeout(() => {
      childProcess.kill('SIGKILL');
    }, 10000);

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    childProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    childProcess.on('close', (code) => {
      clearTimeout(timeoutHandle);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code === 0) {
        // Extract version from stdout (typically first line or entire output)
        const version = stdout.split('\n')[0] || stdout;
        resolve({
          available: true,
          version,
        });
      } else {
        resolve({
          available: false,
          error: stderr || `CLI exited with code ${code}`,
        });
      }
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        available: false,
        error: error.message,
      });
    });
  });
}
