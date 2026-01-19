import { z } from 'zod';

/**
 * TraceLink Model
 *
 * Connects PRD goals to spec requirements, ExecutionTasks, and resulting diffs for audit.
 *
 * Implements ADR-7 (Validation Policy): Zod-based validation
 * Used by CLI commands: trace, audit, status
 */

export const TraceLinkSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    link_id: z.string().min(1),
    feature_id: z.string().min(1),
    source_type: z.enum(['prd_goal', 'spec_requirement', 'execution_task', 'diff', 'other']),
    source_id: z.string().min(1),
    target_type: z.enum(['prd_goal', 'spec_requirement', 'execution_task', 'diff', 'other']),
    target_id: z.string().min(1),
    relationship: z.enum(['implements', 'tests', 'depends_on', 'derived_from', 'validates']),
    created_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type TraceLink = Readonly<z.infer<typeof TraceLinkSchema>>;

export function parseTraceLink(json: unknown) {
  const result = TraceLinkSchema.safeParse(json);
  if (result.success) {
    return { success: true as const, data: result.data as TraceLink };
  }
  return {
    success: false as const,
    errors: result.error.issues.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}
