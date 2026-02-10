/**
 * GitHub Branch Protection Module
 *
 * Provides branch protection intelligence for deployment readiness checks.
 * Fetches required status checks, review requirements, dismissal rules, and auto-merge eligibility.
 *
 * Implements:
 * - FR-15: Status checks mandate
 * - IR-5: Branch protection awareness
 * - Section 2.1: Integration discipline (branch protection detection)
 */

import { HttpClient, Provider, HttpError, ErrorType } from '../http/client';
import type { HttpClientConfig } from '../http/client';
import { serializeError, createErrorNormalizer } from '../../utils/errors';
import { createLogger, LogLevel, type LoggerInterface } from '../../telemetry/logger';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Branch protection configuration
 */
export interface BranchProtectionConfig {
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
 * Required status checks configuration
 */
export interface RequiredStatusChecks {
  /** Whether status checks are enabled */
  enabled: boolean;
  /** Whether to require branches to be up to date before merging */
  strict: boolean;
  /** List of required status check contexts */
  contexts: string[];
  /** List of required status check apps (app_id:check_name) */
  checks?: Array<{
    /** App ID */
    app_id: number;
    /** Check name */
    context: string;
  }>;
}

/**
 * Required pull request review configuration
 */
export interface RequiredPullRequestReviews {
  /** Whether reviews are enabled */
  enabled: boolean;
  /** Whether to dismiss stale reviews when new commits are pushed */
  dismiss_stale_reviews: boolean;
  /** Whether to require code owner reviews */
  require_code_owner_reviews: boolean;
  /** Number of required approving reviews */
  required_approving_review_count: number;
  /** Whether to require review from code owners */
  require_last_push_approval?: boolean;
  /** Teams/users who can dismiss reviews */
  dismissal_restrictions?: {
    users?: string[];
    teams?: string[];
  };
}

/**
 * Branch protection restrictions
 */
export interface BranchProtectionRestrictions {
  /** Whether push restrictions are enabled */
  enabled: boolean;
  /** Users who can push */
  users?: string[];
  /** Teams who can push */
  teams?: string[];
  /** Apps that can push */
  apps?: string[];
}

/**
 * Branch protection rules
 */
export interface BranchProtectionRules {
  /** Branch name or pattern */
  branch: string;
  /** Whether branch protection is enabled */
  enabled: boolean;
  /** Required status checks configuration */
  required_status_checks: RequiredStatusChecks | null;
  /** Required pull request reviews configuration */
  required_pull_request_reviews: RequiredPullRequestReviews | null;
  /** Whether to enforce for administrators */
  enforce_admins: boolean;
  /** Push restrictions */
  restrictions: BranchProtectionRestrictions | null;
  /** Whether force pushes are allowed */
  allow_force_pushes: boolean;
  /** Whether deletions are allowed */
  allow_deletions: boolean;
  /** Whether the branch is locked (read-only) */
  lock_branch?: boolean;
  /** Whether linear history is required */
  required_linear_history?: boolean;
  /** Whether conversations must be resolved before merging */
  required_conversation_resolution?: boolean;
}

/**
 * Commit status state
 */
export interface CommitStatus {
  /** Status context (e.g., "ci/build", "security/scan") */
  context: string;
  /** Status state (pending, success, failure, error) */
  state: 'pending' | 'success' | 'failure' | 'error';
  /** Status description */
  description: string | null;
  /** Target URL */
  target_url: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Check run status
 */
export interface CheckRun {
  /** Check run ID */
  id: number;
  /** Check run name */
  name: string;
  /** Check run status (queued, in_progress, completed) */
  status: string;
  /** Check run conclusion (success, failure, cancelled, etc.) */
  conclusion: string | null;
  /** Started at timestamp */
  started_at: string | null;
  /** Completed at timestamp */
  completed_at: string | null;
  /** Details URL */
  details_url: string | null;
  /** App that created the check */
  app?: {
    id: number;
    name: string;
  };
}

/**
 * Pull request review state
 */
export interface PullRequestReview {
  /** Review ID */
  id: number;
  /** Reviewer user */
  user: {
    login: string;
    id: number;
  };
  /** Review state (APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED) */
  state: string;
  /** Submitted at timestamp */
  submitted_at: string;
  /** Commit ID that was reviewed */
  commit_id: string;
}

/**
 * Branch protection compliance result
 */
export interface BranchProtectionCompliance {
  /** Branch name */
  branch: string;
  /** Commit SHA being evaluated */
  sha: string;
  /** Protection rules for the branch */
  protection: BranchProtectionRules | null;
  /** Whether protection rules exist */
  protected: boolean;
  /** Required status checks (from protection rules) */
  required_checks: string[];
  /** Actual status checks for the commit */
  actual_checks: CommitStatus[];
  /** Check runs for the commit */
  check_runs: CheckRun[];
  /** Whether all required checks are passing */
  checks_passing: boolean;
  /** Missing or failing checks */
  failing_checks: string[];
  /** Reviews required count */
  reviews_required: number;
  /** Actual reviews on the PR */
  reviews: PullRequestReview[];
  /** Whether review requirements are met */
  reviews_satisfied: boolean;
  /** Whether branch is up-to-date with base */
  up_to_date: boolean;
  /** Whether commit is stale (older than base) */
  stale_commit: boolean;
  /** Whether auto-merge is allowed */
  allows_auto_merge: boolean;
  /** Whether force push is allowed */
  allows_force_push: boolean;
  /** Overall compliance result */
  compliant: boolean;
  /** Reasons for non-compliance */
  blockers: string[];
  /** Last evaluation timestamp */
  evaluated_at: string;
}

// ============================================================================
// Branch Protection Adapter
// ============================================================================

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
    this.logger.info('Fetching branch protection rules', {
      owner: this.owner,
      repo: this.repo,
      branch,
    });

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
      }>(`/repos/${this.owner}/${this.repo}/branches/${branch}/protection`, {
        metadata: { operation: 'getBranchProtection', branch },
      });

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

      this.logger.debug('Branch protection rules fetched', {
        branch,
        protected: true,
        required_checks: protection.required_status_checks?.contexts.length ?? 0,
        required_reviews:
          protection.required_pull_request_reviews?.required_approving_review_count ?? 0,
      });

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
    this.logger.debug('Fetching commit statuses', { sha });

    try {
      const encodedSha = encodeURIComponent(sha);
      const response = await this.client.get<CommitStatus[]>(
        `/repos/${this.owner}/${this.repo}/commits/${encodedSha}/statuses`,
        {
          metadata: { operation: 'getCommitStatuses', sha },
        }
      );

      this.logger.debug('Commit statuses fetched', {
        sha,
        count: response.data.length,
      });

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
    this.logger.debug('Fetching check runs', { sha });

    try {
      const encodedSha = encodeURIComponent(sha);
      const response = await this.client.get<{
        total_count: number;
        check_runs: CheckRun[];
      }>(`/repos/${this.owner}/${this.repo}/commits/${encodedSha}/check-runs`, {
        metadata: { operation: 'getCheckRuns', sha },
      });

      this.logger.debug('Check runs fetched', {
        sha,
        count: response.data.total_count,
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
    this.logger.debug('Fetching pull request reviews', { pull_number });

    try {
      const response = await this.client.get<PullRequestReview[]>(
        `/repos/${this.owner}/${this.repo}/pulls/${pull_number}/reviews`,
        {
          metadata: { operation: 'getPullRequestReviews', pull_number },
        }
      );

      this.logger.debug('Pull request reviews fetched', {
        pull_number,
        count: response.data.length,
      });

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
    this.logger.debug('Fetching pull request details', { pull_number });

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
    this.logger.debug('Comparing commits', { base, head });

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

      this.logger.debug('Commits compared', {
        base,
        head,
        ahead_by: response.data.ahead_by,
        behind_by: response.data.behind_by,
        status: response.data.status,
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

  /**
   * Evaluate branch protection compliance for a pull request
   */
  async evaluateCompliance(params: {
    branch: string;
    sha: string;
    base_sha: string;
    pull_number?: number;
  }): Promise<BranchProtectionCompliance> {
    this.logger.info('Evaluating branch protection compliance', {
      branch: params.branch,
      sha: params.sha,
      pull_number: params.pull_number,
    });

    // Fetch branch protection rules
    const protection = await this.getBranchProtection(params.branch);

    // Initialize compliance result
    const compliance: BranchProtectionCompliance = {
      branch: params.branch,
      sha: params.sha,
      protection,
      protected: protection !== null,
      required_checks: [],
      actual_checks: [],
      check_runs: [],
      checks_passing: true,
      failing_checks: [],
      reviews_required: 0,
      reviews: [],
      reviews_satisfied: true,
      up_to_date: true,
      stale_commit: false,
      allows_auto_merge: true,
      allows_force_push: protection?.allow_force_pushes ?? true,
      compliant: true,
      blockers: [],
      evaluated_at: new Date().toISOString(),
    };

    let branchRef = params.branch;
    let evaluationSha = params.sha;
    let baseRef = params.base_sha;

    if (params.pull_number) {
      try {
        const prDetails = await this.getPullRequest(params.pull_number);
        if (prDetails.head?.ref) {
          branchRef = prDetails.head.ref;
        }
        if (prDetails.head?.sha) {
          evaluationSha = prDetails.head.sha;
        }
        if (prDetails.base?.ref) {
          baseRef = prDetails.base.ref;
        }

        compliance.branch = branchRef;
        compliance.sha = evaluationSha;
      } catch (error) {
        this.logger.warn('Failed to refresh PR references for branch protection evaluation', {
          pull_number: params.pull_number,
          error: serializeError(error),
        });
      }
    }

    if (!evaluationSha) {
      throw new BranchProtectionError(
        'Unable to determine commit SHA for branch protection evaluation',
        ErrorType.PERMANENT,
        undefined,
        undefined,
        'evaluateCompliance'
      );
    }

    compliance.branch = branchRef;
    compliance.sha = evaluationSha;

    // If branch is not protected, it's compliant by default
    if (!protection) {
      this.logger.info('Branch is not protected - compliant by default', {
        branch: params.branch,
      });
      return compliance;
    }

    // Fetch commit statuses and check runs
    const [statuses, checkRuns] = await Promise.all([
      this.getCommitStatuses(evaluationSha),
      this.getCheckRuns(evaluationSha),
    ]);

    compliance.actual_checks = statuses;
    compliance.check_runs = checkRuns;

    // Check required status checks
    if (protection.required_status_checks) {
      compliance.required_checks = protection.required_status_checks.contexts;

      const passingContexts = new Set(
        statuses.filter((s) => s.state === 'success').map((s) => s.context)
      );
      const passingCheckRuns = new Set(
        checkRuns.filter((c) => c.conclusion === 'success').map((c) => c.name)
      );

      for (const requiredContext of compliance.required_checks) {
        if (!passingContexts.has(requiredContext) && !passingCheckRuns.has(requiredContext)) {
          compliance.failing_checks.push(requiredContext);
          compliance.checks_passing = false;
          compliance.compliant = false;
          compliance.blockers.push(`Required status check missing or failing: ${requiredContext}`);
        }
      }

      // Check if branch needs to be up-to-date
      if (protection.required_status_checks.strict) {
        if (baseRef) {
          const comparison = await this.compareCommits(baseRef, evaluationSha);
          compliance.up_to_date = comparison.behind_by === 0;
          compliance.stale_commit = comparison.behind_by > 0;

          if (!compliance.up_to_date) {
            compliance.compliant = false;
            compliance.blockers.push(
              `Branch is ${comparison.behind_by} commit(s) behind base - must be up-to-date`
            );
          }
        } else {
          this.logger.warn('Strict status checks enabled but base reference is missing', {
            branch: branchRef,
            pull_number: params.pull_number,
          });
        }
      }
    }

    // Check required reviews
    if (protection.required_pull_request_reviews && params.pull_number) {
      compliance.reviews_required =
        protection.required_pull_request_reviews.required_approving_review_count;

      const reviews = await this.getPullRequestReviews(params.pull_number);
      compliance.reviews = reviews;

      // Count approved reviews (most recent per user)
      const latestReviews = new Map<number, PullRequestReview>();
      for (const review of reviews) {
        const existing = latestReviews.get(review.user.id);
        if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
          latestReviews.set(review.user.id, review);
        }
      }

      const approvedCount = Array.from(latestReviews.values()).filter(
        (r) => r.state === 'APPROVED'
      ).length;

      compliance.reviews_satisfied = approvedCount >= compliance.reviews_required;

      if (!compliance.reviews_satisfied) {
        compliance.compliant = false;
        compliance.blockers.push(
          `Requires ${compliance.reviews_required} approving review(s), has ${approvedCount}`
        );
      }
    }

    // Check if auto-merge is allowed (no force push restrictions)
    compliance.allows_auto_merge = !protection.allow_force_pushes && compliance.compliant;

    this.logger.info('Branch protection compliance evaluated', {
      branch: params.branch,
      sha: params.sha,
      compliant: compliance.compliant,
      blockers: compliance.blockers.length,
    });

    return compliance;
  }

  private readonly normalizeError = createErrorNormalizer(
    BranchProtectionError,
    'Branch protection'
  );

  /**
   * Create default logger
   */
  private createDefaultLogger(): LoggerInterface {
    return createLogger({
      component: 'branch-protection',
      minLevel: LogLevel.DEBUG,
      mirrorToStderr: true,
    });
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Branch protection error with error taxonomy
 */
export class BranchProtectionError extends Error {
  constructor(
    message: string,
    public readonly errorType: ErrorType,
    public readonly statusCode?: number,
    public readonly requestId?: string,
    public readonly operation?: string
  ) {
    super(message);
    this.name = 'BranchProtectionError';
    Object.setPrototypeOf(this, BranchProtectionError.prototype);
  }

  toJSON(): {
    name: string;
    message: string;
    errorType: ErrorType;
    statusCode?: number | undefined;
    requestId?: string | undefined;
    operation?: string | undefined;
  } {
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
 * Create branch protection adapter instance
 */
export function createBranchProtectionAdapter(
  config: BranchProtectionConfig
): BranchProtectionAdapter {
  return new BranchProtectionAdapter(config);
}
