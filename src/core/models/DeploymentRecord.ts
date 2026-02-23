import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * DeploymentRecord Model
 *
 * Captures PR numbers, merge SHAs, status checks, required reviews,
 * auto-merge state, and deployment job links.
 *
 * Implements:
 * - ADR-7 (Validation Policy): Zod-based validation
 *
 * Used by CLI commands: deploy, status
 */

// Deployment Status Enum

export const DeploymentStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'rolled_back',
  'cancelled',
]);

export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

// Status Check Schema

const StatusCheckSchema = z.object({
  /** Status check name */
  name: z.string().min(1),
  /** Status check state (pending, success, failure, error) */
  state: z.enum(['pending', 'success', 'failure', 'error']),
  /** Status check description */
  description: z.string().optional(),
  /** Target URL for status check details */
  target_url: z.string().url().optional(),
});

export type StatusCheck = z.infer<typeof StatusCheckSchema>;

// Review Record Schema

const ReviewRecordSchema = z.object({
  /** Reviewer username or ID */
  reviewer: z.string().min(1),
  /** Review state (approved, changes_requested, commented, pending) */
  state: z.enum(['approved', 'changes_requested', 'commented', 'pending']),
  /** ISO 8601 timestamp when review was submitted */
  submitted_at: z.string().datetime().nullable().optional(),
});

export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

// DeploymentRecord Schema

export const DeploymentRecordSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Unique deployment record identifier */
    deployment_id: z.string().min(1),
    /** Feature ID this deployment belongs to */
    feature_id: z.string().min(1),
    /** Current deployment status */
    status: DeploymentStatusSchema,
    /** Pull request number */
    pr_number: z.number().int().positive().optional(),
    /** Pull request URL */
    pr_url: z.string().url().optional(),
    /** Merge commit SHA (40-character Git hash) */
    merge_sha: z
      .string()
      .regex(/^[a-f0-9]{40}$/, 'Invalid Git SHA format')
      .optional(),
    /** Source branch name */
    source_branch: z.string().optional(),
    /** Target branch name */
    target_branch: z.string().optional(),
    /** Status checks for this deployment */
    status_checks: z.array(StatusCheckSchema).default([]),
    /** Required reviews for this deployment */
    required_reviews: z.array(ReviewRecordSchema).default([]),
    /** Whether auto-merge is enabled */
    auto_merge_enabled: z.boolean().default(false),
    /** Deployment job/workflow URL */
    deployment_job_url: z.string().url().optional(),
    /** ISO 8601 timestamp when deployment was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when deployment was last updated */
    updated_at: z.string().datetime(),
    /** ISO 8601 timestamp when deployment started */
    started_at: z.string().datetime().nullable().optional(),
    /** ISO 8601 timestamp when deployment completed */
    completed_at: z.string().datetime().nullable().optional(),
    /** Optional deployment metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DeploymentRecord = Readonly<z.infer<typeof DeploymentRecordSchema>>;

// Serialization Helpers

const { parse: parseDeploymentRecord, serialize: serializeDeploymentRecord } =
  createModelParser<DeploymentRecord>(DeploymentRecordSchema);
export { parseDeploymentRecord, serializeDeploymentRecord };

/**
 * Create a new DeploymentRecord
 */
export function createDeploymentRecord(
  deploymentId: string,
  featureId: string,
  options?: {
    prNumber?: number;
    prUrl?: string;
    sourceBranch?: string;
    targetBranch?: string;
    autoMergeEnabled?: boolean;
    metadata?: Record<string, unknown>;
  }
): DeploymentRecord {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    deployment_id: deploymentId,
    feature_id: featureId,
    status: 'pending',
    pr_number: options?.prNumber,
    pr_url: options?.prUrl,
    source_branch: options?.sourceBranch,
    target_branch: options?.targetBranch,
    status_checks: [],
    required_reviews: [],
    auto_merge_enabled: options?.autoMergeEnabled ?? false,
    created_at: now,
    updated_at: now,
    metadata: options?.metadata,
  };
}

/**
 * Check if all status checks passed
 */
export function allStatusChecksPassed(record: DeploymentRecord): boolean {
  if (record.status_checks.length === 0) {
    return true;
  }

  return record.status_checks.every((check) => check.state === 'success');
}

/**
 * Check if all required reviews are approved
 */
export function allReviewsApproved(record: DeploymentRecord): boolean {
  if (record.required_reviews.length === 0) {
    return true;
  }

  return record.required_reviews.every((review) => review.state === 'approved');
}

/**
 * Check if deployment is ready to merge
 */
export function isReadyToMerge(record: DeploymentRecord): boolean {
  return allStatusChecksPassed(record) && allReviewsApproved(record);
}
