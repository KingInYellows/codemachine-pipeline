/**
 * GitHub Adapter Types
 *
 * Type definitions for GitHub adapter operations.
 * Extracted from GitHubAdapter.ts for single-responsibility.
 */

import type { LoggerInterface } from '../http/client';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * GitHub adapter configuration
 */
export interface GitHubAdapterConfig {
  /** Repository owner (org or user) */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub API token (PAT or App token) */
  token: string;
  /** Optional base URL for GitHub Enterprise */
  baseUrl?: string;
  /** Run directory for rate limit ledger */
  runDir?: string;
  /** Logger instance */
  logger?: LoggerInterface;
  /** HTTP client timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
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
  /** PR number */
  number: number;
  /** PR ID */
  id: number;
  /** PR state (open, closed) */
  state: string;
  /** PR title */
  title: string;
  /** PR body/description */
  body: string | null;
  /** PR HTML URL */
  html_url: string;
  /** PR API URL */
  url: string;
  /** Head branch info */
  head: {
    ref: string;
    sha: string;
  };
  /** Base branch info */
  base: {
    ref: string;
    sha: string;
  };
  /** Whether PR is draft */
  draft: boolean;
  /** Whether PR is merged */
  merged: boolean;
  /** Whether PR is mergeable */
  mergeable: boolean | null;
  /** Mergeable state */
  mergeable_state: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
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
