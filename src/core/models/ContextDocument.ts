import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * ContextDocument Model
 *
 * Hash manifests tying context files, summaries, token costs,
 * and provenance data to Features.
 *
 * Used by CLI commands: init, start, context
 */

// Context File Record Schema

const ContextFileRecordSchema = z.object({
  /** Relative to repository root */
  path: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  size: z.number().int().nonnegative(),
  file_type: z.string().optional(),
  token_count: z.number().int().nonnegative().optional(),
});

export type ContextFileRecord = z.infer<typeof ContextFileRecordSchema>;

// Context Summary Schema

const ContextSummarySchema = z.object({
  /** Hash-derived chunk identifier (16 hex chars) */
  chunk_id: z.string().regex(/^[a-f0-9]{16}$/i, 'Chunk ID must be 16 hex characters'),
  file_path: z.string().min(1),
  file_sha: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  chunk_index: z.number().int().nonnegative(),
  chunk_total: z.number().int().positive(),
  summary: z.string().min(1),
  token_count: z.number().int().nonnegative(),
  generated_at: z.string().datetime(),
  generated_by: z.string().optional(),
  method: z.string().min(1).default('single_chunk'),
  /** Redaction flags applied during summarization */
  redaction_flags: z.array(z.string()).default([]),
});

export type ContextSummary = z.infer<typeof ContextSummarySchema>;

// Provenance Data Schema

const ProvenanceDataSchema = z.object({
  source: z.string().min(1),
  captured_at: z.string().datetime(),
  commit_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/, 'Invalid Git SHA format')
    .optional(),
  branch: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProvenanceData = z.infer<typeof ProvenanceDataSchema>;

// ContextDocument Schema

export const ContextDocumentSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    feature_id: z.string().min(1),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    /** Keyed by file path */
    files: z.record(z.string(), ContextFileRecordSchema),
    summaries: z.array(ContextSummarySchema).default([]),
    total_token_count: z.number().int().nonnegative().default(0),
    provenance: ProvenanceDataSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ContextDocument = Readonly<z.infer<typeof ContextDocumentSchema>>;

// Serialization Helpers

const { parse: parseContextDocument, serialize: serializeContextDocument } =
  createModelParser<ContextDocument>(ContextDocumentSchema);
export { parseContextDocument, serializeContextDocument };

/**
 * Create a new ContextDocument
 */
export function createContextDocument(
  featureId: string,
  source: string,
  options?: {
    commitSha?: string;
    branch?: string;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: context metadata varies per provenance source
    metadata?: Record<string, unknown>;
  }
): ContextDocument {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    created_at: now,
    updated_at: now,
    files: {},
    summaries: [],
    total_token_count: 0,
    provenance: {
      source,
      captured_at: now,
      commit_sha: options?.commitSha,
      branch: options?.branch,
      metadata: options?.metadata,
    },
  };
}
