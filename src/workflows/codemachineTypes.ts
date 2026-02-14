import { z } from 'zod';

/**
 * CodeMachine-CLI type definitions for the workflow layer.
 *
 * These types represent CodeMachine-CLI concepts (engine types,
 * execution results, strategy names) that the pipeline translates to.
 * They live in src/workflows/ because they are workflow-layer concerns,
 * not adapter concerns.
 */

// ============================================================================
// CodeMachine Engine Types (separate from our ExecutionEngineType)
// ============================================================================

/**
 * Engine types supported by CodeMachine-CLI.
 *
 * Only the engines that the CodeMachine-CLI binary actually supports
 * are included here.  Note: `openai` is a valid pipeline engine
 * (see `ExecutionEngineType` in RepoConfig.ts) but is NOT supported
 * by the CodeMachine-CLI binary, so it is excluded from this schema.
 * The original schema also listed five additional engines (opencode,
 * cursor, mistral, auggie, ccr) that were never referenced or
 * supported — removed in Todo 015.
 */
export const CodeMachineEngineTypeSchema = z.enum([
  'claude',
  'codex',
]);

export type CodeMachineEngineType = z.infer<typeof CodeMachineEngineTypeSchema>;

// ============================================================================
// Adapter Result Types
// ============================================================================

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

// ============================================================================
// Strategy name constants
// ============================================================================

/** Strategy names recognized for CodeMachine telemetry tracking. */
export const CODEMACHINE_STRATEGY_NAMES = new Set(['codemachine', 'codemachine-cli']);
