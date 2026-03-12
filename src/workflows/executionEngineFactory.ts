/**
 * Execution Engine Factory
 *
 * Shared builder for CLIExecutionEngine used by both PipelineOrchestrator
 * and the resume command. Eliminates duplicated config merging, strategy
 * building, engine construction, and prerequisite validation.
 */

import { CLIExecutionEngine, type PrerequisiteResult } from './cliExecutionEngine';
import { buildExecutionStrategies } from './executionStrategyBuilder.js';
import { DEFAULT_EXECUTION_CONFIG, type RepoConfig } from '../core/config/RepoConfig';
import type { StructuredLogger } from '../telemetry/logger';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';

export interface BuildExecutionEngineParams {
  runDir: string;
  repoConfig: RepoConfig;
  maxParallel?: number | undefined;
  logger: StructuredLogger;
  telemetry: ExecutionTelemetry;
  dryRun?: boolean | undefined;
}

export interface ExecutionEngineBundle {
  engine: CLIExecutionEngine;
  prereqResult: PrerequisiteResult;
}

export async function buildAndValidateExecutionEngine(
  params: BuildExecutionEngineParams
): Promise<ExecutionEngineBundle> {
  const { runDir, repoConfig, maxParallel, logger, telemetry, dryRun = false } = params;

  const executionConfig = repoConfig.execution ?? DEFAULT_EXECUTION_CONFIG;
  const resolvedMaxParallel = maxParallel ?? executionConfig.max_parallel_tasks;
  const mergedExecution = {
    ...executionConfig,
    max_parallel_tasks: resolvedMaxParallel,
  };
  const mergedConfig: RepoConfig = {
    ...repoConfig,
    execution: mergedExecution,
  };

  const strategies = await buildExecutionStrategies(mergedExecution, logger);

  const engine = new CLIExecutionEngine({
    runDir,
    config: mergedConfig,
    strategies,
    dryRun,
    logger,
    telemetry,
  });

  const prereqResult = await engine.validatePrerequisites();

  return { engine, prereqResult };
}
