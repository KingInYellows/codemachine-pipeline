import { Flags } from '@oclif/core';
import * as path from 'node:path';
import { getRunDirectoryPath } from '../../persistence/runDirectoryManager';
import { withSpan } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  type RunDirectorySettings,
} from '../utils/runDirectory';
import { loadPlanSummary, buildDagMetadata, type PlanSummary } from '../../workflows/taskPlanner';
import { loadSpecMetadata } from '../../workflows/specComposer';
import { comparePlanDiff, type PlanDiff } from '../../workflows/planDiffer';
import { setJsonOutputMode } from '../utils/cliErrors';
import { TelemetryCommand } from './base';

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
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found)
 */
export default class Plan extends TelemetryCommand {
  protected get commandName(): string {
    return 'plan';
  }

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
      setJsonOutputMode();
    }

    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
    const runDirPath = featureId
      ? getRunDirectoryPath(settings.baseDir, featureId)
      : undefined;

    await this.runWithTelemetry(
      {
        runDirPath,
        featureId: featureId ?? undefined,
        jsonMode: typedFlags.json,
        verbose: typedFlags.verbose,
        spanAttributes: {
          verbose_flag: typedFlags.verbose,
          show_diff: typedFlags['show-diff'],
        },
      },
      async (ctx) => {
        ctx.logger?.info('Plan command invoked', {
          feature_id: featureId,
          json_mode: typedFlags.json,
          verbose: typedFlags.verbose,
          show_diff: typedFlags['show-diff'],
        });

        if (typedFlags.feature && featureId !== typedFlags.feature) {
          ctx.logger?.error('Feature not found', { requested: typedFlags.feature });
          this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
        }

        const planSummary = featureId
          ? await this.loadPlanWithTracing(ctx.traceManager, ctx.commandSpan, settings.baseDir, featureId)
          : undefined;

        const specMetadata = featureId
          ? await loadSpecMetadata(getRunDirectoryPath(settings.baseDir, featureId))
          : undefined;

        const planDiff =
          featureId && typedFlags['show-diff']
            ? await this.computePlanDiff(settings.baseDir, featureId, ctx.logger)
            : undefined;

        const payload = this.buildPlanPayload(
          featureId,
          settings,
          planSummary,
          specMetadata,
          planDiff,
        );

        if (typedFlags.json) {
          this.log(JSON.stringify(payload, null, 2));
        } else {
          this.printHumanReadable(payload, typedFlags);
        }
      },
    );
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

      const dagMetadata = buildDagMetadata(planSummary.dag);
      if (dagMetadata) {
        payload.plan_summary.dag_metadata = dagMetadata;
      }

      payload.notes.push(
        `Plan DAG contains ${planSummary.totalTasks} tasks with ${planSummary.entryTasks.length} entry points`
      );
      payload.notes.push(
        `See docs/reference/architecture/execution_flow_spec.md for DAG semantics and resume behavior`
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
