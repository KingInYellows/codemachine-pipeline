/**
 * Task Planner Shared Types
 *
 * Interfaces shared between taskPlanner.ts and taskPlannerGraph.ts, extracted
 * here to break the circular dependency between those two modules.
 */

// ============================================================================
// Shared Types
// ============================================================================

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
