import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * IntegrationCredential Model
 *
 * Metadata about tokens/app credentials (provider, auth method, scopes, expiry, redaction tokens).
 *
 * Used by CLI commands: init, validate-config
 */

export const IntegrationCredentialSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    credential_id: z.string().min(1),
    provider: z.enum(['github', 'linear', 'anthropic', 'openai', 'other']),
    auth_method: z.enum(['token', 'oauth', 'api_key', 'app_credentials']),
    scopes: z.array(z.string()).default([]),
    expiry: z.string().datetime().nullable().optional(),
    redaction_token: z.string().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type IntegrationCredential = Readonly<z.infer<typeof IntegrationCredentialSchema>>;

const { parse: parseIntegrationCredential, serialize: serializeIntegrationCredential } =
  createModelParser<IntegrationCredential>(IntegrationCredentialSchema);
export { parseIntegrationCredential, serializeIntegrationCredential };
