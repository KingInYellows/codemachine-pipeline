import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * DeploymentRecord Model
 *
 * Captures PR numbers, merge SHAs, status checks, required reviews,
 * auto-merge state, and deployment job links.
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
  name: z.string().min(1),
  state: z.enum(['pending', 'success', 'failure', 'error']),
  description: z.string().optional(),
  target_url: z.string().url().optional(),
});

export type StatusCheck = z.infer<typeof StatusCheckSchema>;

// Review Record Schema

const ReviewRecordSchema = z.object({
  reviewer: z.string().min(1),
  state: z.enum(['approved', 'changes_requested', 'commented', 'pending']),
  submitted_at: z.string().datetime().nullable().optional(),
});

export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

// DeploymentRecord Schema

export const DeploymentRecordSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    deployment_id: z.string().min(1),
    feature_id: z.string().min(1),
    status: DeploymentStatusSchema,
    pr_number: z.number().int().positive().optional(),
    pr_url: z.string().url().optional(),
    merge_sha: z
      .string()
      .regex(/^[a-f0-9]{40}$/, 'Invalid Git SHA format')
      .optional(),
    source_branch: z.string().optional(),
    target_branch: z.string().optional(),
    status_checks: z.array(StatusCheckSchema).default([]),
    required_reviews: z.array(ReviewRecordSchema).default([]),
    auto_merge_enabled: z.boolean().default(false),
    deployment_job_url: z.string().url().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    started_at: z.string().datetime().nullable().optional(),
    completed_at: z.string().datetime().nullable().optional(),
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
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: deployment metadata varies per environment and action
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
