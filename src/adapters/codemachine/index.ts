/**
 * CodeMachine-CLI adapter barrel export.
 */

export {
  CodeMachineCLIAdapter,
  type CodeMachineCLIAdapterOptions,
  type AvailabilityResult,
} from './CodeMachineCLIAdapter.js';

export {
  resolveBinary,
  clearBinaryCache,
  type BinaryResolutionResult,
} from './binaryResolver.js';

// Re-export workflow-layer types for adapter consumers
export {
  type CoordinationSyntax,
  type CodeMachineExecutionResult,
  type WorkflowDefinition,
  type WorkflowStep,
  type CodeMachineEngineType,
  CODEMACHINE_STRATEGY_NAMES,
} from '../../workflows/codemachineTypes.js';
