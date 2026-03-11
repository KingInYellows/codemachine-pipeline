import { Flags } from '@oclif/core';
import * as path from 'node:path';
import {
  analyzeResumeState,
  prepareResume,
  type ResumeOptions,
} from '../../workflows/resumeCoordinator';
import { getRunDirectoryPath } from '../../persistence/runLifecycle';
import { CLIExecutionEngine } from '../../workflows/cliExecutionEngine';
import { buildExecutionStrategies } from '../../workflows/executionStrategyBuilder.js';
import {
  loadRepoConfig,
  type RepoConfig,
  DEFAULT_EXECUTION_CONFIG,
} from '../../core/config/RepoConfig';
import { createExecutionTelemetry } from '../../telemetry/executionTelemetry';
import { loadPlanSummary } from '../../workflows/taskPlanner';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  requireFeatureId,
} from '../utils/runDirectory';
import { setJsonOutputMode } from '../utils/cliErrors';
import { TelemetryCommand } from '../telemetryCommand';
import type { ResumeFlags, ResumeTelemetry, ResumePayload } from '../resumeTypes';
import { buildResumePayload } from '../resumePayloadBuilder';
import {
  printResumeAnalysis,
  printExecutionResults,
  determineResumeExitCode,
} from '../resumeOutput';

/**
 * Resume command - Resume failed or paused feature pipeline execution
 *
 * Exit codes:
 * - 0: Resume successful or dry-run completed
 * - 1: General error
 * - 10: Resume blocked (blockers present)
 * - 20: Integrity check failed (without --force)
 * - 30: Queue validation failed
 */
export default class Resume extends TelemetryCommand {
  protected get commandName(): string {
    return 'resume';
  }

  static description = 'Resume a failed or paused feature pipeline execution with safety checks';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --validate-queue',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to resume (defaults to current/latest)',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Analyze resume eligibility without executing',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Override blockers (integrity warnings) - use with caution',
      default: false,
    }),
    'skip-hash-verification': Flags.boolean({
      description: 'Skip artifact integrity checks (dangerous, for debugging only)',
      default: false,
    }),
    'validate-queue': Flags.boolean({
      description: 'Validate queue files before resuming',
      default: true,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed diagnostics',
      default: false,
    }),
    'max-parallel': Flags.integer({
      description: 'Maximum parallel tasks during execution (1-10)',
      default: 1,
      min: 1,
      max: 10,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Resume);
    const typedFlags = flags as ResumeFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
    try {
      requireFeatureId(featureId, typedFlags.feature);
    } catch (error) {
      this.failWithCliExitCode(error);
    }
    const runDirPath = getRunDirectoryPath(settings.baseDir, featureId);

    await this.runWithTelemetry(
      {
        runDirPath,
        featureId,
        jsonMode: typedFlags.json,
        verbose: typedFlags.verbose,
        spanAttributes: {
          dry_run: typedFlags['dry-run'],
          force: typedFlags.force,
          skip_hash_verification: typedFlags['skip-hash-verification'],
        },
      },
      async (ctx) => {
        const executionTelemetry = createExecutionTelemetry({
          logger: ctx.logger!,
          metrics: ctx.metrics!,
          runDir: runDirPath,
          runId: featureId,
          ...(ctx.traceManager ? { traceManager: ctx.traceManager } : {}),
          component: 'execution_queue',
        });

        const resumeTelemetry: ResumeTelemetry = {
          logger: ctx.logger!,
          metrics: ctx.metrics!,
          traceManager: ctx.traceManager!,
          commandSpan: ctx.commandSpan!,
          executionTelemetry,
          runDirPath,
          resources: ctx.resources,
        };

        resumeTelemetry.logger.info('Resume command invoked', {
          feature_id: featureId,
          dry_run: typedFlags['dry-run'],
          force: typedFlags.force,
          skip_hash_verification: typedFlags['skip-hash-verification'],
        });

        const { analysis, payload } = await this.analyzeAndDisplayResumeState(
          featureId,
          runDirPath,
          typedFlags,
          resumeTelemetry
        );

        // Dry run - stop here
        if (typedFlags['dry-run']) {
          resumeTelemetry.logger.info('Dry run completed', { can_resume: analysis.canResume });
          return { exitCode: 0, extraLogFields: { dry_run: true } };
        }

        // Check if resume is blocked
        if (!analysis.canResume) {
          const exitCode = determineResumeExitCode(analysis);
          resumeTelemetry.logger.error('Resume blocked', {
            blockers: analysis.diagnostics
              .filter((d) => d.severity === 'blocker')
              .map((d) => d.code),
          });
          this.logToStderr('Resume is blocked. See diagnostics above.');
          return { exitCode, extraLogFields: { exit_code: exitCode } };
        }

        // Execute resume
        await this.buildAndRunExecutionEngine(
          featureId,
          runDirPath,
          typedFlags,
          payload,
          resumeTelemetry
        );

        return { exitCode: 0, extraLogFields: { exit_code: 0 } };
      }
    );
  }

  private async analyzeAndDisplayResumeState(
    _featureId: string,
    runDirPath: string,
    flags: ResumeFlags,
    telemetry: ResumeTelemetry
  ): Promise<{
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>;
    payload: ResumePayload;
  }> {
    const resumeOptions: ResumeOptions = {
      force: flags.force,
      skipHashVerification: flags['skip-hash-verification'],
      validateQueue: flags['validate-queue'],
    };

    const analysis = await analyzeResumeState(
      runDirPath,
      resumeOptions,
      telemetry.executionTelemetry
    );
    const planSummary = await loadPlanSummary(runDirPath);

    const queueValidation = analysis.queueValidation;
    if (queueValidation && !queueValidation.valid && !flags.force) {
      telemetry.logger.error('Queue validation failed', {
        corrupted_tasks: queueValidation.corruptedTasks,
        total_errors: queueValidation.errors.length,
      });
    }

    const payload = await buildResumePayload(
      analysis,
      queueValidation,
      planSummary,
      flags['dry-run'],
      runDirPath
    );

    if (flags.json) {
      this.log(JSON.stringify(payload, null, 2));
    } else {
      printResumeAnalysis(
        analysis,
        queueValidation,
        flags,
        payload,
        (msg) => this.log(msg),
        (msg) => this.warn(msg)
      );
    }

    return { analysis, payload };
  }

  private async buildAndRunExecutionEngine(
    featureId: string,
    runDirPath: string,
    flags: ResumeFlags,
    payload: ResumePayload,
    telemetry: ResumeTelemetry
  ): Promise<void> {
    const { logger, executionTelemetry } = telemetry;

    const resumeOptions: ResumeOptions = {
      force: flags.force,
      skipHashVerification: flags['skip-hash-verification'],
      validateQueue: flags['validate-queue'],
    };

    logger.info('Preparing resume', { feature_id: featureId });
    await prepareResume(runDirPath, resumeOptions, executionTelemetry);
    logger.info('Resume preparation completed', { feature_id: featureId });

    // Load repo config
    const repoConfigPath = path.join(process.cwd(), '.codepipe', 'config.json');
    const repoConfigResult = await loadRepoConfig(repoConfigPath);
    if (!repoConfigResult.success || !repoConfigResult.config) {
      const errorMessages =
        repoConfigResult.errors?.map((e) => e.message).join(', ') ?? 'unknown error';
      throw new Error(`Invalid repository configuration: ${errorMessages}`);
    }
    const repoConfig = repoConfigResult.config;

    logger.info('Starting task execution via CLIExecutionEngine', { feature_id: featureId });

    const executionConfig = repoConfig.execution ?? DEFAULT_EXECUTION_CONFIG;
    const mergedConfig: RepoConfig = {
      ...repoConfig,
      execution: {
        ...executionConfig,
        max_parallel_tasks: flags['max-parallel'] ?? executionConfig.max_parallel_tasks,
      },
    };

    if (!mergedConfig.execution) {
      throw new Error(
        'Execution config is required. Ensure your .codepipe/config.json includes an "execution" section.'
      );
    }
    const strategies = await buildExecutionStrategies(mergedConfig.execution, logger);

    const executionEngine = new CLIExecutionEngine({
      runDir: runDirPath,
      config: mergedConfig,
      strategies,
      dryRun: false,
      logger,
      telemetry: executionTelemetry,
    });

    const prereqResult = await executionEngine.validatePrerequisites();
    if (!prereqResult.valid) {
      throw new Error(`Execution prerequisites failed: ${prereqResult.errors.join(', ')}`);
    }

    if (prereqResult.warnings.length > 0) {
      prereqResult.warnings.forEach((w) => logger.warn(w));
    }

    const executionStartTime = Date.now();
    const executionResults = await executionEngine.execute();
    const executionDuration = Date.now() - executionStartTime;

    logger.info('Resume execution completed', {
      feature_id: featureId,
      totalTasks: executionResults.totalTasks,
      completed: executionResults.completedTasks,
      failed: executionResults.failedTasks,
      duration_ms: executionDuration,
    });

    // Update payload with execution results
    payload.execution = {
      total_tasks: executionResults.totalTasks,
      completed: executionResults.completedTasks,
      failed: executionResults.failedTasks,
      permanently_failed: executionResults.permanentlyFailedTasks,
      skipped: executionResults.skippedTasks,
      duration_ms: executionDuration,
    };

    if (!flags.json) {
      printExecutionResults(
        featureId,
        runDirPath,
        executionResults,
        executionDuration,
        (msg) => this.log(msg),
        (msg) => this.warn(msg)
      );
    }
  }
}
