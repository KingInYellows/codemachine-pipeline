import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * RunArtifact Model
 *
 * Tracks paths and integrity hashes for artifacts generated during
 * feature execution (prd.md, spec.md, plan.json, logs, bundles).
 *
 * Used by CLI commands: status, export, verify
 */

// Artifact Type Enum

export const ArtifactTypeSchema = z.enum([
  'prd',
  'spec',
  'plan',
  'log',
  'trace',
  'metrics',
  'cost_estimate',
  'bundle',
  'other',
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

// Single Artifact Record

const ArtifactRecordSchema = z.object({
  /** Artifact type classification */
  artifact_type: ArtifactTypeSchema,
  /** Relative path to artifact file (from run directory root) */
  path: z.string().min(1),
  /** SHA-256 hash of artifact contents */
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  /** File size in bytes */
  size: z.number().int().nonnegative(),
  /** ISO 8601 timestamp when artifact was created */
  timestamp: z.string().datetime(),
  /** Optional artifact-specific metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

// RunArtifact Collection Schema

export const RunArtifactSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Feature ID this artifact collection belongs to */
    feature_id: z.string().min(1),
    /** ISO 8601 timestamp when collection was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when collection was last updated */
    updated_at: z.string().datetime(),
    /** Map of artifact IDs to artifact records */
    artifacts: z.record(z.string(), ArtifactRecordSchema),
    /** Optional collection-level metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type RunArtifact = Readonly<z.infer<typeof RunArtifactSchema>>;

// Serialization Helpers

const { parse: parseRunArtifact, serialize: serializeRunArtifact } =
  createModelParser<RunArtifact>(RunArtifactSchema);
export { parseRunArtifact, serializeRunArtifact };

/**
 * Create a new RunArtifact collection
 *
 * @param featureId - Feature identifier
 * @param options - Optional configuration
 * @returns Initialized RunArtifact object
 */
export function createRunArtifact(
  featureId: string,
  options?: {
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: artifact metadata varies per artifact type
    metadata?: Record<string, unknown>;
  }
): RunArtifact {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    created_at: now,
    updated_at: now,
    artifacts: {},
    metadata: options?.metadata,
  };
}

/**
 * Add an artifact record to RunArtifact collection
 *
 * @param runArtifact - Existing RunArtifact
 * @param artifactId - Unique identifier for this artifact
 * @param record - Artifact record to add
 * @returns Updated RunArtifact
 */
export function addArtifact(
  runArtifact: RunArtifact,
  artifactId: string,
  record: ArtifactRecord
): RunArtifact {
  return {
    ...runArtifact,
    updated_at: new Date().toISOString(),
    artifacts: {
      ...runArtifact.artifacts,
      [artifactId]: record,
    },
  };
}

/**
 * Remove an artifact record from RunArtifact collection
 *
 * @param runArtifact - Existing RunArtifact
 * @param artifactId - Artifact identifier to remove
 * @returns Updated RunArtifact
 */
export function removeArtifact(runArtifact: RunArtifact, artifactId: string): RunArtifact {
  const remainingArtifacts = { ...runArtifact.artifacts };
  delete remainingArtifacts[artifactId];

  return {
    ...runArtifact,
    updated_at: new Date().toISOString(),
    artifacts: remainingArtifacts,
  };
}

/**
 * Get all artifacts of a specific type
 *
 * @param runArtifact - RunArtifact collection
 * @param artifactType - Type to filter by
 * @returns Array of [artifactId, record] tuples
 */
export function getArtifactsByType(
  runArtifact: RunArtifact,
  artifactType: ArtifactType
): Array<[string, ArtifactRecord]> {
  return Object.entries(runArtifact.artifacts).filter(
    ([_id, record]) => record.artifact_type === artifactType
  );
}

/**
 * Calculate total size of all artifacts
 *
 * @param runArtifact - RunArtifact collection
 * @returns Total size in bytes
 */
export function getTotalArtifactSize(runArtifact: RunArtifact): number {
  return Object.values(runArtifact.artifacts).reduce((total, record) => total + record.size, 0);
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parseRunArtifact
 * @returns Formatted error message
 */
export function formatRunArtifactValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['RunArtifact validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
