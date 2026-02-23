import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * Feature Model
 *
 * Represents a complete feature execution lifecycle record including metadata,
 * status, artifacts, telemetry, approvals, and resumability information.
 *
 * Used by CLI commands: init, start, status, resume
 */

// Enums and Status Types

export const FeatureStatusSchema = z.enum([
  'pending',
  'in_progress',
  'paused',
  'completed',
  'failed',
]);

export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

// Repository Metadata

const RepoMetadataSchema = z.object({
  /** Repository URL (e.g., https://github.com/org/repo.git) */
  url: z.string().url(),
  /** Default branch name (e.g., main, master) */
  default_branch: z.string().default('main'),
});

export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;

// Execution Tracking

const LastErrorSchema = z.object({
  /** Step identifier where error occurred */
  step: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
  /** Whether error is recoverable via resume */
  recoverable: z.boolean().default(true),
});

export type LastError = z.infer<typeof LastErrorSchema>;

const ExecutionTrackingSchema = z.object({
  /** Last successfully completed step identifier */
  last_step: z.string().optional(),
  /** Most recent error encountered during execution */
  last_error: LastErrorSchema.optional(),
  current_step: z.string().optional(),
  /** Total number of steps in execution plan */
  total_steps: z.number().int().nonnegative().optional(),
  completed_steps: z.number().int().nonnegative().default(0),
});

export type ExecutionTracking = z.infer<typeof ExecutionTrackingSchema>;

// Timestamps

const TimestampsSchema = z.object({
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

export type Timestamps = z.infer<typeof TimestampsSchema>;

// Approvals

const ApprovalsSchema = z.object({
  /** Path to approvals.json file (relative to run directory) */
  approvals_file: z.string().optional(),
  /** Required approvals not yet granted */
  pending: z.array(z.string()).default([]),
  /** Approvals already granted */
  completed: z.array(z.string()).default([]),
});

export type Approvals = z.infer<typeof ApprovalsSchema>;

// Artifact References

const ArtifactReferencesSchema = z.object({
  /** Path to PRD markdown file */
  prd: z.string().optional(),
  /** Path to specification markdown file */
  spec: z.string().optional(),
  /** Path to execution plan JSON file */
  plan: z.string().optional(),
  /** Path to hash manifest JSON file */
  hash_manifest: z.string().optional(),
});

export type ArtifactReferences = z.infer<typeof ArtifactReferencesSchema>;

// Telemetry References

const TelemetryReferencesSchema = z.object({
  /** Directory containing log files */
  logs_dir: z.string(),
  /** Path to metrics JSON file */
  metrics_file: z.string().optional(),
  /** Path to traces JSON file */
  traces_file: z.string().optional(),
  /** Path to cost estimates JSON file */
  costs_file: z.string().optional(),
  /** Trace ID for distributed tracing correlation */
  trace_id: z.string().optional(),
});

export type TelemetryReferences = z.infer<typeof TelemetryReferencesSchema>;

// Rate Limit References

const RateLimitReferencesSchema = z.object({
  /** Path to rate limits tracking JSON file */
  rate_limits_file: z.string().optional(),
});

export type RateLimitReferences = z.infer<typeof RateLimitReferencesSchema>;

// Main Feature Schema

export const FeatureSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Unique feature identifier (ULID/UUIDv7) */
    feature_id: z.string().min(1),
    /** Human-readable feature title or description */
    title: z.string().optional(),
    /** Feature source (e.g., linear:PROJ-123, manual:prompt) */
    source: z.string().optional(),
    /** Repository metadata */
    repo: RepoMetadataSchema,
    /** Current execution status */
    status: FeatureStatusSchema,
    /** Execution progress tracking */
    execution: ExecutionTrackingSchema,
    /** Lifecycle timestamps */
    timestamps: TimestampsSchema,
    /** Approval workflow tracking */
    approvals: ApprovalsSchema,
    /** References to generated artifacts */
    artifacts: ArtifactReferencesSchema,
    /** Telemetry and observability references */
    telemetry: TelemetryReferencesSchema,
    /** Rate limit tracking references */
    rate_limits: RateLimitReferencesSchema.optional(),
    /** Extensible metadata for custom fields */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Feature = Readonly<z.infer<typeof FeatureSchema>>;

// Serialization Helpers

const { parse: parseFeature, serialize: serializeFeature } =
  createModelParser<Feature>(FeatureSchema);
export { parseFeature, serializeFeature };

/**
 * Create a new Feature with default values
 *
 * @param featureId - Unique identifier (ULID/UUIDv7)
 * @param repoUrl - Repository URL
 * @param options - Optional configuration
 * @returns Initialized Feature object
 */
export function createFeature(
  featureId: string,
  repoUrl: string,
  options?: {
    title?: string;
    source?: string;
    defaultBranch?: string;
    metadata?: Record<string, unknown>;
  }
): Feature {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    title: options?.title,
    source: options?.source,
    repo: {
      url: repoUrl,
      default_branch: options?.defaultBranch || 'main',
    },
    status: 'pending',
    execution: {
      completed_steps: 0,
    },
    timestamps: {
      created_at: now,
      updated_at: now,
    },
    approvals: {
      pending: [],
      completed: [],
    },
    artifacts: {},
    telemetry: {
      logs_dir: 'logs',
    },
    metadata: options?.metadata,
  };
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parseFeature
 * @returns Formatted error message
 */
export function formatFeatureValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['Feature validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
