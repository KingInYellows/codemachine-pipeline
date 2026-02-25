import * as path from 'node:path';
import { getRunDirectoryPath, readManifest } from '../../../persistence/runDirectoryManager';
import { loadTraceSummary } from '../../../workflows/traceabilityMapper';
import { loadPlanSummary } from '../../../workflows/taskPlanner';
import { withSpan } from '../../../telemetry/traces';
import type { TraceManager, ActiveSpan } from '../../../telemetry/traces';
import {
  MANIFEST_FILE,
  type ManifestLoadResult,
  type StatusTraceabilityPayload,
  type StatusPlanPayload,
} from '../types';
import type { DataLogger } from './types';

export async function loadManifestSnapshot(
  baseDir: string,
  featureId: string
): Promise<ManifestLoadResult> {
  const runDir = getRunDirectoryPath(baseDir, featureId);
  const manifestPath = path.join(runDir, MANIFEST_FILE);

  try {
    const manifest = await readManifest(runDir);
    return { manifest, manifestPath };
  } catch (error) {
    return {
      manifestPath,
      error: error instanceof Error ? error.message : 'Unknown manifest error',
    };
  }
}

export async function loadManifestWithTracing(
  traceManager: TraceManager | undefined,
  parentSpan: ActiveSpan | undefined,
  baseDir: string,
  featureId: string
): Promise<ManifestLoadResult> {
  if (traceManager && parentSpan) {
    return withSpan(
      traceManager,
      'status.load_manifest',
      async (span) => {
        span.setAttribute('feature_id', featureId);
        const result = await loadManifestSnapshot(baseDir, featureId);
        if (result.error) {
          span.setAttribute('manifest_load_error', true);
        } else if (result.manifest) {
          span.setAttribute('manifest_status', result.manifest.status);
        }
        return result;
      },
      parentSpan.context
    );
  }

  return loadManifestSnapshot(baseDir, featureId);
}

export async function loadTraceabilityStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusTraceabilityPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  try {
    const traceSummary = await loadTraceSummary(runDir);

    if (!traceSummary) {
      return undefined;
    }

    return {
      trace_path: traceSummary.tracePath,
      total_links: traceSummary.totalLinks,
      prd_goals_mapped: traceSummary.prdGoalsMapped,
      spec_requirements_mapped: traceSummary.specRequirementsMapped,
      execution_tasks_mapped: traceSummary.executionTasksMapped,
      last_updated: traceSummary.lastUpdated,
      outstanding_gaps: traceSummary.outstandingGaps,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      logger?.warn('Failed to load traceability', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_TRACEABILITY_LOAD_FAILED',
      });
    }
    return undefined;
  }
}

export async function loadPlanStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusPlanPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);
  const planPath = path.join(runDir, 'plan.json');

  try {
    const planSummary = await loadPlanSummary(runDir);
    if (!planSummary) {
      return {
        plan_path: planPath,
        plan_exists: false,
      };
    }

    const result: StatusPlanPayload = {
      plan_path: planPath,
      plan_exists: true,
      total_tasks: planSummary.totalTasks,
      entry_tasks: planSummary.entryTasks.length,
      blocked_tasks: planSummary.blockedTasks,
      task_type_breakdown: planSummary.taskTypeBreakdown,
      ...(planSummary.checksum !== undefined && { checksum: planSummary.checksum }),
      ...(planSummary.lastUpdated && { last_updated: planSummary.lastUpdated }),
    };

    if (planSummary.dag) {
      result.dag_metadata = {
        ...(planSummary.dag.parallelPaths !== undefined && {
          parallel_paths: planSummary.dag.parallelPaths,
        }),
        ...(planSummary.dag.criticalPathDepth !== undefined && {
          critical_path_depth: planSummary.dag.criticalPathDepth,
        }),
        generated_at: planSummary.dag.generatedAt,
      };
    }

    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      logger?.warn('Failed to load plan', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        plan_path: planPath,
        error_code: 'STATUS_PLAN_LOAD_FAILED',
      });
    }
    return {
      plan_path: planPath,
      plan_exists: false,
    };
  }
}
