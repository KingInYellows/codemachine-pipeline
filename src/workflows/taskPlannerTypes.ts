/**
 * Task Planner Shared Types
 *
 * Interfaces shared between taskPlanner.ts, taskPlannerGraph.ts,
 * plannerDAG.ts, and plannerPersistence.ts.  Extracted here to break
 * circular dependencies between those modules.
 */

import type { PlanArtifact } from '../core/models/PlanArtifact';

export interface PlanDiagnostics {
  warnings: string[];
  blockers: Array<{
    taskId: string;
    reason: string;
    missingDependencies?: string[];
  }>;
}

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
