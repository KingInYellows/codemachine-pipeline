/**
 * Task Planner Graph Algorithms
 *
 * Extracted from taskPlanner.ts: dependency graph construction,
 * topological ordering, and parallel path calculation for task DAGs.
 */

import type { TaskNode, PlanArtifact } from '../core/models/PlanArtifact';
import { getEntryTasks } from '../core/models/PlanArtifact';
import type { PlanSummary, PlanDiagnostics } from './taskPlannerTypes.js';

export type { PlanDiagnostics } from './taskPlannerTypes.js';

export interface SpecRequirement {
  requirementId: string;
  description: string;
  testType?: string | undefined;
  priority?: string | undefined;
  dependsOn?: string[];
}

export type RequirementTaskMap = Map<string, string>;

/**
 * Build dependency graph based on task types and logical ordering
 */
export function buildDependencyGraph(
  tasks: TaskNode[],
  options: {
    requirements: SpecRequirement[];
    requirementTaskMap: RequirementTaskMap;
  }
): PlanDiagnostics['blockers'] {
  const blockers: PlanDiagnostics['blockers'] = [];
  const taskIndex = new Map(tasks.map((task) => [task.task_id, task]));
  const taskDepSets = new Map(
    tasks.map((t) => [t.task_id, new Set(t.dependencies.map((d) => d.task_id))])
  );

  for (const req of options.requirements) {
    const taskId = req.requirementId
      ? options.requirementTaskMap.get(req.requirementId)
      : undefined;
    if (!taskId) {
      continue;
    }

    const task = taskIndex.get(taskId);
    if (!task || !req.dependsOn || req.dependsOn.length === 0) {
      continue;
    }

    const depSet = taskDepSets.get(taskId);
    if (!depSet) {
      continue;
    }

    for (const dependencyRequirement of req.dependsOn) {
      const dependencyTaskId = options.requirementTaskMap.get(dependencyRequirement);
      if (!dependencyTaskId) {
        blockers.push({
          taskId,
          reason: 'Missing dependency requirement',
          missingDependencies: [dependencyRequirement],
        });
        continue;
      }

      if (dependencyTaskId === taskId) {
        blockers.push({
          taskId,
          reason: 'Task cannot depend on itself',
          missingDependencies: [dependencyRequirement],
        });
        continue;
      }

      if (!depSet.has(dependencyTaskId)) {
        task.dependencies.push({ task_id: dependencyTaskId, type: 'required' });
        depSet.add(dependencyTaskId);
      }
    }
  }

  // Simple heuristic: testing tasks depend on code_generation tasks
  const codeGenTaskIds = new Set(
    tasks.filter((t) => t.task_type === 'code_generation').map((t) => t.task_id)
  );
  const testingTasks = tasks.filter((t) => t.task_type === 'testing');

  // Make all testing tasks depend on all code generation tasks
  for (const testTask of testingTasks) {
    const existingDeps = new Set(testTask.dependencies.map((d) => d.task_id));
    for (const codeTaskId of codeGenTaskIds) {
      if (!existingDeps.has(codeTaskId)) {
        testTask.dependencies.push({ task_id: codeTaskId, type: 'required' });
        existingDeps.add(codeTaskId);
      }
    }
  }

  // Sort testing tasks by type priority (unit -> integration -> e2e)
  const unitTestIds = new Set(
    testingTasks.filter((t) => t.config?.test_type === 'unit').map((t) => t.task_id)
  );
  const integrationTests = testingTasks.filter((t) => t.config?.test_type === 'integration');
  const e2eTests = testingTasks.filter((t) => t.config?.test_type === 'e2e');

  // Integration tests depend on unit tests
  for (const intTest of integrationTests) {
    const existingDeps = new Set(intTest.dependencies.map((d) => d.task_id));
    for (const unitId of unitTestIds) {
      if (!existingDeps.has(unitId)) {
        intTest.dependencies.push({ task_id: unitId, type: 'required' });
        existingDeps.add(unitId);
      }
    }
  }

  // E2E tests depend on integration tests
  const integrationTestIds = new Set(integrationTests.map((t) => t.task_id));
  for (const e2eTest of e2eTests) {
    const existingDeps = new Set(e2eTest.dependencies.map((d) => d.task_id));
    for (const intId of integrationTestIds) {
      if (!existingDeps.has(intId)) {
        e2eTest.dependencies.push({ task_id: intId, type: 'required' });
        existingDeps.add(intId);
      }
    }
  }

  return blockers;
}

/**
 * Compute topological ordering and depth levels
 */
export function computeTopologicalOrder(tasks: TaskNode[]): {
  order: string[];
  depths: Map<string, number>;
  maxDepth: number;
} {
  const inDegree = new Map<string, number>();
  const depths = new Map<string, number>();

  // Build reverse adjacency map once (O(V+E)) to avoid O(V) scan per node
  const reverseAdj = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.task_id, task.dependencies.length);
    depths.set(task.task_id, 0);
    for (const dep of task.dependencies) {
      if (!reverseAdj.has(dep.task_id)) reverseAdj.set(dep.task_id, []);
      reverseAdj.get(dep.task_id)?.push(task.task_id);
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  const order: string[] = [];

  for (const task of tasks) {
    if (task.dependencies.length === 0) {
      queue.push(task.task_id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    order.push(current);

    const currentDepth = depths.get(current) ?? 0;

    for (const taskId of reverseAdj.get(current) ?? []) {
      const remaining = (inDegree.get(taskId) ?? 0) - 1;
      inDegree.set(taskId, remaining);

      depths.set(taskId, Math.max(depths.get(taskId) ?? 0, currentDepth + 1));

      if (remaining === 0) {
        queue.push(taskId);
      }
    }
  }

  const maxDepth = Math.max(...Array.from(depths.values()), 0);

  return { order, depths, maxDepth };
}

/**
 * Calculate number of parallel execution paths
 */
export function calculateParallelPaths(depths: Map<string, number>): number {
  const depthGroups = new Map<number, number>();

  for (const depth of depths.values()) {
    depthGroups.set(depth, (depthGroups.get(depth) ?? 0) + 1);
  }

  // Maximum tasks at any depth level represents parallel paths
  if (depthGroups.size === 0) {
    return 0;
  }
  return Math.max(...depthGroups.values());
}

/**
 * Build task type breakdown map
 */
export function buildTaskTypeBreakdown(tasks: TaskNode[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.task_type] = (acc[task.task_type] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Create plan summary for CLI output or JSON mode
 */
export function createPlanSummary(
  plan: PlanArtifact,
  planPath: string,
  diagnostics?: PlanDiagnostics
): PlanSummary {
  const dagMetadata = plan.dag_metadata ?? {
    generated_at: plan.updated_at ?? plan.created_at ?? new Date().toISOString(),
  };
  const lastUpdated = plan.updated_at ?? plan.created_at ?? new Date().toISOString();
  const entryTaskIds = getEntryTasks(plan);
  const blockedDetails = plan.tasks
    .filter((task) => task.dependencies.length > 0)
    .map((task) => ({
      taskId: task.task_id,
      waitingOn: task.dependencies.map((dep) => dep.task_id),
    }));

  const defaultBlockers: PlanDiagnostics['blockers'] = blockedDetails.map((detail) => ({
    taskId: detail.taskId,
    reason: 'Waiting for dependency completion',
    ...(detail.waitingOn.length > 0 ? { missingDependencies: detail.waitingOn } : {}),
  }));

  const summaryDiagnostics = diagnostics?.blockers.length ? diagnostics.blockers : defaultBlockers;
  const dagSummary: PlanSummary['dag'] = {
    generatedAt: dagMetadata.generated_at,
    ...(dagMetadata.parallel_paths !== undefined
      ? { parallelPaths: dagMetadata.parallel_paths }
      : {}),
    ...(typeof plan.metadata?.critical_path_depth === 'number'
      ? { criticalPathDepth: plan.metadata.critical_path_depth }
      : {}),
  };

  return {
    planPath,
    totalTasks: plan.tasks.length,
    entryTasks: entryTaskIds,
    blockedTasks: blockedDetails.length,
    taskTypeBreakdown: buildTaskTypeBreakdown(plan.tasks),
    queueState: {
      ready: entryTaskIds,
      blocked: blockedDetails,
      blockers: summaryDiagnostics,
    },
    dag: dagSummary,
    checksum: plan.checksum,
    lastUpdated,
    frReferences: ['FR-12', 'FR-13', 'FR-14'],
  };
}
