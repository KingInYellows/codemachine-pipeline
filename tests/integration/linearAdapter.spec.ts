import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  LinearAdapter,
  LinearAdapterError,
  type LinearIssue,
  type LinearComment,
  type IssueSnapshot,
} from '../../src/adapters/linear/LinearAdapter';
import { ErrorType, HttpError } from '../../src/adapters/http/client';
import type { HttpClient } from '../../src/adapters/http/client';
import type { RateLimitLedger } from '../../src/telemetry/rateLimitLedger';

/**
 * Linear Adapter Integration Tests
 *
 * These tests verify the Linear adapter implementation by:
 * 1. Using mocked HTTP responses to avoid hitting live Linear API
 * 2. Testing correct GraphQL query construction
 * 3. Verifying snapshot caching and TTL behavior
 * 4. Asserting error handling and offline mode
 * 5. Validating rate limit integration
 * 6. Testing developer preview feature gating
 *
 * Test fixtures are deterministic to support reproducible test runs.
 */

// Mock HTTP client responses
type MockFunction = ReturnType<typeof vi.fn>;
interface MockHttpClient {
  get: MockFunction;
  post: MockFunction;
  put: MockFunction;
  patch: MockFunction;
  delete: MockFunction;
}

const mockHttpClient: MockHttpClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

// Test fixtures
const MOCK_LINEAR_ISSUE: LinearIssue = {
  id: 'a1b2c3d4-e5f6-7890-abcd-1234567890ab',
  identifier: 'ENG-123',
  title: 'Add Linear integration via MCP',
  description: 'Implement MCP-based Linear adapter with caching and offline support',
  state: {
    id: 'state-uuid-1',
    name: 'In Progress',
    type: 'started',
  },
  priority: 2,
  labels: [
    {
      id: 'label-uuid-1',
      name: 'backend',
      color: '#0066FF',
    },
    {
      id: 'label-uuid-2',
      name: 'integration',
      color: '#00CC66',
    },
  ],
  assignee: {
    id: 'user-uuid-1',
    name: 'John Doe',
    email: 'john@example.com',
  },
  team: {
    id: 'team-uuid-1',
    name: 'Engineering',
    key: 'ENG',
  },
  project: {
    id: 'project-uuid-1',
    name: 'Q1 2024 Features',
  },
  createdAt: '2024-01-01T10:00:00Z',
  updatedAt: '2024-01-15T12:00:00Z',
  url: 'https://linear.app/acme/issue/ENG-123',
};

const MOCK_LINEAR_COMMENTS: LinearComment[] = [
  {
    id: 'comment-uuid-1',
    body: 'This is the first comment on the issue',
    user: {
      id: 'user-uuid-2',
      name: 'Jane Smith',
      email: 'jane@example.com',
    },
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-10T09:00:00Z',
  },
  {
    id: 'comment-uuid-2',
    body: 'Follow-up comment with additional context',
    user: {
      id: 'user-uuid-1',
      name: 'John Doe',
      email: 'john@example.com',
    },
    createdAt: '2024-01-12T14:30:00Z',
    updatedAt: '2024-01-12T14:30:00Z',
  },
];

const MOCK_ISSUE_RESPONSE = {
  data: {
    issue: MOCK_LINEAR_ISSUE,
  },
};

const MOCK_COMMENTS_RESPONSE = {
  data: {
    issue: {
      comments: {
        nodes: MOCK_LINEAR_COMMENTS,
      },
    },
  },
};

const MOCK_UPDATE_RESPONSE = {
  data: {
    issueUpdate: {
      success: true,
      issue: {
        id: MOCK_LINEAR_ISSUE.id,
        identifier: MOCK_LINEAR_ISSUE.identifier,
      },
    },
  },
};

const MOCK_COMMENT_POST_RESPONSE = {
  data: {
    commentCreate: {
      success: true,
      comment: {
        id: 'comment-uuid-new',
      },
    },
  },
};

describe('LinearAdapter Integration Tests', () => {
  let adapter: LinearAdapter;
  let runDir: string;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create temporary run directory for snapshot caching
    runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linear-adapter-test-'));

    // Create mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create adapter instance
    adapter = new LinearAdapter({
      apiKey: 'lin_api_test_mock_key',
      runDir,
      logger: mockLogger,
    });

    // Inject mock HTTP client
    Reflect.set(
      adapter as unknown as { client: HttpClient },
      'client',
      mockHttpClient as unknown as HttpClient
    );

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(runDir, { recursive: true, force: true });
  });

  describe('Issue Fetch Operations', () => {
    it('should fetch issue with correct GraphQL query', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_ISSUE_RESPONSE,
        requestId: 'req_test',
      });

      const result = await adapter.fetchIssue(MOCK_LINEAR_ISSUE.id);

      expect(result).toEqual(MOCK_LINEAR_ISSUE);
      expect(mockHttpClient.post).toHaveBeenCalled();
      const [path, body, options] = mockHttpClient.post.mock.calls[0] as [
        string,
        { query: string; variables: { issueId: string } },
        { metadata?: Record<string, unknown> },
      ];
      expect(path).toBe('/graphql');
      expect(body.query).toContain('query GetIssue');
      expect(body.variables).toEqual({ issueId: MOCK_LINEAR_ISSUE.id });
      expect(options.metadata).toMatchObject({
        operation: 'fetchIssue',
        issueId: MOCK_LINEAR_ISSUE.id,
      });
    });

    it('should fetch comments with correct GraphQL query', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_COMMENTS_RESPONSE,
        requestId: 'req_test',
      });

      const result = await adapter.fetchComments(MOCK_LINEAR_ISSUE.id);

      expect(result).toEqual(MOCK_LINEAR_COMMENTS);
      expect(mockHttpClient.post).toHaveBeenCalled();
      const [, commentsBody, commentsOptions] = mockHttpClient.post.mock.calls[0] as [
        string,
        { query: string; variables: { issueId: string } },
        { metadata?: Record<string, unknown> },
      ];
      expect(commentsBody.query).toContain('query GetComments');
      expect(commentsBody.variables).toEqual({ issueId: MOCK_LINEAR_ISSUE.id });
      expect(commentsOptions.metadata).toMatchObject({
        operation: 'fetchComments',
        issueId: MOCK_LINEAR_ISSUE.id,
      });
    });

    it('should handle issue not found error (404)', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: { data: { issue: null } },
        requestId: 'req_test',
      });

      await expect(adapter.fetchIssue('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Issue 00000000-0000-0000-0000-000000000000 not found'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch issue', expect.any(Object));
    });

    it('should reject malformed issue IDs before fetching issue', async () => {
      await expect(adapter.fetchIssue('---')).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Failed to fetch issue',
        expect.any(Object)
      );
    });

    it('should reject malformed issue IDs before fetching comments', async () => {
      await expect(adapter.fetchComments('.')).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Failed to fetch comments',
        expect.any(Object)
      );
    });

    it('should allow UUID-format opaque issue IDs', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_ISSUE_RESPONSE,
        requestId: 'req_test',
      });

      const opaqueId = 'deadbeef-1234-5678-abcd-ef0123456789';
      const result = await adapter.fetchIssue(opaqueId);

      expect(result).toEqual(MOCK_LINEAR_ISSUE);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/graphql',
        expect.objectContaining({
          variables: { issueId: opaqueId },
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            issueId: opaqueId,
            operation: 'fetchIssue',
          }),
        })
      );
    });

    it('should reject single-segment opaque issue IDs', async () => {
      await expect(adapter.fetchIssue('abc123')).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });
  });

  describe('Snapshot Caching', () => {
    it('should fetch and cache snapshot on first request', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      expect(snapshot.issue).toEqual(MOCK_LINEAR_ISSUE);
      expect(snapshot.comments).toEqual(MOCK_LINEAR_COMMENTS);
      expect(snapshot.metadata.issueId).toBe(MOCK_LINEAR_ISSUE.id);
      expect(typeof snapshot.metadata.retrieved_at).toBe('string');
      expect(typeof snapshot.metadata.hash).toBe('string');
      expect(snapshot.metadata.ttl).toBe(3600);
      expect(snapshot.metadata.isPreview).toBe(false);

      // Verify snapshot was saved to cache
      const snapshotPath = path.join(runDir, 'inputs', `linear_issue_${MOCK_LINEAR_ISSUE.id}.json`);
      const cachedContent = await fs.readFile(snapshotPath, 'utf-8');
      const cachedSnapshot = JSON.parse(cachedContent) as IssueSnapshot;
      expect(cachedSnapshot.issue.identifier).toBe('ENG-123');
    });

    it('should use cached snapshot when valid TTL', async () => {
      // First request - populates cache
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      // Reset mock call count
      mockHttpClient.post.mockClear();

      // Second request - should use cache
      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      expect(snapshot.issue.identifier).toBe('ENG-123');
      // Should not have called API again
      expect(mockHttpClient.post).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using cached snapshot',
        expect.objectContaining({ issueId: MOCK_LINEAR_ISSUE.id })
      );
    });

    it('should bypass cache when forceRefresh is true', async () => {
      // First request - populates cache
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      // Reset mocks
      mockHttpClient.post.mockClear();
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_3',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_4',
        });

      // Second request with forceRefresh
      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        forceRefresh: true,
      });

      expect(snapshot.issue.identifier).toBe('ENG-123');
      // Should have called API again
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
    });

    it('should skip cache when noCache is true', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        noCache: true,
      });

      expect(snapshot.issue.identifier).toBe('ENG-123');
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Offline Mode & Error Handling', () => {
    it('should fallback to cache when API fails (transient error)', async () => {
      // First request - populate cache
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      // Reset and simulate network failure
      mockHttpClient.post.mockClear();
      const networkError = new HttpError(
        'Network connection failed',
        ErrorType.TRANSIENT,
        undefined,
        undefined,
        undefined,
        'req_test_3',
        true
      );
      mockHttpClient.post.mockRejectedValue(networkError);

      // Second request should use cached snapshot
      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        forceRefresh: true,
      });

      expect(snapshot.issue.identifier).toBe('ENG-123');
      expect(snapshot.metadata.last_error).toBeDefined();
      expect(snapshot.metadata.last_error?.type).toBe(ErrorType.TRANSIENT);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'API fetch failed, attempting to use cached snapshot',
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Using stale cached snapshot due to API failure',
        expect.any(Object)
      );
    });

    it('should preserve permanent error types when returning a stale cached snapshot', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      mockHttpClient.post.mockClear();
      mockHttpClient.post.mockRejectedValue(
        new LinearAdapterError(
          'Issue not found',
          ErrorType.PERMANENT,
          404,
          'req_test_3',
          'fetchIssue'
        )
      );

      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        forceRefresh: true,
      });

      expect(snapshot.issue.identifier).toBe('ENG-123');
      expect(snapshot.metadata.last_error?.type).toBe(ErrorType.PERMANENT);
    });

    it('should throw error when API fails and no cache exists', async () => {
      const networkError = new HttpError(
        'Service temporarily unavailable',
        ErrorType.TRANSIENT,
        503,
        {},
        'Service unavailable',
        'req_test',
        true
      );

      mockHttpClient.post.mockRejectedValue(networkError);

      await expect(adapter.fetchIssueSnapshot('11111111-1111-1111-1111-111111111111')).rejects.toThrow(LinearAdapterError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch issue snapshot and no cache available',
        expect.any(Object)
      );
    });

    it('should handle rate limit exceeded (429) as transient', async () => {
      const rateLimitError = new HttpError(
        'Rate limit exceeded',
        ErrorType.TRANSIENT,
        429,
        { 'retry-after': '60' },
        'Rate limit response',
        'req_test',
        true
      );

      mockHttpClient.post.mockRejectedValue(rateLimitError);

      try {
        await adapter.fetchIssue('22222222-2222-2222-2222-222222222222');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LinearAdapterError);
        const linearError = error as LinearAdapterError;
        expect(linearError.errorType).toBe(ErrorType.TRANSIENT);
        expect(linearError.statusCode).toBe(429);
      }
    });

    it('should handle authentication failure (401) as human action required', async () => {
      const authError = new HttpError(
        'Authentication failed',
        ErrorType.HUMAN_ACTION_REQUIRED,
        401,
        {},
        'Invalid token',
        'req_test',
        false
      );

      mockHttpClient.post.mockRejectedValue(authError);

      try {
        await adapter.fetchIssue('22222222-2222-2222-2222-222222222222');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LinearAdapterError);
        const linearError = error as LinearAdapterError;
        expect(linearError.errorType).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
        expect(linearError.statusCode).toBe(401);
      }
    });
  });

  describe('Rate Limit Enforcement', () => {
    it('should block requests when sliding window is exhausted', async () => {
      const timestamps = (adapter as unknown as { requestTimestamps: number[] }).requestTimestamps;
      timestamps.length = 0;
      const now = Date.now();
      for (let i = 0; i < 1500; i++) {
        timestamps.push(now - 1000);
      }

      await expect(adapter.fetchIssue(MOCK_LINEAR_ISSUE.id)).rejects.toThrow(
        'Linear fetchIssue blocked to respect the 1,500 requests/hour budget'
      );
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it('should block when ledger indicates cooldown', async () => {
      const isInCooldown = vi.fn().mockResolvedValue(true);
      const requiresManualAcknowledgement = vi.fn().mockResolvedValue(false);
      const ledgerMock = {
        isInCooldown,
        requiresManualAcknowledgement,
      } as unknown as RateLimitLedger;

      Reflect.set(
        adapter as unknown as { rateLimitLedger?: RateLimitLedger },
        'rateLimitLedger',
        ledgerMock
      );

      await expect(adapter.fetchIssue(MOCK_LINEAR_ISSUE.id)).rejects.toThrow(
        'Linear provider is in cooldown after recent rate-limit responses'
      );
      expect(isInCooldown).toHaveBeenCalled();
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it('should require manual acknowledgement after repeated 429s', async () => {
      const isInCooldown = vi.fn().mockResolvedValue(false);
      const requiresManualAcknowledgement = vi.fn().mockResolvedValue(true);
      const ledgerMock = {
        isInCooldown,
        requiresManualAcknowledgement,
      } as unknown as RateLimitLedger;

      Reflect.set(
        adapter as unknown as { rateLimitLedger?: RateLimitLedger },
        'rateLimitLedger',
        ledgerMock
      );

      await expect(adapter.fetchIssue(MOCK_LINEAR_ISSUE.id)).rejects.toMatchObject({
        errorType: ErrorType.HUMAN_ACTION_REQUIRED,
      });
      expect(requiresManualAcknowledgement).toHaveBeenCalled();
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });
  });

  describe('Developer Preview Features', () => {
    let previewAdapter: LinearAdapter;

    beforeEach(() => {
      previewAdapter = new LinearAdapter({
        apiKey: 'lin_api_test_mock_key',
        runDir,
        logger: mockLogger,
        enablePreviewFeatures: true,
      });

      Reflect.set(
        previewAdapter as unknown as { client: HttpClient },
        'client',
        mockHttpClient as unknown as HttpClient
      );

      vi.clearAllMocks();
    });

    it('should update issue when preview features enabled', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_UPDATE_RESPONSE,
        requestId: 'req_test',
      });

      await previewAdapter.updateIssue({
        issueId: MOCK_LINEAR_ISSUE.id,
        title: 'Updated title',
        priority: 3,
      });

      expect(mockHttpClient.post).toHaveBeenCalled();
      const [updatePath, updateBody, updateOptions] = mockHttpClient.post.mock.calls[0] as [
        string,
        { query: string; variables: Record<string, unknown> },
        { metadata?: Record<string, unknown> },
      ];
      expect(updatePath).toBe('/graphql');
      expect(updateBody.query).toContain('mutation UpdateIssue');
      expect(updateBody.variables).toMatchObject({
        issueId: MOCK_LINEAR_ISSUE.id,
        title: 'Updated title',
        priority: 3,
      });
      expect(updateOptions.metadata).toMatchObject({
        operation: 'updateIssue',
        issueId: MOCK_LINEAR_ISSUE.id,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Issue updated successfully',
        expect.objectContaining({ issueId: MOCK_LINEAR_ISSUE.id })
      );
    });

    it('should post comment when preview features enabled', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_COMMENT_POST_RESPONSE,
        requestId: 'req_test',
      });

      await previewAdapter.postComment({
        issueId: MOCK_LINEAR_ISSUE.id,
        body: 'This is a test comment',
      });

      expect(mockHttpClient.post).toHaveBeenCalled();
      const [commentPath, commentBody, commentOptions] = mockHttpClient.post.mock.calls[0] as [
        string,
        { query: string; variables: Record<string, unknown> },
        { metadata?: Record<string, unknown> },
      ];
      expect(commentPath).toBe('/graphql');
      expect(commentBody.query).toContain('mutation PostComment');
      expect(commentBody.variables).toEqual({
        issueId: MOCK_LINEAR_ISSUE.id,
        body: 'This is a test comment',
      });
      expect(commentOptions.metadata).toMatchObject({
        operation: 'postComment',
        issueId: MOCK_LINEAR_ISSUE.id,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Comment posted successfully',
        expect.objectContaining({ issueId: MOCK_LINEAR_ISSUE.id })
      );
    });

    it('should reject update when preview features disabled', async () => {
      await expect(
        adapter.updateIssue({
          issueId: MOCK_LINEAR_ISSUE.id,
          title: 'Updated title',
        })
      ).rejects.toThrow('Issue updates require preview features to be enabled');
    });

    it('should reject comment post when preview features disabled', async () => {
      await expect(
        adapter.postComment({
          issueId: MOCK_LINEAR_ISSUE.id,
          body: 'Test comment',
        })
      ).rejects.toThrow('Comment posting requires preview features to be enabled');
    });

    it('should reject malformed issue IDs before fetching snapshot', async () => {
      await expect(adapter.fetchIssueSnapshot('---')).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it('should reject malformed issue IDs before update', async () => {
      await expect(
        previewAdapter.updateIssue({
          issueId: 'bad/id',
          title: 'Updated title',
        })
      ).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Failed to update issue',
        expect.any(Object)
      );
    });

    it('should reject malformed issue IDs before posting comment', async () => {
      await expect(
        previewAdapter.postComment({
          issueId: '..',
          body: 'Test comment',
        })
      ).rejects.toMatchObject({
        errorType: ErrorType.PERMANENT,
      });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Failed to post comment',
        expect.any(Object)
      );
    });

    it('should handle update failure gracefully', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 200,
        headers: {},
        data: {
          data: {
            issueUpdate: {
              success: false,
            },
          },
        },
        requestId: 'req_test',
      });

      await expect(
        previewAdapter.updateIssue({
          issueId: MOCK_LINEAR_ISSUE.id,
          title: 'Failed update',
        })
      ).rejects.toThrow('Issue update failed');
    });
  });

  describe('Snapshot Hash Computation', () => {
    it('should compute consistent hash for same data', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const snapshot1 = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      // Fetch again with same data
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_3',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_4',
        });

      const snapshot2 = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        forceRefresh: true,
      });

      // Hashes should be identical for same data
      expect(snapshot1.metadata.hash).toBe(snapshot2.metadata.hash);
    });

    it('should compute different hash when data changes', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const snapshot1 = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      // Modify issue data
      const modifiedIssue = { ...MOCK_LINEAR_ISSUE, title: 'Modified title' };
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: { data: { issue: modifiedIssue } },
          requestId: 'req_test_3',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_4',
        });

      const snapshot2 = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id, {
        forceRefresh: true,
      });

      // Hashes should be different for modified data
      expect(snapshot1.metadata.hash).not.toBe(snapshot2.metadata.hash);
    });
  });

  describe('Adapter Construction', () => {
    it('should create adapter via direct instantiation', () => {
      const adapter = new LinearAdapter({
        apiKey: 'lin_api_test_key',
        runDir,
      });

      expect(adapter).toBeInstanceOf(LinearAdapter);
    });
  });

  describe('Metadata Tracking', () => {
    it('should mark snapshot with preview flag when preview features enabled', async () => {
      const previewAdapter = new LinearAdapter({
        apiKey: 'lin_api_test_key',
        enablePreviewFeatures: true,
        runDir,
        logger: mockLogger,
      });

      Reflect.set(
        previewAdapter as unknown as { client: HttpClient },
        'client',
        mockHttpClient as unknown as HttpClient
      );

      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const snapshot = await previewAdapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);

      expect(snapshot.metadata.isPreview).toBe(true);
    });

    it('should include retrieved_at timestamp', async () => {
      mockHttpClient.post
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_ISSUE_RESPONSE,
          requestId: 'req_test_1',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_COMMENTS_RESPONSE,
          requestId: 'req_test_2',
        });

      const beforeFetch = new Date();
      const snapshot = await adapter.fetchIssueSnapshot(MOCK_LINEAR_ISSUE.id);
      const afterFetch = new Date();

      const retrievedAt = new Date(snapshot.metadata.retrieved_at);
      expect(retrievedAt.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
      expect(retrievedAt.getTime()).toBeLessThanOrEqual(afterFetch.getTime());
    });
  });
});
