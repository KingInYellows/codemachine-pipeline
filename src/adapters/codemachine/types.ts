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

// Re-export CLI path validation from shared utility
export { validateCliPath } from '../../validation/cliPath.js';
