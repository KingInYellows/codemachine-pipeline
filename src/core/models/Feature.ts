import { z } from 'zod';

/**
 * Feature Model
 *
 * Represents a complete feature execution lifecycle record including metadata,
 * status, artifacts, telemetry, approvals, and resumability information.
 *
 * Implements:
 * - FR-2 (Run Directory): Feature metadata persistence
 * - FR-3 (Resumability): Last step/error tracking
 * - ADR-5 (Approval Workflow): Approval records
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: init, start, status, resume
 */

// ============================================================================
// Enums and Status Types
// ============================================================================

export const FeatureStatusSchema = z.enum([
  'pending',
  'in_progress',
  'paused',
  'completed',
  'failed',
]);

export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

// ============================================================================
// Repository Metadata
// ============================================================================

const RepoMetadataSchema = z.object({
  /** Repository URL (e.g., https://github.com/org/repo.git) */
  url: z.string().url(),
  /** Default branch name (e.g., main, master) */
  default_branch: z.string().default('main'),
});

export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;

// ============================================================================
// Execution Tracking
// ============================================================================

const LastErrorSchema = z.object({
  /** Step identifier where error occurred */
  step: z.string(),
  /** Error message */
  message: z.string(),
  /** ISO 8601 timestamp when error occurred */
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
  /** Current step being executed */
  current_step: z.string().optional(),
  /** Total number of steps in execution plan */
  total_steps: z.number().int().nonnegative().optional(),
  /** Number of steps completed so far */
  completed_steps: z.number().int().nonnegative().default(0),
});

export type ExecutionTracking = z.infer<typeof ExecutionTrackingSchema>;

// ============================================================================
// Timestamps
// ============================================================================

const TimestampsSchema = z.object({
  /** When feature record was created (ISO 8601) */
  created_at: z.string().datetime(),
  /** When feature record was last updated (ISO 8601) */
  updated_at: z.string().datetime(),
  /** When feature execution started (ISO 8601) */
  started_at: z.string().datetime().nullable().optional(),
  /** When feature execution completed (ISO 8601) */
  completed_at: z.string().datetime().nullable().optional(),
});

export type Timestamps = z.infer<typeof TimestampsSchema>;

// ============================================================================
// Approvals
// ============================================================================

const ApprovalsSchema = z.object({
  /** Path to approvals.json file (relative to run directory) */
  approvals_file: z.string().optional(),
  /** Required approvals not yet granted */
  pending: z.array(z.string()).default([]),
  /** Approvals already granted */
  completed: z.array(z.string()).default([]),
});

export type Approvals = z.infer<typeof ApprovalsSchema>;

// ============================================================================
// Artifact References
// ============================================================================

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

// ============================================================================
// Telemetry References
// ============================================================================

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

// ============================================================================
// Rate Limit References
// ============================================================================

const RateLimitReferencesSchema = z.object({
  /** Path to rate limits tracking JSON file */
  rate_limits_file: z.string().optional(),
});

export type RateLimitReferences = z.infer<typeof RateLimitReferencesSchema>;

// ============================================================================
// Main Feature Schema
// ============================================================================

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

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Parse and validate Feature from JSON
 *
 * @param json - Raw JSON object or string
 * @returns Parsed Feature or error details
 */
export function parseFeature(json: unknown):
  | {
      success: true;
      data: Feature;
    }
  | {
      success: false;
      errors: Array<{ path: string; message: string }>;
    } {
  const result = FeatureSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as Feature,
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
 * Serialize Feature to JSON string
 *
 * @param feature - Feature object to serialize
 * @param pretty - Whether to format output with indentation
 * @returns JSON string representation
 */
export function serializeFeature(feature: Feature, pretty = true): string {
  return JSON.stringify(feature, null, pretty ? 2 : 0);
}

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
