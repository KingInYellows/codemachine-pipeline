import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { StructuredLogger } from '../../telemetry/logger';
import {
  type StartFlags,
  resolveFeatureTitle,
  resolveSourceDescriptor,
  generateFeatureId,
  findGitRoot,
  prdApprovalRequired,
  fetchLinearIssue,
  formatLinearContext,
} from '../startHelpers.js';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import {
  createExecutionTelemetry,
  type ExecutionTelemetry,
} from '../../telemetry/executionTelemetry';
import {
  createRunDirectory,
  setCurrentStep,
  setLastStep,
  setLastError,
  markApprovalRequired,
  updateManifest,
} from '../../persistence/runDirectoryManager';
import { resolveRunDirectorySettings, ensureTelemetryReferences } from '../utils/runDirectory';
import type { RepoConfig } from '../../core/config/RepoConfig';
import { createFeature } from '../../core/models/Feature';
import { aggregateContext, type AggregatorConfig } from '../../workflows/contextAggregator';
import {
  createResearchCoordinator,
  type UnknownDetectionOptions,
} from '../../workflows/researchCoordinator';
import type { ResearchTask } from '../../core/models/ResearchTask';
import { draftPRD } from '../../workflows/prdAuthoringEngine';
import type { IssueSnapshot } from '../../adapters/linear/LinearAdapter';
import { CLIExecutionEngine } from '../../workflows/cliExecutionEngine';
import { loadQueue } from '../../workflows/queueStore';
import { createCodeMachineStrategy } from '../../workflows/codeMachineStrategy';
import { createCodeMachineCLIStrategy } from '../../workflows/codeMachineCLIStrategy';
import {
  CliError,
  CliErrorCode,
  formatErrorMessage,
  formatErrorJson,
  setJsonOutputMode,
} from '../utils/cliErrors';
import { flushTelemetryError } from '../utils/telemetryLifecycle';
import { DEFAULT_EXECUTION_CONFIG, type ExecutionConfig } from '../../core/config/RepoConfig.js';
import type { ExecutionStrategy } from '../../workflows/executionStrategy.js';

const EXECUTION_STEPS = {
  Context: 'context_aggregation',
  Research: 'research_detection',
  PRD: 'prd_authoring',
  Execution: 'task_execution',
} as const;

type ResearchDetectionOptions = {
  repoRoot: string;
  runDir: string;
  featureId: string;
  promptText?: string;
  specText?: string;
  logger: StructuredLogger;
  metrics: MetricsCollector;
  contextDocument: Parameters<typeof draftPRD>[0]['contextDocument'];
};

interface StartResultPayload {
  feature_id: string;
  run_dir: string;
  source: string;
  status: 'awaiting_prd_approval' | 'completed' | 'execution_complete';
  context: {
    files: number;
    total_tokens: number;
    warnings: string[];
  };
  research: {
    tasks_detected: number;
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
  execution?: {
    total_tasks: number;
    completed: number;
    failed: number;
    duration_ms: number;
  };
  approvals: {
    required: boolean;
    pending: string[];
  };
}

export default class Start extends Command {
  static description = 'Start a new feature development pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %> --prompt "Add user authentication"',
    '<%= config.bin %> <%= command.id %> --linear ISSUE-123',
    '<%= config.bin %> <%= command.id %> --spec ./specs/feature.md',
    '<%= config.bin %> <%= command.id %> --prompt "OAuth integration" --json',
  ];

  static flags = {
    prompt: Flags.string({
      char: 'p',
      description: 'Feature description prompt',
      exclusive: ['linear', 'spec'],
    }),
    linear: Flags.string({
      char: 'l',
      description: 'Linear issue ID to import as feature specification',
      exclusive: ['prompt', 'spec'],
    }),
    spec: Flags.file({
      char: 's',
      description: 'Path to existing specification file',
      exclusive: ['prompt', 'linear'],
      exists: true,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Simulate execution without making changes',
      default: false,
    }),
    'max-parallel': Flags.integer({
      description: 'Maximum parallel tasks during execution (1-10)',
      default: 1,
      min: 1,
      max: 10,
    }),
    'skip-execution': Flags.boolean({
      description: 'Skip task execution phase (stop after PRD)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);
    const typedFlags = flags as StartFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    // Early validation with proper error handling
    if (!typedFlags.prompt && !typedFlags.linear && !typedFlags.spec) {
      const cliErr = new CliError(
        'Must provide one of: --prompt, --linear, or --spec',
        CliErrorCode.CONFIG_INVALID,
        {
          remediation:
            'Provide an input source: --prompt "description", --linear ISSUE-ID, or --spec path/to/spec.md',
        }
      );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
        this.exit(cliErr.exitCode);
      }
      this.error(cliErr.message, { exit: cliErr.exitCode });
    }

    if (typedFlags['dry-run']) {
      this.outputDryRunPlan(typedFlags);
      return;
    }

    const settings = await resolveRunDirectorySettings();

    if (settings.errors.length > 0 || !settings.config) {
      const message =
        settings.errors.length > 0
          ? settings.errors.join('\n')
          : 'Repository not initialized. Run "codepipe init" first.';
      const cliErr = new CliError(message, CliErrorCode.CONFIG_NOT_FOUND, {
        remediation: 'Run "codepipe init" to initialize the repository configuration.',
      });
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
        this.exit(cliErr.exitCode);
      }
      this.error(cliErr.message, { exit: cliErr.exitCode });
    }

    const startTime = Date.now();
    let currentStepLabel: string | undefined;

    const repoConfig = settings.config;
    const repoRoot = findGitRoot();
    await fs.mkdir(settings.baseDir, { recursive: true });

    const featureId = generateFeatureId();
    const featureTitle = resolveFeatureTitle(typedFlags);
    const featureSource = resolveSourceDescriptor(typedFlags);
    const resolvedSpecPath = typedFlags.spec ? path.resolve(typedFlags.spec) : undefined;
    const runDir = await createRunDirectory(settings.baseDir, featureId, {
      title: featureTitle,
      source: featureSource,
      repoUrl: repoConfig.project.repo_url,
      defaultBranch: repoConfig.project.default_branch,
      metadata: {
        input: {
          prompt: typedFlags.prompt,
          linear: typedFlags.linear,
          specPath: resolvedSpecPath,
        },
      },
    });

    await ensureTelemetryReferences(runDir);

    const logger = createCliLogger('start', featureId, runDir, {
      minLevel: typedFlags.json ? LogLevel.WARN : LogLevel.INFO,
      mirrorToStderr: !typedFlags.json,
    });
    const metrics = createRunMetricsCollector(runDir, featureId);
    const traceManager = createRunTraceManager(runDir, featureId, logger);
    const executionTelemetry = createExecutionTelemetry({
      logger,
      metrics,
      runDir,
      runId: featureId,
      traceManager,
      component: 'execution_engine',
    });
    const commandSpan = traceManager.startSpan('cli.start');
    commandSpan.setAttribute('feature_id', featureId);
    commandSpan.setAttribute('input_source', featureSource);

    try {
      await updateManifest(runDir, (manifest) => ({
        status: 'in_progress',
        execution: {
          ...manifest.execution,
          completed_steps: 0,
          total_steps: 3,
        },
      }));

      currentStepLabel = 'initializing';

      const specText = resolvedSpecPath ? await fs.readFile(resolvedSpecPath, 'utf-8') : undefined;

      // Fetch Linear issue snapshot if --linear flag is provided
      let linearSnapshot: IssueSnapshot | undefined;
      if (typedFlags.linear) {
        linearSnapshot = await fetchLinearIssue(typedFlags.linear, runDir, logger);
      }

      currentStepLabel = EXECUTION_STEPS.Context;
      const contextResult = await this.runContextAggregation({
        repoRoot,
        runDir,
        featureId,
        repoConfig,
        logger,
      });

      currentStepLabel = EXECUTION_STEPS.Research;
      const researchOptions = this.buildResearchOptions(
        {
          repoRoot,
          runDir,
          featureId,
          logger,
          metrics,
          contextDocument: contextResult.contextDocument,
        },
        { promptText: typedFlags.prompt, specText, linearSnapshot }
      );
      const researchTasks = await this.runResearchDetection(researchOptions);

      currentStepLabel = EXECUTION_STEPS.PRD;
      const prdResult = await this.runPrdAuthoring({
        repoRoot,
        runDir,
        repoConfig,
        featureId,
        featureTitle,
        featureSource,
        contextDocument: contextResult.contextDocument,
        researchTasks,
        logger,
        metrics,
      });

      const approvalRequired = prdApprovalRequired(repoConfig);

      await updateManifest(runDir, (manifest) => ({
        artifacts: {
          ...manifest.artifacts,
          prd: 'artifacts/prd.md',
        },
        status: approvalRequired ? 'paused' : 'in_progress',
      }));

      if (approvalRequired) {
        await markApprovalRequired(runDir, 'prd');
      }

      // Execute tasks if not skipped and no approval required
      let executionResult: Awaited<ReturnType<CLIExecutionEngine['execute']>> | undefined;
      if (!typedFlags['skip-execution'] && !approvalRequired) {
        currentStepLabel = EXECUTION_STEPS.Execution;
        executionResult = await this.runTaskExecution({
          runDir,
          repoRoot,
          repoConfig,
          logger,
          metrics,
          telemetry: executionTelemetry,
          maxParallel: typedFlags['max-parallel'] ?? 1,
        });
      }

      const payload: StartResultPayload = {
        feature_id: featureId,
        run_dir: runDir,
        source: featureSource,
        status: approvalRequired
          ? 'awaiting_prd_approval'
          : executionResult
            ? 'execution_complete'
            : 'completed',
        context: {
          files: Object.keys(contextResult.contextDocument.files).length,
          total_tokens: contextResult.contextDocument.total_token_count ?? 0,
          warnings: contextResult.diagnostics.warnings,
        },
        research: {
          tasks_detected: researchTasks.length,
          pending: researchTasks.filter((task) => task.status !== 'completed').length,
        },
        prd: {
          path: path.relative(process.cwd(), prdResult.prdPath),
          hash: prdResult.prdHash,
          diagnostics: {
            incompleteSections: prdResult.diagnostics.incompleteSections,
            warnings: prdResult.diagnostics.warnings,
          },
        },
        approvals: {
          required: approvalRequired,
          pending: approvalRequired ? ['prd'] : [],
        },
      };

      if (executionResult) {
        payload.execution = {
          total_tasks: executionResult.totalTasks,
          completed: executionResult.completedTasks,
          failed: executionResult.failedTasks,
          duration_ms: Date.now() - startTime,
        };
      }

      this.emitStartSummary(payload, typedFlags.json);

      const exitCode = payload.approvals.required ? 30 : 0;
      const duration = Date.now() - startTime;
      metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
        command: 'start',
      });
      metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: 'start',
        exit_code: exitCode.toString(),
      });
      await metrics.flush();
      commandSpan.end({ code: SpanStatusCode.OK });

      if (exitCode !== 0) {
        this.exit(exitCode);
      }
    } catch (error) {
      await flushTelemetryError(
        { commandName: 'start', startTime, logger, metrics, traceManager, commandSpan },
        error
      );

      await setLastError(runDir, currentStepLabel ?? 'start', formatErrorMessage(error), true);

      const cliErr =
        error instanceof CliError
          ? error
          : new CliError(
              `Start command failed: ${formatErrorMessage(error)}`,
              CliErrorCode.GENERAL,
              error instanceof Error ? { cause: error } : {}
            );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
        this.exit(cliErr.exitCode);
      }
      this.error(cliErr.message, { exit: cliErr.exitCode });
    }
  }

  private async runContextAggregation(options: {
    repoRoot: string;
    runDir: string;
    featureId: string;
    repoConfig: RepoConfig;
    logger: StructuredLogger;
  }) {
    const { repoRoot, runDir, featureId, repoConfig, logger } = options;
    await setCurrentStep(runDir, EXECUTION_STEPS.Context);

    const aggregatorConfig: AggregatorConfig = {
      repoRoot,
      runDir,
      featureId,
      contextPaths: repoConfig.project.context_paths,
      tokenBudget: repoConfig.runtime.context_token_budget,
    };

    if (typeof repoConfig.constraints?.max_context_files === 'number') {
      aggregatorConfig.maxFiles = repoConfig.constraints.max_context_files;
    }

    const result = await aggregateContext(aggregatorConfig);
    await setLastStep(runDir, EXECUTION_STEPS.Context);

    logger.info('Context aggregation finished', {
      files: Object.keys(result.contextDocument.files).length,
      warnings: result.diagnostics.warnings.length,
    });

    await updateExecutionProgress(runDir, 1);
    return result;
  }

  /**
   * Build research detection options, merging prompt, spec text, and Linear context.
   */
  private buildResearchOptions(
    base: {
      repoRoot: string;
      runDir: string;
      featureId: string;
      logger: StructuredLogger;
      metrics: MetricsCollector;
      contextDocument: ResearchDetectionOptions['contextDocument'];
    },
    input: {
      promptText?: string | undefined;
      specText?: string | undefined;
      linearSnapshot?: IssueSnapshot | undefined;
    }
  ): ResearchDetectionOptions {
    const options: ResearchDetectionOptions = { ...base };
    if (input.promptText) {
      options.promptText = input.promptText;
    }
    const linearContext = input.linearSnapshot
      ? formatLinearContext(input.linearSnapshot)
      : undefined;
    if (input.specText && linearContext) {
      options.specText = `${input.specText}\n\n${linearContext}`;
    } else if (input.specText) {
      options.specText = input.specText;
    } else if (linearContext) {
      options.specText = linearContext;
    }
    return options;
  }

  private async runResearchDetection(options: ResearchDetectionOptions): Promise<ResearchTask[]> {
    const { repoRoot, runDir, featureId, promptText, specText, logger, metrics, contextDocument } =
      options;

    await setCurrentStep(runDir, EXECUTION_STEPS.Research);

    const coordinator = createResearchCoordinator(
      {
        repoRoot,
        runDir,
        featureId,
      },
      logger,
      metrics
    );

    const detectionOptions: UnknownDetectionOptions = {};
    if (promptText) {
      detectionOptions.promptText = promptText;
    }
    if (specText) {
      detectionOptions.specText = specText;
    }

    const tasks = await coordinator.detectUnknownsFromContext(contextDocument, detectionOptions);

    await setLastStep(runDir, EXECUTION_STEPS.Research);
    await updateExecutionProgress(runDir, 2);

    logger.info('Research detection complete', {
      detected: tasks.length,
    });

    return tasks;
  }

  private async runPrdAuthoring(options: {
    repoRoot: string;
    runDir: string;
    repoConfig: RepoConfig;
    featureId: string;
    featureTitle: string;
    featureSource: string;
    contextDocument: Parameters<typeof draftPRD>[0]['contextDocument'];
    researchTasks: ResearchTask[];
    logger: StructuredLogger;
    metrics: MetricsCollector;
  }) {
    const {
      repoRoot,
      runDir,
      repoConfig,
      featureId,
      featureTitle,
      featureSource,
      contextDocument,
      researchTasks,
      logger,
      metrics,
    } = options;

    await setCurrentStep(runDir, EXECUTION_STEPS.PRD);

    const feature = createFeature(featureId, repoConfig.project.repo_url, {
      title: featureTitle,
      source: featureSource,
      defaultBranch: repoConfig.project.default_branch,
      metadata: {
        approvals_required:
          repoConfig.governance?.approval_workflow.require_approval_for_prd ?? true,
      },
    });

    const result = await draftPRD(
      {
        repoRoot,
        runDir,
        feature,
        contextDocument,
        researchTasks,
        repoConfig,
      },
      logger,
      metrics
    );

    await setLastStep(runDir, EXECUTION_STEPS.PRD);
    await updateExecutionProgress(runDir, 3);

    logger.info('PRD draft complete', {
      prdPath: result.prdPath,
      incompleteSections: result.diagnostics.incompleteSections.length,
    });

    return result;
  }

  private async runTaskExecution(options: {
    runDir: string;
    repoRoot: string;
    repoConfig: RepoConfig;
    logger: StructuredLogger;
    metrics: MetricsCollector;
    telemetry: ExecutionTelemetry;
    maxParallel: number;
  }): Promise<Awaited<ReturnType<CLIExecutionEngine['execute']>>> {
    const { runDir, repoConfig, logger, maxParallel, telemetry } = options;

    await setCurrentStep(runDir, EXECUTION_STEPS.Execution);
    logger.info('Starting task execution via CLIExecutionEngine');

    // Load queue to check if there are tasks
    const queue = await loadQueue(runDir);
    if (queue.size === 0) {
      logger.info('No tasks in queue, skipping execution');
      await setLastStep(runDir, EXECUTION_STEPS.Execution);
      return {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        permanentlyFailedTasks: 0,
        skippedTasks: 0,
      };
    }

    // Create execution config with max parallel override
    const executionConfig = repoConfig.execution ?? DEFAULT_EXECUTION_CONFIG;

    // Override max_parallel_tasks if specified
    const mergedConfig: RepoConfig = {
      ...repoConfig,
      execution: {
        ...executionConfig,
        max_parallel_tasks: maxParallel,
      },
    };

    // Create strategies — CLI strategy takes priority when binary is available
    const strategies = await buildExecutionStrategies(mergedConfig.execution!, logger);

    // Create execution engine
    const executionEngine = new CLIExecutionEngine({
      runDir,
      config: mergedConfig,
      strategies,
      dryRun: false,
      logger,
      telemetry,
    });

    // Validate prerequisites
    const prereqResult = await executionEngine.validatePrerequisites();
    if (!prereqResult.valid) {
      throw new CliError(
        `Execution prerequisites failed: ${prereqResult.errors.join(', ')}`,
        CliErrorCode.CONFIG_INVALID,
        {
          remediation: 'Fix the prerequisite issues and retry.',
          howToFix: 'Review the errors above and ensure all required tools are installed.',
          commonFixes: prereqResult.errors,
        }
      );
    }

    if (prereqResult.warnings.length > 0) {
      prereqResult.warnings.forEach((w) => logger.warn(w));
    }

    // Execute all pending tasks from queue
    const results = await executionEngine.execute();

    // Set completion step
    await setLastStep(runDir, EXECUTION_STEPS.Execution);

    logger.info('Execution complete', {
      totalTasks: results.totalTasks,
      completed: results.completedTasks,
      failed: results.failedTasks,
      permanentlyFailed: results.permanentlyFailedTasks,
    });

    if (results.failedTasks > 0) {
      logger.warn('Some tasks failed', {
        failedCount: results.failedTasks,
        permanentlyFailedCount: results.permanentlyFailedTasks,
      });
    }

    return results;
  }

  private emitStartSummary(payload: StartResultPayload, jsonMode: boolean): void {
    if (jsonMode) {
      this.log(JSON.stringify(payload, null, 2));
      return;
    }

    this.log('');
    this.log(`🚀 Feature run created: ${payload.feature_id}`);
    this.log(`Run directory: ${path.relative(process.cwd(), payload.run_dir)}`);
    this.log(`Context files analyzed: ${payload.context.files}`);
    this.log(`Research tasks detected: ${payload.research.tasks_detected}`);
    this.log(`PRD written to: ${payload.prd.path}`);
    this.log(`PRD hash: ${payload.prd.hash}`);

    if (payload.context.warnings.length > 0) {
      this.log('\nContext warnings:');
      payload.context.warnings.forEach((w) => this.log(`  • ${w}`));
    }

    if (payload.prd.diagnostics.warnings.length > 0) {
      this.log('\nPRD warnings:');
      payload.prd.diagnostics.warnings.forEach((w) => this.log(`  • ${w}`));
    }

    if (payload.execution) {
      this.log('\nExecution results:');
      this.log(`  Total tasks: ${payload.execution.total_tasks}`);
      this.log(`  Completed: ${payload.execution.completed}`);
      this.log(`  Failed: ${payload.execution.failed}`);
      this.log(`  Duration: ${(payload.execution.duration_ms / 1000).toFixed(2)}s`);

      if (payload.execution.failed > 0) {
        this.warn(
          `  Warning: ${payload.execution.failed} task(s) failed. Use 'codepipe resume' to retry.`
        );
      }
    }

    if (payload.approvals.required) {
      this.log('\n✅ PRD draft created. Approval required before continuing.');
      this.log(`Review the document at ${payload.prd.path}, then run:`);
      this.log(`  codepipe approve prd --feature ${payload.feature_id} --signer "<email>"`);
      this.log('Need edits? Request revisions via: codepipe prd edit --request "<details>"');
      this.log('');
    } else if (!payload.execution) {
      this.log('\nPRD approved automatically based on configuration.');
      this.log('Use --skip-execution flag was used or execution skipped.');
    } else {
      this.log('\nPipeline execution completed.');
    }
  }

  private outputDryRunPlan(flags: StartFlags): void {
    const steps = [
      'Load repo configuration and verify git repository',
      'Create feature run directory and manifest',
      'Aggregate context files under configured globs',
      'Detect unknowns to queue research tasks',
      'Render PRD draft using docs/templates/prd_template.md',
      'Record PRD hash for approval workflow',
    ];

    if (!flags['skip-execution']) {
      steps.push('Execute queued tasks via CLIExecutionEngine');
      steps.push(`  - Max parallel tasks: ${flags['max-parallel'] ?? 1}`);
    }

    const plan = {
      status: 'dry_run',
      message: 'Dry-run mode previews the planned steps without creating artifacts.',
      planned_steps: steps,
      input: {
        prompt: flags.prompt,
        linear: flags.linear,
        spec: flags.spec,
        max_parallel: flags['max-parallel'],
        skip_execution: flags['skip-execution'],
      },
    };

    if (flags.json) {
      this.log(JSON.stringify(plan, null, 2));
    } else {
      this.log('\nℹ️  Dry-run preview (no files written):\n');
      plan.planned_steps.forEach((step) => this.log(`  • ${step}`));
      this.log('');
    }
  }
}

/**
 * Build the ordered list of execution strategies.
 *
 * Accepts optional overrides for the factory functions to allow injection
 * in unit tests without module-level mocking.
 *
 * @param config - Execution config section from RepoConfig.
 * @param logger - Structured logger instance.
 * @param factories - Optional factory overrides for testing; defaults to the
 *   real CLI and legacy strategy constructors.
 */
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

async function updateExecutionProgress(runDir: string, completedSteps: number): Promise<void> {
  await updateManifest(runDir, (manifest) => ({
    execution: {
      ...manifest.execution,
      completed_steps: Math.max(manifest.execution.completed_steps, completedSteps),
    },
  }));
}
