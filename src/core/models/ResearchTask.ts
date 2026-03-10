import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * ResearchTask Model
 *
 * Represents investigation units with objectives, sources, cache keys,
 * freshness requirements, and confidence-scored results.
 *
 * Used by CLI commands: research, start
 */

// Research Status Enum

export const ResearchStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cached',
]);

export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

// Research Source Schema

const ResearchSourceSchema = z.object({
  type: z.enum(['codebase', 'web', 'documentation', 'api', 'linear', 'github', 'other']),
  identifier: z.string().min(1),
  description: z.string().optional(),
});

export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

// Research Result Schema

const ResearchResultSchema = z.object({
  summary: z.string().min(1),
  details: z.string().optional(),
  confidence_score: z.number().min(0).max(1).default(0.5),
  timestamp: z.string().datetime(),
  sources_consulted: z.array(ResearchSourceSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// Freshness Requirement Schema

const FreshnessRequirementSchema = z.object({
  max_age_hours: z.number().int().nonnegative().default(24),
  /** Bypasses cache even if a fresh result exists */
  force_fresh: z.boolean().default(false),
});

export type FreshnessRequirement = z.infer<typeof FreshnessRequirementSchema>;

// ResearchTask Schema

export const ResearchTaskSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    task_id: z.string().min(1),
    feature_id: z.string().min(1),
    title: z.string().min(1),
    objectives: z.array(z.string().min(1)).min(1),
    sources: z.array(ResearchSourceSchema).default([]),
    cache_key: z.string().optional(),
    freshness_requirements: FreshnessRequirementSchema.optional(),
    status: ResearchStatusSchema,
    /** Populated when status reaches 'completed' */
    results: ResearchResultSchema.optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    started_at: z.string().datetime().nullable().optional(),
    completed_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ResearchTask = Readonly<z.infer<typeof ResearchTaskSchema>>;

// Serialization Helpers

const { parse: parseResearchTask, serialize: serializeResearchTask } =
  createModelParser<ResearchTask>(ResearchTaskSchema);
export { parseResearchTask, serializeResearchTask };

/**
 * Create a new ResearchTask
 *
 * @param taskId - Unique task identifier
 * @param featureId - Feature identifier
 * @param title - Task title
 * @param objectives - Research objectives
 * @param options - Optional configuration
 * @returns Initialized ResearchTask object
 */
export function createResearchTask(
  taskId: string,
  featureId: string,
  title: string,
  objectives: string[],
  options?: {
    sources?: ResearchSource[];
    cacheKey?: string;
    freshnessRequirements?: FreshnessRequirement;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: research task metadata varies by source and objective
    metadata?: Record<string, unknown>;
  }
): ResearchTask {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    task_id: taskId,
    feature_id: featureId,
    title,
    objectives,
    sources: options?.sources || [],
    cache_key: options?.cacheKey,
    freshness_requirements: options?.freshnessRequirements,
    status: 'pending',
    created_at: now,
    updated_at: now,
    metadata: options?.metadata,
  };
}

/**
 * Generate cache key from research objectives and sources
 *
 * @param objectives - Research objectives
 * @param sources - Research sources
 * @returns SHA-256 hash cache key
 */
export function generateCacheKey(objectives: string[], sources: ResearchSource[]): string {
  const content = JSON.stringify({ objectives, sources });
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if cached result is still fresh
 *
 * @param result - Research result to check
 * @param requirements - Freshness requirements
 * @returns True if result is fresh, false otherwise
 */
export function isCachedResultFresh(
  result: ResearchResult,
  requirements: FreshnessRequirement
): boolean {
  if (requirements.force_fresh) {
    return false;
  }

  const resultTimestamp = new Date(result.timestamp).getTime();
  const now = Date.now();
  const ageHours = (now - resultTimestamp) / (1000 * 60 * 60);

  return ageHours <= requirements.max_age_hours;
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parseResearchTask
 * @returns Formatted error message
 */
export function formatResearchTaskValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['ResearchTask validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
