import { z } from 'zod';

/**
 * ApprovalRecord Model
 *
 * Gate approvals referencing artifacts, signers, timestamps, and rationale.
 *
 * Implements:
 * - ADR-5 (Approval Workflow): Human-in-the-loop gates
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: approve, status
 */

// ============================================================================
// Approval Gate Type Enum
// ============================================================================

export const ApprovalGateTypeSchema = z.enum([
  'prd',
  'spec',
  'plan',
  'code',
  'pr',
  'deploy',
  'other',
]);

export type ApprovalGateType = z.infer<typeof ApprovalGateTypeSchema>;

// ============================================================================
// Approval Verdict Enum
// ============================================================================

export const ApprovalVerdictSchema = z.enum(['approved', 'rejected', 'requested_changes']);

export type ApprovalVerdict = z.infer<typeof ApprovalVerdictSchema>;

// ============================================================================
// ApprovalRecord Schema
// ============================================================================

export const ApprovalRecordSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Unique approval record identifier */
    approval_id: z.string().min(1),
    /** Feature ID this approval belongs to */
    feature_id: z.string().min(1),
    /** Approval gate type */
    gate_type: ApprovalGateTypeSchema,
    /** Approval verdict */
    verdict: ApprovalVerdictSchema,
    /** Signer identifier (username, email, or ID) */
    signer: z.string().min(1),
    /** Signer display name */
    signer_name: z.string().optional(),
    /** ISO 8601 timestamp when approval was granted */
    approved_at: z.string().datetime(),
    /** SHA-256 hash of artifact being approved */
    artifact_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format')
      .optional(),
    /** Path to approved artifact (relative to run directory) */
    artifact_path: z.string().optional(),
    /** Rationale or comments for approval decision */
    rationale: z.string().optional(),
    /** Optional approval metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ApprovalRecord = Readonly<z.infer<typeof ApprovalRecordSchema>>;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Parse and validate ApprovalRecord from JSON
 */
export function parseApprovalRecord(json: unknown):
  | {
      success: true;
      data: ApprovalRecord;
    }
  | {
      success: false;
      errors: Array<{ path: string; message: string }>;
    } {
  const result = ApprovalRecordSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      data: result.data as ApprovalRecord,
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
 * Serialize ApprovalRecord to JSON string
 */
export function serializeApprovalRecord(record: ApprovalRecord, pretty = true): string {
  return JSON.stringify(record, null, pretty ? 2 : 0);
}

/**
 * Create a new ApprovalRecord
 */
export function createApprovalRecord(
  approvalId: string,
  featureId: string,
  gateType: ApprovalGateType,
  verdict: ApprovalVerdict,
  signer: string,
  options?: {
    signerName?: string;
    artifactHash?: string;
    artifactPath?: string;
    rationale?: string;
    metadata?: Record<string, unknown>;
  }
): ApprovalRecord {
  return {
    schema_version: '1.0.0',
    approval_id: approvalId,
    feature_id: featureId,
    gate_type: gateType,
    verdict,
    signer,
    signer_name: options?.signerName,
    approved_at: new Date().toISOString(),
    artifact_hash: options?.artifactHash,
    artifact_path: options?.artifactPath,
    rationale: options?.rationale,
    metadata: options?.metadata,
  };
}
