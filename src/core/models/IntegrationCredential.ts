import { z } from 'zod';

/**
 * IntegrationCredential Model
 *
 * Metadata about tokens/app credentials (provider, auth method, scopes, expiry, redaction tokens).
 *
 * Implements ADR-7 (Validation Policy): Zod-based validation
 * Used by CLI commands: init, validate-config
 */

export const IntegrationCredentialSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  credential_id: z.string().min(1),
  provider: z.enum(['github', 'linear', 'anthropic', 'openai', 'other']),
  auth_method: z.enum(['token', 'oauth', 'api_key', 'app_credentials']),
  scopes: z.array(z.string()).default([]),
  expiry: z.string().datetime().nullable().optional(),
  redaction_token: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type IntegrationCredential = Readonly<z.infer<typeof IntegrationCredentialSchema>>;

export function parseIntegrationCredential(json: unknown) {
  const result = IntegrationCredentialSchema.safeParse(json);
  if (result.success) {
    return { success: true as const, data: result.data as IntegrationCredential };
  }
  return {
    success: false as const,
    errors: result.error.errors.map(err => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}
