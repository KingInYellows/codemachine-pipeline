/**
 * GitHub Branch Protection Module
 *
 * Provides branch protection intelligence for deployment readiness checks.
 * Fetches required status checks, review requirements, dismissal rules, and auto-merge eligibility.
 *
 */

import { HttpClient, Provider, HttpError } from '../http/client';
import type { HttpClientConfig } from '../http/client';
import { serializeError, createErrorNormalizer, AdapterError } from '../../utils/errors';
import { ErrorType } from '../../core/sharedTypes';
import { createLogger, LogLevel, type LoggerInterface } from '../../telemetry/logger';
import { resolveGitHubApiBaseUrl } from '../../utils/githubApiUrl.js';

/**
 * Branch protection configuration
 */
export interface BranchProtectionConfig {
  owner: string;
  repo: string;
  token: string;
  baseUrl?: string;
  runDir?: string;
  logger?: LoggerInterface;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Required status checks configuration
 */
export interface RequiredStatusChecks {
  enabled: boolean;
  strict: boolean;
  contexts: string[];
  checks?: Array<{
    app_id: number;
    context: string;
  }>;
}

/**
 * Required pull request review configuration
 */
export interface RequiredPullRequestReviews {
  enabled: boolean;
  dismiss_stale_reviews: boolean;
  require_code_owner_reviews: boolean;
  required_approving_review_count: number;
  require_last_push_approval?: boolean;
  dismissal_restrictions?: {
    users?: string[];
    teams?: string[];
  };
}

/**
 * Branch protection restrictions
 */
export interface BranchProtectionRestrictions {
  enabled: boolean;
  users?: string[];
  teams?: string[];
  apps?: string[];
}

/**
 * Branch protection rules
 */
export interface BranchProtectionRules {
  branch: string;
  enabled: boolean;
  required_status_checks: RequiredStatusChecks | null;
  required_pull_request_reviews: RequiredPullRequestReviews | null;
  enforce_admins: boolean;
  restrictions: BranchProtectionRestrictions | null;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
  lock_branch?: boolean;
  required_linear_history?: boolean;
  required_conversation_resolution?: boolean;
}

/**
 * Commit status state
 */
export interface CommitStatus {
  context: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string | null;
  target_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Check run status
 */
export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  details_url: string | null;
  app?: {
    id: number;
    name: string;
  };
}

/**
 * Pull request review state
 */
export interface PullRequestReview {
  id: number;
  user: {
    login: string;
    id: number;
  };
  state: string;
  submitted_at: string;
  commit_id: string;
}

/**
 * Branch protection compliance result
 */
export interface BranchProtectionCompliance {
  branch: string;
  sha: string;
  protection: BranchProtectionRules | null;
  protected: boolean;
  required_checks: string[];
  actual_checks: CommitStatus[];
  check_runs: CheckRun[];
  checks_passing: boolean;
  failing_checks: string[];
  reviews_required: number;
  reviews: PullRequestReview[];
  reviews_satisfied: boolean;
  up_to_date: boolean;
  stale_commit: boolean;
  allows_auto_merge: boolean;
  allows_force_push: boolean;
  compliant: boolean;
  blockers: string[];
  evaluated_at: string;
}

/**
 * GitHub branch protection intelligence adapter
 */
export class BranchProtectionAdapter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly client: HttpClient;
  private readonly logger: LoggerInterface;

  constructor(config: BranchProtectionConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.logger =
      config.logger ??
      createLogger({
        component: 'branch-protection',
        minLevel: LogLevel.DEBUG,
        mirrorToStderr: true,
      });

    let baseUrl: string;
    try {
      baseUrl = resolveGitHubApiBaseUrl(config.baseUrl);
    } catch (error) {
      throw new BranchProtectionError(
        `Invalid GitHub API base URL: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.PERMANENT
      );
    }

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

    this.logger.info('BranchProtectionAdapter initialized', {
      owner: this.owner,
      repo: this.repo,
      baseUrl,
    });
  }

  /**
   * Get branch protection rules for a specific branch
   */
  async getBranchProtection(branch: string): Promise<BranchProtectionRules | null> {
    try {
      const response = await this.client.get<{
        required_status_checks: RequiredStatusChecks | null;
        required_pull_request_reviews: RequiredPullRequestReviews | null;
        enforce_admins: { enabled: boolean };
        restrictions: BranchProtectionRestrictions | null;
        allow_force_pushes: { enabled: boolean };
        allow_deletions: { enabled: boolean };
        lock_branch?: { enabled: boolean };
        required_linear_history?: { enabled: boolean };
        required_conversation_resolution?: { enabled: boolean };
      }>(
        `/repos/${this.owner}/${this.repo}/branches/${branch.split('/').map(encodeURIComponent).join('/')}/protection`,
        {
          metadata: { operation: 'getBranchProtection', branch },
        }
      );

      const data = response.data;

      const protection: BranchProtectionRules = {
        branch,
        enabled: true,
        required_status_checks: data.required_status_checks
          ? {
              enabled: true,
              strict: data.required_status_checks.strict,
              contexts: data.required_status_checks.contexts,
              ...(data.required_status_checks.checks && {
                checks: data.required_status_checks.checks,
              }),
            }
          : null,
        required_pull_request_reviews: data.required_pull_request_reviews
          ? {
              enabled: true,
              dismiss_stale_reviews: data.required_pull_request_reviews.dismiss_stale_reviews,
              require_code_owner_reviews:
                data.required_pull_request_reviews.require_code_owner_reviews,
              required_approving_review_count:
                data.required_pull_request_reviews.required_approving_review_count,
              ...(typeof data.required_pull_request_reviews.require_last_push_approval ===
                'boolean' && {
                require_last_push_approval:
                  data.required_pull_request_reviews.require_last_push_approval,
              }),
              ...(data.required_pull_request_reviews.dismissal_restrictions && {
                dismissal_restrictions: data.required_pull_request_reviews.dismissal_restrictions,
              }),
            }
          : null,
        enforce_admins: data.enforce_admins.enabled,
        restrictions: data.restrictions,
        allow_force_pushes: data.allow_force_pushes.enabled,
        allow_deletions: data.allow_deletions.enabled,
        ...(data.lock_branch && { lock_branch: data.lock_branch.enabled }),
        ...(data.required_linear_history && {
          required_linear_history: data.required_linear_history.enabled,
        }),
        ...(data.required_conversation_resolution && {
          required_conversation_resolution: data.required_conversation_resolution.enabled,
        }),
      };

      return protection;
    } catch (error) {
      // 404 means branch is not protected
      if (error instanceof HttpError && error.statusCode === 404) {
        this.logger.info('Branch is not protected', { branch });
        return null;
      }

      this.logger.error('Failed to fetch branch protection rules', {
        branch,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getBranchProtection');
    }
  }

  /**
   * Get commit statuses for a specific commit
   */
  async getCommitStatuses(sha: string): Promise<CommitStatus[]> {
    try {
      const encodedSha = encodeURIComponent(sha);
      const response = await this.client.get<CommitStatus[]>(
        `/repos/${this.owner}/${this.repo}/commits/${encodedSha}/statuses`,
        {
          metadata: { operation: 'getCommitStatuses', sha },
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch commit statuses', {
        sha,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getCommitStatuses');
    }
  }

  /**
   * Get check runs for a specific commit
   */
  async getCheckRuns(sha: string): Promise<CheckRun[]> {
    try {
      const encodedSha = encodeURIComponent(sha);
      const response = await this.client.get<{
        total_count: number;
        check_runs: CheckRun[];
      }>(`/repos/${this.owner}/${this.repo}/commits/${encodedSha}/check-runs`, {
        metadata: { operation: 'getCheckRuns', sha },
      });

      return response.data.check_runs;
    } catch (error) {
      this.logger.error('Failed to fetch check runs', {
        sha,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getCheckRuns');
    }
  }

  /**
   * Get pull request reviews
   */
  async getPullRequestReviews(pull_number: number): Promise<PullRequestReview[]> {
    try {
      const response = await this.client.get<PullRequestReview[]>(
        `/repos/${this.owner}/${this.repo}/pulls/${pull_number}/reviews`,
        {
          metadata: { operation: 'getPullRequestReviews', pull_number },
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch pull request reviews', {
        pull_number,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getPullRequestReviews');
    }
  }

  /**
   * Get pull request details for head/base references
   */
  async getPullRequest(pull_number: number): Promise<{
    number: number;
    state: string;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    mergeable: boolean | null;
    mergeable_state: string | null;
  }> {
    try {
      const response = await this.client.get<{
        number: number;
        state: string;
        head: { ref: string; sha: string };
        base: { ref: string; sha: string };
        mergeable: boolean | null;
        mergeable_state: string | null;
      }>(`/repos/${this.owner}/${this.repo}/pulls/${pull_number}`, {
        metadata: { operation: 'getPullRequest', pull_number },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch pull request details', {
        pull_number,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getPullRequest');
    }
  }

  /**
   * Compare commits to check if head is up-to-date with base
   */
  async compareCommits(
    base: string,
    head: string
  ): Promise<{
    ahead_by: number;
    behind_by: number;
    status: string;
  }> {
    try {
      const encodedBase = encodeURIComponent(base);
      const encodedHead = encodeURIComponent(head);
      const response = await this.client.get<{
        ahead_by: number;
        behind_by: number;
        status: string;
      }>(`/repos/${this.owner}/${this.repo}/compare/${encodedBase}...${encodedHead}`, {
        metadata: { operation: 'compareCommits', base, head },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to compare commits', {
        base,
        head,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'compareCommits');
    }
  }

  private readonly normalizeError = createErrorNormalizer(
    BranchProtectionError,
    'Branch protection'
  );
}

/**
 * Branch protection error with error taxonomy
 */
export class BranchProtectionError extends AdapterError {}
