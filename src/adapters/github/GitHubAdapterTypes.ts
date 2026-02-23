/**
 * GitHub Adapter Types
 *
 * Type definitions for GitHub adapter operations.
 * Extracted from GitHubAdapter.ts for single-responsibility.
 */

import type { LoggerInterface } from '../../telemetry/logger';

// Types & Schemas

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
  id: number;
  /** Full repository name (owner/repo) */
  full_name: string;
  default_branch: string;
  private: boolean;
  /** Clone URL (HTTPS) */
  clone_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Git reference (branch or tag)
 */
export interface GitReference {
  /** Reference name (e.g., refs/heads/feature-branch) */
  ref: string;
  url: string;
  object: {
    sha: string;
    /** Object type (usually 'commit') */
    type: string;
    url: string;
  };
}

/**
 * Pull request creation parameters
 */
export interface CreatePullRequestParams {
  title: string;
  body: string;
  head: string;
  base: string;
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
  pull_number: number;
  reviewers?: string[];
  team_reviewers?: string[];
}

/**
 * Status check information
 */
export interface StatusCheck {
  id: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
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
  pull_number: number;
  commit_title?: string;
  commit_message?: string;
  /** Merge method (merge, squash, rebase) */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** SHA that pull request head must match to prevent race conditions */
  sha?: string;
}

/**
 * Merge result
 */
export interface MergeResult {
  merged: boolean;
  sha: string;
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
  inputs?: Record<string, string>;
}

/**
 * Branch creation parameters
 */
export interface CreateBranchParams {
  branch: string;
  /** SHA to branch from */
  sha: string;
}
