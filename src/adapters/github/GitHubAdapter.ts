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
 */

import { HttpClient, Provider } from '../http/client';
import type { HttpClientConfig } from '../http/client';
import { serializeError, createErrorNormalizer, AdapterError } from '../../utils/errors';
import { ErrorType } from '../../core/sharedTypes';
import { createLogger, LogLevel, type LoggerInterface } from '../../telemetry/logger';
import type {
  GitHubAdapterConfig,
  RepositoryInfo,
  GitReference,
  CreatePullRequestParams,
  PullRequest,
  RequestReviewersParams,
  StatusCheck,
  MergePullRequestParams,
  MergeResult,
  WorkflowDispatchParams,
  CreateBranchParams,
} from './GitHubAdapterTypes.js';

// Re-export types for backward compatibility
export type {
  GitHubAdapterConfig,
  RepositoryInfo,
  GitReference,
  CreatePullRequestParams,
  PullRequest,
  RequestReviewersParams,
  StatusCheck,
  MergePullRequestParams,
  MergeResult,
  WorkflowDispatchParams,
  CreateBranchParams,
} from './GitHubAdapterTypes.js';

const ENABLE_AUTO_MERGE_MUTATION = `
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
` as const;

const DISABLE_AUTO_MERGE_MUTATION = `
  mutation DisableAutoMerge($pullRequestId: ID!) {
    disablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId
    }) {
      pullRequest {
        id
      }
    }
  }
` as const;

/** GitHub usernames and organizations use alphanumerics with single hyphen separators. */
const GITHUB_OWNER_RE = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
/** Repository names allow dot-prefixed repos like `.github` but must remain a single safe path segment. */
const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Configuration for the {@link GitHubAdapter.withLogging} wrapper.
 *
 * Controls optional entry, success, and error logging around an async
 * operation while normalizing thrown errors through the adapter's
 * error taxonomy.
 */
interface WithLoggingConfig<T> {
  /** Method name forwarded to {@link createErrorNormalizer} on failure */
  operation: string;
  /** Message logged at `error` level when the wrapped function rejects */
  errorMessage: string;
  /** Extra context merged into the error log entry */
  errorContext?: Record<string, unknown>;
  /** If provided, logged at `info` level *before* `fn()` executes */
  entryMessage?: string;
  /** Extra context merged into the entry log entry */
  entryContext?: Record<string, unknown>;
  /** If provided, logged at `info` level *after* `fn()` resolves */
  successMessage?: string;
  /** Derives extra context from the resolved value for the success log */
  successContext?: (result: T) => Record<string, unknown>;
}

/**
 * GitHub adapter for repository operations
 */
export class GitHubAdapter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly client: HttpClient;
  private readonly logger: LoggerInterface;

  constructor(config: GitHubAdapterConfig) {
    this.owner = GitHubAdapter.validateName(config.owner, 'owner');
    this.repo = GitHubAdapter.validateName(config.repo, 'repo');
    this.logger =
      config.logger ??
      createLogger({ component: 'github-adapter', minLevel: LogLevel.DEBUG, mirrorToStderr: true });

    const baseUrl = config.baseUrl ?? 'https://api.github.com';

    const clientConfig: HttpClientConfig = {
      baseUrl,
      provider: Provider.GITHUB,
      token: config.token,
      ...(config.apiVersion !== undefined ? { apiVersion: config.apiVersion } : {}),
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

  private static validateName(value: string, label: 'owner' | 'repo'): string {
    if (!value) {
      throw new GitHubAdapterError(
        `Invalid GitHub ${label}: "${value}" — cannot be empty`,
        ErrorType.PERMANENT
      );
    }

    if (label === 'owner') {
      if (!GITHUB_OWNER_RE.test(value)) {
        throw new GitHubAdapterError(
          `Invalid GitHub owner: "${value}" — must contain only alphanumeric characters or single hyphens`,
          ErrorType.PERMANENT
        );
      }
      return value;
    }

    if (!GITHUB_REPO_RE.test(value) || value === '.' || value === '..') {
      throw new GitHubAdapterError(
        `Invalid GitHub repo: "${value}" — must be a single safe path segment`,
        ErrorType.PERMANENT
      );
    }

    if (value.endsWith('.') || value.endsWith('.git')) {
      throw new GitHubAdapterError(
        `Invalid GitHub repo: "${value}" — cannot end with "." or ".git"`,
        ErrorType.PERMANENT
      );
    }

    return value;
  }

  private static validatePullNumber(value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new GitHubAdapterError(
        `Invalid pull request number: ${String(value)} — must be a positive integer`,
        ErrorType.PERMANENT
      );
    }
  }

  /**
   * Get repository metadata
   */
  async getRepository(): Promise<RepositoryInfo> {
    return this.withLogging(
      {
        operation: 'getRepository',
        errorMessage: 'Failed to fetch repository metadata',
        entryMessage: 'Fetching repository metadata',
        entryContext: { owner: this.owner, repo: this.repo },
      },
      async () => {
        const response = await this.client.get<RepositoryInfo>(
          `/repos/${this.owner}/${this.repo}`,
          {
            metadata: { operation: 'getRepository' },
          }
        );

        return response.data;
      }
    );
  }

  /**
   * Create a new branch from a specific commit
   */
  async createBranch(params: CreateBranchParams): Promise<GitReference> {
    return this.withLogging(
      {
        operation: 'createBranch',
        errorMessage: 'Failed to create branch',
        errorContext: { branch: params.branch },
      },
      async () => {
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

        return response.data;
      }
    );
  }

  /**
   * Get a specific branch reference
   */
  async getBranch(branch: string): Promise<GitReference> {
    return this.withLogging(
      {
        operation: 'getBranch',
        errorMessage: 'Failed to fetch branch reference',
        errorContext: { branch },
      },
      async () => {
        const response = await this.client.get<GitReference>(
          `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
          {
            metadata: { operation: 'getBranch', branch },
          }
        );

        return response.data;
      }
    );
  }

  /**
   * Create a pull request
   */
  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequest> {
    return this.withLogging(
      {
        operation: 'createPullRequest',
        errorMessage: 'Failed to create pull request',
        errorContext: { title: params.title },
        successMessage: 'Pull request created successfully',
        successContext: (result) => ({
          pr_number: result.number,
          html_url: result.html_url,
        }),
      },
      async () => {
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

        return response.data;
      }
    );
  }

  /**
   * Get pull request details
   */
  async getPullRequest(pull_number: number): Promise<PullRequest> {
    GitHubAdapter.validatePullNumber(pull_number);
    return this.withLogging(
      {
        operation: 'getPullRequest',
        errorMessage: 'Failed to fetch pull request',
        errorContext: { pull_number },
      },
      async () => {
        const response = await this.client.get<PullRequest>(
          `/repos/${this.owner}/${this.repo}/pulls/${pull_number}`,
          {
            metadata: { operation: 'getPullRequest', pull_number },
          }
        );

        return response.data;
      }
    );
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(params: RequestReviewersParams): Promise<PullRequest> {
    GitHubAdapter.validatePullNumber(params.pull_number);
    return this.withLogging(
      {
        operation: 'requestReviewers',
        errorMessage: 'Failed to request reviewers',
        errorContext: { pull_number: params.pull_number },
        successMessage: 'Reviewers requested successfully',
        successContext: () => ({ pull_number: params.pull_number }),
      },
      async () => {
        const payload: { reviewers?: string[]; team_reviewers?: string[] } = {};
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

        return response.data;
      }
    );
  }

  /**
   * Get status checks for a commit
   */
  async getStatusChecks(sha: string): Promise<StatusCheck[]> {
    return this.withLogging(
      {
        operation: 'getStatusChecks',
        errorMessage: 'Failed to fetch status checks',
        errorContext: { sha },
      },
      async () => {
        // GitHub REST API v3 uses check-suites endpoint
        const response = await this.client.get<{ check_suites: StatusCheck[] }>(
          `/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(sha)}/check-suites`,
          {
            metadata: { operation: 'getStatusChecks', sha },
          }
        );

        return response.data.check_suites ?? [];
      }
    );
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
    GitHubAdapter.validatePullNumber(pull_number);
    return this.withLogging(
      {
        operation: 'isPullRequestReadyToMerge',
        errorMessage: 'Failed to check merge readiness',
        errorContext: { pull_number },
        successMessage: 'Merge readiness checked',
        successContext: (result) => ({
          pull_number,
          ready: result.ready,
          reasons: result.reasons,
        }),
      },
      async () => {
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
          (check) => check.conclusion === 'failure' || check.conclusion === 'cancelled'
        );

        if (failedChecks.length > 0) {
          reasons.push(`${failedChecks.length} status check(s) failed`);
        }

        const ready = reasons.length === 0;

        return { ready, reasons };
      }
    );
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(params: MergePullRequestParams): Promise<MergeResult> {
    GitHubAdapter.validatePullNumber(params.pull_number);
    return this.withLogging(
      {
        operation: 'mergePullRequest',
        errorMessage: 'Failed to merge pull request',
        errorContext: { pull_number: params.pull_number },
        successMessage: 'Pull request merged successfully',
        successContext: (result) => ({
          pull_number: params.pull_number,
          sha: result.sha,
        }),
      },
      async () => {
        const payload: {
          merge_method: string;
          commit_title?: string;
          commit_message?: string;
          sha?: string;
        } = {
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

        return response.data;
      }
    );
  }

  /**
   * Enable auto-merge for a pull request using GraphQL mutation
   *
   * Note: This uses the GraphQL API wrapped in REST-like envelope
   */
  async enableAutoMerge(
    pull_number: number,
    merge_method?: 'MERGE' | 'SQUASH' | 'REBASE'
  ): Promise<void> {
    GitHubAdapter.validatePullNumber(pull_number);
    return this.withLogging(
      {
        operation: 'enableAutoMerge',
        errorMessage: 'Failed to enable auto-merge',
        errorContext: { pull_number },
      },
      async () => {
        const prNodeId = await this.getPRNodeId(pull_number);

        await this.executeGraphQLMutation(
          ENABLE_AUTO_MERGE_MUTATION,
          { pullRequestId: prNodeId, mergeMethod: merge_method ?? 'MERGE' },
          'enableAutoMerge',
          pull_number
        );
      }
    );
  }

  /**
   * Disable auto-merge for a pull request using GraphQL mutation
   *
   * Note: This uses the GraphQL API wrapped in REST-like envelope
   */
  async disableAutoMerge(pull_number: number): Promise<void> {
    GitHubAdapter.validatePullNumber(pull_number);
    return this.withLogging(
      {
        operation: 'disableAutoMerge',
        errorMessage: 'Failed to disable auto-merge',
        errorContext: { pull_number },
        successMessage: 'Auto-merge disabled successfully',
        successContext: () => ({ pull_number }),
      },
      async () => {
        const prNodeId = await this.getPRNodeId(pull_number);

        await this.executeGraphQLMutation(
          DISABLE_AUTO_MERGE_MUTATION,
          { pullRequestId: prNodeId },
          'disableAutoMerge',
          pull_number
        );
      }
    );
  }

  private async getPRNodeId(pull_number: number): Promise<string> {
    const pr = await this.getPullRequest(pull_number);
    const prNodeId = (pr as unknown as { node_id: string }).node_id;
    if (!prNodeId) {
      throw new Error('PR node_id not available');
    }
    return prNodeId;
  }

  private async executeGraphQLMutation(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: GraphQL mutation variables are open-ended by nature
    variables: Record<string, unknown>,
    operation: string,
    pull_number: number
  ): Promise<void> {
    await this.client.post(
      '/graphql',
      { query, variables },
      { metadata: { operation, pull_number } }
    );
  }

  /**
   * Trigger a workflow dispatch
   */
  async triggerWorkflow(params: WorkflowDispatchParams): Promise<void> {
    return this.withLogging(
      {
        operation: 'triggerWorkflow',
        errorMessage: 'Failed to trigger workflow dispatch',
        errorContext: { workflow_id: params.workflow_id },
        successMessage: 'Workflow dispatch triggered successfully',
        successContext: () => ({
          workflow_id: params.workflow_id,
          ref: params.ref,
        }),
      },
      async () => {
        await this.client.post(
          `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(params.workflow_id)}/dispatches`,
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
      }
    );
  }

  /**
   * Execute an async operation with structured entry, success, and error
   * logging.  Catches any thrown error, logs it with the provided context,
   * normalizes it through the adapter error taxonomy, and re-throws.
   */
  private async withLogging<T>(config: WithLoggingConfig<T>, fn: () => Promise<T>): Promise<T> {
    if (config.entryMessage) {
      this.logger.info(config.entryMessage, config.entryContext ?? {});
    }

    try {
      const result = await fn();

      if (config.successMessage) {
        const ctx = config.successContext ? config.successContext(result) : {};
        this.logger.info(config.successMessage, ctx);
      }

      return result;
    } catch (error) {
      this.logger.error(config.errorMessage, {
        ...(config.errorContext ?? {}),
        error: serializeError(error),
      });
      throw this.normalizeError(error, config.operation);
    }
  }

  private readonly normalizeError = createErrorNormalizer(GitHubAdapterError, 'GitHub');
}

/**
 * Backwards-compatible factory helper retained for external/example callers.
 */
export function createGitHubAdapter(config: GitHubAdapterConfig): GitHubAdapter {
  return new GitHubAdapter(config);
}

/**
 * GitHub adapter error with error taxonomy
 */
export class GitHubAdapterError extends AdapterError {}
