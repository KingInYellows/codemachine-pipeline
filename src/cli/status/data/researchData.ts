import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { createCoordinatorForRun } from '../../../workflows/researchCoordinator';
import { isCachedResultFresh } from '../../../core/models/ResearchTask';
import type { StructuredLogger } from '../../../telemetry/logger';
import type { MetricsCollector } from '../../../telemetry/metrics';
import type { StatusResearchPayload } from '../types';
import { logIfUnexpectedFileError } from './types';
import type { DataLogger } from './types';

function isStructuredLogger(logger: DataLogger | undefined): logger is StructuredLogger {
  return (
    logger !== undefined &&
    typeof logger.debug === 'function' &&
    typeof logger.info === 'function' &&
    typeof logger.warn === 'function' &&
    typeof (logger as { error?: unknown }).error === 'function'
  );
}

export async function loadResearchStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger,
  metrics?: MetricsCollector
): Promise<StatusResearchPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);
  const researchDir = join(runDir, 'research');
  const tasksFile = join(researchDir, 'tasks.jsonl');

  // Check if research directory exists
  try {
    await access(researchDir);
  } catch (error) {
    logIfUnexpectedFileError(error, logger, 'Failed to access research directory', {
      research_dir: researchDir,
      error_code: 'STATUS_RESEARCH_DIR_ACCESS_FAILED',
    });
    return undefined;
  }

  try {
    if (!isStructuredLogger(logger) || !metrics) {
      return {
        total_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        cached_tasks: 0,
        stale_tasks: 0,
        research_dir: researchDir,
        tasks_file: tasksFile,
        warnings: ['Research coordinator telemetry unavailable'],
      };
    }

    const coordinator = createCoordinatorForRun(runDir, featureId, logger, metrics);

    const diagnostics = await coordinator.getDiagnostics();
    const warnings: string[] = [...diagnostics.warnings];

    if (diagnostics.errors.length > 0) {
      warnings.push(...diagnostics.errors);
    }

    // Count stale tasks
    const allTasks = await coordinator.listTasks({});
    const staleTasks = allTasks.filter((task) => {
      if (task.status !== 'completed' || !task.results) return false;
      const freshnessReq = task.freshness_requirements ?? {
        max_age_hours: 24,
        force_fresh: false,
      };
      return !isCachedResultFresh(task.results, freshnessReq);
    });

    return {
      total_tasks: diagnostics.totalTasks,
      pending_tasks: diagnostics.pendingTasks,
      in_progress_tasks: diagnostics.inProgressTasks,
      completed_tasks: diagnostics.completedTasks,
      failed_tasks: diagnostics.failedTasks,
      cached_tasks: diagnostics.cachedTasks,
      stale_tasks: staleTasks.length,
      research_dir: researchDir,
      tasks_file: tasksFile,
      warnings,
    };
  } catch (error) {
    logger?.warn('Failed to load research status', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      research_dir: researchDir,
      error_code: 'STATUS_RESEARCH_LOAD_FAILED',
    });
    return {
      total_tasks: 0,
      pending_tasks: 0,
      in_progress_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      cached_tasks: 0,
      stale_tasks: 0,
      research_dir: researchDir,
      tasks_file: tasksFile,
      warnings: [
        `Failed to load research status: ${error instanceof Error ? error.message : 'unknown error'}`,
      ],
    };
  }
}
