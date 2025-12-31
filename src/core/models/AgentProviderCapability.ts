import { z } from 'zod';

/**
 * AgentProviderCapability Model
 *
 * Manifest entries describing models, max tokens, tool support, rate guidance, cost estimates.
 *
 * Implements ADR-7 (Validation Policy): Zod-based validation
 * Used by CLI commands: agent selection, cost estimation
 */

export const AgentProviderCapabilitySchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    provider: z.string().min(1),
    model_name: z.string().min(1),
    max_tokens: z.number().int().positive(),
    supports_tools: z.boolean().default(false),
    supports_streaming: z.boolean().default(false),
    rate_limit_guidance: z
      .object({
        requests_per_minute: z.number().int().nonnegative().optional(),
        tokens_per_minute: z.number().int().nonnegative().optional(),
      })
      .optional(),
    cost_estimate: z
      .object({
        input_cost_per_1k_tokens: z.number().nonnegative(),
        output_cost_per_1k_tokens: z.number().nonnegative(),
      })
      .optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentProviderCapability = Readonly<z.infer<typeof AgentProviderCapabilitySchema>>;

export function parseAgentProviderCapability(json: unknown) {
  const result = AgentProviderCapabilitySchema.safeParse(json);
  if (result.success) {
    return { success: true as const, data: result.data as AgentProviderCapability };
  }
  return {
    success: false as const,
    errors: result.error.errors.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}
