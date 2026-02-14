/**
 * Workflows barrel export
 *
 * Re-exports public workflow-layer types and strategies.
 */

// Execution strategy interfaces
export {
  type ExecutionStrategy,
  type ExecutionContext,
  type ExecutionStrategyResult,
} from './executionStrategy.js';

// CodeMachine-CLI strategy
export {
  CodeMachineCLIStrategy,
  createCodeMachineCLIStrategy,
  type CodeMachineCLIStrategyOptions,
} from './codeMachineCLIStrategy.js';

// CodeMachine types
export {
  CodeMachineEngineTypeSchema,
  CODEMACHINE_STRATEGY_NAMES,
  type CodeMachineEngineType,
  type CodeMachineExecutionResult,
} from './codemachineTypes.js';
