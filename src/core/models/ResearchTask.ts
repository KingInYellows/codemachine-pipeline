import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * ResearchTask Model
 *
 * Represents investigation units with objectives, sources, cache keys,
 * freshness requirements, and confidence-scored results.
 *
 * Implements:
 * - FR-1 (Initialize): Context discovery and research
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: research, start
 */

// ============================================================================
// Research Status Enum
// ============================================================================

export const ResearchStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cached',
]);

export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

// ============================================================================
// Research Source Schema
// ============================================================================

const ResearchSourceSchema = z.object({
  /** Source type (e.g., 'codebase', 'web', 'documentation', 'api') */
  type: z.enum(['codebase', 'web', 'documentation', 'api', 'linear', 'github', 'other']),
  /** Source URL or identifier */
  identifier: z.string().min(1),
  /** Optional source description */
  description: z.string().optional(),
});

export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

// ============================================================================
// Research Result Schema
// ============================================================================

const ResearchResultSchema = z.object({
  /** Research findings summary */
  summary: z.string().min(1),
  /** Detailed results or data */
  details: z.string().optional(),
  /** Confidence score (0.0 to 1.0) */
  confidence_score: z.number().min(0).max(1).default(0.5),
  /** ISO 8601 timestamp when result was generated */
  timestamp: z.string().datetime(),
  /** Sources consulted for this result */
  sources_consulted: z.array(ResearchSourceSchema).default([]),
  /** Optional result metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ============================================================================
// Freshness Requirement Schema
// ============================================================================

const FreshnessRequirementSchema = z.object({
  /** Maximum age of cached result in hours */
  max_age_hours: z.number().int().nonnegative().default(24),
  /** Whether to force fresh research even if cache exists */
  force_fresh: z.boolean().default(false),
});

export type FreshnessRequirement = z.infer<typeof FreshnessRequirementSchema>;

// ============================================================================
// ResearchTask Schema
// ============================================================================

export const ResearchTaskSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Unique research task identifier */
    task_id: z.string().min(1),
    /** Feature ID this research task belongs to */
    feature_id: z.string().min(1),
    /** Research task title */
    title: z.string().min(1),
    /** Research objectives (array of questions or goals) */
    objectives: z.array(z.string().min(1)).min(1),
    /** Sources to consult during research */
    sources: z.array(ResearchSourceSchema).default([]),
    /** Cache key for result reuse */
    cache_key: z.string().optional(),
    /** Freshness requirements for cached results */
    freshness_requirements: FreshnessRequirementSchema.optional(),
    /** Current research status */
    status: ResearchStatusSchema,
    /** Research results (populated when completed) */
    results: ResearchResultSchema.optional(),
    /** ISO 8601 timestamp when task was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when task was last updated */
    updated_at: z.string().datetime(),
    /** ISO 8601 timestamp when task started */
    started_at: z.string().datetime().nullable().optional(),
    /** ISO 8601 timestamp when task completed */
    completed_at: z.string().datetime().nullable().optional(),
    /** Optional task metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ResearchTask = Readonly<z.infer<typeof ResearchTaskSchema>>;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Parse and validate ResearchTask from JSON
 *
 * @param json - Raw JSON object or string
 * @returns Parsed ResearchTask or error details
 */
export function parseResearchTask(json: unknown):
  | {
      success: true;
      data: ResearchTask;
    }
  | {
      success: false;
      errors: Array<{ path: string; message: string }>;
    } {
  const result = ResearchTaskSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as ResearchTask,
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
 * Serialize ResearchTask to JSON string
 *
 * @param researchTask - ResearchTask object to serialize
 * @param pretty - Whether to format output with indentation
 * @returns JSON string representation
 */
export function serializeResearchTask(researchTask: ResearchTask, pretty = true): string {
  return JSON.stringify(researchTask, null, pretty ? 2 : 0);
}

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
