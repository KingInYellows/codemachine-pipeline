import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import { getRunDirectoryPath } from '../../persistence/runDirectoryManager';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode, withSpan } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
  type RunDirectorySettings,
} from '../utils/runDirectory';
import { loadPlanSummary, type PlanSummary } from '../../workflows/taskPlanner';
import { loadSpecMetadata } from '../../workflows/specComposer';
import { comparePlanDiff, type PlanDiff } from '../../workflows/planDiffer';

type PlanFlags = {
  feature?: string;
  json: boolean;
  verbose: boolean;
  'show-diff': boolean;
};

interface PlanPayload {
  feature_id: string | null;
  plan_path: string;
  plan_exists: boolean;
  plan_summary?: {
    total_tasks: number;
    entry_tasks: string[];
    blocked_tasks: number;
    task_type_breakdown: Record<string, number>;
    dag_metadata?: {
      parallel_paths?: number;
      critical_path_depth?: number;
      generated_at: string;
    };
    checksum?: string;
    last_updated: string;
  };
  spec_metadata?: {
    spec_hash: string;
    approval_status: string;
  };
  plan_diff?: PlanDiff;
  notes: string[];
  error?: string;
}

/**
 * Plan command - Display execution plan DAG and task summaries
 * Implements FR-12, FR-13, FR-14: Execution Task Generation and Dependency Management
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found)
 */
export default class Plan extends Command {
  static description = 'Display the execution plan DAG, task summaries, and dependency graph';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --show-diff',
    '<%= config.bin %> <%= command.id %> --verbose',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to query (defaults to current/latest)',
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed task breakdown and dependency chains',
      default: false,
    }),
    'show-diff': Flags.boolean({
      description: 'Compare plan against spec hash to detect changes',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Plan);
    const typedFlags = flags as PlanFlags;

    if (typedFlags.json) {
      process.env.JSON_OUTPUT = '1';
    }

    // Initialize telemetry
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    let runDirPath: string | undefined;
    const startTime = Date.now();

    try {
      const settings = resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      // Initialize telemetry if feature exists
      if (featureId) {
        runDirPath = getRunDirectoryPath(settings.baseDir, featureId);
        logger = createCliLogger('plan', featureId, runDirPath, {
          minLevel: typedFlags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
          mirrorToStderr: !typedFlags.json,
        });
        metrics = createRunMetricsCollector(runDirPath, featureId);
        traceManager = createRunTraceManager(runDirPath, featureId, logger);
        commandSpan = traceManager.startSpan('cli.plan');
        commandSpan.setAttribute('feature_id', featureId);
        commandSpan.setAttribute('json_mode', typedFlags.json);
        commandSpan.setAttribute('verbose_flag', typedFlags.verbose);
        commandSpan.setAttribute('show_diff', typedFlags['show-diff']);

        logger.info('Plan command invoked', {
          feature_id: featureId,
          json_mode: typedFlags.json,
          verbose: typedFlags.verbose,
          show_diff: typedFlags['show-diff'],
        });
      }

      if (typedFlags.feature && featureId !== typedFlags.feature) {
        if (logger) {
          logger.error('Feature not found', { requested: typedFlags.feature });
        }
        this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
      }

      const planSummary = featureId
        ? await this.loadPlanWithTracing(traceManager, commandSpan, settings.baseDir, featureId)
        : undefined;

      const specMetadata = featureId
        ? await loadSpecMetadata(getRunDirectoryPath(settings.baseDir, featureId))
        : undefined;

      const planDiff =
        featureId && typedFlags['show-diff']
          ? await this.computePlanDiff(settings.baseDir, featureId, logger)
          : undefined;

      const payload = this.buildPlanPayload(
        featureId,
        settings,
        planSummary,
        specMetadata,
        planDiff
      );

      if (typedFlags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload, typedFlags);
      }

      // Record success metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'plan',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'plan',
          exit_code: '0',
        });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 0);
        commandSpan.end({ code: SpanStatusCode.OK });
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (runDirPath) {
        await ensureTelemetryReferences(runDirPath);
      }

      if (logger) {
        logger.info('Plan command completed', { duration_ms: Date.now() - startTime });
        await logger.flush();
      }
    } catch (error) {
      // Record error metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'plan',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'plan',
          exit_code: '1',
        });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', 1);
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

      if (traceManager) {
        await traceManager.flush();
      }

      if (runDirPath) {
        await ensureTelemetryReferences(runDirPath);
      }

      if (logger) {
        if (error instanceof Error) {
          logger.error('Plan command failed', {
            error: error.message,
            stack: error.stack,
            duration_ms: Date.now() - startTime,
          });
        }
        await logger.flush();
      }

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Plan command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Plan command failed with an unknown error', { exit: 1 });
      }
    }
  }

  private async loadPlanWithTracing(
    traceManager: TraceManager | undefined,
    parentSpan: ActiveSpan | undefined,
    baseDir: string,
    featureId: string
  ): Promise<PlanSummary | undefined> {
    if (traceManager && parentSpan) {
      return withSpan(
        traceManager,
        'plan.load_summary',
        async (span) => {
          span.setAttribute('feature_id', featureId);
          const runDir = getRunDirectoryPath(baseDir, featureId);
          const summary = await loadPlanSummary(runDir);
          if (summary) {
            span.setAttribute('total_tasks', summary.totalTasks);
            span.setAttribute('entry_tasks', summary.entryTasks.length);
          } else {
            span.setAttribute('plan_not_found', true);
          }
          return summary ?? undefined;
        },
        parentSpan.context
      );
    }

    const runDir = getRunDirectoryPath(baseDir, featureId);
    const summary = await loadPlanSummary(runDir);
    return summary ?? undefined;
  }

  private async computePlanDiff(
    baseDir: string,
    featureId: string,
    logger?: StructuredLogger
  ): Promise<PlanDiff | undefined> {
    try {
      const runDir = getRunDirectoryPath(baseDir, featureId);
      return await comparePlanDiff(runDir);
    } catch (error) {
      if (logger) {
        logger.warn('Plan diff computation failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
      return undefined;
    }
  }

  private buildPlanPayload(
    featureId: string | undefined,
    settings: RunDirectorySettings,
    planSummary?: PlanSummary,
    specMetadata?: Awaited<ReturnType<typeof loadSpecMetadata>>,
    planDiff?: PlanDiff
  ): PlanPayload {
    const planPath = featureId
      ? path.join(getRunDirectoryPath(settings.baseDir, featureId), 'plan.json')
      : path.join(settings.baseDir, '<feature_id>', 'plan.json');

    const payload: PlanPayload = {
      feature_id: featureId ?? null,
      plan_path: planPath,
      plan_exists: planSummary !== undefined,
      notes: [],
    };

    if (planSummary) {
      payload.plan_summary = {
        total_tasks: planSummary.totalTasks,
        entry_tasks: planSummary.entryTasks,
        blocked_tasks: planSummary.blockedTasks,
        task_type_breakdown: planSummary.taskTypeBreakdown,
        ...(planSummary.checksum !== undefined && { checksum: planSummary.checksum }),
        last_updated: planSummary.lastUpdated,
      };

      if (planSummary.dag) {
        payload.plan_summary.dag_metadata = {
          ...(planSummary.dag.parallelPaths !== undefined && {
            parallel_paths: planSummary.dag.parallelPaths,
          }),
          ...(planSummary.dag.criticalPathDepth !== undefined && {
            critical_path_depth: planSummary.dag.criticalPathDepth,
          }),
          generated_at: planSummary.dag.generatedAt,
        };
      }

      payload.notes.push(
        `Plan DAG contains ${planSummary.totalTasks} tasks with ${planSummary.entryTasks.length} entry points`
      );
      payload.notes.push(
        `See docs/requirements/execution_flow.md for DAG semantics and resume behavior`
      );
    } else {
      payload.notes.push('No plan.json found. Ensure spec is approved and run plan generation.');
      payload.notes.push('Plan generation is covered by FR-12, FR-13, FR-14');
    }

    if (specMetadata) {
      payload.spec_metadata = {
        spec_hash: specMetadata.specHash,
        approval_status: specMetadata.approvalStatus,
      };
    }

    if (planDiff) {
      payload.plan_diff = planDiff;
      if (planDiff.has_changes) {
        payload.notes.push(
          '⚠ Specification hash changed—plan may be stale. Re-run plan generation if needed.'
        );
      }
    }

    return payload;
  }

  private printHumanReadable(payload: PlanPayload, flags: PlanFlags): void {
    this.log('');
    this.log(`Feature: ${payload.feature_id ?? '(none detected)'}`);
    this.log(`Plan: ${payload.plan_path}`);
    this.log(`Plan exists: ${payload.plan_exists ? 'Yes' : 'No'}`);
    this.log('');

    if (payload.plan_summary) {
      const summary = payload.plan_summary;
      this.log('═══════════════════════════════════════════════════════════');
      this.log('  Execution Plan Summary');
      this.log('═══════════════════════════════════════════════════════════');
      this.log('');
      this.log(`Total tasks: ${summary.total_tasks}`);
      this.log(`Entry tasks: ${summary.entry_tasks.length} (can start immediately)`);
      this.log(`Blocked tasks: ${summary.blocked_tasks} (waiting on dependencies)`);
      this.log('');

      if (summary.dag_metadata) {
        this.log('DAG Metadata:');
        this.log(`  Parallel paths: ${summary.dag_metadata.parallel_paths ?? 'N/A'}`);
        this.log(`  Critical path depth: ${summary.dag_metadata.critical_path_depth ?? 'N/A'}`);
        this.log(`  Generated at: ${summary.dag_metadata.generated_at}`);
        this.log('');
      }

      this.log('Task Type Breakdown:');
      for (const [taskType, count] of Object.entries(summary.task_type_breakdown)) {
        this.log(`  • ${taskType}: ${count}`);
      }
      this.log('');

      if (flags.verbose) {
        this.log('Entry Tasks (can start immediately):');
        summary.entry_tasks.forEach((taskId) => {
          this.log(`  • ${taskId}`);
        });
        this.log('');
      }

      if (summary.checksum) {
        this.log(`Plan checksum: ${summary.checksum.substring(0, 16)}...`);
      }
      this.log(`Last updated: ${summary.last_updated}`);
      this.log('');
    }

    if (payload.spec_metadata) {
      this.log('Specification:');
      this.log(`  Hash: ${payload.spec_metadata.spec_hash.substring(0, 16)}...`);
      this.log(`  Approval status: ${payload.spec_metadata.approval_status}`);
      this.log('');
    }

    if (payload.plan_diff && flags['show-diff']) {
      this.log('═══════════════════════════════════════════════════════════');
      this.log('  Plan Diff Analysis');
      this.log('═══════════════════════════════════════════════════════════');
      this.log('');

      if (payload.plan_diff.has_changes) {
        this.warn('⚠ Changes detected between current spec and plan');
        this.log('');
        this.log('Changed fields:');
        payload.plan_diff.changed_fields.forEach((field) => {
          this.log(`  • ${field}`);
        });
        this.log('');

        if (payload.plan_diff.spec_hash_changed) {
          this.warn('Spec hash changed:');
          this.log(`  Previous: ${payload.plan_diff.previous_spec_hash ?? 'unknown'}`);
          this.log(`  Current:  ${payload.plan_diff.current_spec_hash ?? 'unknown'}`);
          this.log('');
        }

        if (payload.plan_diff.recommendation) {
          this.log('Recommendation:');
          this.log(`  ${payload.plan_diff.recommendation}`);
          this.log('');
        }
      } else {
        this.log('✓ Plan is up-to-date with specification');
        this.log('');
      }
    }

    if (payload.error) {
      this.warn(`Error: ${payload.error}`);
      this.log('');
    }

    for (const note of payload.notes) {
      this.log(`• ${note}`);
    }
    this.log('');
  }
}
