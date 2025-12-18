/**
 * GitHub Adapter
 *
 * Provides GitHub integration boundary with repo info, branch creation,
 * PR creation, reviewer requests, merge operations, and status-check introspection.
 *
 * Key features:
 * - Rate-limit aware HTTP calls with required headers (Accept, X-GitHub-Api-Version)
 * - Authentication support (PAT or GitHub App)
 * - Error taxonomy (transient, permanent, human action required)
 * - Auto-merge enablement when repository settings allow
 * - Logging with structured telemetry
 * - OpenAPI spec generation for future remote endpoints
 *
 * Implements:
 * - Section 2.1: Key Components - GitHub Adapter
 * - IR-1..IR-7: Integration requirements
 * - FR-15: PR automation
 */

import { HttpClient, Provider, HttpError, ErrorType } from '../http/client';
import type { LoggerInterface, HttpClientConfig } from '../http/client';

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

// ============================================================================
// GitHub Adapter
// ============================================================================

/**
 * GitHub adapter for repository operations
 */
export class GitHubAdapter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly client: HttpClient;
  private readonly logger: LoggerInterface;

  constructor(config: GitHubAdapterConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.logger = config.logger ?? this.createDefaultLogger();

    const baseUrl = config.baseUrl ?? 'https://api.github.com';

    const clientConfig: HttpClientConfig = {
      baseUrl,
      provider: Provider.GITHUB,
      token: config.token,
      maxRetries: config.maxRetries ?? 3,
      logger: this.logger,
    };

    if (typeof config.timeout === 'number') {
      clientConfig.timeout = config.timeout;
    }

    if (config.runDir) {
      clientConfig.runDir = config.runDir;
    }

    this.client = new HttpClient(clientConfig);

    this.logger.info('GitHubAdapter initialized', {
      owner: this.owner,
      repo: this.repo,
      baseUrl,
    });
  }

  /**
   * Get repository metadata
   */
  async getRepository(): Promise<RepositoryInfo> {
    this.logger.info('Fetching repository metadata', {
      owner: this.owner,
      repo: this.repo,
    });

    try {
      const response = await this.client.get<RepositoryInfo>(
        `/repos/${this.owner}/${this.repo}`,
        {
          metadata: { operation: 'getRepository' },
        }
      );

      this.logger.debug('Repository metadata fetched', {
        repo: response.data.full_name,
        default_branch: response.data.default_branch,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch repository metadata', {
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'getRepository');
    }
  }

  /**
   * Create a new branch from a specific commit
   */
  async createBranch(params: CreateBranchParams): Promise<GitReference> {
    this.logger.info('Creating branch', {
      branch: params.branch,
      sha: params.sha,
    });

    try {
      const response = await this.client.post<GitReference>(
        `/repos/${this.owner}/${this.repo}/git/refs`,
        {
          ref: `refs/heads/${params.branch}`,
          sha: params.sha,
        },
        {
          metadata: { operation: 'createBranch', branch: params.branch },
        }
      );

      this.logger.info('Branch created successfully', {
        branch: params.branch,
        ref: response.data.ref,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create branch', {
        branch: params.branch,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'createBranch');
    }
  }

  /**
   * Get a specific branch reference
   */
  async getBranch(branch: string): Promise<GitReference> {
    this.logger.debug('Fetching branch reference', { branch });

    try {
      const response = await this.client.get<GitReference>(
        `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`,
        {
          metadata: { operation: 'getBranch', branch },
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch branch reference', {
        branch,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'getBranch');
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequest> {
    this.logger.info('Creating pull request', {
      title: params.title,
      head: params.head,
      base: params.base,
      draft: params.draft,
    });

    try {
      const response = await this.client.post<PullRequest>(
        `/repos/${this.owner}/${this.repo}/pulls`,
        {
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base,
          draft: params.draft ?? false,
          maintainer_can_modify: params.maintainer_can_modify ?? true,
        },
        {
          metadata: {
            operation: 'createPullRequest',
            head: params.head,
            base: params.base,
          },
        }
      );

      this.logger.info('Pull request created successfully', {
        pr_number: response.data.number,
        html_url: response.data.html_url,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create pull request', {
        title: params.title,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'createPullRequest');
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(pull_number: number): Promise<PullRequest> {
    this.logger.debug('Fetching pull request', { pull_number });

    try {
      const response = await this.client.get<PullRequest>(
        `/repos/${this.owner}/${this.repo}/pulls/${pull_number}`,
        {
          metadata: { operation: 'getPullRequest', pull_number },
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch pull request', {
        pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'getPullRequest');
    }
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(params: RequestReviewersParams): Promise<PullRequest> {
    this.logger.info('Requesting reviewers', {
      pull_number: params.pull_number,
      reviewers: params.reviewers,
      team_reviewers: params.team_reviewers,
    });

    try {
      const payload: Record<string, unknown> = {};
      if (params.reviewers && params.reviewers.length > 0) {
        payload.reviewers = params.reviewers;
      }
      if (params.team_reviewers && params.team_reviewers.length > 0) {
        payload.team_reviewers = params.team_reviewers;
      }

      const response = await this.client.post<PullRequest>(
        `/repos/${this.owner}/${this.repo}/pulls/${params.pull_number}/requested_reviewers`,
        payload,
        {
          metadata: {
            operation: 'requestReviewers',
            pull_number: params.pull_number,
          },
        }
      );

      this.logger.info('Reviewers requested successfully', {
        pull_number: params.pull_number,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to request reviewers', {
        pull_number: params.pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'requestReviewers');
    }
  }

  /**
   * Get status checks for a commit
   */
  async getStatusChecks(sha: string): Promise<StatusCheck[]> {
    this.logger.debug('Fetching status checks', { sha });

    try {
      // GitHub REST API v3 uses check-suites endpoint
      const response = await this.client.get<{ check_suites: StatusCheck[] }>(
        `/repos/${this.owner}/${this.repo}/commits/${sha}/check-suites`,
        {
          metadata: { operation: 'getStatusChecks', sha },
        }
      );

      this.logger.debug('Status checks fetched', {
        sha,
        count: response.data.check_suites?.length ?? 0,
      });

      return response.data.check_suites ?? [];
    } catch (error) {
      this.logger.error('Failed to fetch status checks', {
        sha,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'getStatusChecks');
    }
  }

  /**
   * Check if pull request is ready to merge
   *
   * Validates:
   * - PR is in open state
   * - PR is mergeable
   * - Status checks have passed
   */
  async isPullRequestReadyToMerge(pull_number: number): Promise<{
    ready: boolean;
    reasons: string[];
  }> {
    this.logger.debug('Checking merge readiness', { pull_number });

    try {
      const pr = await this.getPullRequest(pull_number);
      const reasons: string[] = [];

      if (pr.state !== 'open') {
        reasons.push(`PR state is ${pr.state}, expected open`);
      }

      if (pr.draft) {
        reasons.push('PR is in draft mode');
      }

      if (pr.mergeable === false) {
        reasons.push('PR has merge conflicts');
      }

      if (pr.mergeable_state === 'blocked') {
        reasons.push('PR is blocked by required status checks or reviews');
      }

      // Check status checks
      const statusChecks = await this.getStatusChecks(pr.head.sha);
      const failedChecks = statusChecks.filter(
        check => check.conclusion === 'failure' || check.conclusion === 'cancelled'
      );

      if (failedChecks.length > 0) {
        reasons.push(`${failedChecks.length} status check(s) failed`);
      }

      const ready = reasons.length === 0;

      this.logger.info('Merge readiness checked', {
        pull_number,
        ready,
        reasons,
      });

      return { ready, reasons };
    } catch (error) {
      this.logger.error('Failed to check merge readiness', {
        pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'isPullRequestReadyToMerge');
    }
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(params: MergePullRequestParams): Promise<MergeResult> {
    this.logger.info('Merging pull request', {
      pull_number: params.pull_number,
      merge_method: params.merge_method,
    });

    try {
      const payload: Record<string, unknown> = {
        merge_method: params.merge_method ?? 'merge',
      };

      if (params.commit_title) {
        payload.commit_title = params.commit_title;
      }

      if (params.commit_message) {
        payload.commit_message = params.commit_message;
      }

      if (params.sha) {
        payload.sha = params.sha;
      }

      const response = await this.client.put<MergeResult>(
        `/repos/${this.owner}/${this.repo}/pulls/${params.pull_number}/merge`,
        payload,
        {
          metadata: {
            operation: 'mergePullRequest',
            pull_number: params.pull_number,
          },
        }
      );

      this.logger.info('Pull request merged successfully', {
        pull_number: params.pull_number,
        sha: response.data.sha,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to merge pull request', {
        pull_number: params.pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'mergePullRequest');
    }
  }

  /**
   * Enable auto-merge for a pull request using GraphQL mutation
   *
   * Note: This uses the GraphQL API wrapped in REST-like envelope
   */
  async enableAutoMerge(pull_number: number, merge_method?: 'MERGE' | 'SQUASH' | 'REBASE'): Promise<void> {
    this.logger.info('Enabling auto-merge', {
      pull_number,
      merge_method,
    });

    try {
      // Get PR node ID for GraphQL mutation
      const pr = await this.getPullRequest(pull_number);
      const prNodeId = (pr as unknown as { node_id: string }).node_id;

      if (!prNodeId) {
        throw new Error('PR node_id not available');
      }

      // GraphQL mutation for auto-merge
      const mutation = `
        mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
          enablePullRequestAutoMerge(input: {
            pullRequestId: $pullRequestId
            mergeMethod: $mergeMethod
          }) {
            pullRequest {
              id
              autoMergeRequest {
                enabledAt
              }
            }
          }
        }
      `;

      const variables = {
        pullRequestId: prNodeId,
        mergeMethod: merge_method ?? 'MERGE',
      };

      await this.client.post(
        '/graphql',
        {
          query: mutation,
          variables,
        },
        {
          metadata: {
            operation: 'enableAutoMerge',
            pull_number,
          },
        }
      );

      this.logger.info('Auto-merge enabled successfully', {
        pull_number,
      });
    } catch (error) {
      this.logger.error('Failed to enable auto-merge', {
        pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'enableAutoMerge');
    }
  }

  /**
   * Disable auto-merge for a pull request using GraphQL mutation
   *
   * Note: This uses the GraphQL API wrapped in REST-like envelope
   */
  async disableAutoMerge(pull_number: number): Promise<void> {
    this.logger.info('Disabling auto-merge', {
      pull_number,
    });

    try {
      // Get PR node ID for GraphQL mutation
      const pr = await this.getPullRequest(pull_number);
      const prNodeId = (pr as unknown as { node_id: string }).node_id;

      if (!prNodeId) {
        throw new Error('PR node_id not available');
      }

      // GraphQL mutation for disabling auto-merge
      const mutation = `
        mutation DisableAutoMerge($pullRequestId: ID!) {
          disablePullRequestAutoMerge(input: {
            pullRequestId: $pullRequestId
          }) {
            pullRequest {
              id
            }
          }
        }
      `;

      const variables = {
        pullRequestId: prNodeId,
      };

      await this.client.post(
        '/graphql',
        {
          query: mutation,
          variables,
        },
        {
          metadata: {
            operation: 'disableAutoMerge',
            pull_number,
          },
        }
      );

      this.logger.info('Auto-merge disabled successfully', {
        pull_number,
      });
    } catch (error) {
      this.logger.error('Failed to disable auto-merge', {
        pull_number,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'disableAutoMerge');
    }
  }

  /**
   * Trigger a workflow dispatch
   */
  async triggerWorkflow(params: WorkflowDispatchParams): Promise<void> {
    this.logger.info('Triggering workflow dispatch', {
      workflow_id: params.workflow_id,
      ref: params.ref,
    });

    try {
      await this.client.post(
        `/repos/${this.owner}/${this.repo}/actions/workflows/${params.workflow_id}/dispatches`,
        {
          ref: params.ref,
          inputs: params.inputs ?? {},
        },
        {
          metadata: {
            operation: 'triggerWorkflow',
            workflow_id: params.workflow_id,
            ref: params.ref,
          },
        }
      );

      this.logger.info('Workflow dispatch triggered successfully', {
        workflow_id: params.workflow_id,
        ref: params.ref,
      });
    } catch (error) {
      this.logger.error('Failed to trigger workflow dispatch', {
        workflow_id: params.workflow_id,
        error: this.serializeError(error),
      });
      throw this.normalizeError(error, 'triggerWorkflow');
    }
  }

  /**
   * Normalize errors to GitHubAdapterError
   */
  private normalizeError(error: unknown, operation: string): GitHubAdapterError {
    if (error instanceof HttpError) {
      return new GitHubAdapterError(
        `GitHub ${operation} failed: ${error.message}`,
        error.type,
        error.statusCode,
        error.requestId,
        operation
      );
    }

    if (error instanceof GitHubAdapterError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    return new GitHubAdapterError(
      `GitHub ${operation} failed: ${message}`,
      ErrorType.PERMANENT,
      undefined,
      undefined,
      operation
    );
  }

  /**
   * Serialize error for logging
   */
  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof HttpError) {
      return error.toJSON();
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return { error: String(error) };
  }

  /**
   * Create default console logger
   */
  private createDefaultLogger(): LoggerInterface {
    return {
      debug: (message: string, context?: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.debug(`[DEBUG] ${message}`, context ? JSON.stringify(context) : '');
      },
      info: (message: string, context?: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.info(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.warn(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
      },
      error: (message: string, context?: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.error(`[ERROR] ${message}`, context ? JSON.stringify(context) : '');
      },
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * GitHub adapter error with error taxonomy
 */
export class GitHubAdapterError extends Error {
  constructor(
    message: string,
    public readonly errorType: ErrorType,
    public readonly statusCode?: number,
    public readonly requestId?: string,
    public readonly operation?: string
  ) {
    super(message);
    this.name = 'GitHubAdapterError';
    Object.setPrototypeOf(this, GitHubAdapterError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorType: this.errorType,
      statusCode: this.statusCode,
      requestId: this.requestId,
      operation: this.operation,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create GitHub adapter instance
 */
export function createGitHubAdapter(config: GitHubAdapterConfig): GitHubAdapter {
  return new GitHubAdapter(config);
}
