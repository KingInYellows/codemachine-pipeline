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
