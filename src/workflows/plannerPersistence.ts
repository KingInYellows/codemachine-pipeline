/**
 * Planner Persistence
 *
 * Extracted from taskPlanner.ts: all file-system I/O for plan artifacts,
 * plan metadata, traceability task-ID mapping, and existing-plan loading.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { withLock } from '../persistence';
import {
  getEntryTasks,
  type PlanArtifact,
} from '../core/models/PlanArtifact';
import { validateOrThrow } from '../validation/helpers.js';
import type { StructuredLogger } from '../telemetry/logger';
import type { TraceLink } from '../core/models/TraceLink';
import type { PlanSummary, TaskPlannerConfig, TaskPlannerResult } from './taskPlannerTypes.js';
import { createPlanSummary } from './taskPlannerGraph.js';
import {
  parsePlanArtifactForRead,
  computePlanChecksum,
} from './plannerDAG.js';

// ---------------------------------------------------------------------------
// Plan metadata
// ---------------------------------------------------------------------------

/**
 * Plan metadata persisted alongside plan.json
 */
export interface PlanMetadata {
  schema_version: string;
  feature_id: string;
  plan_hash: string;
  spec_hash: string;
  iteration_id?: string | undefined;
  created_at: string;
  updated_at: string;
  total_tasks: number;
  entry_tasks: string[];
}

export const PlanMetadataSchema = z.object({
  schema_version: z.string(),
  feature_id: z.string(),
  plan_hash: z.string(),
  spec_hash: z.string(),
  iteration_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  total_tasks: z.number(),
  entry_tasks: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Trace document
// ---------------------------------------------------------------------------

/**
 * Trace document subset for requirement → task mapping
 */
interface TraceDocument {
  links?: TraceLink[];
}

const TraceDocumentSchema = z.object({
  links: z.array(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persist plan artifact to plan.json
 */
export async function persistPlan(
  runDir: string,
  plan: PlanArtifact,
  specHash: string,
  iterationId?: string
): Promise<{ path: string; planWithChecksum: PlanArtifact }> {
  const planPath = path.join(runDir, 'plan.json');
  const metadataPath = path.join(runDir, 'plan_metadata.json');

  const planChecksum = computePlanChecksum(plan);

  // Update plan with checksum
  const planWithChecksum: PlanArtifact = {
    ...plan,
    checksum: planChecksum,
  };

  // Create metadata
  const now = new Date().toISOString();
  const metadata: PlanMetadata = {
    schema_version: '1.0.0',
    feature_id: plan.feature_id,
    plan_hash: planChecksum,
    spec_hash: specHash,
    iteration_id: iterationId,
    created_at: now,
    updated_at: now,
    total_tasks: plan.tasks.length,
    entry_tasks: getEntryTasks(plan),
  };

  // Write files atomically with lock
  await withLock(runDir, async () => {
    await fs.writeFile(planPath, JSON.stringify(planWithChecksum, null, 2), 'utf-8');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  });

  return { path: planPath, planWithChecksum };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load traceability map for spec requirements → task IDs (if available)
 */
export async function loadTraceabilityTaskIds(
  runDir: string
): Promise<Map<string, string>> {
  const tracePath = path.join(runDir, 'trace.json');
  const mapping = new Map<string, string>();

  try {
    const traceContent = await fs.readFile(tracePath, 'utf-8');
    const traceDoc = validateOrThrow(
      TraceDocumentSchema,
      JSON.parse(traceContent),
      'trace document'
    ) as TraceDocument;
    if (!traceDoc.links) {
      return mapping;
    }

    for (const link of traceDoc.links) {
      if (
        link.source_type === 'execution_task' &&
        link.target_type === 'spec_requirement' &&
        link.target_id
      ) {
        mapping.set(link.target_id, link.source_id);
      }
    }
  } catch {
    // Traceability data is optional at plan-generation time
  }

  return mapping;
}

/**
 * Load an existing plan.json if present and force-regeneration is not requested.
 * Returns the plan result if found, null if generation should proceed.
 */
export async function loadExistingPlanIfPresent(
  config: TaskPlannerConfig,
  planPath: string,
  logger: StructuredLogger
): Promise<TaskPlannerResult | null> {
  if (config.force) return null;

  try {
    await fs.access(planPath);
    logger.info('plan.json already exists, loading existing plan', { planPath });

    const existingContent = await fs.readFile(planPath, 'utf-8');
    const existingPlan = parsePlanArtifactForRead(existingContent);
    const existingSummary = createPlanSummary(existingPlan, planPath);

    return {
      planPath,
      plan: existingPlan,
      summary: existingSummary,
      statistics: {
        totalTasks: existingPlan.tasks.length,
        entryTasks: existingSummary.entryTasks.length,
        blockedTasks: existingSummary.blockedTasks,
        maxDepth: existingSummary.dag?.criticalPathDepth ?? 0,
        parallelPaths: existingSummary.dag?.parallelPaths ?? 0,
      },
      diagnostics: {
        warnings: ['plan.json already exists; use --force to regenerate'],
        blockers: existingSummary.queueState.blockers,
      },
    };
  } catch {
    return null; // File doesn't exist, proceed with generation
  }
}

/**
 * Load plan summary for CLI status output
 */
export async function loadPlanSummary(runDir: string): Promise<PlanSummary | null> {
  const planPath = path.join(runDir, 'plan.json');

  try {
    const content = await fs.readFile(planPath, 'utf-8');
    const plan = parsePlanArtifactForRead(content);
    return createPlanSummary(plan, planPath);
  } catch {
    return null;
  }
}

/**
 * Load plan metadata
 */
export async function loadPlanMetadata(runDir: string): Promise<PlanMetadata | null> {
  const metadataPath = path.join(runDir, 'plan_metadata.json');

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return validateOrThrow(PlanMetadataSchema, JSON.parse(content), 'plan metadata');
  } catch {
    return null;
  }
}
