/**
 * Pipeline Orchestrator
 *
 * Coordinates the feature pipeline stages: context aggregation, research
 * detection, PRD authoring, and task execution.
 */

import * as path from 'node:path';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import type { RepoConfig } from '../core/config/RepoConfig';
import { DEFAULT_EXECUTION_CONFIG } from '../core/config/RepoConfig.js';
import { createFeature } from '../core/models/Feature';
import type { ResearchTask } from '../core/models/ResearchTask';
import { aggregateContext, type AggregatorConfig } from './contextAggregator';
import {
  createResearchCoordinator,
  type UnknownDetectionOptions,
} from './researchCoordinator';
import { draftPRD } from './prdAuthoringEngine';
import { CLIExecutionEngine } from './cliExecutionEngine';
import { loadQueue } from './queueStore';
import { buildExecutionStrategies } from './executionStrategyBuilder.js';
import {
  setCurrentStep,
  setLastStep,
  markApprovalRequired,
  updateManifest,
} from '../persistence/manifestManager.js';

/**
 * Thrown when execution prerequisites are not met.
 * The CLI layer can detect this error type and re-wrap it with
 * structured CliError metadata (CONFIG_INVALID, remediation hints).
 */
export class PrerequisiteError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Execution prerequisites failed: ${errors.join(', ')}`);
    this.name = 'PrerequisiteError';
    this.errors = errors;
  }
}

const EXECUTION_STEPS = {
  Context: 'context_aggregation',
  Research: 'research_detection',
  PRD: 'prd_authoring',
  Execution: 'task_execution',
} as const;

export interface PipelineOrchestratorConfig {
  repoRoot: string;
  runDir: string;
  featureId: string;
  featureTitle: string;
  featureSource: string;
  repoConfig: RepoConfig;
  logger: StructuredLogger;
  metrics: MetricsCollector;
  telemetry: ExecutionTelemetry;
}

export interface PipelineInput {
  promptText?: string | undefined;
  specText?: string | undefined;
  linearContextText?: string | undefined;
  maxParallel: number;
  skipExecution: boolean;
}

export interface PipelineResult {
  context: {
    files: number;
    totalTokens: number;
    warnings: string[];
  };
  research: {
    tasksDetected: number;
    pending: number;
  };
  prd: {
    path: string;
    hash: string;
    diagnostics: {
      incompleteSections: string[];
      warnings: string[];
    };
  };
  approvalRequired: boolean;
  execution?: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  } | undefined;
}

export class PipelineOrchestrator {
  currentStep = 'initializing';

  private readonly repoRoot: string;
  private readonly runDir: string;
  private readonly featureId: string;
  private readonly featureTitle: string;
  private readonly featureSource: string;
  private readonly repoConfig: RepoConfig;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;
  private readonly telemetry: ExecutionTelemetry;

  constructor(config: PipelineOrchestratorConfig) {
    this.repoRoot = config.repoRoot;
    this.runDir = config.runDir;
    this.featureId = config.featureId;
    this.featureTitle = config.featureTitle;
    this.featureSource = config.featureSource;
    this.repoConfig = config.repoConfig;
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.telemetry = config.telemetry;
  }

  async execute(input: PipelineInput): Promise<PipelineResult> {
    // Calculate total steps: context(1) + research(2) + PRD(3) + execution(4 if not skipped)
    const willRunExecution = !input.skipExecution && !this.isApprovalRequired();
    const totalSteps = willRunExecution ? 4 : 3;

    await updateManifest(this.runDir, (manifest) => ({
      status: 'in_progress',
      execution: {
        ...manifest.execution,
        completed_steps: 0,
        total_steps: totalSteps,
      },
    }));

    const specText = this.mergeSpecText(input.specText, input.linearContextText);

    this.currentStep = EXECUTION_STEPS.Context;
    const contextResult = await this.runContextAggregation();

    this.currentStep = EXECUTION_STEPS.Research;
    const researchTasks = await this.runResearchDetection({
      promptText: input.promptText,
      specText,
      contextDocument: contextResult.contextDocument,
    });

    this.currentStep = EXECUTION_STEPS.PRD;
    const prdResult = await this.runPrdAuthoring(
      contextResult.contextDocument,
      researchTasks,
      input.promptText,
      specText
    );

    const approvalRequired = this.isApprovalRequired();

    await updateManifest(this.runDir, (manifest) => ({
      artifacts: {
        ...manifest.artifacts,
        prd: 'artifacts/prd.md',
      },
      status: approvalRequired ? 'paused' : 'in_progress',
    }));

    if (approvalRequired) {
      await markApprovalRequired(this.runDir, 'prd');
    }

    let executionResult:
      | { totalTasks: number; completedTasks: number; failedTasks: number }
      | undefined;

    if (!input.skipExecution && !approvalRequired) {
      this.currentStep = EXECUTION_STEPS.Execution;
      executionResult = await this.runTaskExecution(input.maxParallel);
    }

    return {
      context: {
        files: Object.keys(contextResult.contextDocument.files).length,
        totalTokens: contextResult.contextDocument.total_token_count ?? 0,
        warnings: contextResult.diagnostics.warnings,
      },
      research: {
        tasksDetected: researchTasks.length,
        pending: researchTasks.filter((t) => t.status !== 'completed').length,
      },
      prd: {
        path: path.relative(process.cwd(), prdResult.prdPath),
        hash: prdResult.prdHash,
        diagnostics: {
          incompleteSections: prdResult.diagnostics.incompleteSections,
          warnings: prdResult.diagnostics.warnings,
        },
      },
      approvalRequired,
      execution: executionResult,
    };
  }

  private mergeSpecText(
    specText?: string,
    linearContextText?: string
  ): string | undefined {
    const parts = [specText, linearContextText].filter(Boolean);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  private isApprovalRequired(): boolean {
    if (this.repoConfig.governance?.approval_workflow) {
      return this.repoConfig.governance.approval_workflow.require_approval_for_prd;
    }
    return this.repoConfig.safety.require_approval_for_prd;
  }

  private async runContextAggregation() {
    await setCurrentStep(this.runDir, EXECUTION_STEPS.Context);

    const aggregatorConfig: AggregatorConfig = {
      repoRoot: this.repoRoot,
      runDir: this.runDir,
      featureId: this.featureId,
      contextPaths: this.repoConfig.project.context_paths,
      tokenBudget: this.repoConfig.runtime.context_token_budget,
    };

    if (typeof this.repoConfig.constraints?.max_context_files === 'number') {
      aggregatorConfig.maxFiles = this.repoConfig.constraints.max_context_files;
    }

    const result = await aggregateContext(aggregatorConfig);
    await setLastStep(this.runDir, EXECUTION_STEPS.Context);

    this.logger.info('Context aggregation finished', {
      files: Object.keys(result.contextDocument.files).length,
      warnings: result.diagnostics.warnings.length,
    });

    await this.updateExecutionProgress(1);
    return result;
  }

  private async runResearchDetection(options: {
    promptText?: string | undefined;
    specText?: string | undefined;
    contextDocument: Parameters<typeof draftPRD>[0]['contextDocument'];
  }): Promise<ResearchTask[]> {
    await setCurrentStep(this.runDir, EXECUTION_STEPS.Research);

    const coordinator = createResearchCoordinator(
      {
        repoRoot: this.repoRoot,
        runDir: this.runDir,
        featureId: this.featureId,
      },
      this.logger,
      this.metrics
    );

    const detectionOptions: UnknownDetectionOptions = {};
    if (options.promptText) {
      detectionOptions.promptText = options.promptText;
    }
    if (options.specText) {
      detectionOptions.specText = options.specText;
    }

    const tasks = await coordinator.detectUnknownsFromContext(
      options.contextDocument,
      detectionOptions
    );

    await setLastStep(this.runDir, EXECUTION_STEPS.Research);
    await this.updateExecutionProgress(2);

    this.logger.info('Research detection complete', { detected: tasks.length });

    return tasks;
  }

  private async runPrdAuthoring(
    contextDocument: Parameters<typeof draftPRD>[0]['contextDocument'],
    researchTasks: ResearchTask[],
    promptText?: string,
    specText?: string
  ) {
    await setCurrentStep(this.runDir, EXECUTION_STEPS.PRD);
    const approvalRequired = this.isApprovalRequired();

    const feature = createFeature(this.featureId, this.repoConfig.project.repo_url, {
      title: this.featureTitle,
      source: this.featureSource,
      defaultBranch: this.repoConfig.project.default_branch,
      metadata: {
        approvals_required: approvalRequired,
        prompt_text: promptText,
        spec_text: specText,
      },
    });

    const result = await draftPRD(
      {
        repoRoot: this.repoRoot,
        runDir: this.runDir,
        feature,
        contextDocument,
        researchTasks,
        repoConfig: this.repoConfig,
      },
      this.logger,
      this.metrics
    );

    await setLastStep(this.runDir, EXECUTION_STEPS.PRD);
    await this.updateExecutionProgress(3);

    this.logger.info('PRD draft complete', {
      prdPath: result.prdPath,
      incompleteSections: result.diagnostics.incompleteSections.length,
    });

    return result;
  }

  private async runTaskExecution(
    maxParallel: number
  ): Promise<{ totalTasks: number; completedTasks: number; failedTasks: number }> {
    await setCurrentStep(this.runDir, EXECUTION_STEPS.Execution);
    this.logger.info('Starting task execution via CLIExecutionEngine');

    const queue = await loadQueue(this.runDir);
    if (queue.size === 0) {
      this.logger.info('No tasks in queue, skipping execution');
      await setLastStep(this.runDir, EXECUTION_STEPS.Execution);
      return { totalTasks: 0, completedTasks: 0, failedTasks: 0 };
    }

    const executionConfig = this.repoConfig.execution ?? DEFAULT_EXECUTION_CONFIG;
    const effectiveExecutionConfig = {
      ...executionConfig,
      max_parallel_tasks: maxParallel,
    };
    const mergedConfig: RepoConfig = {
      ...this.repoConfig,
      execution: effectiveExecutionConfig,
    };

    const strategies = await buildExecutionStrategies(effectiveExecutionConfig, this.logger);

    const executionEngine = new CLIExecutionEngine({
      runDir: this.runDir,
      config: mergedConfig,
      strategies,
      dryRun: false,
      logger: this.logger,
      telemetry: this.telemetry,
    });

    const prereqResult = await executionEngine.validatePrerequisites();
    if (!prereqResult.valid) {
      throw new PrerequisiteError(prereqResult.errors);
    }

    if (prereqResult.warnings.length > 0) {
      prereqResult.warnings.forEach((w) => this.logger.warn(w));
    }

    const results = await executionEngine.execute();
    await setLastStep(this.runDir, EXECUTION_STEPS.Execution);
    await this.updateExecutionProgress(4);

    this.logger.info('Execution complete', {
      totalTasks: results.totalTasks,
      completed: results.completedTasks,
      failed: results.failedTasks,
      permanentlyFailed: results.permanentlyFailedTasks,
    });

    if (results.failedTasks > 0) {
      this.logger.warn('Some tasks failed', {
        failedCount: results.failedTasks,
        permanentlyFailedCount: results.permanentlyFailedTasks,
      });
    }

    return {
      totalTasks: results.totalTasks,
      completedTasks: results.completedTasks,
      failedTasks: results.failedTasks,
    };
  }

  private async updateExecutionProgress(completedSteps: number): Promise<void> {
    await updateManifest(this.runDir, (manifest) => ({
      execution: {
        ...manifest.execution,
        completed_steps: Math.max(manifest.execution.completed_steps, completedSteps),
      },
    }));
  }
}
