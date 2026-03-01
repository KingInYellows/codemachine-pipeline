import { z } from 'zod';

/**
 * Branch Protection Report Model
 *
 * Shared schema/type for branch protection artifacts consumed by workflows,
 * persistence, and deployment context loading.
 */
export const BranchProtectionReportSchema = z.object({
  schema_version: z.string(),
  feature_id: z.string(),
  branch: z.string(),
  sha: z.string(),
  base_sha: z.string(),
  pull_number: z.number().optional(),
  protected: z.boolean(),
  compliant: z.boolean(),
  required_checks: z.array(z.string()),
  checks_passing: z.boolean(),
  failing_checks: z.array(z.string()),
  reviews_required: z.number(),
  reviews_count: z.number(),
  reviews_satisfied: z.boolean(),
  up_to_date: z.boolean(),
  stale_commit: z.boolean(),
  allows_auto_merge: z.boolean(),
  allows_force_push: z.boolean(),
  blockers: z.array(z.string()),
  evaluated_at: z.string(),
  validation_mismatch: z
    .object({
      missing_in_registry: z.array(z.string()),
      extra_in_registry: z.array(z.string()),
      recommendations: z.array(z.string()),
    })
    .optional(),
  metadata: z
    .object({
      owner: z.string(),
      repo: z.string(),
      protection_enabled: z.boolean(),
      enforce_admins: z.boolean().optional(),
      required_linear_history: z.boolean().optional(),
      required_conversation_resolution: z.boolean().optional(),
    })
    .optional(),
});

export type BranchProtectionReport = z.infer<typeof BranchProtectionReportSchema>;
