import { z } from 'zod';

/**
 * RateLimitEnvelope Model
 *
 * Provider-specific budget tracking with remaining counts,
 * reset timestamps, retry-after data, and last errors.
 *
 * Implements:
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: status, http client
 */

// ============================================================================
// RateLimitEnvelope Schema
// ============================================================================

export const RateLimitEnvelopeSchema = z.object({
  /** Schema version for future migrations (semver) */
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  /** Provider identifier (e.g., 'openai', 'anthropic', 'github', 'linear') */
  provider: z.string().min(1),
  /** Remaining request quota */
  remaining_requests: z.number().int().nonnegative(),
  /** Total request quota */
  total_requests: z.number().int().nonnegative(),
  /** Remaining token quota (if applicable) */
  remaining_tokens: z.number().int().nonnegative().optional(),
  /** Total token quota (if applicable) */
  total_tokens: z.number().int().nonnegative().optional(),
  /** ISO 8601 timestamp when quota resets */
  reset_at: z.string().datetime().nullable().optional(),
  /** Retry-after seconds if currently rate limited */
  retry_after_seconds: z.number().int().nonnegative().optional(),
  /** Last rate limit error message */
  last_error: z.string().optional(),
  /** ISO 8601 timestamp when last error occurred */
  last_error_at: z.string().datetime().optional(),
  /** ISO 8601 timestamp when envelope was last updated */
  updated_at: z.string().datetime(),
  /** Optional envelope metadata */
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type RateLimitEnvelope = Readonly<z.infer<typeof RateLimitEnvelopeSchema>>;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Parse and validate RateLimitEnvelope from JSON
 */
export function parseRateLimitEnvelope(json: unknown): {
  success: true;
  data: RateLimitEnvelope;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  const result = RateLimitEnvelopeSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as RateLimitEnvelope,
    };
  }

  return {
    success: false,
    errors: result.error.errors.map(err => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}

/**
 * Serialize RateLimitEnvelope to JSON string
 */
export function serializeRateLimitEnvelope(envelope: RateLimitEnvelope, pretty = true): string {
  return JSON.stringify(envelope, null, pretty ? 2 : 0);
}

/**
 * Create a new RateLimitEnvelope
 */
export function createRateLimitEnvelope(
  provider: string,
  totalRequests: number,
  options?: {
    totalTokens?: number;
    resetAt?: string;
    metadata?: Record<string, unknown>;
  }
): RateLimitEnvelope {
  return {
    schema_version: '1.0.0',
    provider,
    remaining_requests: totalRequests,
    total_requests: totalRequests,
    remaining_tokens: options?.totalTokens,
    total_tokens: options?.totalTokens,
    reset_at: options?.resetAt ?? null,
    updated_at: new Date().toISOString(),
    metadata: options?.metadata,
  };
}

/**
 * Check if rate limit budget is exhausted
 */
export function isRateLimited(envelope: RateLimitEnvelope): boolean {
  return envelope.remaining_requests <= 0 || (envelope.remaining_tokens !== undefined && envelope.remaining_tokens <= 0);
}

/**
 * Get time until rate limit reset in milliseconds
 */
export function getTimeUntilReset(envelope: RateLimitEnvelope): number | undefined {
  if (!envelope.reset_at) {
    return undefined;
  }

  const resetTime = new Date(envelope.reset_at).getTime();
  const now = Date.now();

  return Math.max(0, resetTime - now);
}
