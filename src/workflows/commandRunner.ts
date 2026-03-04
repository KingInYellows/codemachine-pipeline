/**
 * Command Runner
 *
 * Shared child-process execution and retry utilities extracted from
 * autoFixEngine.ts.  Provides secure command execution without shell
 * injection risk, plus helpers for working-directory resolution,
 * template rendering, output persistence, and retry back-off.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'shell-quote';
import type { StructuredLogger } from '../telemetry/logger';
import { getErrorMessage } from '../utils/errors.js';

const NULL_BYTE_CHARACTER = String.fromCharCode(0);

export function escapeForCharacterClass(characters: string): string {
  return characters
    .replaceAll('\\', '\\\\')
    .replaceAll(']', '\\]')
    .replaceAll('[', '\\[')
    .replaceAll('^', '\\^')
    .replaceAll('-', '\\-');
}

/**
 * Shell metacharacters that indicate shell interpretation is required.
 * These characters can enable command injection if user input contains them.
 */
export const SHELL_METACHARACTERS = new RegExp(
  `[${escapeForCharacterClass(`|&;\`$<>(){}[]!*?~#${NULL_BYTE_CHARACTER}`)}]`,
  'u'
);

/**
 * Stricter metacharacter check for user-provided template values.
 * Includes quotes and whitespace to block multi-token substitutions.
 */
export const TEMPLATE_VALUE_METACHARACTERS = new RegExp(
  `[${escapeForCharacterClass(`|&;\`$<>(){}[]!*?~#"'${NULL_BYTE_CHARACTER}`)}]|\\s`,
  'u'
);

function createVariablePlaceholder(index: number, command: string): string {
  let placeholder = `__CODEPIPE_LITERAL_VAR_${index}__`;
  while (command.includes(placeholder)) {
    placeholder = `_${placeholder}_`;
  }
  return placeholder;
}

function preserveLiteralVariableReferences(command: string): {
  placeholders: Map<string, string>;
  sanitizedCommand: string;
} {
  const placeholders = new Map<string, string>();
  let sanitizedCommand = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let placeholderIndex = 0;

  for (let i = 0; i < command.length; i += 1) {
    const currentCharacter = command[i];

    if (escaped) {
      sanitizedCommand += currentCharacter;
      escaped = false;
      continue;
    }

    if (currentCharacter === '\\' && !inSingleQuote) {
      sanitizedCommand += currentCharacter;
      escaped = true;
      continue;
    }

    if (currentCharacter === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      sanitizedCommand += currentCharacter;
      continue;
    }

    if (currentCharacter === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      sanitizedCommand += currentCharacter;
      continue;
    }

    if (currentCharacter !== '$' || inSingleQuote) {
      sanitizedCommand += currentCharacter;
      continue;
    }

    const nextCharacter = command[i + 1];
    let variableReferenceLength = 1;

    if (nextCharacter === '{') {
      // NOTE: Does not support nested brace expressions like ${VAR:-${DEFAULT}}.
      // Only simple ${VAR_NAME} and ${SPECIAL} forms are handled.
      const closingBraceIndex = command.indexOf('}', i + 2);
      if (closingBraceIndex === -1) {
        sanitizedCommand += currentCharacter;
        continue;
      }
      variableReferenceLength = closingBraceIndex - i + 1;
    } else if (nextCharacter && /[*@#?$!_-]/u.test(nextCharacter)) {
      variableReferenceLength = 2;
    } else if (nextCharacter && /\w/u.test(nextCharacter)) {
      let endIndex = i + 1;
      while (endIndex < command.length && /\w/u.test(command[endIndex])) {
        endIndex += 1;
      }
      variableReferenceLength = endIndex - i;
    }

    if (variableReferenceLength === 1) {
      sanitizedCommand += currentCharacter;
      continue;
    }

    const literalVariableReference = command.slice(i, i + variableReferenceLength);
    const placeholder = createVariablePlaceholder(placeholderIndex, command);

    placeholders.set(placeholder, literalVariableReference);
    sanitizedCommand += placeholder;
    placeholderIndex += 1;
    i += variableReferenceLength - 1;
  }

  return { placeholders, sanitizedCommand };
}

function restoreLiteralVariableReferences(
  parsedArgument: string,
  placeholders: ReadonlyMap<string, string>
): string {
  let restoredArgument = parsedArgument;
  for (const [placeholder, literalVariableReference] of placeholders) {
    restoredArgument = restoredArgument.replaceAll(placeholder, literalVariableReference);
  }
  return restoredArgument;
}

/**
 * Parse command string into executable and arguments array.
 * Handles quoted arguments (single and double quotes) properly.
 *
 * Security: Delegates to shell-quote while preserving raw $VARS / ${VARS}
 * references as literal text.
 * Shell operators (|, &&, ;, etc.) are rejected instead of interpreted or
 * silently discarded, preventing command injection and argument rewriting.
 *
 * Behavioral note: Unquoted `#` starts a comment (POSIX shell semantics).
 * For example, `echo hello # world` parses as ['echo', 'hello', '# world']
 * (comment merged into one token), not ['echo', 'hello', '#', 'world'].
 * Quote the `#` if you need it as a separate literal token.
 *
 * @param command - Command string to parse (e.g., "npm run lint -- --fix")
 * @returns Tuple of [executable, args[]]
 */
export function parseCommandString(command: string): [string, string[]] {
  const { placeholders, sanitizedCommand } = preserveLiteralVariableReferences(command);
  const parts = parse(sanitizedCommand).map((part) => {
  if (parts.length === 0) {
    throw new Error('Empty command string');
  }

  return [parts[0], parts.slice(1)];
}

// ---------------------------------------------------------------------------
// Path & working-directory helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the repository root from a run directory.
 *
 * Run directories live at `<repo>/.codepipe/runs/<id>`, so the repo
 * root is three levels up.
 */
export function resolveRepoRoot(runDir: string): string {
  return path.resolve(runDir, '..', '..', '..');
}

/**
 * Resolve the working directory for a command.
 *
 * If an `override` is provided it takes precedence; otherwise the
 * command's own `commandCwd` is used.  Relative paths are resolved
 * against `repoRoot`.
 */
export function resolveWorkingDirectory(
  repoRoot: string,
  commandCwd: string,
  override?: string
): string {
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
  }

  return path.isAbsolute(commandCwd) ? commandCwd : path.resolve(repoRoot, commandCwd);
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

/**
 * Build the context object used for command-template interpolation.
 *
 * Throws if any caller-supplied `templateContext` value contains shell
 * metacharacters.
 */
export function buildCommandTemplateContext(
  runDir: string,
  repoRoot: string,
  commandCwd: string,
  templateContext?: Record<string, string>
): Record<string, string> {
  for (const [key, value] of Object.entries(templateContext ?? {})) {
    if (SHELL_METACHARACTERS.test(value)) {
      throw new Error(
        `Template context value for "${key}" contains shell metacharacters which are not permitted`
      );
    }
  }

  return {
    feature_id: path.basename(runDir),
    run_dir: runDir,
    repo_root: repoRoot,
    command_cwd: commandCwd,
    ...(templateContext ?? {}),
  };
}

/**
 * Apply mustache-style `{{ key }}` interpolation to a command template.
 */
export function applyCommandTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => context[key] ?? '');
}

// ---------------------------------------------------------------------------
// Output persistence
// ---------------------------------------------------------------------------

/**
 * Persist command stdout / stderr to the run directory.
 *
 * Files are written under `<runDir>/validation/outputs/`.
 *
 * @returns Relative paths (from `runDir`) for each file.
 */
export async function saveCommandOutput(
  runDir: string,
  commandType: string,
  attemptId: string,
  stdout: string,
  stderr: string
): Promise<{ stdoutPath: string; stderrPath: string }> {
  const outputDir = path.join(runDir, 'validation', 'outputs');
  await fs.mkdir(outputDir, { recursive: true });

  const stdoutPath = `validation/outputs/${commandType}_${attemptId}.stdout.txt`;
  const stderrPath = `validation/outputs/${commandType}_${attemptId}.stderr.txt`;

  const stdoutAbsPath = path.join(runDir, stdoutPath);
  const stderrAbsPath = path.join(runDir, stderrPath);

  await Promise.all([
    fs.writeFile(stdoutAbsPath, stdout, 'utf-8'),
    fs.writeFile(stderrAbsPath, stderr, 'utf-8'),
  ]);

  return { stdoutPath, stderrPath };
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for `ms` milliseconds.  Used for retry back-off.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shell command execution
// ---------------------------------------------------------------------------

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
