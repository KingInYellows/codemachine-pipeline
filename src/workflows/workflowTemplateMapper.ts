import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ExecutionTaskTypeSchema, type ExecutionTaskType } from '../core/models/ExecutionTask.js';
import type { ExecutionTask } from '../core/models/ExecutionTask.js';
import type { ExecutionConfig, ExecutionEngineType } from '../core/config/RepoConfig.js';
import {
  CoordinationSyntaxSchema,
  type CoordinationSyntax,
} from './codemachineTypes.js';
import type { StructuredLogger } from '../telemetry/logger.js';

/**
 * Allowed task types for template path interpolation.
 * Prevents path traversal by validating task_type before using it in file paths.
 */
const ALLOWED_TASK_TYPES = new Set(ExecutionTaskTypeSchema.options);

/**
 * Default coordination syntax mappings per task type.
 */
const DEFAULT_COORDINATION_MAP: Record<ExecutionTaskType, (engine: ExecutionEngineType, prompt: string, specPath?: string) => string> = {
  code_generation: (engine, prompt, specPath) =>
    specPath
      ? `${engine}[input:${specPath}] '${escapeQuotes(prompt)}'`
      : `${engine} '${escapeQuotes(prompt)}'`,
  testing: (_engine, prompt) =>
    `codex '${escapeQuotes(`write tests for ${prompt}`)}'`,
  pr_creation: (engine, prompt) =>
    `${engine} '${escapeQuotes(`create PR: ${prompt}`)}'`,
  deployment: (_engine, prompt) =>
    `codex '${escapeQuotes(`deploy: ${prompt}`)}'`,
  review: (engine, prompt) =>
    `${engine} '${escapeQuotes(`review: ${prompt}`)}'`,
  refactoring: (engine, prompt) =>
    `${engine} '${escapeQuotes(prompt)}'`,
  documentation: (engine, prompt) =>
    `${engine} '${escapeQuotes(`document: ${prompt}`)}'`,
  other: (engine, prompt) =>
    `${engine} '${escapeQuotes(prompt)}'`,
};

function escapeQuotes(str: string): string {
  return str.replace(/'/g, "'\\''");
}

export interface WorkflowTemplateMapperOptions {
  config: ExecutionConfig;
  logger?: StructuredLogger;
}

/**
 * Translates pipeline tasks into CodeMachine-CLI coordination syntax
 * or .workflow.js file references.
 */
export class WorkflowTemplateMapper {
  private readonly config: ExecutionConfig;
  private readonly logger: StructuredLogger | undefined;

  constructor(options: WorkflowTemplateMapperOptions) {
    this.config = options.config;
    this.logger = options.logger;
  }

  /**
   * Map a task to CodeMachine-CLI coordination syntax string.
   */
  mapTaskToCoordination(task: ExecutionTask): CoordinationSyntax {
    const engine = this.config.default_engine;
    const prompt = (task.config?.prompt as string | undefined) ?? task.title;
    const specPath = task.config?.spec_path as string | undefined;

    const mapFn = DEFAULT_COORDINATION_MAP[task.task_type];
    const syntax = mapFn(engine, prompt, specPath);

    return CoordinationSyntaxSchema.parse(syntax);
  }

  /**
   * Map a task to a .workflow.js file path.
   *
   * Resolution order:
   * 1. Custom template from codemachine_workflow_dir or .codepipe/workflows/
   * 2. Returns null if no custom template exists (caller should use coordination syntax)
   */
  async mapTaskToWorkflowFile(task: ExecutionTask, workspaceDir: string): Promise<string | null> {
    // Security: validate task_type against allowlist before path interpolation
    if (!ALLOWED_TASK_TYPES.has(task.task_type)) {
      this.logger?.warn('Unknown task type, skipping workflow template lookup', {
        taskType: task.task_type,
      });
      return null;
    }

    const workflowDir = this.config.codemachine_workflow_dir
      ?? path.join(workspaceDir, '.codepipe', 'workflows');

    const templateName = `${task.task_type}.workflow.js`;
    const templatePath = path.resolve(workflowDir, templateName);

    // Security: verify resolved path is still within workflowDir (prevent traversal)
    const resolvedWorkflowDir = path.resolve(workflowDir);
    if (!templatePath.startsWith(resolvedWorkflowDir + path.sep) && templatePath !== resolvedWorkflowDir) {
      this.logger?.error('Template path escapes workflow directory', {
        templatePath,
        workflowDir: resolvedWorkflowDir,
        taskType: task.task_type,
      });
      return null;
    }

    try {
      await fs.access(templatePath);
    } catch {
      return null; // No custom template — caller uses coordination syntax
    }

    // Validate the workflow file exports a valid structure
    const valid = await this.validateWorkflowFile(templatePath);
    if (!valid) {
      this.logger?.warn('Workflow template has invalid structure', {
        templatePath,
        taskType: task.task_type,
      });
      return null;
    }

    this.logger?.debug('Using custom workflow template', {
      templatePath,
      taskType: task.task_type,
    });

    return templatePath;
  }

  /**
   * Validate that a .workflow.js file exports a valid WorkflowDefinition.
   */
  private async validateWorkflowFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // Basic structural check — look for module.exports with name and steps
      // Full validation would require eval/import which we avoid for security
      return content.includes('name') && content.includes('steps');
    } catch {
      return false;
    }
  }
}

export function createWorkflowTemplateMapper(
  options: WorkflowTemplateMapperOptions,
): WorkflowTemplateMapper {
  return new WorkflowTemplateMapper(options);
}
