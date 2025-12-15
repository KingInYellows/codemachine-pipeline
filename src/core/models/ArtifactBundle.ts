import { z } from 'zod';

/**
 * ArtifactBundle Model
 *
 * Export bundle manifest referencing included files, hashes, delivery targets, and CLI versions.
 *
 * Implements ADR-7 (Validation Policy): Zod-based validation
 * Used by CLI commands: export, bundle
 */

export const ArtifactBundleSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  bundle_id: z.string().min(1),
  feature_id: z.string().min(1),
  included_files: z.array(z.object({
    path: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
    size: z.number().int().nonnegative(),
  })).default([]),
  delivery_target: z.string().optional(),
  cli_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  created_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type ArtifactBundle = Readonly<z.infer<typeof ArtifactBundleSchema>>;

export function parseArtifactBundle(json: unknown) {
  const result = ArtifactBundleSchema.safeParse(json);
  if (result.success) {
    return { success: true as const, data: result.data as ArtifactBundle };
  }
  return {
    success: false as const,
    errors: result.error.errors.map(err => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}
