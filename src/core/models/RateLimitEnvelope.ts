import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * RateLimitEnvelope Model
 *
 * Provider-specific budget tracking with remaining counts,
 * reset timestamps, retry-after data, and last errors.
 *
 * Used by CLI commands: status, http client
 */

// RateLimitEnvelope Schema

export const RateLimitEnvelopeSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    provider: z.string().min(1),
    remaining_requests: z.number().int().nonnegative(),
    total_requests: z.number().int().nonnegative(),
    /** Only applicable for token-based rate limits */
    remaining_tokens: z.number().int().nonnegative().optional(),
    /** Only applicable for token-based rate limits */
    total_tokens: z.number().int().nonnegative().optional(),
    reset_at: z.string().datetime().nullable().optional(),
    retry_after_seconds: z.number().int().nonnegative().optional(),
    last_error: z.string().optional(),
    last_error_at: z.string().datetime().optional(),
    updated_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type RateLimitEnvelope = Readonly<z.infer<typeof RateLimitEnvelopeSchema>>;

// Serialization Helpers

const { parse: parseRateLimitEnvelope, serialize: serializeRateLimitEnvelope } =
  createModelParser<RateLimitEnvelope>(RateLimitEnvelopeSchema);
export { parseRateLimitEnvelope, serializeRateLimitEnvelope };

/**
 * Create a new RateLimitEnvelope
 */
export function createRateLimitEnvelope(
  provider: string,
  totalRequests: number,
  options?: {
    totalTokens?: number;
    resetAt?: string;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: envelope metadata varies per provider
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
  return (
    envelope.remaining_requests <= 0 ||
    (envelope.remaining_tokens !== undefined && envelope.remaining_tokens <= 0)
  );
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
