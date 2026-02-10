/**
 * Linear Adapter
 *
 * Provides Linear integration via MCP server with issue fetch/snapshot,
 * optional updates, and graceful degradation when preview APIs differ.
 *
 * Key features:
 * - Rate-limit aware HTTP calls (1,500 requests/hour sliding window)
 * - GraphQL API integration via MCP server
 * - Snapshot caching with TTL and offline mode support
 * - Developer preview API feature flags
 * - Error taxonomy (transient, permanent, human action required)
 * - Logging with structured telemetry
 *
 * Implements:
 * - Section 2.1: Key Components - Linear Adapter
 * - IR-8..IR-11: Linear integration requirements
 * - ADR-6: Linear integration architecture
 * - FR-16: Issue snapshot caching
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { HttpClient, Provider, HttpError, ErrorType } from '../http/client';
import type { HttpClientConfig } from '../http/client';
import { RateLimitLedger } from '../../telemetry/rateLimitLedger';
import { serializeError, createErrorNormalizer } from '../../utils/errors';
import { createLogger, LogLevel, type LoggerInterface } from '../../telemetry/logger';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Linear adapter configuration
 */
export interface LinearAdapterConfig {
  /** Linear organization/team identifier */
  organization?: string;
  /** Linear API key */
  apiKey: string;
  /** Optional MCP endpoint URL */
  mcpEndpoint?: string;
  /** Run directory for caching and rate limit ledger */
  runDir?: string;
  /** Logger instance */
  logger?: LoggerInterface;
  /** HTTP client timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Enable developer preview features */
  enablePreviewFeatures?: boolean;
}

/**
 * Linear issue snapshot
 */
export interface LinearIssue {
  /** Issue ID */
  id: string;
  /** Issue identifier (e.g., ENG-123) */
  identifier: string;
  /** Issue title */
  title: string;
  /** Issue description */
  description: string | null;
  /** Issue state (triage, backlog, in_progress, done, canceled) */
  state: {
    id: string;
    name: string;
    type: string;
  };
  /** Issue priority (0-4, where 0 is no priority, 4 is urgent) */
  priority: number;
  /** Issue labels */
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  /** Assignee */
  assignee: {
    id: string;
    name: string;
    email: string;
  } | null;
  /** Team */
  team: {
    id: string;
    name: string;
    key: string;
  };
  /** Project */
  project: {
    id: string;
    name: string;
  } | null;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** URL to issue */
  url: string;
}

/**
 * Linear issue comment
 */
export interface LinearComment {
  /** Comment ID */
  id: string;
  /** Comment body */
  body: string;
  /** Author */
  user: {
    id: string;
    name: string;
    email: string;
  };
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Cached snapshot metadata
 */
export interface SnapshotMetadata {
  /** Issue identifier */
  issueId: string;
  /** Timestamp when snapshot was retrieved */
  retrieved_at: string;
  /** SHA-256 hash of snapshot content */
  hash: string;
  /** TTL in seconds (default: 3600) */
  ttl?: number;
  /** Whether this is from a preview API */
  isPreview?: boolean;
  /** Last error if snapshot is stale */
  last_error?: {
    timestamp: string;
    message: string;
    type: ErrorType;
  };
}

/**
 * Issue snapshot with metadata
 */
export interface IssueSnapshot {
  /** Issue data */
  issue: LinearIssue;
  /** Comments on the issue */
  comments: LinearComment[];
  /** Snapshot metadata */
  metadata: SnapshotMetadata;
}

/**
 * Update issue parameters
 */
export interface UpdateIssueParams {
  /** Issue ID */
  issueId: string;
  /** New title */
  title?: string;
  /** New description */
  description?: string;
  /** New state ID */
  stateId?: string;
  /** New priority */
  priority?: number;
  /** New assignee ID */
  assigneeId?: string;
}

/**
 * Post comment parameters
 */
export interface PostCommentParams {
  /** Issue ID */
  issueId: string;
  /** Comment body */
  body: string;
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const ISSUE_QUERY = `
  query GetIssue($issueId: String!) {
    issue(id: $issueId) {
      id
      identifier
      title
      description
      state {
        id
        name
        type
      }
      priority
      labels {
        nodes {
          id
          name
          color
        }
      }
      assignee {
        id
        name
        email
      }
      team {
        id
        name
        key
      }
      project {
        id
        name
      }
      createdAt
      updatedAt
      url
    }
  }
`;

const COMMENTS_QUERY = `
  query GetComments($issueId: String!) {
    issue(id: $issueId) {
      comments {
        nodes {
          id
          body
          user {
            id
            name
            email
          }
          createdAt
          updatedAt
        }
      }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue(
    $issueId: String!
    $title: String
    $description: String
    $stateId: String
    $priority: Int
    $assigneeId: String
  ) {
    issueUpdate(
      id: $issueId
      input: {
        title: $title
        description: $description
        stateId: $stateId
        priority: $priority
        assigneeId: $assigneeId
      }
    ) {
      success
      issue {
        id
        identifier
      }
    }
  }
`;

const POST_COMMENT_MUTATION = `
  mutation PostComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
      }
    }
  }
`;

// ============================================================================
// Constants
// ============================================================================

const LINEAR_API_URL = 'https://api.linear.app';
const GRAPHQL_ENDPOINT = '/graphql';
const RATE_LIMIT_PER_HOUR = 1500;
const DEFAULT_CACHE_TTL = 3600; // 1 hour in seconds
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour sliding window
const SNAPSHOT_DIR = 'inputs';

// ============================================================================
// Linear Adapter
// ============================================================================

/**
 * Linear adapter for issue operations via MCP
 */
export class LinearAdapter {
  private readonly client: HttpClient;
  private readonly logger: LoggerInterface;
  private readonly runDir: string | undefined;
  private readonly enablePreviewFeatures: boolean;
  private readonly rateLimitLedger?: RateLimitLedger;
  private readonly requestTimestamps: number[] = [];

  constructor(config: LinearAdapterConfig) {
    this.logger = config.logger ?? this.createDefaultLogger();
    this.runDir = config.runDir;
    this.enablePreviewFeatures = config.enablePreviewFeatures ?? false;

    const baseUrl = config.mcpEndpoint ?? LINEAR_API_URL;

    const clientConfig: HttpClientConfig = {
      baseUrl,
      provider: Provider.LINEAR,
      token: config.apiKey,
      maxRetries: config.maxRetries ?? 3,
      logger: this.logger,
      defaultHeaders: {
        'Content-Type': 'application/json',
      },
    };

    if (typeof config.timeout === 'number') {
      clientConfig.timeout = config.timeout;
    }

    if (config.runDir) {
      clientConfig.runDir = config.runDir;
      this.rateLimitLedger = new RateLimitLedger(config.runDir, Provider.LINEAR, this.logger);
    }

    this.client = new HttpClient(clientConfig);

    this.logger.info('LinearAdapter initialized', {
      baseUrl,
      previewFeatures: this.enablePreviewFeatures,
    });
  }

  /**
   * Fetch issue snapshot with caching support
   *
   * Implements offline mode: returns cached snapshot if available and API fails
   */
  async fetchIssueSnapshot(
    issueId: string,
    options?: {
      /** Force refresh from API even if cache is valid */
      forceRefresh?: boolean;
      /** Skip cache and only use API */
      noCache?: boolean;
    }
  ): Promise<IssueSnapshot> {
    this.logger.info('Fetching issue snapshot', {
      issueId,
      forceRefresh: options?.forceRefresh,
      noCache: options?.noCache,
    });

    // Check cache first unless noCache or forceRefresh
    if (this.runDir && !options?.noCache && !options?.forceRefresh) {
      const cachedSnapshot = await this.loadCachedSnapshot(issueId);
      if (cachedSnapshot && this.isSnapshotValid(cachedSnapshot.metadata)) {
        this.logger.info('Using cached snapshot', {
          issueId,
          age: this.getSnapshotAge(cachedSnapshot.metadata),
        });
        return cachedSnapshot;
      }
    }

    try {
      // Fetch fresh data from API
      const issue = await this.fetchIssue(issueId);
      const comments = await this.fetchComments(issueId);

      const snapshot: IssueSnapshot = {
        issue,
        comments,
        metadata: {
          issueId,
          retrieved_at: new Date().toISOString(),
          hash: this.computeSnapshotHash({ issue, comments }),
          ttl: DEFAULT_CACHE_TTL,
          isPreview: this.enablePreviewFeatures,
        },
      };

      // Cache snapshot if runDir is available
      if (this.runDir) {
        await this.saveSnapshot(snapshot);
      }

      this.logger.info('Issue snapshot fetched successfully', {
        issueId: issue.identifier,
        commentsCount: comments.length,
      });

      return snapshot;
    } catch (error) {
      this.logger.warn('API fetch failed, attempting to use cached snapshot', {
        issueId,
        error: serializeError(error),
      });

      // Try to use cached snapshot as fallback
      if (this.runDir && !options?.noCache) {
        const cachedSnapshot = await this.loadCachedSnapshot(issueId);
        if (cachedSnapshot) {
          // Mark snapshot with error
          cachedSnapshot.metadata.last_error = {
            timestamp: new Date().toISOString(),
            message: this.formatError(error),
            type: error instanceof HttpError ? error.type : ErrorType.TRANSIENT,
          };

          this.logger.warn('Using stale cached snapshot due to API failure', {
            issueId,
            cachedAt: cachedSnapshot.metadata.retrieved_at,
          });

          return cachedSnapshot;
        }
      }

      // No cache available, propagate error
      this.logger.error('Failed to fetch issue snapshot and no cache available', {
        issueId,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'fetchIssueSnapshot');
    }
  }

  /**
   * Fetch issue details from Linear API
   */
  async fetchIssue(issueId: string): Promise<LinearIssue> {
    this.logger.debug('Fetching issue from API', { issueId });

    try {
      const timestamp = await this.assertRateLimitHeadroom('fetchIssue');
      this.recordRequest(timestamp);
      const response = await this.client.post<{ data: { issue: LinearIssue } }>(
        GRAPHQL_ENDPOINT,
        {
          query: ISSUE_QUERY,
          variables: { issueId },
        },
        {
          metadata: {
            operation: 'fetchIssue',
            issueId,
          },
        }
      );

      if (!response.data.data?.issue) {
        throw new Error(`Issue ${issueId} not found`);
      }

      // Transform labels from GraphQL response
      const issue = response.data.data.issue;
      if (issue.labels && 'nodes' in issue.labels) {
        issue.labels = (issue.labels as { nodes: LinearIssue['labels'] }).nodes;
      }

      return issue;
    } catch (error) {
      this.logger.error('Failed to fetch issue', {
        issueId,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'fetchIssue');
    }
  }

  /**
   * Fetch comments for an issue
   */
  async fetchComments(issueId: string): Promise<LinearComment[]> {
    this.logger.debug('Fetching comments from API', { issueId });

    try {
      const timestamp = await this.assertRateLimitHeadroom('fetchComments');
      this.recordRequest(timestamp);
      const response = await this.client.post<{
        data: { issue: { comments: { nodes: LinearComment[] } } };
      }>(
        GRAPHQL_ENDPOINT,
        {
          query: COMMENTS_QUERY,
          variables: { issueId },
        },
        {
          metadata: {
            operation: 'fetchComments',
            issueId,
          },
        }
      );

      return response.data.data?.issue?.comments?.nodes ?? [];
    } catch (error) {
      this.logger.error('Failed to fetch comments', {
        issueId,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'fetchComments');
    }
  }

  /**
   * Update issue (only if preview features enabled)
   */
  async updateIssue(params: UpdateIssueParams): Promise<void> {
    if (!this.enablePreviewFeatures) {
      throw new LinearAdapterError(
        'Issue updates require preview features to be enabled',
        ErrorType.PERMANENT,
        undefined,
        undefined,
        'updateIssue'
      );
    }

    this.logger.info('Updating issue', {
      issueId: params.issueId,
      updates: Object.keys(params).filter((k) => k !== 'issueId'),
    });

    try {
      const variables: {
        issueId: string;
        title?: string;
        description?: string;
        stateId?: string;
        priority?: number;
        assigneeId?: string;
      } = { issueId: params.issueId };
      if (params.title !== undefined) variables.title = params.title;
      if (params.description !== undefined) variables.description = params.description;
      if (params.stateId !== undefined) variables.stateId = params.stateId;
      if (params.priority !== undefined) variables.priority = params.priority;
      if (params.assigneeId !== undefined) variables.assigneeId = params.assigneeId;

      const timestamp = await this.assertRateLimitHeadroom('updateIssue');
      this.recordRequest(timestamp);
      const response = await this.client.post<{
        data: { issueUpdate: { success: boolean } };
      }>(
        GRAPHQL_ENDPOINT,
        {
          query: UPDATE_ISSUE_MUTATION,
          variables,
        },
        {
          metadata: {
            operation: 'updateIssue',
            issueId: params.issueId,
          },
        }
      );

      if (!response.data.data?.issueUpdate?.success) {
        throw new Error('Issue update failed');
      }

      this.logger.info('Issue updated successfully', { issueId: params.issueId });
    } catch (error) {
      this.logger.error('Failed to update issue', {
        issueId: params.issueId,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'updateIssue');
    }
  }

  /**
   * Post comment to issue (only if preview features enabled)
   */
  async postComment(params: PostCommentParams): Promise<void> {
    if (!this.enablePreviewFeatures) {
      throw new LinearAdapterError(
        'Comment posting requires preview features to be enabled',
        ErrorType.PERMANENT,
        undefined,
        undefined,
        'postComment'
      );
    }

    this.logger.info('Posting comment', {
      issueId: params.issueId,
      bodyLength: params.body.length,
    });

    try {
      const timestamp = await this.assertRateLimitHeadroom('postComment');
      this.recordRequest(timestamp);
      const response = await this.client.post<{
        data: { commentCreate: { success: boolean } };
      }>(
        GRAPHQL_ENDPOINT,
        {
          query: POST_COMMENT_MUTATION,
          variables: {
            issueId: params.issueId,
            body: params.body,
          },
        },
        {
          metadata: {
            operation: 'postComment',
            issueId: params.issueId,
          },
        }
      );

      if (!response.data.data?.commentCreate?.success) {
        throw new Error('Comment creation failed');
      }

      this.logger.info('Comment posted successfully', { issueId: params.issueId });
    } catch (error) {
      this.logger.error('Failed to post comment', {
        issueId: params.issueId,
        error: serializeError(error),
      });
      throw this.normalizeError(error, 'postComment');
    }
  }

  /**
   * Load cached snapshot from run directory
   */
  private async loadCachedSnapshot(issueId: string): Promise<IssueSnapshot | null> {
    if (!this.runDir) {
      return null;
    }

    try {
      const snapshotPath = this.getSnapshotPath(issueId);
      const content = await fs.readFile(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(content) as IssueSnapshot;

      this.logger.debug('Loaded cached snapshot', {
        issueId,
        retrievedAt: snapshot.metadata.retrieved_at,
      });

      return snapshot;
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        this.logger.debug('No cached snapshot found', { issueId });
        return null;
      }

      this.logger.warn('Failed to load cached snapshot', {
        issueId,
        error: serializeError(error),
      });
      return null;
    }
  }

  /**
   * Save snapshot to run directory
   */
  private async saveSnapshot(snapshot: IssueSnapshot): Promise<void> {
    if (!this.runDir) {
      return;
    }

    try {
      const snapshotDir = path.join(this.runDir, SNAPSHOT_DIR);
      await fs.mkdir(snapshotDir, { recursive: true });

      const snapshotPath = this.getSnapshotPath(snapshot.metadata.issueId);
      const content = JSON.stringify(snapshot, null, 2);
      await fs.writeFile(snapshotPath, content, 'utf-8');

      this.logger.debug('Saved snapshot to cache', {
        issueId: snapshot.metadata.issueId,
        path: snapshotPath,
      });
    } catch (error) {
      this.logger.warn('Failed to save snapshot to cache', {
        issueId: snapshot.metadata.issueId,
        error: serializeError(error),
      });
    }
  }

  /**
   * Check if snapshot is still valid based on TTL
   */
  private isSnapshotValid(metadata: SnapshotMetadata): boolean {
    const ttl = metadata.ttl ?? DEFAULT_CACHE_TTL;
    const retrievedAt = new Date(metadata.retrieved_at).getTime();
    const now = Date.now();
    const age = (now - retrievedAt) / 1000; // Convert to seconds

    return age < ttl;
  }

  /**
   * Get snapshot age in seconds
   */
  private getSnapshotAge(metadata: SnapshotMetadata): number {
    const retrievedAt = new Date(metadata.retrieved_at).getTime();
    const now = Date.now();
    return Math.floor((now - retrievedAt) / 1000);
  }

  /**
   * Compute SHA-256 hash of snapshot content
   */
  private computeSnapshotHash(data: { issue: LinearIssue; comments: LinearComment[] }): string {
    const content = JSON.stringify(data);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get snapshot file path
   */
  private getSnapshotPath(issueId: string): string {
    const sanitized = issueId.replace(/[^a-zA-Z0-9-]/g, '_');
    return path.join(this.runDir!, SNAPSHOT_DIR, `linear_issue_${sanitized}.json`);
  }

  /**
   * Check if error is file not found
   */
  private isFileNotFoundError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }

  private readonly normalizeError = createErrorNormalizer(LinearAdapterError, 'Linear');

  /**
   * Format error message
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Ensure outgoing request stays within Linear's sliding window budget
   */
  private async assertRateLimitHeadroom(operation: string): Promise<number> {
    const now = Date.now();
    this.trimRequestWindow(now);

    if (this.rateLimitLedger) {
      if (await this.rateLimitLedger.isInCooldown()) {
        this.logger.warn('Linear provider is in cooldown; blocking request', {
          operation,
        });
        throw new LinearAdapterError(
          'Linear provider is in cooldown after recent rate-limit responses. Try again once cooldown expires.',
          ErrorType.TRANSIENT,
          undefined,
          undefined,
          operation
        );
      }

      if (await this.rateLimitLedger.requiresManualAcknowledgement()) {
        this.logger.warn('Linear provider requires manual acknowledgement', {
          operation,
        });
        throw new LinearAdapterError(
          'Linear rate limit requires operator acknowledgement after repeated 429 responses. Clear cooldown to continue.',
          ErrorType.HUMAN_ACTION_REQUIRED,
          undefined,
          undefined,
          operation
        );
      }
    }

    if (this.requestTimestamps.length >= RATE_LIMIT_PER_HOUR) {
      const oldestRequest = this.requestTimestamps[0];
      const retryAt = oldestRequest + RATE_LIMIT_WINDOW_MS;
      const waitMs = Math.max(0, retryAt - now);
      const waitMinutes = Math.max(1, Math.ceil(waitMs / 60000));

      this.logger.warn('Linear request blocked to respect hourly budget', {
        operation,
        waitMs,
      });

      throw new LinearAdapterError(
        `Linear ${operation} blocked to respect the 1,500 requests/hour budget. Try again in approximately ${waitMinutes} minute(s).`,
        ErrorType.TRANSIENT,
        undefined,
        undefined,
        operation
      );
    }

    return now;
  }

  /**
   * Record request timestamp for sliding window tracking
   */
  private recordRequest(timestamp: number): void {
    this.requestTimestamps.push(timestamp);
  }

  /**
   * Remove timestamps that are outside the sliding window
   */
  private trimRequestWindow(now: number): void {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < windowStart) {
      this.requestTimestamps.shift();
    }
  }

  /**
   * Create default logger
   */
  private createDefaultLogger(): LoggerInterface {
    return createLogger({
      component: 'linear-adapter',
      minLevel: LogLevel.DEBUG,
      mirrorToStderr: true,
    });
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Linear adapter error with error taxonomy
 */
export class LinearAdapterError extends Error {
  constructor(
    message: string,
    public readonly errorType: ErrorType,
    public readonly statusCode?: number,
    public readonly requestId?: string,
    public readonly operation?: string
  ) {
    super(message);
    this.name = 'LinearAdapterError';
    Object.setPrototypeOf(this, LinearAdapterError.prototype);
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
 * Create Linear adapter instance
 */
export function createLinearAdapter(config: LinearAdapterConfig): LinearAdapter {
  return new LinearAdapter(config);
}
