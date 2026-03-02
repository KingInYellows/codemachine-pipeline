import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * AgentProviderCapability Model
 *
 * Manifest entries describing models, max tokens, tool support, rate guidance, cost estimates.
 *
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
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AgentProviderCapability = Readonly<z.infer<typeof AgentProviderCapabilitySchema>>;

const { parse: parseAgentProviderCapability, serialize: serializeAgentProviderCapability } =
  createModelParser<AgentProviderCapability>(AgentProviderCapabilitySchema);
export { parseAgentProviderCapability, serializeAgentProviderCapability };
