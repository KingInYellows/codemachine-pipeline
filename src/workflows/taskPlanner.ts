/**
 * Task Planner
 *
 * Converts approved specification requirements and traceability entries into
 * an ExecutionTask DAG, persists plan.json, manages dependencies, and supports
 * deterministic resume/replay scenarios.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { withLock, getSubdirectoryPath } from '../persistence/runDirectoryManager';
import { z } from 'zod';
import {
  createPlanArtifact,
  validateDAG,
  getEntryTasks,
  PlanArtifactSchema,
  type PlanArtifact,
  type TaskNode,
} from '../core/models/PlanArtifact';
import { loadSpecMetadata } from './specComposer';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { TraceLink } from '../core/models/TraceLink';
import { validateOrThrow } from '../validation/helpers.js';
import {
  buildDependencyGraph,
  computeTopologicalOrder,
  calculateParallelPaths,
  createPlanSummary,
  type PlanDiagnostics,
  type SpecRequirement,
  type RequirementTaskMap,
} from './taskPlannerGraph.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Task planner configuration
 */
export interface TaskPlannerConfig {
  /** Run directory path */
  runDir: string;
  /** Feature identifier */
  featureId: string;
  /** Iteration ID (e.g., 'I3') */
  iterationId?: string;
  /** Force regeneration even if plan.json exists */
  force?: boolean;
}

/**
 * Task planner result
 */
export interface TaskPlannerResult {
  /** Path to generated plan.json */
  planPath: string;
  /** Generated plan artifact */
  plan: PlanArtifact;
  /** Plan summary for CLI consumption */
  summary: PlanSummary;
  /** Planning statistics */
  statistics: {
    /** Total tasks generated */
    totalTasks: number;
    /** Entry tasks (no dependencies) */
    entryTasks: number;
    /** Maximum dependency depth */
    maxDepth: number;
    /** Parallel execution paths */
    parallelPaths: number;
    /** Tasks currently blocked by dependencies */
    blockedTasks: number;
  };
  /** Diagnostics and warnings */
  diagnostics: PlanDiagnostics;
}

/**
 * Plan summary for CLI status output
 */
export interface PlanSummary {
  /** Path to plan.json */
  planPath: string;
  /** Total tasks in plan */
  totalTasks: number;
  /** Entry tasks (can start immediately) */
  entryTasks: string[];
  /** Tasks blocked by dependencies */
  blockedTasks: number;
  /** Breakdown of blockers waiting on dependencies */
  queueState: {
    /** Tasks ready to run (no dependencies) */
    ready: string[];
    /** Tasks waiting on dependencies */
    blocked: Array<{
      taskId: string;
      waitingOn: string[];
    }>;
    /** Blockers derived during planning */
    blockers: PlanDiagnostics['blockers'];
  };
  /** Task counts by task_type */
  taskTypeBreakdown: Record<string, number>;
  /** DAG metadata for CLI summary */
  dag?: {
    parallelPaths?: number;
    generatedAt: string;
    criticalPathDepth?: number;
  };
  /** Plan checksum */
  checksum?: string | undefined;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Feature requirement references (FR-12..FR-14) */
  frReferences: string[];
}

/**
 * Plan metadata persisted alongside plan.json
 */
interface PlanMetadata {
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

const PlanMetadataSchema = z.object({
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

/**
 * Trace document subset for requirement → task mapping
 */
interface TraceDocument {
  links?: TraceLink[];
}

const TraceDocumentSchema = z.object({
  links: z.array(z.unknown()).optional(),
});

// ============================================================================
// Spec Loading
// ============================================================================

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

  const requirements: SpecRequirement[] = [];

  const spec = specJson as {
    test_plan?: Array<{
      test_id: string;
      description: string;
      test_type?: string;
      priority?: string;
      depends_on?: string[];
      dependencies?: string[];
    }>;
  };

  if (spec.test_plan && Array.isArray(spec.test_plan)) {
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

// ============================================================================
// Task Generation
// ============================================================================

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

// ============================================================================
// Plan Persistence
// ============================================================================

/**
 * Compute plan checksum for integrity verification
 */
function computePlanChecksum(plan: PlanArtifact): string {
  const content = JSON.stringify(plan, null, 2);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Persist plan artifact to plan.json
 */
async function persistPlan(
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

/**
 * Load traceability map for spec requirements → task IDs (if available)
 */
async function loadTraceabilityTaskIds(runDir: string): Promise<RequirementTaskMap> {
  const tracePath = path.join(runDir, 'trace.json');
  const mapping: RequirementTaskMap = new Map();

  try {
    const traceContent = await fs.readFile(tracePath, 'utf-8');
    const traceDoc = validateOrThrow(TraceDocumentSchema, JSON.parse(traceContent), 'trace document') as TraceDocument;
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

// ============================================================================
// Main Planner Function
// ============================================================================

/**
 * Load an existing plan.json if present and force-regeneration is not requested.
 * Returns the plan result if found, null if generation should proceed.
 */
async function loadExistingPlanIfPresent(
  config: TaskPlannerConfig,
  planPath: string,
  logger: StructuredLogger
): Promise<TaskPlannerResult | null> {
  if (config.force) return null;

  try {
    await fs.access(planPath);
    logger.info('plan.json already exists, loading existing plan', { planPath });

    const existingContent = await fs.readFile(planPath, 'utf-8');
    const existingPlan = validateOrThrow(PlanArtifactSchema, JSON.parse(existingContent), 'plan artifact');
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
 * Collect blockers for tasks whose declared dependencies are not present in the plan.
 */
function collectMissingDepBlockers(
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

  // Step 1: Verify spec approval
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

  // Step 2: Extract spec requirements
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

  // Step 3: Generate task nodes
  const traceabilityTaskIds = await loadTraceabilityTaskIds(config.runDir);
  const { tasks, requirementTaskMap } = generateTaskNodes(
    requirements,
    config.iterationId,
    traceabilityTaskIds
  );

  logger.debug('Generated task nodes', {
    count: tasks.length,
  });

  // Step 4: Build dependency graph
  const dependencyBlockers = buildDependencyGraph(tasks, { requirements, requirementTaskMap });

  logger.debug('Built dependency graph');

  // Step 5: Compute topological order (for deterministic CLI summaries)
  const { order, depths, maxDepth } = computeTopologicalOrder(tasks);
  const parallelPaths = calculateParallelPaths(depths);

  // Step 5: Create plan artifact
  const plan = createPlanArtifact(config.featureId, tasks, {
    generatedBy: 'task-planner:v1.0.0',
    metadata: {
      iteration_id: config.iterationId,
      spec_hash: specMetadata.specHash,
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

  // Step 6: Validate DAG
  const validation = validateDAG(planWithDag);
  if (!validation.valid) {
    throw new Error(`Plan validation failed:\n${validation.errors.join('\n')}`);
  }

  logger.info('DAG validation passed');

  // Step 7: Identify entry tasks
  const entryTaskIds = getEntryTasks(planWithDag);

  logger.info('Identified entry tasks', {
    count: entryTaskIds.length,
    tasks: entryTaskIds,
  });

  // Step 8: Identify blockers
  const blockers = collectMissingDepBlockers(tasks, dependencyBlockers);

  // Step 9: Persist plan
  const { path: persistedPath, planWithChecksum } = await persistPlan(
    config.runDir,
    planWithDag,
    specMetadata.specHash,
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

// ============================================================================
// Plan Loading & Summary
// ============================================================================

/**
 * Load plan summary for CLI status output
 */
export async function loadPlanSummary(runDir: string): Promise<PlanSummary | null> {
  const planPath = path.join(runDir, 'plan.json');

  try {
    const content = await fs.readFile(planPath, 'utf-8');
    const plan = validateOrThrow(PlanArtifactSchema, JSON.parse(content), 'plan artifact');
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
