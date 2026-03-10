/**
 * Task Planner
 *
 * Converts approved specification requirements and traceability entries into
 * an ExecutionTask DAG, persists plan.json, manages dependencies, and supports
 * deterministic resume/replay scenarios.
 *
 * DAG helpers live in ./plannerDAG.ts; persistence I/O lives in
 * ./plannerPersistence.ts.  This module re-exports their public API so that
 * existing consumers of './taskPlanner' continue to work unchanged.
 */

import * as path from 'node:path';
import { z } from 'zod';
import { getSubdirectoryPath } from '../persistence';
import * as fs from 'node:fs/promises';
import {
  createPlanArtifact,
  validateDAG,
  getEntryTasks,
  type PlanArtifact,
  type TaskNode,
} from '../core/models/PlanArtifact';
import { loadSpecMetadata } from './specComposer';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import { validateOrResult } from '../validation/helpers.js';
import type { PlanDiagnostics } from './taskPlannerTypes.js';
import type { TaskPlannerConfig, TaskPlannerResult } from './taskPlannerTypes.js';
import {
  buildDependencyGraph,
  computeTopologicalOrder,
  calculateParallelPaths,
  createPlanSummary,
  type SpecRequirement,
  type RequirementTaskMap,
} from './taskPlannerGraph.js';

// -- re-exports from extracted modules (backward compatibility) -------------
export type { PlanSummary, TaskPlannerConfig, TaskPlannerResult } from './taskPlannerTypes.js';
export {
  parsePlanArtifactForRead,
  computePlanChecksum,
  collectMissingDepBlockers,
  buildDagMetadata,
} from './plannerDAG.js';
export {
  persistPlan,
  loadTraceabilityTaskIds,
  loadExistingPlanIfPresent,
  loadPlanSummary,
  loadPlanMetadata,
} from './plannerPersistence.js';
export type { PlanMetadata } from './plannerPersistence.js';

// -- local imports from extracted modules -----------------------------------
import { collectMissingDepBlockers } from './plannerDAG.js';
import {
  persistPlan,
  loadTraceabilityTaskIds,
  loadExistingPlanIfPresent,
} from './plannerPersistence.js';

// ---------------------------------------------------------------------------
// Spec requirement extraction
// ---------------------------------------------------------------------------

/**
 * Extract requirements from spec.json test plan
 */
async function extractSpecRequirements(runDir: string): Promise<SpecRequirement[]> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const specJsonPath = path.join(artifactsDir, 'spec.json');

  let specJson: unknown;
  try {
    const specContent = await fs.readFile(specJsonPath, 'utf-8');
    specJson = JSON.parse(specContent);
  } catch {
    return [];
  }

  const SpecTestPlanSchema = z.object({
    test_plan: z
      .array(
        z.object({
          test_id: z.string().min(1),
          description: z.string().min(1),
          test_type: z.string().optional(),
          priority: z.string().optional(),
          depends_on: z.array(z.string()).optional(),
          dependencies: z.array(z.string()).optional(),
        })
      )
      .optional(),
  });

  const parseResult = validateOrResult(SpecTestPlanSchema, specJson, 'spec.json test plan');
  if (!parseResult.success) {
    return [];
  }

  const requirements: SpecRequirement[] = [];
  const spec = parseResult.data;

  if (spec.test_plan) {
    spec.test_plan.forEach((test) => {
      const dependsOn = Array.isArray(test.depends_on)
        ? test.depends_on
        : Array.isArray(test.dependencies)
          ? test.dependencies
          : undefined;

      const requirement: SpecRequirement = {
        requirementId: test.test_id,
        description: test.description,
        testType: test.test_type,
        priority: test.priority,
      };

      if (dependsOn && dependsOn.length > 0) {
        requirement.dependsOn = dependsOn;
      }

      requirements.push(requirement);
    });
  }

  return requirements;
}

// ---------------------------------------------------------------------------
// Task node generation helpers
// ---------------------------------------------------------------------------

/**
 * Generate ExecutionTask nodes from spec requirements
 */
function generateTaskNodes(
  requirements: SpecRequirement[],
  iterationId: string | undefined,
  existingTaskIds: RequirementTaskMap
): { tasks: TaskNode[]; requirementTaskMap: RequirementTaskMap } {
  const tasks: TaskNode[] = [];
  const usedTaskIds = new Set<string>();
  const requirementTaskMap: RequirementTaskMap = new Map();

  requirements.forEach((req, index) => {
    const preferredId =
      existingTaskIds.get(req.requirementId) ??
      buildDefaultTaskId(req.requirementId, iterationId, index);
    const uniqueTaskId = ensureUniqueTaskId(preferredId, usedTaskIds);

    const task: TaskNode = {
      task_id: uniqueTaskId,
      title: req.description,
      task_type: deriveTaskType(req.testType),
      dependencies: [],
      config: {
        requirement_id: req.requirementId,
        test_type: req.testType,
        priority: req.priority,
      },
    };

    tasks.push(task);
    if (req.requirementId) {
      requirementTaskMap.set(req.requirementId, uniqueTaskId);
    }
  });

  return { tasks, requirementTaskMap };
}

/**
 * Build stable fallback task ID from requirement/iteration
 */
function buildDefaultTaskId(
  requirementId: string,
  iterationId: string | undefined,
  index: number
): string {
  const normalizedRequirement = requirementId
    ? normalizeIdentifier(requirementId)
    : `REQ-${(index + 1).toString().padStart(2, '0')}`;
  const iterationPrefix = iterationId ?? 'PLAN';
  return `${iterationPrefix}-${normalizedRequirement}`;
}

/**
 * Normalize identifiers for inclusion in task IDs
 */
function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    return 'UNSPECIFIED';
  }

  return trimmed
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

/**
 * Ensure task ID uniqueness with numeric suffixes
 */
function ensureUniqueTaskId(taskId: string, used: Set<string>): string {
  let uniqueId = taskId;
  let suffix = 1;
  while (used.has(uniqueId)) {
    uniqueId = `${taskId}-${suffix}`;
    suffix += 1;
  }
  used.add(uniqueId);
  return uniqueId;
}

/**
 * Determine task_type classification
 */
function deriveTaskType(testType?: string): string {
  const type = testType?.toLowerCase();
  if (!type) {
    return 'code_generation';
  }

  const testingIndicators = new Set(['unit', 'integration', 'e2e', 'smoke', 'qa']);
  return testingIndicators.has(type) ? 'testing' : 'code_generation';
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Load and validate the spec, extract requirements, and return the spec hash
 * along with any warnings produced during extraction.
 */
async function loadAndValidateSpec(
  config: TaskPlannerConfig,
  logger: StructuredLogger
): Promise<{ specHash: string; requirements: SpecRequirement[]; warnings: string[] }> {
  const specMetadata = await loadSpecMetadata(config.runDir);
  if (!specMetadata) {
    throw new Error('Spec metadata not found. Generate spec first.');
  }

  if (specMetadata.approvalStatus !== 'approved') {
    throw new Error('Spec must be approved before generating execution plan.');
  }

  logger.info('Spec approved, proceeding with plan generation', {
    specHash: specMetadata.specHash,
  });

  const requirements = await extractSpecRequirements(config.runDir);
  const warnings: string[] = [];
  if (requirements.length === 0) {
    const warning = 'No requirements found in spec.json test_plan';
    warnings.push(warning);
    logger.warn(warning);
  }

  logger.debug('Extracted spec requirements', {
    count: requirements.length,
  });

  return { specHash: specMetadata.specHash, requirements, warnings };
}

/**
 * Generate task nodes from requirements, build the dependency graph and
 * topological order, and assemble the PlanArtifact with DAG metadata.
 */
async function assembleTaskGraph(
  config: TaskPlannerConfig,
  requirements: SpecRequirement[],
  specHash: string,
  logger: StructuredLogger
): Promise<{
  tasks: TaskNode[];
  planWithDag: PlanArtifact;
  maxDepth: number;
  parallelPaths: number;
  dependencyBlockers: PlanDiagnostics['blockers'];
}> {
  const traceabilityTaskIds = await loadTraceabilityTaskIds(config.runDir);
  const { tasks, requirementTaskMap } = generateTaskNodes(
    requirements,
    config.iterationId,
    traceabilityTaskIds
  );

  logger.debug('Generated task nodes', {
    count: tasks.length,
  });

  const dependencyBlockers = buildDependencyGraph(tasks, { requirements, requirementTaskMap });

  logger.debug('Built dependency graph');

  const { order, depths, maxDepth } = computeTopologicalOrder(tasks);
  const parallelPaths = calculateParallelPaths(depths);

  const plan = createPlanArtifact(config.featureId, tasks, {
    generatedBy: 'task-planner:v1.0.0',
    metadata: {
      iteration_id: config.iterationId,
      spec_hash: specHash,
      requirement_count: requirements.length,
    },
  });
  const planWithDag: PlanArtifact = {
    ...plan,
    dag_metadata: {
      ...plan.dag_metadata,
      parallel_paths: parallelPaths,
    },
    metadata: {
      ...(plan.metadata ?? {}),
      topological_order: order,
      critical_path_depth: maxDepth,
      fr_references: ['FR-12', 'FR-13', 'FR-14'],
    },
  };

  logger.debug('Computed execution order', {
    maxDepth,
    parallelPaths,
  });

  return { tasks, planWithDag, maxDepth, parallelPaths, dependencyBlockers };
}

/**
 * Generate execution plan from approved specification
 */
export async function generateExecutionPlan(
  config: TaskPlannerConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<TaskPlannerResult> {
  logger.info('Starting execution plan generation', {
    featureId: config.featureId,
    runDir: config.runDir,
    iterationId: config.iterationId,
  });

  const planPath = path.join(config.runDir, 'plan.json');

  const existing = await loadExistingPlanIfPresent(config, planPath, logger);
  if (existing) return existing;

  const { specHash, requirements, warnings } = await loadAndValidateSpec(config, logger);
  const { tasks, planWithDag, maxDepth, parallelPaths, dependencyBlockers } =
    await assembleTaskGraph(config, requirements, specHash, logger);

  const validation = validateDAG(planWithDag);
  if (!validation.valid) {
    throw new Error(`Plan validation failed:\n${validation.errors.join('\n')}`);
  }

  logger.info('DAG validation passed');

  const entryTaskIds = getEntryTasks(planWithDag);

  logger.info('Identified entry tasks', {
    count: entryTaskIds.length,
    tasks: entryTaskIds,
  });

  const blockers = collectMissingDepBlockers(tasks, dependencyBlockers);

  const { path: persistedPath, planWithChecksum } = await persistPlan(
    config.runDir,
    planWithDag,
    specHash,
    config.iterationId
  );

  logger.info('Plan persisted', {
    planPath: persistedPath,
    checksum: planWithChecksum.checksum,
  });

  metrics.increment('execution_plans_generated_total', {
    feature_id: config.featureId,
  });

  const diagnostics: PlanDiagnostics = {
    warnings,
    blockers,
  };

  const summary = createPlanSummary(planWithChecksum, persistedPath, diagnostics);

  logger.info('Plan summary (FR-12..FR-14)', {
    total_tasks: summary.totalTasks,
    entry_tasks: summary.entryTasks,
    blocked_tasks: summary.blockedTasks,
    queue_ready: summary.queueState.ready,
    queue_blocked: summary.queueState.blocked.map((blocked) => blocked.taskId),
    dag_parallel_paths: summary.dag?.parallelPaths ?? 0,
    dag_critical_path_depth: summary.dag?.criticalPathDepth ?? 0,
  });

  return {
    planPath: persistedPath,
    plan: planWithChecksum,
    summary,
    statistics: {
      totalTasks: tasks.length,
      entryTasks: entryTaskIds.length,
      blockedTasks: summary.blockedTasks,
      maxDepth,
      parallelPaths,
    },
    diagnostics,
  };
}
