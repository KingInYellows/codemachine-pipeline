import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * TraceLink Model
 *
 * Connects PRD goals to spec requirements, ExecutionTasks, and resulting diffs for audit.
 *
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

const { parse: parseTraceLink, serialize: serializeTraceLink } =
  createModelParser<TraceLink>(TraceLinkSchema);
export { parseTraceLink, serializeTraceLink };
