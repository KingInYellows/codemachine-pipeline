import { z } from 'zod';

/**
 * ContextDocument Model
 *
 * Hash manifests tying context files, summaries, token costs,
 * and provenance data to Features.
 *
 * Implements:
 * - FR-1 (Initialize): Context discovery and caching
 * - ADR-2 (State Persistence): Hash-based integrity
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: init, start, context
 */

// ============================================================================
// Context File Record Schema
// ============================================================================

const ContextFileRecordSchema = z.object({
  /** Relative path to context file (from repository root) */
  path: z.string().min(1),
  /** SHA-256 hash of file contents */
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  /** File size in bytes */
  size: z.number().int().nonnegative(),
  /** File type or extension */
  file_type: z.string().optional(),
  /** Token count for this file */
  token_count: z.number().int().nonnegative().optional(),
});

export type ContextFileRecord = z.infer<typeof ContextFileRecordSchema>;

// ============================================================================
// Context Summary Schema
// ============================================================================

const ContextSummarySchema = z.object({
  /** Chunk identifier (hash-derived) */
  chunk_id: z.string().regex(/^[a-f0-9]{16}$/i, 'Chunk ID must be 16 hex characters'),
  /** Source file path */
  file_path: z.string().min(1),
  /** Source file SHA */
  file_sha: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  /** Chunk index within the file */
  chunk_index: z.number().int().nonnegative(),
  /** Total chunk count for the file */
  chunk_total: z.number().int().positive(),
  /** Summary text */
  summary: z.string().min(1),
  /** Token count for summary */
  token_count: z.number().int().nonnegative(),
  /** ISO 8601 timestamp when summary was generated */
  generated_at: z.string().datetime(),
  /** Model or tool used to generate summary */
  generated_by: z.string().optional(),
  /** Summarization method identifier */
  method: z.string().min(1).default('single_chunk'),
  /** Redaction flags applied during summarization */
  redaction_flags: z.array(z.string()).default([]),
});

export type ContextSummary = z.infer<typeof ContextSummarySchema>;

// ============================================================================
// Provenance Data Schema
// ============================================================================

const ProvenanceDataSchema = z.object({
  /** Source URL or identifier where context originated */
  source: z.string().min(1),
  /** ISO 8601 timestamp when context was captured */
  captured_at: z.string().datetime(),
  /** Git commit SHA if applicable */
  commit_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/, 'Invalid Git SHA format')
    .optional(),
  /** Branch name if applicable */
  branch: z.string().optional(),
  /** Additional provenance metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProvenanceData = z.infer<typeof ProvenanceDataSchema>;

// ============================================================================
// ContextDocument Schema
// ============================================================================

export const ContextDocumentSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Feature ID this context belongs to */
    feature_id: z.string().min(1),
    /** ISO 8601 timestamp when context was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when context was last updated */
    updated_at: z.string().datetime(),
    /** Map of file paths to context file records */
    files: z.record(z.string(), ContextFileRecordSchema),
    /** Context summaries */
    summaries: z.array(ContextSummarySchema).default([]),
    /** Total token cost for all context */
    total_token_count: z.number().int().nonnegative().default(0),
    /** Provenance information */
    provenance: ProvenanceDataSchema,
    /** Optional context-level metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ContextDocument = Readonly<z.infer<typeof ContextDocumentSchema>>;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Parse and validate ContextDocument from JSON
 */
export function parseContextDocument(json: unknown):
  | {
      success: true;
      data: ContextDocument;
    }
  | {
      success: false;
      errors: Array<{ path: string; message: string }>;
    } {
  const result = ContextDocumentSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as ContextDocument,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}

/**
 * Serialize ContextDocument to JSON string
 */
export function serializeContextDocument(contextDocument: ContextDocument, pretty = true): string {
  return JSON.stringify(contextDocument, null, pretty ? 2 : 0);
}

/**
 * Create a new ContextDocument
 */
export function createContextDocument(
  featureId: string,
  source: string,
  options?: {
    commitSha?: string;
    branch?: string;
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
