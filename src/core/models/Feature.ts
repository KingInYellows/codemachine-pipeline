import { z } from 'zod';

/**
 * Feature Model
 *
 * Represents a complete feature execution lifecycle record including metadata,
 * status, artifacts, telemetry, approvals, and resumability information.
 *
 * Used by CLI commands: init, start, status, resume
 */

export const FeatureStatusSchema = z.enum([
  'pending',
  'in_progress',
  'paused',
  'completed',
  'failed',
]);

export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

const RepoMetadataSchema = z.object({
  url: z.string().url(),
  default_branch: z.string().default('main'),
});

export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;

const LastErrorSchema = z.object({
  step: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
  /** Determines whether `resume` can retry from this error */
  recoverable: z.boolean().default(true),
});

export type LastError = z.infer<typeof LastErrorSchema>;

const ExecutionTrackingSchema = z.object({
  last_step: z.string().optional(),
  last_error: LastErrorSchema.optional(),
  current_step: z.string().optional(),
  total_steps: z.number().int().nonnegative().optional(),
  completed_steps: z.number().int().nonnegative().default(0),
});

export type ExecutionTracking = z.infer<typeof ExecutionTrackingSchema>;

const TimestampsSchema = z.object({
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

export type Timestamps = z.infer<typeof TimestampsSchema>;

const ApprovalsSchema = z.object({
  /** Relative to run directory */
  approvals_file: z.string().optional(),
  pending: z.array(z.string()).default([]),
  completed: z.array(z.string()).default([]),
});

export type Approvals = z.infer<typeof ApprovalsSchema>;

const ArtifactReferencesSchema = z.object({
  prd: z.string().optional(),
  spec: z.string().optional(),
  plan: z.string().optional(),
  hash_manifest: z.string().optional(),
});

export type ArtifactReferences = z.infer<typeof ArtifactReferencesSchema>;

const TelemetryReferencesSchema = z.object({
  logs_dir: z.string(),
  metrics_file: z.string().optional(),
  traces_file: z.string().optional(),
  costs_file: z.string().optional(),
  /** For distributed tracing correlation */
  trace_id: z.string().optional(),
});

export type TelemetryReferences = z.infer<typeof TelemetryReferencesSchema>;

const RateLimitReferencesSchema = z.object({
  rate_limits_file: z.string().optional(),
});

export type RateLimitReferences = z.infer<typeof RateLimitReferencesSchema>;

export const FeatureSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    feature_id: z.string().min(1),
    title: z.string().optional(),
    /** e.g., linear:PROJ-123, manual:prompt */
    source: z.string().optional(),
    repo: RepoMetadataSchema,
    status: FeatureStatusSchema,
    execution: ExecutionTrackingSchema,
    timestamps: TimestampsSchema,
    approvals: ApprovalsSchema,
    artifacts: ArtifactReferencesSchema,
    telemetry: TelemetryReferencesSchema,
    rate_limits: RateLimitReferencesSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Feature = Readonly<z.infer<typeof FeatureSchema>>;

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
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: feature metadata is consumer-defined and open-ended
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
