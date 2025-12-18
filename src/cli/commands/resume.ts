import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import {
  analyzeResumeState,
  prepareResume,
  formatResumeAnalysis,
  type ResumeOptions,
} from '../../workflows/resumeCoordinator';
import {
  getRunDirectoryPath,
} from '../../persistence/runDirectoryManager';
import type { QueueValidationResult } from '../../workflows/queueStore';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import { createExecutionMetrics } from '../../telemetry/executionMetrics';
import { createExecutionLogWriter } from '../../telemetry/logWriters';
import type { ExecutionTelemetry } from '../../telemetry/executionTelemetry';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
} from '../utils/runDirectory';

type ResumeFlags = {
  feature?: string;
  'dry-run': boolean;
  force: boolean;
  'skip-hash-verification': boolean;
  'validate-queue': boolean;
  json: boolean;
  verbose: boolean;
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
    let executionTelemetry: ExecutionTelemetry | undefined;
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
      executionTelemetry = {
        metrics: createExecutionMetrics(metrics, {
          runDir: runDirPath,
          runId: featureId,
          component: 'execution_queue',
        }),
        logs: createExecutionLogWriter(logger, { runDir: runDirPath, runId: featureId }),
        traceManager,
      };

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

      const queueValidation = analysis.queueValidation;
      if (queueValidation && !queueValidation.valid && !typedFlags.force) {
        logger.error('Queue validation failed', {
          corrupted_tasks: queueValidation.corruptedTasks,
          total_errors: queueValidation.errors.length,
        });
      }

      // Build output payload
      const payload = this.buildResumePayload(analysis, queueValidation, typedFlags['dry-run']);

      if (typedFlags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(analysis, queueValidation, typedFlags);
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
          blockers: analysis.diagnostics.filter(d => d.severity === 'blocker').map(d => d.code),
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

      if (!typedFlags.json) {
        this.log('');
        this.log('✅ Resume preparation successful');
        this.log('');
        this.log('Next steps:');
        this.log('  • The execution coordinator will resume from the last checkpoint');
        this.log('  • Monitor progress with: ai-feature status --feature ' + featureId);
        this.log('  • View logs in: ' + path.join(runDirPath, 'logs', 'logs.ndjson'));
        this.log('');
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
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, { command: 'resume' });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, { command: 'resume', exit_code: '1' });
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

  private buildResumePayload(
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
    queueValidation?: QueueValidationResult,
    dryRun = false
  ): ResumePayload {
    const payload: ResumePayload = {
      feature_id: analysis.featureId,
      can_resume: analysis.canResume,
      status: analysis.status,
      queue_state: analysis.queueState,
      pending_approvals: analysis.pendingApprovals,
      diagnostics: analysis.diagnostics.map(d => {
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

    return payload;
  }

  private printHumanReadable(
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
    queueValidation?: QueueValidationResult,
    flags?: ResumeFlags
  ): void {
    this.log('');
    this.log('═══════════════════════════════════════════════════════════');
    this.log('  Resume Analysis');
    this.log('═══════════════════════════════════════════════════════════');
    this.log('');

    // Use the formatted output from resumeCoordinator
    this.log(formatResumeAnalysis(analysis));

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

  private determineExitCode(
    analysis: Awaited<ReturnType<typeof analyzeResumeState>>
  ): number {
    // Check for integrity failures
    const hasIntegrityFailure = analysis.diagnostics.some(
      d => d.code === 'INTEGRITY_HASH_MISMATCH' || d.code === 'INTEGRITY_MISSING_FILES'
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
