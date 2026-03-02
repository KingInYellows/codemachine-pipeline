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
    this.logger =
      config.logger ??
      createLogger({ component: 'github-adapter', minLevel: LogLevel.DEBUG, mirrorToStderr: true });

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
    try {
      const response = await this.client.get<RepositoryInfo>(`/repos/${this.owner}/${this.repo}`, {
        metadata: { operation: 'getRepository' },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch repository metadata', {
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getRepository');
    }
  }

  /**
   * Create a new branch from a specific commit
   */
  async createBranch(params: CreateBranchParams): Promise<GitReference> {
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

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create branch', {
        branch: params.branch,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'createBranch');
    }
  }

  /**
   * Get a specific branch reference
   */
  async getBranch(branch: string): Promise<GitReference> {
    try {
      const response = await this.client.get<GitReference>(
        `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
        {
          metadata: { operation: 'getBranch', branch },
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch branch reference', {
        branch,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getBranch');
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequest> {
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

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create pull request', {
        title: params.title,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'createPullRequest');
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(pull_number: number): Promise<PullRequest> {
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
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'getPullRequest');
    }
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(params: RequestReviewersParams): Promise<PullRequest> {
    try {
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
    } catch (error) {
      this.logger.error('Failed to request reviewers', {
        pull_number: params.pull_number,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'requestReviewers');
    }
  }

  /**
   * Get status checks for a commit
   */
  async getStatusChecks(sha: string): Promise<StatusCheck[]> {
    try {
      // GitHub REST API v3 uses check-suites endpoint
      const response = await this.client.get<{ check_suites: StatusCheck[] }>(
        `/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(sha)}/check-suites`,
        {
          metadata: { operation: 'getStatusChecks', sha },
        }
      );

      return response.data.check_suites ?? [];
    } catch (error) {
      this.logger.error('Failed to fetch status checks', {
        sha,
        error: serializeError(error),
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
        (check) => check.conclusion === 'failure' || check.conclusion === 'cancelled'
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
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'isPullRequestReadyToMerge');
    }
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(params: MergePullRequestParams): Promise<MergeResult> {
    try {
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
    } catch (error) {
      this.logger.error('Failed to merge pull request', {
        pull_number: params.pull_number,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'mergePullRequest');
    }
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
    try {
      const prNodeId = await this.getPRNodeId(pull_number);

      await this.executeGraphQLMutation(
        ENABLE_AUTO_MERGE_MUTATION,
        { pullRequestId: prNodeId, mergeMethod: merge_method ?? 'MERGE' },
        'enableAutoMerge',
        pull_number
      );
    } catch (error) {
      this.logger.error('Failed to enable auto-merge', {
        pull_number,
        error: serializeError(error),
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
    try {
      const prNodeId = await this.getPRNodeId(pull_number);

      await this.executeGraphQLMutation(
        DISABLE_AUTO_MERGE_MUTATION,
        { pullRequestId: prNodeId },
        'disableAutoMerge',
        pull_number
      );
      this.logger.info('Auto-merge disabled successfully', { pull_number });
    } catch (error) {
      this.logger.error('Failed to disable auto-merge', {
        pull_number,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'disableAutoMerge');
    }
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
    try {
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
    } catch (error) {
      this.logger.error('Failed to trigger workflow dispatch', {
        workflow_id: params.workflow_id,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'triggerWorkflow');
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
