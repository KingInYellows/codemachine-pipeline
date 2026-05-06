/**
 * CodeMachine Strategy (Legacy)
 *
 * Legacy execution strategy that delegates task execution to the CodeMachine
 * binary. This is the fallback strategy — prefer CodeMachineCLIStrategy for
 * new deployments. Handles tasks whose task_type is not marked as native-only.
 */

import * as path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ExecutionTask } from '../core/models/ExecutionTask.js';
import type { ExecutionConfig } from '../core/config/RepoConfig.js';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy.js';
import {
  runCodeMachine,
  validateCliAvailability,
  type RunnerOptions,
} from './codeMachineRunner.js';
import { mapTaskToWorkflow, shouldUseNativeEngine } from './taskMapper.js';
import { normalizeResult } from './resultNormalizer.js';
import { buildStrategyResult } from './strategyHelpers.js';
import { isPathContained, validateTaskId } from './executionArtifactCapture.js';
import type { StructuredLogger } from '../telemetry/logger.js';

/** Configuration options for the CodeMachine strategy */
export interface CodeMachineStrategyOptions {
  /** Execution configuration from RepoConfig */
  config: ExecutionConfig;
  /** Optional structured logger */
  logger?: StructuredLogger;
}

/**
 * Legacy execution strategy using the CodeMachine binary.
 * Delegates to `runCodeMachine()` for task execution and normalizes results.
 */
export class CodeMachineStrategy implements ExecutionStrategy {
  readonly name = 'codemachine';

  private readonly config: ExecutionConfig;
  private readonly logger: StructuredLogger | undefined;

  constructor(options: CodeMachineStrategyOptions) {
    this.config = options.config;
    this.logger = options.logger;
  }

  canHandle(task: ExecutionTask): boolean {
    return !shouldUseNativeEngine(task.task_type);
  }

  async execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult> {
    const mapping = mapTaskToWorkflow(task.task_type);

    this.logger?.debug('Executing task via CodeMachine', {
      taskId: task.task_id,
      taskType: task.task_type,
      workflow: mapping.workflow,
      command: mapping.command,
    });

    const specPath = await this.buildSpecPath(task, context);
    if (!specPath.valid) {
      this.logger?.warn('Rejected unsafe CodeMachine spec path', {
        taskId: task.task_id,
        error: specPath.errorMessage,
      });
      return {
        success: false,
        status: 'failed',
        summary: specPath.errorMessage,
        errorMessage: specPath.errorMessage,
        recoverable: false,
        durationMs: 0,
        artifacts: [],
      };
    }

    const runnerOptions: RunnerOptions = {
      taskId: task.task_id,
      prompt: task.title,
      workspaceDir: context.workspaceDir,
      specPath: specPath.path,
      timeoutMs: context.timeoutMs,
    };

    if (this.logger) {
      runnerOptions.logger = this.logger;
    }

    const result = await runCodeMachine(this.config, runnerOptions);
    const normalized = normalizeResult(result);

    return buildStrategyResult(normalized);
  }

  async validatePrerequisites(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const cliCheck = await validateCliAvailability(this.config.codemachine_cli_path);
    if (!cliCheck.available) {
      errors.push(cliCheck.error ?? 'CodeMachine CLI not available');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async buildSpecPath(
    task: ExecutionTask,
    context: ExecutionContext
  ): Promise<{ valid: true; path: string } | { valid: false; errorMessage: string }> {
    const taskConfig = task.config;
    if (taskConfig && typeof taskConfig['spec_path'] === 'string') {
      const candidatePath = path.resolve(context.workspaceDir, taskConfig['spec_path']);
      const workspaceDir = path.resolve(context.workspaceDir);

      if (!isPathContained(workspaceDir, candidatePath)) {
        return {
          valid: false,
          errorMessage: 'Invalid spec_path: path must stay within the workspace directory',
        };
      }

      const realCandidatePath = await resolveRealPathSafe(candidatePath);
      const realWorkspaceDir = await resolveRealPathSafe(workspaceDir);
      if (!isPathContained(realWorkspaceDir, realCandidatePath)) {
        return {
          valid: false,
          errorMessage: 'Invalid spec_path: path resolves outside the workspace directory',
        };
      }

      return { valid: true, path: candidatePath };
    }

    if (!validateTaskId(task.task_id)) {
      return {
        valid: false,
        errorMessage: 'Invalid task ID format',
      };
    }

    return { valid: true, path: path.join(context.runDir, 'specs', `${task.task_id}.md`) };
  }
}

async function resolveRealPathSafe(candidatePath: string): Promise<string> {
  try {
    return await realpath(candidatePath);
  } catch {
    return path.resolve(candidatePath);
  }
}

/** Factory function to create a CodeMachineStrategy instance */
export function createCodeMachineStrategy(
  options: CodeMachineStrategyOptions
): CodeMachineStrategy {
  return new CodeMachineStrategy(options);
}
