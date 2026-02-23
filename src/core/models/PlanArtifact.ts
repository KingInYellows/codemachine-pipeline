import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * PlanArtifact Model
 *
 * Defines the execution plan DAG with task dependencies, metadata,
 * and checksum for idempotence verification.
 *
 * Implements:
 * - FR-2 (Run Directory): Plan persistence in plan.json
 * - FR-3 (Resumability): Dependency graph for step ordering
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: start, resume, status
 */

// ============================================================================
// Task Dependency Schema
// ============================================================================

const TaskDependencySchema = z.object({
  /** Dependent task ID */
  task_id: z.string().min(1),
  /** Dependency type (e.g., 'required', 'optional') */
  type: z.enum(['required', 'optional']).default('required'),
});

export type TaskDependency = z.infer<typeof TaskDependencySchema>;

// ============================================================================
// Task Node Schema
// ============================================================================

const TaskNodeSchema = z.object({
  /** Unique task identifier */
  task_id: z.string().min(1),
  /** Task title or description */
  title: z.string().min(1),
  /** Task type (e.g., 'research', 'code_generation', 'testing') */
  task_type: z.string().min(1),
  /** Array of task IDs this task depends on */
  dependencies: z.array(TaskDependencySchema).default([]),
  /** Estimated execution time in minutes */
  estimated_duration_minutes: z.number().int().nonnegative().optional(),
  /** Task-specific configuration */
  config: z.record(z.string(), z.unknown()).optional(),
});

export type TaskNode = z.infer<typeof TaskNodeSchema>;

// ============================================================================
// DAG Metadata Schema
// ============================================================================

const DAGMetadataSchema = z.object({
  /** Total number of tasks in the plan */
  total_tasks: z.number().int().nonnegative(),
  /** Number of parallel execution paths */
  parallel_paths: z.number().int().nonnegative().optional(),
  /** Estimated total execution time in minutes */
  estimated_total_duration_minutes: z.number().int().nonnegative().optional(),
  /** Plan generation timestamp (ISO 8601) */
  generated_at: z.string().datetime(),
  /** Plan generator agent or tool identifier */
  generated_by: z.string().optional(),
});

export type DAGMetadata = z.infer<typeof DAGMetadataSchema>;

// ============================================================================
// PlanArtifact Schema
// ============================================================================

export const PlanArtifactSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Feature ID this plan belongs to */
    feature_id: z.string().min(1),
    /** ISO 8601 timestamp when plan was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when plan was last updated */
    updated_at: z.string().datetime(),
    /** DAG task nodes defining the execution plan */
    tasks: z.array(TaskNodeSchema),
    /** DAG metadata and statistics */
    dag_metadata: DAGMetadataSchema,
    /** SHA-256 checksum of plan content for idempotence */
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format')
      .optional(),
    /** Optional plan-level metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PlanArtifact = Readonly<z.infer<typeof PlanArtifactSchema>>;

// ============================================================================
// Serialization Helpers

const { parse: parsePlanArtifact, serialize: serializePlanArtifact } =
  createModelParser<PlanArtifact>(PlanArtifactSchema);
export { parsePlanArtifact, serializePlanArtifact };

/**
 * Create a new PlanArtifact
 *
 * @param featureId - Feature identifier
 * @param tasks - Array of task nodes
 * @param options - Optional configuration
 * @returns Initialized PlanArtifact object
 */
export function createPlanArtifact(
  featureId: string,
  tasks: TaskNode[],
  options?: {
    generatedBy?: string;
    metadata?: Record<string, unknown>;
  }
): PlanArtifact {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    created_at: now,
    updated_at: now,
    tasks,
    dag_metadata: {
      total_tasks: tasks.length,
      generated_at: now,
      generated_by: options?.generatedBy,
    },
    metadata: options?.metadata,
  };
}

/**
 * Validate DAG structure for cycles and orphaned tasks
 *
 * @param planArtifact - PlanArtifact to validate
 * @returns Validation result with errors if any
 */
export function validateDAG(planArtifact: PlanArtifact): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const taskIds = new Set(planArtifact.tasks.map((t) => t.task_id));

  // Check for duplicate task IDs
  const duplicates = planArtifact.tasks
    .map((t) => t.task_id)
    .filter((id, index, arr) => arr.indexOf(id) !== index);

  if (duplicates.length > 0) {
    errors.push(`Duplicate task IDs found: ${duplicates.join(', ')}`);
  }

  // Check for invalid dependency references
  for (const task of planArtifact.tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep.task_id)) {
        errors.push(`Task ${task.task_id} depends on non-existent task ${dep.task_id}`);
      }
    }
  }

  // Check for cycles (simplified detection)
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(taskId: string): boolean {
    if (recursionStack.has(taskId)) {
      return true;
    }

    if (visited.has(taskId)) {
      return false;
    }

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = planArtifact.tasks.find((t) => t.task_id === taskId);
    if (task) {
      for (const dep of task.dependencies) {
        if (hasCycle(dep.task_id)) {
          errors.push(`Cycle detected involving task ${taskId}`);
          recursionStack.delete(taskId);
          return true;
        }
      }
    }

    recursionStack.delete(taskId);
    return false;
  }

  for (const task of planArtifact.tasks) {
    if (!visited.has(task.task_id)) {
      hasCycle(task.task_id);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get tasks with no dependencies (entry points)
 *
 * @param planArtifact - PlanArtifact to analyze
 * @returns Array of task IDs that have no dependencies
 */
export function getEntryTasks(planArtifact: PlanArtifact): string[] {
  return planArtifact.tasks
    .filter((task) => task.dependencies.length === 0)
    .map((task) => task.task_id);
}

/**
 * Get tasks that depend on a specific task
 *
 * @param planArtifact - PlanArtifact to analyze
 * @param taskId - Task ID to find dependents for
 * @returns Array of task IDs that depend on the specified task
 */
export function getDependentTasks(planArtifact: PlanArtifact, taskId: string): string[] {
  return planArtifact.tasks
    .filter((task) => task.dependencies.some((dep) => dep.task_id === taskId))
    .map((task) => task.task_id);
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parsePlanArtifact
 * @returns Formatted error message
 */
export function formatPlanArtifactValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['PlanArtifact validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
