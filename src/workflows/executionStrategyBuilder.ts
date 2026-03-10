/**
 * Execution Strategy Builder
 *
 * Extracted from src/cli/commands/start.ts so that both start.ts and resume.ts
 * can import shared workflow logic from the workflows layer rather than having
 * one CLI command import from another (finding 126).
 */

import type { StructuredLogger } from '../telemetry/logger';
import type { ExecutionConfig } from '../core/config/RepoConfig.js';
import type { ExecutionStrategy } from './executionStrategy.js';
import { createCodeMachineStrategy } from './codeMachineStrategy.js';
import { createCodeMachineCLIStrategy } from './codeMachineCLIStrategy.js';

export async function buildExecutionStrategies(
  config: ExecutionConfig,
  logger: StructuredLogger,
  factories?: {
    cli?: typeof createCodeMachineCLIStrategy | undefined;
    legacy?: typeof createCodeMachineStrategy | undefined;
  }
): Promise<ExecutionStrategy[]> {
  const cliFactory = factories?.cli ?? createCodeMachineCLIStrategy;
  const legacyFactory = factories?.legacy ?? createCodeMachineStrategy;

  const cliStrategy = cliFactory({ config, logger });
  await cliStrategy.checkAvailability();
  const legacyStrategy = legacyFactory({ config, logger });
  return [cliStrategy, legacyStrategy];
}
