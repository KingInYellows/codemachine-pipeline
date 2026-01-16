/**
 * Task Mapper
 *
 * Maps ExecutionTaskType values to CodeMachine workflow configurations.
 * Provides workflow routing for the execution engine to determine which
 * CodeMachine CLI workflow to invoke for each task type.
 *
 * Key features:
 * - ExecutionTaskType to workflow mapping
 * - Native engine routing for testing tasks (AutoFixEngine)
 * - Supported engine validation
 * - Command type specification (start/run/step)
 *
 * Implements:
 * - CDMCH-17: TaskMapper refactoring for ExecutionTaskType -> CodeMachine workflows
 * - FR-12: Execution Task Generation
 * - ADR-1: Agent Execution Model
 *
 * Used by: CodeMachineStrategy, CLIExecutionEngine
 */

import type { ExecutionTaskType } from '../core/models/ExecutionTask';

// ============================================================================
// Types
// ============================================================================

/**
 * Workflow mapping configuration for CodeMachine CLI
 *
 * Defines how an ExecutionTaskType should be routed to a CodeMachine workflow
 * or native engine for execution.
 */
export interface WorkflowMapping {
  /** CodeMachine workflow name (e.g., 'codemachine', 'pr', 'review', 'docs', 'autofix', 'deploy') */
  workflow: string;
  /** CLI command to invoke: 'start' for new sessions, 'run' for single execution, 'step' for incremental */
  command: 'start' | 'run' | 'step';
  /** Whether to use native engine (AutoFixEngine) instead of CodeMachine CLI */
  useNativeEngine: boolean;
}

/**
 * Supported execution engine types
 *
 * - 'codemachine': CodeMachine CLI for code generation, refactoring, PR creation, etc.
 * - 'autofix': Native AutoFixEngine for validation and testing tasks
 */
export type SupportedEngine = 'codemachine' | 'autofix';

// ============================================================================
// Mapping Configuration
// ============================================================================

/**
 * Task type to workflow mapping table
 *
 * Maps all 8 ExecutionTaskType values to their corresponding workflow configurations.
 *
 * Workflow semantics:
 * - 'codemachine': General-purpose code generation workflow
 * - 'pr': Pull request creation and management workflow
 * - 'review': Code review workflow
 * - 'docs': Documentation generation workflow
 * - 'autofix': Native validation/testing engine (uses AutoFixEngine)
 * - 'deploy': Deployment orchestration workflow
 *
 * Command semantics:
 * - 'start': Initiates a new interactive session (for complex, multi-step tasks)
 * - 'run': Single execution (for atomic, one-shot tasks)
 * - 'step': Incremental execution (for resumable tasks)
 *
 * Native engine routing:
 * - useNativeEngine: true routes to AutoFixEngine for validation/testing
 * - useNativeEngine: false routes to CodeMachine CLI
 */
export const TASK_TYPE_TO_WORKFLOW: Record<ExecutionTaskType, WorkflowMapping> = {
  code_generation: {
    workflow: 'codemachine',
    command: 'start',
    useNativeEngine: false,
  },
  refactoring: {
    workflow: 'codemachine',
    command: 'start',
    useNativeEngine: false,
  },
  other: {
    workflow: 'codemachine',
    command: 'start',
    useNativeEngine: false,
  },
  pr_creation: {
    workflow: 'pr',
    command: 'run',
    useNativeEngine: false,
  },
  review: {
    workflow: 'review',
    command: 'run',
    useNativeEngine: false,
  },
  documentation: {
    workflow: 'docs',
    command: 'run',
    useNativeEngine: false,
  },
  testing: {
    workflow: 'autofix',
    command: 'run',
    useNativeEngine: true,
  },
  deployment: {
    workflow: 'deploy',
    command: 'run',
    useNativeEngine: false,
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Supported execution engines constant
 */
const SUPPORTED_ENGINES: readonly SupportedEngine[] = ['codemachine', 'autofix'];

/**
 * Map an ExecutionTaskType to its corresponding workflow configuration
 *
 * @param taskType - The execution task type to map
 * @returns WorkflowMapping configuration for the task type
 * @throws Error if taskType is not a valid ExecutionTaskType
 *
 * @example
 * ```typescript
 * const mapping = mapTaskToWorkflow('code_generation');
 * // Returns: { workflow: 'codemachine', command: 'start', useNativeEngine: false }
 *
 * const testMapping = mapTaskToWorkflow('testing');
 * // Returns: { workflow: 'autofix', command: 'run', useNativeEngine: true }
 * ```
 */
export function mapTaskToWorkflow(taskType: ExecutionTaskType): WorkflowMapping {
  const mapping = TASK_TYPE_TO_WORKFLOW[taskType];

  if (!mapping) {
    throw new Error(`Unknown task type: ${taskType}`);
  }

  return mapping;
}

/**
 * Get list of supported execution engines
 *
 * Returns the execution strategy/engine names that the TaskMapper supports.
 * These are execution backends, not AI model providers.
 *
 * @returns Array of supported engine names
 *
 * @example
 * ```typescript
 * const engines = getSupportedEngines();
 * // Returns: ['codemachine', 'autofix']
 * ```
 */
export function getSupportedEngines(): SupportedEngine[] {
  return [...SUPPORTED_ENGINES];
}

/**
 * Check if an engine is supported
 *
 * @param engine - Engine name to check
 * @returns true if the engine is supported, false otherwise
 *
 * @example
 * ```typescript
 * isEngineSupported('codemachine'); // true
 * isEngineSupported('autofix');     // true
 * isEngineSupported('unknown');     // false
 * ```
 */
export function isEngineSupported(engine: string): engine is SupportedEngine {
  return SUPPORTED_ENGINES.includes(engine as SupportedEngine);
}

/**
 * Validate and get engine, throwing if unsupported
 *
 * @param engine - Engine name to validate
 * @returns The validated engine name
 * @throws Error if engine is not supported
 *
 * @example
 * ```typescript
 * const engine = validateEngine('codemachine'); // 'codemachine'
 * validateEngine('unknown'); // throws Error('Unsupported engine: unknown')
 * ```
 */
export function validateEngine(engine: string): SupportedEngine {
  if (!isEngineSupported(engine)) {
    throw new Error(`Unsupported engine: ${engine}`);
  }
  return engine;
}

/**
 * Get all task types that use a specific workflow
 *
 * @param workflow - Workflow name to filter by
 * @returns Array of ExecutionTaskType values that use the specified workflow
 *
 * @example
 * ```typescript
 * const codeGenTasks = getTaskTypesForWorkflow('codemachine');
 * // Returns: ['code_generation', 'refactoring', 'other']
 * ```
 */
export function getTaskTypesForWorkflow(workflow: string): ExecutionTaskType[] {
  const taskTypes: ExecutionTaskType[] = [];

  for (const [taskType, mapping] of Object.entries(TASK_TYPE_TO_WORKFLOW)) {
    if (mapping.workflow === workflow) {
      taskTypes.push(taskType as ExecutionTaskType);
    }
  }

  return taskTypes;
}

/**
 * Get all task types that use native engine (AutoFixEngine)
 *
 * @returns Array of ExecutionTaskType values that route to native engine
 *
 * @example
 * ```typescript
 * const nativeTasks = getNativeEngineTasks();
 * // Returns: ['testing']
 * ```
 */
export function getNativeEngineTasks(): ExecutionTaskType[] {
  const taskTypes: ExecutionTaskType[] = [];

  for (const [taskType, mapping] of Object.entries(TASK_TYPE_TO_WORKFLOW)) {
    if (mapping.useNativeEngine) {
      taskTypes.push(taskType as ExecutionTaskType);
    }
  }

  return taskTypes;
}

/**
 * Get workflow configuration summary for debugging/logging
 *
 * @returns Object with workflow statistics and mappings
 */
export function getWorkflowSummary(): {
  totalMappings: number;
  nativeEngineCount: number;
  workflowBreakdown: Record<string, number>;
  commandBreakdown: Record<string, number>;
} {
  const workflowBreakdown: Record<string, number> = {};
  const commandBreakdown: Record<string, number> = {};
  let nativeEngineCount = 0;

  for (const mapping of Object.values(TASK_TYPE_TO_WORKFLOW)) {
    workflowBreakdown[mapping.workflow] = (workflowBreakdown[mapping.workflow] ?? 0) + 1;
    commandBreakdown[mapping.command] = (commandBreakdown[mapping.command] ?? 0) + 1;
    if (mapping.useNativeEngine) {
      nativeEngineCount++;
    }
  }

  return {
    totalMappings: Object.keys(TASK_TYPE_TO_WORKFLOW).length,
    nativeEngineCount,
    workflowBreakdown,
    commandBreakdown,
  };
}
