import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * ArtifactBundle Model
 *
 * Export bundle manifest referencing included files, hashes, delivery targets, and CLI versions.
 *
 * Used by CLI commands: export, bundle
 */

export const ArtifactBundleSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    bundle_id: z.string().min(1),
    feature_id: z.string().min(1),
    included_files: z
      .array(
        z.object({
          path: z.string().min(1),
          hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
          size: z.number().int().nonnegative(),
        })
      )
      .default([]),
    delivery_target: z.string().optional(),
    cli_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    created_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ArtifactBundle = Readonly<z.infer<typeof ArtifactBundleSchema>>;

const { parse: parseArtifactBundle, serialize: serializeArtifactBundle } =
  createModelParser<ArtifactBundle>(ArtifactBundleSchema);
export { parseArtifactBundle, serializeArtifactBundle };
