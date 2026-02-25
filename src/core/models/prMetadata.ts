import { z } from 'zod';

export const PRMetadataSchema = z.object({
  pr_number: z.number().int().positive(),
  url: z.string(),
  branch: z.string().min(1),
  base_branch: z.string().min(1),
  head_sha: z.string().optional(),
  base_sha: z.string().optional(),
  state: z.string().optional(),
  mergeable: z.boolean().nullable().optional(),
  created_at: z.string(),
  reviewers_requested: z.array(z.string()),
  auto_merge_enabled: z.boolean(),
  status_checks: z
    .array(
      z.object({
        context: z.string(),
        state: z.string(),
        conclusion: z.string().nullable(),
      })
    )
    .optional(),
  merge_ready: z.boolean().optional(),
  blockers: z.array(z.string()).optional(),
  last_updated: z.string(),
});

/**
 * Pull request metadata (persisted to pr.json)
 */
export interface PRMetadata {
  pr_number: number;
  url: string;
  branch: string;
  base_branch: string;
  head_sha?: string;
  base_sha?: string;
  state?: string;
  mergeable?: boolean | null;
  created_at: string;
  reviewers_requested: string[];
  auto_merge_enabled: boolean;
  status_checks?: Array<{
    context: string;
    state: string;
    conclusion: string | null;
  }>;
  merge_ready?: boolean;
  blockers?: string[];
  last_updated: string;
}
