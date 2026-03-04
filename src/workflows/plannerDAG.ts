/**
 * Planner DAG Utilities
 *
 * Extracted from taskPlanner.ts: DAG validation helpers, plan artifact
 * read-schema, checksum computation, and dag_metadata construction.
 */

import * as crypto from 'node:crypto';
import { z } from 'zod';
import {
  type PlanArtifact,
  type TaskNode,
} from '../core/models/PlanArtifact';
import { validateOrThrow } from '../validation/helpers.js';
import type { PlanDiagnostics, PlanSummary } from './taskPlannerTypes.js';

// ---------------------------------------------------------------------------
// Plan artifact read schema
// ---------------------------------------------------------------------------

export const PlanArtifactReadSchema = z
  .object({
    tasks: z.array(
      z
        .object({
          task_id: z.string(),
          dependencies: z
            .array(
              z
                .object({
                  task_id: z.string(),
                  type: z.string().optional(),
                })
                .passthrough()
            )
            .default([]),
        })
        .passthrough()
    ),
    dag_metadata: z
      .object({
        generated_at: z.string().optional(),
        parallel_paths: z.number().optional(),
        critical_path_depth: z.number().optional(),
      })
      .passthrough()
      .default(() => ({ generated_at: new Date().toISOString() })),
    metadata: z.record(z.string(), z.unknown()).optional(),
    checksum: z.string().optional(),
    updated_at: z.string().default(() => new Date().toISOString()),
  })
  .passthrough();

export function parsePlanArtifactForRead(content: string): PlanArtifact {
  const parsed: unknown = JSON.parse(content);
  return validateOrThrow(PlanArtifactReadSchema, parsed, 'plan artifact') as PlanArtifact;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/**
 * Compute plan checksum for integrity verification
 */
export function computePlanChecksum(plan: PlanArtifact): string {
  const content = JSON.stringify(plan, null, 2);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// DAG blocker collection
// ---------------------------------------------------------------------------

/**
 * Collect blockers for tasks whose declared dependencies are not present in the plan.
 */
export function collectMissingDepBlockers(
  tasks: TaskNode[],
  dependencyBlockers: PlanDiagnostics['blockers']
): PlanDiagnostics['blockers'] {
  const blockers: PlanDiagnostics['blockers'] = [...dependencyBlockers];
  for (const task of tasks) {
    const missingDeps = task.dependencies.filter(
      (dep) => !tasks.some((t) => t.task_id === dep.task_id)
    );
    if (missingDeps.length > 0) {
      blockers.push({
        taskId: task.task_id,
        reason: 'Missing dependencies',
        missingDependencies: missingDeps.map((d) => d.task_id),
      });
    }
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// DAG metadata helper
// ---------------------------------------------------------------------------

/**
 * Build dag_metadata payload from a PlanSummary dag object.
 *
 * Both plan.ts and status/data/planData.ts construct the same spread object
 * from planSummary.dag.  This helper centralises that construction so changes
 * to the DAG shape only need to be made once.
 *
 * @param dag - The dag field from a PlanSummary (may be undefined)
 * @returns A dag_metadata object ready for embedding in a payload, or
 *   undefined if dag is not present
 */
export function buildDagMetadata(
  dag: PlanSummary['dag']
): { parallel_paths?: number; critical_path_depth?: number; generated_at: string } | undefined {
  if (!dag) {
    return undefined;
  }
  return {
    ...(dag.parallelPaths !== undefined && { parallel_paths: dag.parallelPaths }),
    ...(dag.criticalPathDepth !== undefined && { critical_path_depth: dag.criticalPathDepth }),
    generated_at: dag.generatedAt,
  };
}
