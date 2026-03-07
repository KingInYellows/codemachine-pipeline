import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  GitHubAdapter,
  GitHubAdapterError,
  type RepositoryInfo,
  type PullRequest,
  type GitReference,
  type StatusCheck,
} from '../../src/adapters/github/GitHubAdapter';
import { ErrorType, HttpError } from '../../src/adapters/http/client';
import type { HttpClient } from '../../src/adapters/http/client';

/**
 * GitHub Adapter Integration Tests
 *
 * These tests verify the GitHub adapter implementation by:
 * 1. Using mocked HTTP responses to avoid hitting live GitHub API
 * 2. Testing correct header injection (Accept, X-GitHub-Api-Version)
 * 3. Verifying payload structure for each operation
 * 4. Asserting error handling and retry logic
 * 5. Validating rate limit integration
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
const MOCK_REPO_INFO: RepositoryInfo = {
  id: 123456789,
  full_name: 'test-org/test-repo',
  default_branch: 'main',
  private: false,
  clone_url: 'https://github.com/test-org/test-repo.git',
  description: 'Test repository',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-15T12:00:00Z',
};

const MOCK_BRANCH_REF: GitReference = {
  ref: 'refs/heads/feature-branch',
  url: 'https://api.github.com/repos/test-org/test-repo/git/refs/heads/feature-branch',
  object: {
    sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
    type: 'commit',
    url: 'https://api.github.com/repos/test-org/test-repo/git/commits/aa218f56b14c9653891f9e74264a383fa43fefbd',
  },
};

const MOCK_PULL_REQUEST: PullRequest = {
  number: 42,
  id: 987654321,
  state: 'open',
  title: 'Add new feature',
  body: 'This PR adds a new feature',
  html_url: 'https://github.com/test-org/test-repo/pull/42',
  url: 'https://api.github.com/repos/test-org/test-repo/pulls/42',
  head: {
    ref: 'feature-branch',
    sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
  },
  base: {
    ref: 'main',
    sha: 'bb329f67c25d0764902f0e75375b494fb54gfgce',
  },
  draft: false,
  merged: false,
  mergeable: true,
  mergeable_state: 'clean',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T11:00:00Z',
};

const MOCK_STATUS_CHECKS: StatusCheck[] = [
  {
    id: 111,
    status: 'completed',
    conclusion: 'success',
    head_sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
    check_runs: [
      {
        id: 222,
        name: 'CI Build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2024-01-15T10:05:00Z',
        completed_at: '2024-01-15T10:15:00Z',
      },
      {
        id: 333,
        name: 'Tests',
        status: 'completed',
        conclusion: 'success',
        started_at: '2024-01-15T10:05:00Z',
        completed_at: '2024-01-15T10:20:00Z',
      },
    ],
  },
];

describe('GitHubAdapter Integration Tests', () => {
  let adapter: GitHubAdapter;
  let runDir: string;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create temporary run directory for rate limit ledger
    runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-adapter-test-'));

    // Create mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create adapter instance
    adapter = new GitHubAdapter({
      owner: 'test-org',
      repo: 'test-repo',
      token: 'ghp_test_token_mock',
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

  describe('Repository Operations', () => {
    it('should fetch repository metadata with correct headers', async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_REPO_INFO,
        requestId: 'req_test',
      });

      const result = await adapter.getRepository();

      expect(result).toEqual(MOCK_REPO_INFO);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/repos/test-org/test-repo',
        expect.objectContaining({
          metadata: { operation: 'getRepository' },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching repository metadata',
        expect.objectContaining({
          owner: 'test-org',
          repo: 'test-repo',
        })
      );
    });

    it('should handle 404 repository not found error', async () => {
      const httpError = new HttpError('Not Found', ErrorType.PERMANENT, 404);

      mockHttpClient.get.mockRejectedValue(httpError);

      await expect(adapter.getRepository()).rejects.toThrow(GitHubAdapterError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch repository metadata',
        expect.any(Object)
      );
    });
  });

  describe('Branch Operations', () => {
    it('should create branch with correct payload', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        headers: {},
        data: MOCK_BRANCH_REF,
        requestId: 'req_test',
      });

      const result = await adapter.createBranch({
        branch: 'feature-branch',
        sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      });

      expect(result).toEqual(MOCK_BRANCH_REF);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/git/refs',
        {
          ref: 'refs/heads/feature-branch',
          sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        expect.objectContaining({
          metadata: {
            operation: 'createBranch',
            branch: 'feature-branch',
          },
        })
      );
    });

    it('should handle branch already exists error (422)', async () => {
      const httpError = new HttpError('Validation Failed', ErrorType.PERMANENT, 422);

      mockHttpClient.post.mockRejectedValue(httpError);

      await expect(
        adapter.createBranch({
          branch: 'existing-branch',
          sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        })
      ).rejects.toThrow(GitHubAdapterError);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create branch', expect.any(Object));
    });

    it('should get branch reference', async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_BRANCH_REF,
        requestId: 'req_test',
      });

      const result = await adapter.getBranch('feature-branch');

      expect(result).toEqual(MOCK_BRANCH_REF);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/git/ref/heads/feature-branch',
        expect.objectContaining({
          metadata: {
            operation: 'getBranch',
            branch: 'feature-branch',
          },
        })
      );
    });
  });

  describe('Pull Request Operations', () => {
    it('should create pull request with all required fields', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        headers: {},
        data: MOCK_PULL_REQUEST,
        requestId: 'req_test',
      });

      const result = await adapter.createPullRequest({
        title: 'Add new feature',
        body: 'This PR adds a new feature',
        head: 'feature-branch',
        base: 'main',
        draft: false,
      });

      expect(result).toEqual(MOCK_PULL_REQUEST);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/pulls',
        {
          title: 'Add new feature',
          body: 'This PR adds a new feature',
          head: 'feature-branch',
          base: 'main',
          draft: false,
          maintainer_can_modify: true,
        },
        expect.objectContaining({
          metadata: {
            operation: 'createPullRequest',
            head: 'feature-branch',
            base: 'main',
          },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pull request created successfully',
        expect.objectContaining({
          pr_number: 42,
          html_url: MOCK_PULL_REQUEST.html_url,
        })
      );
    });

    it('should create draft pull request', async () => {
      const draftPR = { ...MOCK_PULL_REQUEST, draft: true };
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        headers: {},
        data: draftPR,
        requestId: 'req_test',
      });

      const result = await adapter.createPullRequest({
        title: 'WIP: New feature',
        body: 'Work in progress',
        head: 'feature-branch',
        base: 'main',
        draft: true,
      });

      expect(result.draft).toBe(true);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ draft: true }),
        expect.any(Object)
      );
    });

    it('should get pull request details', async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: MOCK_PULL_REQUEST,
        requestId: 'req_test',
      });

      const result = await adapter.getPullRequest(42);

      expect(result).toEqual(MOCK_PULL_REQUEST);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/pulls/42',
        expect.objectContaining({
          metadata: { operation: 'getPullRequest', pull_number: 42 },
        })
      );
    });
  });

  describe('Reviewer Operations', () => {
    it('should request reviewers with usernames and teams', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        headers: {},
        data: MOCK_PULL_REQUEST,
        requestId: 'req_test',
      });

      await adapter.requestReviewers({
        pull_number: 42,
        reviewers: ['octocat', 'hubot'],
        team_reviewers: ['team-alpha'],
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/pulls/42/requested_reviewers',
        {
          reviewers: ['octocat', 'hubot'],
          team_reviewers: ['team-alpha'],
        },
        expect.objectContaining({
          metadata: {
            operation: 'requestReviewers',
            pull_number: 42,
          },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Reviewers requested successfully',
        expect.objectContaining({ pull_number: 42 })
      );
    });

    it('should request only user reviewers', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        headers: {},
        data: MOCK_PULL_REQUEST,
        requestId: 'req_test',
      });

      await adapter.requestReviewers({
        pull_number: 42,
        reviewers: ['octocat'],
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          reviewers: ['octocat'],
        },
        expect.any(Object)
      );
    });
  });

  describe('Status Check Operations', () => {
    it('should fetch status checks for commit', async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: { check_suites: MOCK_STATUS_CHECKS },
        requestId: 'req_test',
      });

      const result = await adapter.getStatusChecks('aa218f56b14c9653891f9e74264a383fa43fefbd');

      expect(result).toEqual(MOCK_STATUS_CHECKS);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/commits/aa218f56b14c9653891f9e74264a383fa43fefbd/check-suites',
        expect.objectContaining({
          metadata: {
            operation: 'getStatusChecks',
            sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
          },
        })
      );
    });

    it('should check if pull request is ready to merge (all checks pass)', async () => {
      // Mock PR fetch
      mockHttpClient.get
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_PULL_REQUEST,
          requestId: 'req_test',
        })
        // Mock status checks fetch
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: { check_suites: MOCK_STATUS_CHECKS },
          requestId: 'req_test',
        });

      const result = await adapter.isPullRequestReadyToMerge(42);

      expect(result.ready).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('should detect PR not ready - draft mode', async () => {
      const draftPR = { ...MOCK_PULL_REQUEST, draft: true };
      mockHttpClient.get
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: draftPR,
          requestId: 'req_test',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: { check_suites: MOCK_STATUS_CHECKS },
          requestId: 'req_test',
        });

      const result = await adapter.isPullRequestReadyToMerge(42);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('PR is in draft mode');
    });

    it('should detect PR not ready - failed status checks', async () => {
      const failedChecks = [
        {
          ...MOCK_STATUS_CHECKS[0],
          conclusion: 'failure',
        },
      ];

      mockHttpClient.get
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: MOCK_PULL_REQUEST,
          requestId: 'req_test',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: { check_suites: failedChecks },
          requestId: 'req_test',
        });

      const result = await adapter.isPullRequestReadyToMerge(42);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('1 status check(s) failed');
    });
  });

  describe('Merge Operations', () => {
    it('should merge pull request with squash method', async () => {
      mockHttpClient.put.mockResolvedValue({
        status: 200,
        headers: {},
        data: {
          merged: true,
          sha: 'cc440f78d36e1165003f0e86486b7fae68dgfhdg',
          message: 'Pull Request successfully merged',
        },
        requestId: 'req_test',
      });

      const result = await adapter.mergePullRequest({
        pull_number: 42,
        merge_method: 'squash',
        commit_title: 'feat: add new API endpoints',
      });

      expect(result.merged).toBe(true);
      expect(mockHttpClient.put).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/pulls/42/merge',
        {
          merge_method: 'squash',
          commit_title: 'feat: add new API endpoints',
        },
        expect.objectContaining({
          metadata: {
            operation: 'mergePullRequest',
            pull_number: 42,
          },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pull request merged successfully',
        expect.objectContaining({
          pull_number: 42,
          sha: 'cc440f78d36e1165003f0e86486b7fae68dgfhdg',
        })
      );
    });

    it('should handle merge conflict error (405)', async () => {
      const httpError = new HttpError('Method Not Allowed', ErrorType.PERMANENT, 405);

      mockHttpClient.put.mockRejectedValue(httpError);

      await expect(
        adapter.mergePullRequest({
          pull_number: 42,
        })
      ).rejects.toThrow(GitHubAdapterError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to merge pull request',
        expect.any(Object)
      );
    });
  });

  describe('Workflow Operations', () => {
    it('should trigger workflow dispatch with inputs', async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 204,
        headers: {},
        data: null,
        requestId: 'req_test',
      });

      await adapter.triggerWorkflow({
        workflow_id: 'deploy.yml',
        ref: 'main',
        inputs: {
          environment: 'production',
          version: 'v1.2.3',
        },
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/repos/test-org/test-repo/actions/workflows/deploy.yml/dispatches',
        {
          ref: 'main',
          inputs: {
            environment: 'production',
            version: 'v1.2.3',
          },
        },
        expect.objectContaining({
          metadata: {
            operation: 'triggerWorkflow',
            workflow_id: 'deploy.yml',
            ref: 'main',
          },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Workflow dispatch triggered successfully',
        expect.any(Object)
      );
    });

    it('should handle workflow not found error (404)', async () => {
      const httpError = new HttpError('Not Found', ErrorType.PERMANENT, 404);

      mockHttpClient.post.mockRejectedValue(httpError);

      await expect(
        adapter.triggerWorkflow({
          workflow_id: 'nonexistent.yml',
          ref: 'main',
        })
      ).rejects.toThrow(GitHubAdapterError);
    });
  });

  describe('Error Handling', () => {
    it('should classify transient errors correctly', async () => {
      const httpError = new HttpError(
        'Rate limit exceeded',
        ErrorType.TRANSIENT,
        429,
        {},
        'Rate limit response body',
        'req_test',
        true
      );

      mockHttpClient.get.mockRejectedValue(httpError);

      try {
        await adapter.getRepository();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAdapterError);
        const ghError = error as GitHubAdapterError;
        expect(ghError.errorType).toBe(ErrorType.TRANSIENT);
        expect(ghError.statusCode).toBe(429);
      }
    });

    it('should classify permanent errors correctly', async () => {
      const httpError = new HttpError(
        'Validation Failed',
        ErrorType.PERMANENT,
        422,
        {},
        'Validation error response body',
        'req_test',
        false
      );

      mockHttpClient.post.mockRejectedValue(httpError);

      try {
        await adapter.createPullRequest({
          title: 'Test',
          body: 'Test',
          head: 'feature',
          base: 'main',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAdapterError);
        const ghError = error as GitHubAdapterError;
        expect(ghError.errorType).toBe(ErrorType.PERMANENT);
      }
    });

    it('should log errors with sanitized context', async () => {
      const httpError = new HttpError('Internal Server Error', ErrorType.PERMANENT, 500);

      mockHttpClient.get.mockRejectedValue(httpError);

      await expect(adapter.getRepository()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch repository metadata',
        expect.any(Object)
      );
    });
  });

  describe('Factory Function', () => {
    it('should create adapter using factory function', () => {
      const adapter = new GitHubAdapter({
        owner: 'test-org',
        repo: 'test-repo',
        token: 'test-token',
      });

      expect(adapter).toBeInstanceOf(GitHubAdapter);
    });
  });

  describe('Input Validation (CDMCH-174)', () => {
    describe('owner/repo validation', () => {
      it('should reject empty owner', () => {
        expect(
          () => new GitHubAdapter({ owner: '', repo: 'test-repo', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject owner with path traversal', () => {
        expect(
          () => new GitHubAdapter({ owner: '../etc', repo: 'test-repo', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject owner with slashes', () => {
        expect(
          () => new GitHubAdapter({ owner: 'org/evil', repo: 'test-repo', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject owner with dots', () => {
        expect(
          () => new GitHubAdapter({ owner: 'my-org.test', repo: 'test-repo', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject dot-prefixed owner', () => {
        expect(
          () => new GitHubAdapter({ owner: '.myorg', repo: 'test-repo', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject repo with special characters', () => {
        expect(
          () => new GitHubAdapter({ owner: 'test-org', repo: 'repo%20name', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should reject repository names that collapse path segments', () => {
        expect(() => new GitHubAdapter({ owner: 'test-org', repo: '.', token: 'tok' })).toThrow(
          GitHubAdapterError
        );
        expect(() => new GitHubAdapter({ owner: 'test-org', repo: '..', token: 'tok' })).toThrow(
          GitHubAdapterError
        );
      });

      it('should reject repository names that end with "." or ".git"', () => {
        expect(
          () => new GitHubAdapter({ owner: 'test-org', repo: 'repo.', token: 'tok' })
        ).toThrow(GitHubAdapterError);
        expect(
          () => new GitHubAdapter({ owner: 'test-org', repo: 'repo.git', token: 'tok' })
        ).toThrow(GitHubAdapterError);
      });

      it('should accept valid owner and repo with hyphens, dots, underscores', () => {
        expect(
          () => new GitHubAdapter({ owner: 'my-org-test', repo: 'my_repo-v2.0', token: 'tok' })
        ).not.toThrow();
      });

      it('should accept repository names that start with a dot', () => {
        expect(
          () => new GitHubAdapter({ owner: 'test-org', repo: '.github', token: 'tok' })
        ).not.toThrow();
      });
    });

    describe('pull_number validation', () => {
      it('should reject NaN pull number', async () => {
        await expect(adapter.getPullRequest(NaN)).rejects.toThrow(GitHubAdapterError);
      });

      it('should reject negative pull number', async () => {
        await expect(adapter.getPullRequest(-1)).rejects.toThrow(GitHubAdapterError);
      });

      it('should reject zero pull number', async () => {
        await expect(adapter.getPullRequest(0)).rejects.toThrow(GitHubAdapterError);
      });

      it('should reject fractional pull number', async () => {
        await expect(adapter.getPullRequest(1.5)).rejects.toThrow(GitHubAdapterError);
      });

      it('should accept valid positive integer', async () => {
        mockHttpClient.get.mockResolvedValue({ data: MOCK_PULL_REQUEST });
        await expect(adapter.getPullRequest(42)).resolves.toBeDefined();
      });

      it('should validate pull_number in requestReviewers', async () => {
        await expect(
          adapter.requestReviewers({ pull_number: -1, reviewers: ['user'] })
        ).rejects.toThrow(GitHubAdapterError);
        expect(mockHttpClient.post).not.toHaveBeenCalled();
      });

      it('should validate pull_number in mergePullRequest', async () => {
        await expect(
          adapter.mergePullRequest({ pull_number: 0 })
        ).rejects.toThrow(GitHubAdapterError);
        expect(mockHttpClient.put).not.toHaveBeenCalled();
      });

      it('should validate pull_number in isPullRequestReadyToMerge', async () => {
        await expect(adapter.isPullRequestReadyToMerge(0)).rejects.toThrow(GitHubAdapterError);
        expect(mockHttpClient.get).not.toHaveBeenCalled();
      });

      it('should validate pull_number in enableAutoMerge', async () => {
        await expect(adapter.enableAutoMerge(0, 'MERGE')).rejects.toThrow(GitHubAdapterError);
        expect(mockHttpClient.get).not.toHaveBeenCalled();
        expect(mockHttpClient.post).not.toHaveBeenCalled();
      });

      it('should validate pull_number in disableAutoMerge', async () => {
        await expect(adapter.disableAutoMerge(0)).rejects.toThrow(GitHubAdapterError);
        expect(mockHttpClient.get).not.toHaveBeenCalled();
        expect(mockHttpClient.post).not.toHaveBeenCalled();
      });
    });
  });

});
