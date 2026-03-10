import { z } from 'zod';

/**
 * ExecutionTask Model
 *
 * Units of work (code_generation, testing, pr_creation, deployment)
 * with statuses, retries, logs, cost tracking, and assigned agents.
 *
 * Used by CLI commands: start, resume, status
 */

export const ExecutionTaskTypeSchema = z.enum([
  'code_generation',
  'testing',
  'pr_creation',
  'deployment',
  'review',
  'refactoring',
  'documentation',
  'other',
  'validation',
  'patch_application',
  'git_operation',
  'custom',
]);

export type ExecutionTaskType = z.infer<typeof ExecutionTaskTypeSchema>;

export const ExecutionTaskStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);

export type ExecutionTaskStatus = z.infer<typeof ExecutionTaskStatusSchema>;

const TaskErrorSchema = z.object({
  message: z.string().min(1),
  code: z.string().optional(),
  details: z.string().optional(),
  timestamp: z.string().datetime(),
  recoverable: z.boolean().default(true),
});

export type TaskError = z.infer<typeof TaskErrorSchema>;

const CostTrackingSchema = z.object({
  total_usd: z.number().nonnegative().default(0),
  breakdown: z.record(z.string(), z.number().nonnegative()).optional(),
  api_calls: z.number().int().nonnegative().default(0),
  /** Input + output tokens combined */
  tokens_consumed: z.number().int().nonnegative().default(0),
});

export type CostTracking = z.infer<typeof CostTrackingSchema>;

const RateLimitBudgetSchema = z.object({
  provider: z.string().min(1),
  remaining_requests: z.number().int().nonnegative(),
  total_requests: z.number().int().nonnegative(),
  reset_at: z.string().datetime().nullable().optional(),
  retry_after_seconds: z.number().int().nonnegative().optional(),
});

export type RateLimitBudget = z.infer<typeof RateLimitBudgetSchema>;

export const ExecutionTaskSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    task_id: z.string().min(1),
    feature_id: z.string().min(1),
    title: z.string().min(1),
    task_type: ExecutionTaskTypeSchema,
    status: ExecutionTaskStatusSchema,
    config: z.record(z.string(), z.unknown()).optional(),
    assigned_agent: z.string().optional(),
    /** Must complete before this task starts */
    dependency_ids: z.array(z.string()).default([]),
    retry_count: z.number().int().nonnegative().default(0),
    max_retries: z.number().int().nonnegative().default(3),
    last_error: TaskErrorSchema.optional(),
    logs_path: z.string().optional(),
    cost: CostTrackingSchema.optional(),
    rate_limit_budget: RateLimitBudgetSchema.optional(),
    trace_id: z.string().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    started_at: z.string().datetime().nullable().optional(),
    completed_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ExecutionTask = Readonly<z.infer<typeof ExecutionTaskSchema>>;

/**
 * Parse and validate ExecutionTask from JSON
 *
 * @param json - Raw JSON object or string
 * @returns Parsed ExecutionTask or error details
 */
export function parseExecutionTask(json: unknown):
  | {
      success: true;
      data: ExecutionTask;
    }
  | {
      success: false;
      errors: Array<{ path: string; message: string }>;
    } {
  const result = ExecutionTaskSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as ExecutionTask,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}

/**
 * Serialize ExecutionTask to JSON string
 *
 * @param executionTask - ExecutionTask object to serialize
 * @param pretty - Whether to format output with indentation
 * @returns JSON string representation
 */
export function serializeExecutionTask(executionTask: ExecutionTask, pretty = true): string {
  return JSON.stringify(executionTask, null, pretty ? 2 : 0);
}

/**
 * Create a new ExecutionTask
 *
 * @param taskId - Unique task identifier
 * @param featureId - Feature identifier
 * @param title - Task title
 * @param taskType - Task type
 * @param options - Optional configuration
 * @returns Initialized ExecutionTask object
 */
export function createExecutionTask(
  taskId: string,
  featureId: string,
  title: string,
  taskType: ExecutionTaskType,
  options?: {
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: task config varies per execution task type
    config?: Record<string, unknown>;
    assignedAgent?: string;
    dependencyIds?: string[];
    maxRetries?: number;
    traceId?: string;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: task metadata varies per execution task type
    metadata?: Record<string, unknown>;
  }
): ExecutionTask {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    task_id: taskId,
    feature_id: featureId,
    title,
    task_type: taskType,
    status: 'pending',
    config: options?.config,
    assigned_agent: options?.assignedAgent,
    dependency_ids: options?.dependencyIds || [],
    retry_count: 0,
    max_retries: options?.maxRetries ?? 3,
    trace_id: options?.traceId,
    created_at: now,
    updated_at: now,
    metadata: options?.metadata,
  };
}

/**
 * Check if task can be retried
 *
 * @param task - ExecutionTask to check
 * @returns True if task can be retried, false otherwise
 */
export function canRetry(task: ExecutionTask): boolean {
  return (
    task.status === 'failed' &&
    task.retry_count < task.max_retries &&
    (task.last_error?.recoverable ?? true)
  );
}

/**
 * Check if all dependencies are completed
 *
 * @param task - ExecutionTask to check
 * @param allTasks - Map of all tasks by ID
 * @returns True if all dependencies completed, false otherwise
 */
export function areDependenciesCompleted(
  task: ExecutionTask,
  allTasks: Map<string, ExecutionTask>
): boolean {
  for (const depId of task.dependency_ids) {
    const depTask = allTasks.get(depId);
    if (!depTask || depTask.status !== 'completed') {
      return false;
    }
  }
  return true;
}

/**
 * Calculate task duration in milliseconds
 *
 * @param task - ExecutionTask to calculate duration for
 * @returns Duration in milliseconds, or undefined if not completed
 */
export function getTaskDuration(task: ExecutionTask): number | undefined {
  if (!task.started_at || !task.completed_at) {
    return undefined;
  }

  const start = new Date(task.started_at).getTime();
  const end = new Date(task.completed_at).getTime();

  return end - start;
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parseExecutionTask
 * @returns Formatted error message
 */
export function formatExecutionTaskValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['ExecutionTask validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
