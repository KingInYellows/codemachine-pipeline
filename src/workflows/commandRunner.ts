/**
 * Command Runner
 *
 * Extracted from autoFixEngine.ts: secure child process execution utilities
 * for running validation commands without shell injection risk.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StructuredLogger } from '../telemetry/logger';
import { getErrorMessage } from '../utils/errors.js';

/**
 * Shell metacharacters that indicate shell interpretation is required.
 * These characters can enable command injection if user input contains them.
 */
export const SHELL_METACHARACTERS = /[|&;`$<>(){}[\]!*?~#\u0000]/u;

/**
 * Stricter metacharacter check for user-provided template values.
 * Includes quotes and whitespace to block multi-token substitutions.
 */
export const TEMPLATE_VALUE_METACHARACTERS = /[|&;`$<>(){}[\]!*?~#"'\s\u0000]/u;

/**
 * Parse command string into executable and arguments array.
 * Handles quoted arguments (single and double quotes) properly.
 *
 * Security: This parser extracts arguments without shell interpretation,
 * preventing command injection via metacharacters.
 *
 * @param command - Command string to parse (e.g., "npm run lint -- --fix")
 * @returns Tuple of [executable, args[]]
 */
export function parseCommandString(command: string): [string, string[]] {
  const parts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && (inSingleQuote || inDoubleQuote)) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    throw new Error('Empty command string');
  }

  return [parts[0], parts.slice(1)];
}

/**
 * Execute shell command with timeout.
 *
 * SECURITY: This function prevents command injection by:
 * 1. Using execFile instead of spawn with shell:true
 * 2. Parsing commands into executable + args without shell interpretation
 * 3. Detecting shell metacharacters and logging warnings
 * 4. Never passing user input directly to a shell
 *
 * Limitations:
 * - Shell features (pipes, redirects, variable expansion) are NOT supported
 * - Commands requiring shell features will fail
 * - Use multiple validation commands instead of shell pipelines
 *
 * @param command - Command string to execute
 * @param options - Execution options (cwd, env, timeout, logger)
 * @returns Promise resolving to exit code, stdout, stderr, and duration
 */
export async function executeShellCommand(
  command: string,
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeout: number;
    logger?: StructuredLogger;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const startTime = Date.now();

  // Security check: Detect shell metacharacters
  if (SHELL_METACHARACTERS.test(command)) {
    options.logger?.warn('Command contains shell metacharacters - potential security risk', {
      command,
      metacharacters_detected: true,
    });
  }

  // Parse command into executable and arguments (without shell interpretation)
  let executable: string;
  let args: string[];

  try {
    [executable, args] = parseCommandString(command);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Command parsing error: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Create promisified execFile for timeout support
  const execFileAsync = promisify(execFile);

  try {
    // Execute command without shell (security: no shell interpretation)
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd: options.cwd,
      env: options.env as Record<string, string>,
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      // CRITICAL: shell is NOT set (defaults to false), preventing command injection
    });

    const durationMs = Date.now() - startTime;

    return {
      exitCode: 0,
      stdout,
      stderr,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;

    // Handle timeout (signal: 'SIGTERM')
    if (error && typeof error === 'object' && 'killed' in error && error.killed) {
      options.logger?.warn('Command timed out', {
        command,
        timeout_ms: options.timeout,
        duration_ms: durationMs,
      });

      return {
        exitCode: 124, // 124 = timeout exit code (convention)
        stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
        stderr: `Command timed out after ${options.timeout}ms`,
        durationMs,
      };
    }

    // Handle command execution errors
    if (error && typeof error === 'object' && 'code' in error) {
      const exitCode = typeof error.code === 'number' ? error.code : 1;
      const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
      const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';

      return {
        exitCode,
        stdout,
        stderr,
        durationMs,
      };
    }

    // Handle other errors
    const errorMessage = getErrorMessage(error);
    options.logger?.error('Command execution error', {
      command,
      error: errorMessage,
    });

    return {
      exitCode: 1,
      stdout: '',
      stderr: `Command execution error: ${errorMessage}`,
      durationMs,
    };
  }
}
