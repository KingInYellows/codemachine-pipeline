import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import {
  analyzeResumeState,
  prepareResume,
  formatResumeAnalysis,
  type ResumeOptions,
} from '../../workflows/resumeCoordinator';
import { getRunDirectoryPath } from '../../persistence/runDirectoryManager';
import type { QueueValidationResult } from '../../workflows/queueStore';
import { CLIExecutionEngine } from '../../workflows/cliExecutionEngine';
import { createCodeMachineStrategy } from '../../workflows/codeMachineStrategy';
import { loadRepoConfig, type RepoConfig } from '../../core/config/RepoConfig';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import { createExecutionTelemetry } from '../../telemetry/executionTelemetry';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
} from '../utils/runDirectory';
import { loadPlanSummary } from '../../workflows/taskPlanner';
import { RateLimitReporter } from '../../telemetry/rateLimitReporter';
import { loadReport as loadBranchProtectionReport } from '../../workflows/branchProtectionReporter';

type ResumeFlags = {
  feature?: string;
  'dry-run': boolean;
  force: boolean;
  'skip-hash-verification': boolean;
  'validate-queue': boolean;
  json: boolean;
  verbose: boolean;
  'max-parallel'?: number;
};

interface ResumePayload {
  feature_id: string;
  can_resume: boolean;
  status: string;
  last_step?: string;
  current_step?: string;
  last_error?: {
    step: string;
    message: string;
    timestamp: string;
    recoverable: boolean;
  } | null;
  queue_state: {
    pending: number;
    completed: number;
    failed: number;
  };
  execution?: {
    total_tasks: number;
    completed: number;
    failed: number;
    permanently_failed: number;
    skipped: number;
    duration_ms: number;
  };
  pending_approvals: string[];
  integrity_check?: {
    valid: boolean;
    passed: number;
    failed: number;
    missing: number;
  };
  diagnostics: Array<{
    severity: string;
    message: string;
    code?: string;
  }>;
  recommendations: string[];
  queue_validation?: {
    valid: boolean;
    total_tasks: number;
    corrupted_tasks: number;
    errors: Array<{
      taskId: string;
      line: number;
      message: string;
    }>;
  };
  plan_summary?: {
    total_tasks: number;
    entry_tasks: number;
    next_tasks: string[];
  };
  resume_instructions?: {
    checkpoint?: string;
    next_step?: string;
    pending_approvals?: string[];
  };
  rate_limit_warnings?: Array<{
    provider: string;
    in_cooldown: boolean;
    manual_ack_required: boolean;
    reset_at: string;
  }>;
  integration_blockers?: {
    github?: string[];
    linear?: string[];
  };
  branch_protection_blockers?: string[];
  dry_run: boolean;
  playbook_reference: string;
}

/**
 * Resume command - Resume failed or paused feature pipeline execution
 *
 * Implements:
 * - FR-3 (Resumability): Deterministic crash recovery
 * - ADR-2 (State Persistence): Hash verification and queue restoration
 *
 * Exit codes:
 * - 0: Resume successful or dry-run completed
 * - 1: General error
 * - 10: Resume blocked (blockers present)
 * - 20: Integrity check failed (without --force)
 * - 30: Queue validation failed
 */
export default class Resume extends Command {
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
      process.env.JSON_OUTPUT = '1';
    }

    // Initialize telemetry
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    let executionTelemetry: ReturnType<typeof createExecutionTelemetry> | undefined;
    let runDirPath: string | undefined;
    const startTime = Date.now();

    try {
      const settings = resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      if (!featureId) {
        this.error(
          'No feature run directory found. Specify with --feature or ensure a run directory exists.',
          { exit: 1 }
        );
      }

      runDirPath = getRunDirectoryPath(settings.baseDir, featureId);

      // Initialize telemetry
      logger = createCliLogger('resume', featureId, runDirPath, {
        minLevel: typedFlags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
        mirrorToStderr: !typedFlags.json,
      });
      metrics = createRunMetricsCollector(runDirPath, featureId);
      traceManager = createRunTraceManager(runDirPath, featureId);
      commandSpan = traceManager.startSpan('cli.resume');
      commandSpan.setAttribute('feature_id', featureId);
      commandSpan.setAttribute('dry_run', typedFlags['dry-run']);
      commandSpan.setAttribute('force', typedFlags.force);
      commandSpan.setAttribute('skip_hash_verification', typedFlags['skip-hash-verification']);
      if (!metrics || !logger) {
        throw new Error('Telemetry initialization failed for resume command');
      }
      executionTelemetry = createExecutionTelemetry({
        logger,
        metrics,
        runDir: runDirPath,
        runId: featureId,
        traceManager,
        component: 'execution_queue',
      });

      logger.info('Resume command invoked', {
        feature_id: featureId,
        dry_run: typedFlags['dry-run'],
        force: typedFlags.force,
        skip_hash_verification: typedFlags['skip-hash-verification'],
      });

      // Build resume options
      const resumeOptions: ResumeOptions = {
        force: typedFlags.force,
        skipHashVerification: typedFlags['skip-hash-verification'],
        validateQueue: typedFlags['validate-queue'],
      };

      // Analyze resume state
      const analysis = await analyzeResumeState(runDirPath, resumeOptions, executionTelemetry);

      // Load plan summary for context
      const planSummary = await loadPlanSummary(runDirPath);

      const queueValidation = analysis.queueValidation;
      if (queueValidation && !queueValidation.valid && !typedFlags.force) {
        logger.error('Queue validation failed', {
          corrupted_tasks: queueValidation.corruptedTasks,
          total_errors: queueValidation.errors.length,
        });
      }

      // Build output payload
      const payload = await this.buildResumePayload(
        analysis,
        queueValidation,
        planSummary,
        typedFlags['dry-run'],
        runDirPath
      );

      if (typedFlags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(analysis, queueValidation, typedFlags, payload);
      }

      // Dry run - stop here
      if (typedFlags['dry-run']) {
        logger.info('Dry run completed', { can_resume: analysis.canResume });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'resume',
          exit_code: '0',
          dry_run: 'true',
        });
        await this.flush(logger, metrics, traceManager, commandSpan, runDirPath, 0);
        return;
      }

      // Check if resume is blocked
      if (!analysis.canResume) {
        const exitCode = this.determineExitCode(analysis);
        logger.error('Resume blocked', {
          blockers: analysis.diagnostics.filter((d) => d.severity === 'blocker').map((d) => d.code),
        });

        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'resume',
          exit_code: exitCode.toString(),
        });

        await this.flush(logger, metrics, traceManager, commandSpan, runDirPath, exitCode);
        this.error(`Resume is blocked. See diagnostics above.`, { exit: exitCode });
      }

      // Execute resume
      logger.info('Preparing resume', { feature_id: featureId });

      await prepareResume(runDirPath, resumeOptions, executionTelemetry);

      logger.info('Resume preparation completed', { feature_id: featureId });

      // Load repo config
      const repoConfigPath = path.join(process.cwd(), '.ai-feature-pipeline', 'config.json');
      const repoConfigResult = loadRepoConfig(repoConfigPath);
      if (!repoConfigResult.success || !repoConfigResult.config) {
        const errorMessages = repoConfigResult.errors?.map((e) => e.message).join(', ') ?? 'unknown error';
        throw new Error(
          `Invalid repository configuration: ${errorMessages}`
        );
      }
      const repoConfig = repoConfigResult.config;

      // Execute tasks via CLIExecutionEngine
      logger.info('Starting task execution via CLIExecutionEngine', { feature_id: featureId });

      const executionConfig = repoConfig.execution ?? {
        task_timeout_ms: 1800000,
        max_parallel_tasks: typedFlags['max-parallel'] ?? 1,
        max_retries: 3,
        retry_backoff_ms: 5000,
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude' as const,
        workspace_dir: undefined,
        max_log_buffer_size: 10 * 1024 * 1024,
        env_allowlist: [],
        spec_path: '',
        log_rotation_mb: 100,
        log_rotation_keep: 3,
        log_rotation_compress: false,
      };

      const mergedConfig: RepoConfig = {
        ...repoConfig,
        execution: {
          ...executionConfig,
          max_parallel_tasks: typedFlags['max-parallel'] ?? executionConfig.max_parallel_tasks,
        },
      };

      const strategy = createCodeMachineStrategy({
        config: mergedConfig.execution!,
        logger,
      });

      const executionEngine = new CLIExecutionEngine({
        runDir: runDirPath,
        config: mergedConfig,
        strategies: [strategy],
        dryRun: false,
        logger,
        telemetry: executionTelemetry,
      });

      const prereqResult = await executionEngine.validatePrerequisites();
      if (!prereqResult.valid) {
        throw new Error(`Execution prerequisites failed: ${prereqResult.errors.join(', ')}`);
      }

      if (prereqResult.warnings.length > 0) {
        prereqResult.warnings.forEach((w) => logger!.warn(w));
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

      if (!typedFlags.json) {
        this.log('');
        this.log('✅ Resume execution successful');
        this.log('');
        this.log('Execution results:');
        this.log(`  Total tasks: ${executionResults.totalTasks}`);
        this.log(`  Completed: ${executionResults.completedTasks}`);
        this.log(`  Failed: ${executionResults.failedTasks}`);
        this.log(
          `  Permanently failed: ${executionResults.permanentlyFailedTasks}`
        );
        this.log(`  Skipped: ${executionResults.skippedTasks}`);
        this.log(`  Duration: ${(executionDuration / 1000).toFixed(2)}s`);
        this.log('');
        this.log('Next steps:');
        this.log('  • Monitor progress with: ai-feature status --feature ' + featureId);
        this.log('  • View logs in: ' + path.join(runDirPath, 'logs', 'logs.ndjson'));
        this.log('');

        if (executionResults.failedTasks > 0) {
          this.warn(
            `Warning: ${executionResults.failedTasks} task(s) failed. Run 'ai-feature resume' to retry.`
          );
        }
      }

      metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: 'resume',
        exit_code: '0',
      });

      await this.flush(logger, metrics, traceManager, commandSpan, runDirPath, 0);
    } catch (error) {
      const exitCode = 1;

      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'resume',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'resume',
          exit_code: '1',
        });
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', exitCode);
        commandSpan.setAttribute('error', true);
        if (error instanceof Error) {
          commandSpan.setAttribute('error.message', error.message);
          commandSpan.setAttribute('error.name', error.name);
        }
        commandSpan.end({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }

      if (logger) {
        logger.error('Resume command failed', {
          error: error instanceof Error ? error.message : 'unknown',
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      await this.flush(logger, metrics, traceManager, commandSpan, runDirPath, exitCode);

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Resume command failed: ${error.message}`, { exit: exitCode });
      } else {
        this.error('Resume command failed with an unknown error', { exit: exitCode });
      }
    }
  }

  private async buildResumePayload(
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
    queueValidation?: QueueValidationResult,
    planSummary?: Awaited<ReturnType<typeof loadPlanSummary>>,
    dryRun = false,
    runDir?: string
  ): Promise<ResumePayload> {
    const payload: ResumePayload = {
      feature_id: analysis.featureId,
      can_resume: analysis.canResume,
      status: analysis.status,
      queue_state: analysis.queueState,
      pending_approvals: analysis.pendingApprovals,
      diagnostics: analysis.diagnostics.map((d) => {
        const diag: { severity: string; message: string; code?: string } = {
          severity: d.severity,
          message: d.message,
        };
        if (d.code) {
          diag.code = d.code;
        }
        return diag;
      }),
      recommendations: analysis.recommendations,
      dry_run: dryRun,
      playbook_reference: 'docs/requirements/resume_playbook.md',
      last_error: analysis.lastError ?? null,
    };

    if (analysis.lastStep) {
      payload.last_step = analysis.lastStep;
    }
    if (analysis.currentStep) {
      payload.current_step = analysis.currentStep;
    }

    if (analysis.integrityCheck) {
      payload.integrity_check = {
        valid: analysis.integrityCheck.valid,
        passed: analysis.integrityCheck.passed.length,
        failed: analysis.integrityCheck.failed.length,
        missing: analysis.integrityCheck.missing.length,
      };
    }

    if (queueValidation) {
      payload.queue_validation = {
        valid: queueValidation.valid,
        total_tasks: queueValidation.totalTasks,
        corrupted_tasks: queueValidation.corruptedTasks,
        errors: queueValidation.errors,
      };
    }

    if (planSummary) {
      payload.plan_summary = {
        total_tasks: planSummary.totalTasks,
        entry_tasks: planSummary.entryTasks.length,
        next_tasks: planSummary.queueState.ready.slice(0, 3),
      };
    }

    // Build resume instructions
    const resumeInstructions: ResumePayload['resume_instructions'] = {};

    if (analysis.lastStep) {
      resumeInstructions.checkpoint = analysis.lastStep;
    }

    if (analysis.currentStep) {
      resumeInstructions.next_step = analysis.currentStep;
    }

    if (analysis.pendingApprovals.length > 0) {
      resumeInstructions.pending_approvals = analysis.pendingApprovals;
    }

    if (Object.keys(resumeInstructions).length > 0) {
      payload.resume_instructions = resumeInstructions;
    }

    // Load rate limit warnings and integration blockers
    if (runDir) {
      await this.attachRateLimitWarnings(payload, runDir);
      await this.attachBranchProtectionBlockers(payload, runDir);
    }

    return payload;
  }

  private async attachRateLimitWarnings(payload: ResumePayload, runDir: string): Promise<void> {
    try {
      const rateLimitReport = await RateLimitReporter.generateReport(runDir);

      const rateLimitWarnings: ResumePayload['rate_limit_warnings'] = [];
      const integrationBlockers: ResumePayload['integration_blockers'] = {};

      for (const [providerName, providerData] of Object.entries(rateLimitReport.providers)) {
        if (providerData.inCooldown || providerData.manualAckRequired) {
          rateLimitWarnings.push({
            provider: providerName,
            in_cooldown: providerData.inCooldown,
            manual_ack_required: providerData.manualAckRequired,
            reset_at: providerData.resetAt,
          });

          // Track integration-specific blockers
          if (providerName === 'github') {
            if (!integrationBlockers.github) {
              integrationBlockers.github = [];
            }
            if (providerData.inCooldown) {
              integrationBlockers.github.push(`Rate limit cooldown until ${providerData.resetAt}`);
            }
            if (providerData.manualAckRequired) {
              integrationBlockers.github.push(
                `Manual acknowledgement required (${providerData.recentHitCount} consecutive hits)`
              );
            }
          }

          if (providerName === 'linear') {
            if (!integrationBlockers.linear) {
              integrationBlockers.linear = [];
            }
            if (providerData.inCooldown) {
              integrationBlockers.linear.push(`Rate limit cooldown until ${providerData.resetAt}`);
            }
            if (providerData.manualAckRequired) {
              integrationBlockers.linear.push(
                `Manual acknowledgement required (${providerData.recentHitCount} consecutive hits)`
              );
            }
          }
        }
      }

      if (rateLimitWarnings.length > 0) {
        payload.rate_limit_warnings = rateLimitWarnings;
      }

      if (Object.keys(integrationBlockers).length > 0) {
        payload.integration_blockers = integrationBlockers;
      }
    } catch {
      // Rate limit data unavailable, skip
    }
  }

  private async attachBranchProtectionBlockers(
    payload: ResumePayload,
    runDir: string
  ): Promise<void> {
    try {
      const report = await loadBranchProtectionReport(runDir);
      if (report && report.blockers.length > 0) {
        payload.branch_protection_blockers = [...report.blockers];
      }
    } catch {
      // Branch protection artifact missing or invalid; skip without blocking resume output
    }
  }

  private printHumanReadable(
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
    queueValidation?: QueueValidationResult,
    flags?: ResumeFlags,
    payload?: ResumePayload
  ): void {
    this.log('');
    this.log('═══════════════════════════════════════════════════════════');
    this.log('  Resume Analysis');
    this.log('═══════════════════════════════════════════════════════════');
    this.log('');

    // Use the formatted output from resumeCoordinator
    this.log(formatResumeAnalysis(analysis));

    // Resume instructions section
    if (analysis.canResume && !flags?.['dry-run']) {
      this.log('');
      this.log('Resume Instructions:');
      if (analysis.lastStep) {
        this.log(`  Last checkpoint: ${analysis.lastStep}`);
      }
      if (analysis.currentStep) {
        this.log(`  Next step: ${analysis.currentStep}`);
      }
      if (analysis.pendingApprovals.length > 0) {
        this.log('  Pending approvals:');
        analysis.pendingApprovals.forEach((gate) => {
          this.log(`    • ${gate.toUpperCase()} - Run: ai-feature approve ${gate}`);
        });
      }
    }

    // Queue validation results
    if (queueValidation && flags?.verbose) {
      this.log('');
      this.log('Queue Validation:');
      if (queueValidation.valid) {
        this.log(`  ✓ Queue is valid (${queueValidation.totalTasks} tasks)`);
      } else {
        this.log(`  ✗ Queue validation failed`);
        this.log(`    Total tasks: ${queueValidation.totalTasks}`);
        this.log(`    Corrupted: ${queueValidation.corruptedTasks}`);
        if (queueValidation.errors.length > 0) {
          this.log('  Errors:');
          for (const error of queueValidation.errors.slice(0, 5)) {
            this.log(`    • Line ${error.line}: ${error.message}`);
          }
          if (queueValidation.errors.length > 5) {
            this.log(`    ... and ${queueValidation.errors.length - 5} more`);
          }
        }
      }
    }

    // Rate limit warnings
    if (payload?.rate_limit_warnings && payload.rate_limit_warnings.length > 0) {
      this.log('');
      this.log('Rate Limit Warnings:');
      for (const warning of payload.rate_limit_warnings) {
        this.log(`  ${warning.provider}:`);
        if (warning.in_cooldown) {
          this.warn(`    ⚠ In cooldown until ${warning.reset_at}`);
        }
        if (warning.manual_ack_required) {
          this.warn(`    ⚠ Manual acknowledgement required`);
          this.log(`       Use: ai-feature rate-limits clear ${warning.provider}`);
        }
      }
    }

    // Integration blockers
    if (payload?.integration_blockers) {
      const blockers = payload.integration_blockers;
      if (
        (blockers.github && blockers.github.length > 0) ||
        (blockers.linear && blockers.linear.length > 0)
      ) {
        this.log('');
        this.log('Integration Blockers:');

        if (blockers.github && blockers.github.length > 0) {
          this.log('  GitHub:');
          blockers.github.forEach((blocker) => {
            this.warn(`    ⚠ ${blocker}`);
          });
        }

        if (blockers.linear && blockers.linear.length > 0) {
          this.log('  Linear:');
          blockers.linear.forEach((blocker) => {
            this.warn(`    ⚠ ${blocker}`);
          });
        }
      }
    }

    if (payload?.branch_protection_blockers && payload.branch_protection_blockers.length > 0) {
      this.log('');
      this.log('Branch Protection Blockers:');
      payload.branch_protection_blockers.forEach((blocker) => {
        this.warn(`  ⚠ ${blocker}`);
      });
    }

    this.log('');
    this.log('═══════════════════════════════════════════════════════════');

    // Warnings for dangerous flags
    if (flags?.force) {
      this.log('');
      this.warn('⚠️  WARNING: Force flag enabled - blockers overridden');
      this.log('');
    }

    if (flags?.['skip-hash-verification']) {
      this.log('');
      this.warn('⚠️  WARNING: Hash verification skipped - integrity not verified');
      this.log('');
    }

    if (flags?.['dry-run']) {
      this.log('');
      this.log('ℹ️  This was a dry run. No changes were made.');
      this.log('   To execute resume, run without --dry-run flag.');
      this.log('');
    }
  }

  private determineExitCode(analysis: Awaited<ReturnType<typeof analyzeResumeState>>): number {
    // Check for integrity failures
    const hasIntegrityFailure = analysis.diagnostics.some(
      (d) => d.code === 'INTEGRITY_HASH_MISMATCH' || d.code === 'INTEGRITY_MISSING_FILES'
    );
    if (hasIntegrityFailure) {
      return 20;
    }

    // Check for queue validation failures
    if (analysis.queueValidation && !analysis.queueValidation.valid) {
      return 30;
    }

    // General blocker
    return 10;
  }

  private async flush(
    logger: StructuredLogger | undefined,
    metrics: MetricsCollector | undefined,
    traceManager: TraceManager | undefined,
    span: ActiveSpan | undefined,
    runDirPath: string | undefined,
    exitCode: number
  ): Promise<void> {
    if (metrics) {
      await metrics.flush();
    }

    if (span) {
      span.setAttribute('exit_code', exitCode);
      span.end({ code: exitCode === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    }

    if (traceManager) {
      await traceManager.flush();
    }

    if (runDirPath) {
      await ensureTelemetryReferences(runDirPath);
    }

    if (logger) {
      logger.info('Resume command completed', { exit_code: exitCode });
      await logger.flush();
    }
  }
}
