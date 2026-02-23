/**
 * CodeMachine-CLI adapter barrel export.
 */

export {
  CodeMachineCLIAdapter,
  type CodeMachineCLIAdapterOptions,
  type AvailabilityResult,
} from './CodeMachineCLIAdapter.js';

export { resolveBinary, clearBinaryCache, type BinaryResolutionResult } from './binaryResolver.js';

export {
  type CodeMachineExecutionResult,
  type CodeMachineEngineType,
  CODEMACHINE_STRATEGY_NAMES,
} from './types.js';
