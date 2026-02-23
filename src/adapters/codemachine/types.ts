import { z } from 'zod';

/**
 * CodeMachine-CLI type definitions for the adapter layer.
 *
 * Moved here from workflows/codemachineTypes.ts to resolve the
 * architectural violation where adapters imported from workflows.
 */

// CodeMachine Engine Types

/**
 * Engine types supported by CodeMachine-CLI.
 *
 * Only the engines that the CodeMachine-CLI binary actually supports
 * are included here. Note: `openai` is a valid pipeline engine
 * (see `ExecutionEngineType` in RepoConfig.ts) but is NOT supported
 * by the CodeMachine-CLI binary, so it is excluded from this schema.
 */
export const CodeMachineEngineTypeSchema = z.enum(['claude', 'codex']);

export type CodeMachineEngineType = z.infer<typeof CodeMachineEngineTypeSchema>;

// Adapter Result Types

/** Result of a CodeMachine-CLI execution via the adapter. */
export interface CodeMachineExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  pid?: number | undefined;
}

// Strategy name constants

/** Strategy names recognized for CodeMachine telemetry tracking. */
export const CODEMACHINE_STRATEGY_NAMES = new Set(['codemachine', 'codemachine-cli']);

// CLI Path Validation

/**
 * Allowlist regex for safe CLI path characters.
 * Uses an allowlist instead of a blocklist to prevent bypass
 * via `$()`, backticks, or Unicode homoglyphs.
 */
const SAFE_CLI_PATH_PATTERN = /^[a-zA-Z0-9_\-./:\\]+$/;

export function validateCliPath(cliPath: string): { valid: boolean; error?: string } {
  if (cliPath.length === 0) {
    return { valid: false, error: 'CLI path is empty' };
  }
  if (cliPath.trim() !== cliPath) {
    return { valid: false, error: 'CLI path contains leading or trailing whitespace' };
  }
  if (!SAFE_CLI_PATH_PATTERN.test(cliPath)) {
    // Provide specific error messages for common attack vectors
    if (/[\n\r]/.test(cliPath)) {
      return { valid: false, error: 'CLI path contains newline characters' };
    }
    if (/[;|&`$(){}]/.test(cliPath)) {
      return { valid: false, error: 'CLI path contains shell metacharacters' };
    }
    return { valid: false, error: 'CLI path contains invalid characters' };
  }
  if (cliPath.split(/[\\/]/).includes('..')) {
    return { valid: false, error: 'CLI path contains path traversal segments (..)' };
  }
  return { valid: true };
}
