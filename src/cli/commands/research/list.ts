import { Command, Flags } from '@oclif/core';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { resolveRunDirectorySettings, selectFeatureId } from '../../utils/runDirectory';
import { createCliLogger } from '../../../telemetry/logger';
import { createRunMetricsCollector } from '../../../telemetry/metrics';
import {
  createResearchCoordinator,
  type ResearchDiagnostics,
  type ResearchTaskFilters,
} from '../../../workflows/researchCoordinator';
import type { ResearchTask } from '../../../core/models/ResearchTask';
import { setJsonOutputMode } from '../../utils/cliErrors';
import { flushTelemetrySuccess, flushTelemetryError } from '../../utils/telemetryLifecycle';

type ListFlags = {
  feature?: string;
  status?: ResearchTask['status'][];
  stale: boolean;
  limit?: number;
  json: boolean;
};

interface ResearchListPayload {
  feature_id: string;
  tasks: ResearchTask[];
  diagnostics: ResearchDiagnostics;
}

export default class ResearchList extends Command {
  static description = 'List ResearchTasks for the selected feature run directory';

  static examples = [
    '<%= config.bin %> research list',
    '<%= config.bin %> research list --feature feat-123',
    '<%= config.bin %> research list --status pending --status in_progress',
    '<%= config.bin %> research list --stale --limit 5',
    '<%= config.bin %> research list --json',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to inspect (defaults to most recent run)',
    }),
    status: Flags.string({
      char: 's',
      multiple: true,
      options: ['pending', 'in_progress', 'completed', 'failed', 'cached'] as const,
      description: 'Filter by task status (repeatable)',
    }),
    stale: Flags.boolean({
      description: 'Show only tasks whose cached results are stale',
      default: false,
    }),
    limit: Flags.integer({
      description: 'Limit the number of tasks returned',
      min: 1,
    }),
    json: Flags.boolean({
      description: 'Emit machine-readable JSON output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchList);
    const typedFlags = flags as ListFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const startTime = Date.now();
    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

    if (!featureId) {
      this.error('No feature run directory found. Use `codepipe start` first.', { exit: 10 });
    }

    if (typedFlags.feature && featureId !== typedFlags.feature) {
      this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
    }

    const runDir = getRunDirectoryPath(settings.baseDir, featureId);
    const logger = createCliLogger('research:list', featureId, runDir);
    const metrics = createRunMetricsCollector(runDir, featureId);
    const coordinator = createResearchCoordinator(
      {
        repoRoot: process.cwd(),
        runDir,
        featureId,
      },
      logger,
      metrics
    );

    try {
      const statusFilter =
        typedFlags.status && typedFlags.status.length > 0
          ? typedFlags.status.length === 1
            ? typedFlags.status[0]
            : typedFlags.status
          : undefined;

      const filters: ResearchTaskFilters = {};
      if (statusFilter !== undefined) {
        filters.status = statusFilter;
      }
      if (typedFlags.stale) {
        filters.onlyStale = true;
      }
      if (typeof typedFlags.limit === 'number') {
        filters.limit = typedFlags.limit;
      }

      const tasks = await coordinator.listTasks(filters);
      const diagnostics = await coordinator.getDiagnostics();

      const payload: ResearchListPayload = {
        feature_id: featureId,
        tasks,
        diagnostics,
      };

      if (typedFlags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload);
      }
      await flushTelemetrySuccess({ commandName: 'research:list', startTime, metrics });
    } catch (error) {
      await flushTelemetryError({ commandName: 'research:list', startTime, metrics }, error);

      logger.error('Failed to list research tasks', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
      this.error('Failed to list research tasks', { exit: 1 });
    }
  }

  private printHumanReadable(payload: ResearchListPayload): void {
    this.log(`Research tasks for feature: ${payload.feature_id}`);

    if (payload.tasks.length === 0) {
      this.log('No research tasks have been recorded yet.');
      return;
    }

    const grouped = new Map<ResearchTask['status'], ResearchTask[]>();
    for (const task of payload.tasks) {
      if (!grouped.has(task.status)) {
        grouped.set(task.status, []);
      }
      const tasksForStatus = grouped.get(task.status);
      if (tasksForStatus) {
        tasksForStatus.push(task);
      }
    }

    const statusOrder: ResearchTask['status'][] = [
      'pending',
      'in_progress',
      'completed',
      'failed',
      'cached',
    ];

    for (const status of statusOrder) {
      const entries = grouped.get(status);
      if (!entries || entries.length === 0) {
        continue;
      }

      this.log(`\n${status.toUpperCase()} (${entries.length}):`);
      for (const task of entries) {
        const objectivesCount = task.objectives.length;
        const sourcesCount = task.sources?.length ?? 0;
        const cachePreview = task.cache_key ? task.cache_key.slice(0, 8) : 'none';
        const completedAt = task.completed_at ? ` | Completed: ${task.completed_at}` : '';
        this.log(`  [${task.task_id}] ${task.title}`);
        this.log(
          `    Status: ${task.status} | Objectives: ${objectivesCount} | Sources: ${sourcesCount} | Cache: ${cachePreview}${completedAt}`
        );
        );

        if (task.results?.summary) {
          this.log(`    Summary: ${this.truncate(task.results.summary)}`);
        }
      }
    }

    this.log('\nDiagnostics:');
    this.log(
      `  Total=${payload.diagnostics.totalTasks} | Pending=${payload.diagnostics.pendingTasks} | In Progress=${payload.diagnostics.inProgressTasks} | Completed=${payload.diagnostics.completedTasks} | Failed=${payload.diagnostics.failedTasks} | Cached=${payload.diagnostics.cachedTasks}`
    );
  }

  private truncate(value: string, maxLength = 140): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 3)}...`;
  }
}
