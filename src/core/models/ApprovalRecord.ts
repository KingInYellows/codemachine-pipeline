import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * ApprovalRecord Model
 *
 * Gate approvals referencing artifacts, signers, timestamps, and rationale.
 *
 * Used by CLI commands: approve, status
 */

// Approval Gate Type Enum

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

// Approval Verdict Enum

export const ApprovalVerdictSchema = z.enum(['approved', 'rejected', 'requested_changes']);

export type ApprovalVerdict = z.infer<typeof ApprovalVerdictSchema>;

// ApprovalRecord Schema

export const ApprovalRecordSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    approval_id: z.string().min(1),
    feature_id: z.string().min(1),
    gate_type: ApprovalGateTypeSchema,
    verdict: ApprovalVerdictSchema,
    signer: z.string().min(1), // Signer identifier (username, email, or ID)
    signer_name: z.string().optional(),
    approved_at: z.string().datetime(),
    /** SHA-256 hash of the artifact being approved */
    artifact_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format')
      .optional(),
    /** Path to the approved artifact, relative to run directory */
    artifact_path: z.string().optional(),
    rationale: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ApprovalRecord = Readonly<z.infer<typeof ApprovalRecordSchema>>;

// Serialization Helpers

const { parse: parseApprovalRecord, serialize: serializeApprovalRecord } =
  createModelParser<ApprovalRecord>(ApprovalRecordSchema);
export { parseApprovalRecord, serializeApprovalRecord };

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
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: approval metadata varies by gate type and workflow
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
