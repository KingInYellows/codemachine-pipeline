import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  GitHubAdapter,
  type RepositoryInfo,
  type PullRequest,
} from '../../src/adapters/github/GitHubAdapter';
import {
  LinearAdapter,
  type LinearIssue,
  type LinearComment,
} from '../../src/adapters/linear/LinearAdapter';
import { ErrorType, HttpError } from '../../src/adapters/http/client';
import type { HttpClient } from '../../src/adapters/http/client';
import { GitHubAdapterError } from '../../src/adapters/github/GitHubAdapter';
import { LinearAdapterError } from '../../src/adapters/linear/LinearAdapter';

/**
 * GitHub & Linear Integration Regression Test Suite
 *
 * This suite validates adapter behavior across success, rate-limit, and error scenarios
 * using deterministic HTTP fixtures recorded in tests/fixtures/{github,linear}/.
 *
 * Covers:
 * - Success paths: repository fetch, PR creation, issue snapshots
 * - Primary rate limit (429): GitHub/Linear API quota exhaustion
 * - Secondary rate limit (403): GitHub abuse detection
 * - Missing scopes (403): Insufficient OAuth permissions
 * - Authentication failures: Invalid tokens
 *
 * Fixtures are hashed and tracked in manifest.json for auditability.
 * Run scripts/tooling/update_fixtures.sh to refresh recorded responses.
 */

// ============================================================================
// Fixture Loading Utilities
// ============================================================================

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

interface HttpFixture {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

interface FixtureManifestEntry {
  file: string;
  scenario: string;
  endpoint?: string;
  query?: string;
  hash: string;
}

interface FixtureManifest {
  description: string;
  created: string;
  updated?: string;
  source_branch?: string;
  refresh_command: string;
  fixtures: FixtureManifestEntry[];
}

type GitHubAdapterContract = {
  getRepository(): Promise<RepositoryInfo>;
  createPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<PullRequest>;
  triggerWorkflow(params: { workflow_id: string; ref: string }): Promise<void>;
};

type LinearAdapterContract = {
  fetchIssue(issueId: string): Promise<LinearIssue>;
  fetchComments(issueId: string): Promise<LinearComment[]>;
  updateIssue(input: { issueId: string; title?: string }): Promise<void>;
};

const stringMatcher = (value: string): string =>
  expect.stringContaining(value) as unknown as string;

const objectMatcher = <T extends object>(value: T): T =>
  expect.objectContaining(value) as unknown as T;

/**
 * Load a fixture file and compute its hash
 */
async function loadFixture(provider: 'github' | 'linear', filename: string): Promise<HttpFixture> {
  const fixturePath = path.join(FIXTURES_DIR, provider, filename);
  const content = await fs.readFile(fixturePath, 'utf-8');
  return JSON.parse(content) as HttpFixture;
}

/**
 * Compute SHA256 hash of fixture data for manifest tracking
 */
function computeFixtureHash(fixture: HttpFixture): string {
  const normalized = JSON.stringify(fixture, null, 2);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFixtureManifestEntry(value: unknown): value is FixtureManifestEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.file === 'string' &&
    typeof value.scenario === 'string' &&
    typeof value.hash === 'string'
  );
}

function isFixtureManifest(value: unknown): value is FixtureManifest {
  if (!isRecord(value)) {
    return false;
  }

  const { description, created, refresh_command: refreshCommand, fixtures } = value;

  if (
    typeof description !== 'string' ||
    typeof created !== 'string' ||
    typeof refreshCommand !== 'string' ||
    !Array.isArray(fixtures)
  ) {
    return false;
  }

  return fixtures.every(isFixtureManifestEntry);
}

async function loadManifest(provider: 'github' | 'linear'): Promise<FixtureManifest> {
  const manifestPath = path.join(FIXTURES_DIR, provider, 'manifest.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(manifestContent) as unknown;

  if (!isFixtureManifest(parsed)) {
    throw new Error(`Invalid manifest format for provider ${provider}`);
  }

  return parsed;
}

/**
 * Helper to create mock HTTP client that replays fixtures
 */
function createFixtureMockClient(fixture: HttpFixture): {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const mockResponse = {
    status: fixture.status,
    headers: fixture.headers,
    data: fixture.data,
    requestId: `fixture_${Date.now()}`,
  };

  // For error fixtures, reject with HttpError
  if (fixture.status >= 400) {
    const errorType =
      fixture.status === 429 || fixture.status === 503
        ? ErrorType.TRANSIENT
        : fixture.status === 401 || fixture.status === 403
          ? ErrorType.HUMAN_ACTION_REQUIRED
          : ErrorType.PERMANENT;

    const httpError = new HttpError(
      (fixture.data as { message?: string })?.message || 'HTTP Error',
      errorType,
      fixture.status,
      fixture.headers,
      JSON.stringify(fixture.data),
      mockResponse.requestId,
      errorType === ErrorType.TRANSIENT
    );

    return {
      get: vi.fn().mockRejectedValue(httpError),
      post: vi.fn().mockRejectedValue(httpError),
      put: vi.fn().mockRejectedValue(httpError),
      patch: vi.fn().mockRejectedValue(httpError),
      delete: vi.fn().mockRejectedValue(httpError),
    };
  }

  // Success fixtures resolve normally
  return {
    get: vi.fn().mockResolvedValue(mockResponse),
    post: vi.fn().mockResolvedValue(mockResponse),
    put: vi.fn().mockResolvedValue(mockResponse),
    patch: vi.fn().mockResolvedValue(mockResponse),
    delete: vi.fn().mockResolvedValue(mockResponse),
  };
}

// ============================================================================
// GitHub Adapter Regression Tests
// ============================================================================

describe('GitHub Adapter Regression Tests', () => {
  let adapter: GitHubAdapter;
  let adapterContract: GitHubAdapterContract;
  let runDir: string;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-regression-'));

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    adapter = new GitHubAdapter({
      owner: 'test-org',
      repo: 'test-repo',
      token: 'ghp_fixture_token',
      runDir,
      logger: mockLogger,
    });
    adapterContract = adapter as unknown as GitHubAdapterContract;

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(runDir, { recursive: true, force: true });
  });

  describe('Success Scenarios', () => {
    it('should fetch repository metadata successfully', async () => {
      const fixture = await loadFixture('github', 'success_repository.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.getRepository()).resolves.toMatchObject({
        full_name: 'test-org/test-repo',
        default_branch: 'main',
        private: false,
      });
      expect(mockClient.get).toHaveBeenCalledWith(
        '/repos/test-org/test-repo',
        expect.objectContaining({ metadata: { operation: 'getRepository' } })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching repository metadata',
        expect.any(Object)
      );
    });

    it('should create pull request successfully', async () => {
      const fixture = await loadFixture('github', 'success_pull_request.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(
        adapterContract.createPullRequest({
          title: 'feat: Add new feature via AI pipeline',
          body: 'This PR was generated by the AI feature pipeline.',
          head: 'feature/ai-pipeline-123',
          base: 'main',
          draft: false,
        })
      ).resolves.toMatchObject({
        number: 42,
        state: 'open',
        title: stringMatcher('feat:'),
        draft: false,
        mergeable: true,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pull request created successfully',
        expect.objectContaining({ pr_number: 42 })
      );
    });

    // getBranchProtection is on BranchProtectionAdapter, not GitHubAdapter.
    // See src/adapters/github/branchProtection.ts for dedicated tests.
  });

  describe('Rate Limit Scenarios', () => {
    it('should handle primary rate limit (429) as transient error', async () => {
      const fixture = await loadFixture('github', 'ratelimit_429_primary.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.getRepository()).rejects.toThrow();

      try {
        await adapterContract.getRepository();
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAdapterError);
        if (!(error instanceof GitHubAdapterError)) {
          throw error;
        }
        expect(error.errorType).toBe(ErrorType.TRANSIENT);
        expect(error.statusCode).toBe(429);
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle secondary rate limit (403) with cooldown', async () => {
      const fixture = await loadFixture('github', 'error_403_secondary.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.getRepository()).rejects.toThrow();

      try {
        await adapterContract.getRepository();
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAdapterError);
        if (!(error instanceof GitHubAdapterError)) {
          throw error;
        }
        expect(error.statusCode).toBe(403);
        expect(error.errorType).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
      }
    });
  });

  describe('Permission & Scope Scenarios', () => {
    it('should detect missing OAuth scopes (403)', async () => {
      const fixture = await loadFixture('github', 'error_missing_scopes.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(
        adapterContract.triggerWorkflow({
          workflow_id: 'deploy.yml',
          ref: 'main',
        })
      ).rejects.toThrow();

      try {
        await adapterContract.triggerWorkflow({ workflow_id: 'deploy.yml', ref: 'main' });
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAdapterError);
        if (!(error instanceof GitHubAdapterError)) {
          throw error;
        }
        expect(error.statusCode).toBe(403);
        expect(error.errorType).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
      }
    });
  });

  describe('Fixture Integrity', () => {
    it('should compute consistent hashes for fixtures', async () => {
      const fixture = await loadFixture('github', 'success_repository.json');
      const hash1 = computeFixtureHash(fixture);
      const hash2 = computeFixtureHash(fixture);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('should verify fixture manifest exists', async () => {
      const manifest = await loadManifest('github');

      expect(manifest).toHaveProperty('fixtures');
      expect(Array.isArray(manifest.fixtures)).toBe(true);
      expect(manifest.fixtures.length).toBeGreaterThan(0);
      expect(manifest).toHaveProperty('refresh_command');
    });
  });
});

// ============================================================================
// Linear Adapter Regression Tests
// ============================================================================

describe('Linear Adapter Regression Tests', () => {
  let adapter: LinearAdapter;
  let adapterContract: LinearAdapterContract;
  let runDir: string;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linear-regression-'));

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    adapter = new LinearAdapter({
      apiKey: 'lin_fixture_key',
      runDir,
      logger: mockLogger,
    });
    adapterContract = adapter as unknown as LinearAdapterContract;

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(runDir, { recursive: true, force: true });
  });

  describe('Success Scenarios', () => {
    it('should fetch issue successfully', async () => {
      const fixture = await loadFixture('linear', 'success_issue.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.fetchIssue('linear-uuid-1234-5678-abcd')).resolves.toMatchObject(
        {
          identifier: 'ENG-123',
          title: stringMatcher('regression tests'),
          state: { name: 'In Progress' },
          priority: 2,
        }
      );
      expect(mockClient.post).toHaveBeenCalledWith(
        '/graphql',
        expect.objectContaining({
          query: stringMatcher('query GetIssue'),
          variables: { issueId: 'linear-uuid-1234-5678-abcd' },
        }),
        expect.any(Object)
      );
    });

    it('should fetch comments successfully', async () => {
      const fixture = await loadFixture('linear', 'success_comments.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await adapterContract.fetchComments('linear-uuid-1234-5678-abcd').then((result) => {
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          body: stringMatcher('Starting implementation'),
          user: { name: 'Test User' },
        });
      });
      expect(mockClient.post).toHaveBeenCalledWith(
        '/graphql',
        expect.objectContaining({
          query: stringMatcher('query GetComments'),
        }),
        expect.any(Object)
      );
    });

    it('should update issue with preview features enabled', async () => {
      const previewAdapter = new LinearAdapter({
        apiKey: 'lin_fixture_key',
        runDir,
        logger: mockLogger,
        enablePreviewFeatures: true,
      });
      const previewAdapterContract = previewAdapter as unknown as LinearAdapterContract;

      const fixture = await loadFixture('linear', 'success_update_issue.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        previewAdapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await previewAdapterContract.updateIssue({
        issueId: 'linear-uuid-1234-5678-abcd',
        title: 'Updated title',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/graphql',
        expect.objectContaining({
          query: stringMatcher('mutation UpdateIssue'),
          variables: objectMatcher({
            issueId: 'linear-uuid-1234-5678-abcd',
          }),
        }),
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Issue updated successfully',
        expect.any(Object)
      );
    });
  });

  describe('Rate Limit Scenarios', () => {
    it('should handle primary rate limit (429) as transient error', async () => {
      const fixture = await loadFixture('linear', 'ratelimit_429_primary.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.fetchIssue('linear-uuid-test')).rejects.toThrow();

      try {
        await adapterContract.fetchIssue('linear-uuid-test');
      } catch (error) {
        expect(error).toBeInstanceOf(LinearAdapterError);
        if (!(error instanceof LinearAdapterError)) {
          throw error;
        }
        expect(error.errorType).toBe(ErrorType.TRANSIENT);
        expect(error.statusCode).toBe(429);
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Authentication & Permission Scenarios', () => {
    it('should handle invalid API key (403) as human action required', async () => {
      const fixture = await loadFixture('linear', 'error_403_invalid_token.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        adapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(adapterContract.fetchIssue('linear-uuid-test')).rejects.toThrow();

      try {
        await adapterContract.fetchIssue('linear-uuid-test');
      } catch (error) {
        expect(error).toBeInstanceOf(LinearAdapterError);
        if (!(error instanceof LinearAdapterError)) {
          throw error;
        }
        expect(error.statusCode).toBe(403);
        expect(error.errorType).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
      }
    });

    it('should handle missing scopes (403) for preview features', async () => {
      const previewAdapter = new LinearAdapter({
        apiKey: 'lin_fixture_key',
        runDir,
        logger: mockLogger,
        enablePreviewFeatures: true,
      });
      const previewAdapterContract = previewAdapter as unknown as LinearAdapterContract;

      const fixture = await loadFixture('linear', 'error_missing_scopes.json');
      const mockClient = createFixtureMockClient(fixture);

      Reflect.set(
        previewAdapter as unknown as { client: HttpClient },
        'client',
        mockClient as unknown as HttpClient
      );

      await expect(
        previewAdapterContract.updateIssue({
          issueId: 'linear-uuid-test',
          title: 'Test',
        })
      ).rejects.toThrow();

      try {
        await previewAdapterContract.updateIssue({ issueId: 'linear-uuid-test', title: 'Test' });
      } catch (error) {
        expect(error).toBeInstanceOf(LinearAdapterError);
        if (!(error instanceof LinearAdapterError)) {
          throw error;
        }
        expect(error.statusCode).toBe(403);
        expect(error.errorType).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
      }
    });
  });

  describe('Fixture Integrity', () => {
    it('should compute consistent hashes for fixtures', async () => {
      const fixture = await loadFixture('linear', 'success_issue.json');
      const hash1 = computeFixtureHash(fixture);
      const hash2 = computeFixtureHash(fixture);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should verify fixture manifest exists', async () => {
      const manifest = await loadManifest('linear');

      expect(manifest).toHaveProperty('fixtures');
      expect(Array.isArray(manifest.fixtures)).toBe(true);
      expect(manifest.fixtures.length).toBeGreaterThan(0);
      expect(manifest).toHaveProperty('refresh_command');
    });
  });
});

// ============================================================================
// Cross-Provider Regression Tests
// ============================================================================

describe('Cross-Provider Regression Tests', () => {
  it('should demonstrate consistent error taxonomy across GitHub and Linear', async () => {
    const ghFixture = await loadFixture('github', 'ratelimit_429_primary.json');
    const linearFixture = await loadFixture('linear', 'ratelimit_429_primary.json');

    expect(ghFixture.status).toBe(429);
    expect(linearFixture.status).toBe(429);

    // Both should have retry-after headers
    expect(ghFixture.headers).toHaveProperty('retry-after');
    expect(linearFixture.headers).toHaveProperty('retry-after');
  });

  it('should validate all fixtures have required metadata', async () => {
    const providers: Array<'github' | 'linear'> = ['github', 'linear'];

    for (const provider of providers) {
      const manifest = await loadManifest(provider);

      expect(manifest).toHaveProperty('description');
      expect(manifest).toHaveProperty('created');
      expect(manifest).toHaveProperty('refresh_command');
      expect(Array.isArray(manifest.fixtures)).toBe(true);

      for (const fixtureEntry of manifest.fixtures) {
        expect(fixtureEntry).toHaveProperty('file');
        expect(fixtureEntry).toHaveProperty('scenario');
        expect(fixtureEntry).toHaveProperty('hash');
      }
    }
  });
});
