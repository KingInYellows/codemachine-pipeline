/**
 * GitHub Adapter Types
 *
 * Type definitions for GitHub adapter operations.
 * Extracted from GitHubAdapter.ts for single-responsibility.
 */

import type { LoggerInterface } from '../../telemetry/logger';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * GitHub adapter configuration
 */
export interface GitHubAdapterConfig {
  /** Repository owner (org or user) */
  owner: string;
  repo: string;
  /** GitHub API token (PAT or App token) */
  token: string;
  /** Optional base URL for GitHub Enterprise */
  baseUrl?: string;
  /** Run directory for rate limit ledger */
  runDir?: string;
  logger?: LoggerInterface;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Repository metadata
 */
export interface RepositoryInfo {
  /** Repository ID */
  id: number;
  /** Full repository name (owner/repo) */
  full_name: string;
  /** Default branch name */
  default_branch: string;
  /** Whether the repository is private */
  private: boolean;
  /** Clone URL (HTTPS) */
  clone_url: string;
  /** Repository description */
  description: string | null;
  /** Repository creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Git reference (branch or tag)
 */
export interface GitReference {
  /** Reference name (e.g., refs/heads/feature-branch) */
  ref: string;
  /** Reference URL */
  url: string;
  /** Object information */
  object: {
    /** SHA of the commit */
    sha: string;
    /** Object type (usually 'commit') */
    type: string;
    /** Object URL */
    url: string;
  };
}

/**
 * Pull request creation parameters
 */
export interface CreatePullRequestParams {
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Head branch (source) */
  head: string;
  /** Base branch (target) */
  base: string;
  /** Whether PR is a draft */
  draft?: boolean;
  /** Whether to create PR for maintainer edits */
  maintainer_can_modify?: boolean;
}

/**
 * Pull request information
 */
export interface PullRequest {
  number: number;
  id: number;
  state: string;
  title: string;
  body: string | null;
  /** HTML URL (browser-facing, distinct from API url below) */
  html_url: string;
  url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reviewer request parameters
 */
export interface RequestReviewersParams {
  /** PR number */
  pull_number: number;
  /** List of reviewer usernames */
  reviewers?: string[];
  /** List of team slugs */
  team_reviewers?: string[];
}

/**
 * Status check information
 */
export interface StatusCheck {
  /** Check suite ID */
  id: number;
  /** Check suite status */
  status: string;
  /** Check suite conclusion */
  conclusion: string | null;
  /** Head SHA */
  head_sha: string;
  /** Check runs */
  check_runs?: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

/**
 * Merge pull request parameters
 */
export interface MergePullRequestParams {
  /** PR number */
  pull_number: number;
  /** Merge commit message (optional) */
  commit_title?: string;
  /** Merge commit description (optional) */
  commit_message?: string;
  /** Merge method (merge, squash, rebase) */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** SHA that pull request head must match */
  sha?: string;
}

/**
 * Merge result
 */
export interface MergeResult {
  /** Whether merge was successful */
  merged: boolean;
  /** SHA of the merge commit */
  sha: string;
  /** Result message */
  message: string;
}

/**
 * Workflow dispatch parameters
 */
export interface WorkflowDispatchParams {
  /** Workflow ID or filename */
  workflow_id: string;
  /** Branch/tag/SHA reference */
  ref: string;
  /** Workflow inputs */
  inputs?: Record<string, string>;
}

/**
 * Branch creation parameters
 */
export interface CreateBranchParams {
  /** Branch name */
  branch: string;
  /** SHA to branch from */
  sha: string;
}
