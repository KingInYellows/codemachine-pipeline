import { z } from 'zod';

/**
 * CodeMachine-CLI type definitions for the workflow layer.
 *
 * These types represent CodeMachine-CLI concepts (coordination syntax,
 * workflow definitions, engine types) that the pipeline translates to.
 * They live in src/workflows/ because they are workflow-layer concerns,
 * not adapter concerns.
 */

// ============================================================================
// CodeMachine Engine Types (separate from our ExecutionEngineType)
// ============================================================================

/**
 * Engine types supported by CodeMachine-CLI v0.8.0.
 *
 * Our core `ExecutionEngineType` is `claude | codex | openai`.
 * CodeMachine-CLI supports a broader set. We define this separately
 * to avoid widening our core type.
 */
export const CodeMachineEngineTypeSchema = z.enum([
  'opencode',
  'claude',
  'codex',
  'cursor',
  'mistral',
  'auggie',
  'ccr',
]);

export type CodeMachineEngineType = z.infer<typeof CodeMachineEngineTypeSchema>;

// ============================================================================
// Coordination Syntax
// ============================================================================

/**
 * Branded string representing a valid CodeMachine-CLI coordination syntax.
 *
 * Examples:
 *   "claude 'build a login page'"
 *   "claude[input:spec.md,tail:100] 'implement auth' && codex 'write tests'"
 *   "claude 'task A' & codex 'task B'"
 */
export type CoordinationSyntax = string & { readonly __brand: 'CoordinationSyntax' };

/** Zod schema for coordination syntax (non-empty string). */
export const CoordinationSyntaxSchema = z
  .string()
  .min(1, 'Coordination syntax must not be empty')
  .transform((val) => val as CoordinationSyntax);

// ============================================================================
// Workflow Definition (.workflow.js module format)
// ============================================================================

/** A single step in a CodeMachine workflow file. */
export const WorkflowStepSchema = z.object({
  agent: CodeMachineEngineTypeSchema,
  prompt: z.string().min(1),
  input: z.string().optional(),
  depends: z.array(z.string()).optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** The structure exported by a `.workflow.js` module. */
export const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  steps: z.array(WorkflowStepSchema).min(1),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

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
