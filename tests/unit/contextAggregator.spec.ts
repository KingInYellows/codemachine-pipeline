import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  aggregateContext,
  resolveAggregatorConfig,
  getGitMetadata,
  type AggregatorConfig,
} from '../../src/workflows/contextAggregator';
import {
  scoreByPathDepth,
  scoreByGitRecency,
  scoreByFileType,
  scoreBySize,
  calculateCompositeScore,
  estimateTokens,
  rankAndBudgetFiles,
  type FileMetadata,
} from '../../src/workflows/contextRanking';
import { parseContextDocument } from '../../src/core/models/ContextDocument';
import { loadHashManifest } from '../../src/persistence/hashManifest';
import type { RepoConfig } from '../../src/core/config/RepoConfig';

/**
 * Context Aggregator Unit Tests
 *
 * Tests cover:
 * - Configuration resolution with CLI overrides
 * - File discovery with glob patterns
 * - Incremental hashing and change detection
 * - Scoring and ranking logic
 * - Token budgeting and file limits
 * - Context document generation
 * - Persistence to run directory
 */

describe('Context Ranking', () => {
  describe('scoreByPathDepth', () => {
    it('should score shallow files higher', () => {
      expect(scoreByPathDepth('README.md')).toBeGreaterThan(scoreByPathDepth('src/index.ts'));
      expect(scoreByPathDepth('src/index.ts')).toBeGreaterThan(
        scoreByPathDepth('src/deep/nested/file.ts')
      );
    });

    it('should return 1.0 for root-level files', () => {
      expect(scoreByPathDepth('README.md')).toBe(1.0);
      expect(scoreByPathDepth('package.json')).toBe(1.0);
    });

    it('should approach 0 for deeply nested files', () => {
      const deepPath = 'a/b/c/d/e/f/g.ts';
      expect(scoreByPathDepth(deepPath)).toBeLessThan(0.2);
    });
  });

  describe('scoreByGitRecency', () => {
    it('should score recent files higher', () => {
      const now = new Date('2024-01-01T00:00:00Z');
      const recent = new Date('2023-12-31T00:00:00Z'); // 1 day ago
      const old = new Date('2023-06-01T00:00:00Z'); // ~7 months ago

      expect(scoreByGitRecency(recent, now)).toBeGreaterThan(scoreByGitRecency(old, now));
    });

    it('should return 1.0 for files modified today', () => {
      const now = new Date();
      expect(scoreByGitRecency(now, now)).toBe(1.0);
    });

    it('should return 0.5 for files without git data', () => {
      expect(scoreByGitRecency(undefined)).toBe(0.5);
    });

    it('should approach 0 for very old files', () => {
      const now = new Date('2024-01-01T00:00:00Z');
      const ancient = new Date('2023-01-01T00:00:00Z'); // 1 year ago
      expect(scoreByGitRecency(ancient, now)).toBeLessThan(0.1);
    });
  });

  describe('scoreByFileType', () => {
    it('should score README files highest', () => {
      expect(scoreByFileType('README.md')).toBe(1.0);
      expect(scoreByFileType('readme.MD')).toBe(1.0);
      expect(scoreByFileType('docs/README.txt')).toBe(1.0);
    });

    it('should score documentation high', () => {
      expect(scoreByFileType('docs/guide.md')).toBe(0.8);
      expect(scoreByFileType('ARCHITECTURE.md')).toBe(0.8);
    });

    it('should score source code medium', () => {
      expect(scoreByFileType('src/index.ts')).toBe(0.6);
      expect(scoreByFileType('lib/utils.js')).toBe(0.6);
    });

    it('should score tests lower than source', () => {
      expect(scoreByFileType('tests/unit/index.spec.ts')).toBe(0.4);
      expect(scoreByFileType('src/__tests__/utils.test.js')).toBe(0.4);
    });

    it('should score config files medium-low', () => {
      expect(scoreByFileType('package.json')).toBe(0.5);
      expect(scoreByFileType('tsconfig.json')).toBe(0.5);
    });

    it('should score lock files and build artifacts low', () => {
      expect(scoreByFileType('package-lock.json')).toBe(0.2);
      expect(scoreByFileType('dist/bundle.js')).toBe(0.2);
    });
  });

  describe('scoreBySize', () => {
    it('should score empty files lowest', () => {
      expect(scoreBySize(0)).toBe(0);
    });

    it('should score optimal range (1KB-100KB) highest', () => {
      expect(scoreBySize(1024)).toBe(1.0); // 1KB
      expect(scoreBySize(50 * 1024)).toBe(1.0); // 50KB
      expect(scoreBySize(100 * 1024)).toBe(1.0); // 100KB
    });

    it('should penalize very small files', () => {
      expect(scoreBySize(100)).toBeLessThan(1.0);
      expect(scoreBySize(512)).toBeLessThan(1.0);
    });

    it('should penalize very large files', () => {
      expect(scoreBySize(500 * 1024)).toBeLessThan(1.0); // 500KB
      expect(scoreBySize(1000 * 1024)).toBeLessThan(0.5); // 1MB
    });
  });

  describe('calculateCompositeScore', () => {
    it('should combine all factors with default weights', () => {
      const metadata = {
        path: '/repo/src/index.ts',
        relativePath: 'src/index.ts',
        hash: 'a'.repeat(64),
        size: 10 * 1024, // 10KB
        mtime: new Date(),
        gitLastModified: new Date(),
        estimatedTokens: 2500,
      };

      const score = calculateCompositeScore(metadata);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should respect custom weights', () => {
      const metadata = {
        path: '/repo/README.md',
        relativePath: 'README.md',
        hash: 'b'.repeat(64),
        size: 5 * 1024,
        mtime: new Date(),
        estimatedTokens: 1250,
      };

      const defaultScore = calculateCompositeScore(metadata);
      const typeWeightedScore = calculateCompositeScore(metadata, {
        fileType: 1.0,
        pathDepth: 0,
        gitRecency: 0,
        fileSize: 0,
      });

      expect(typeWeightedScore).toBe(1.0); // README with 100% type weight
      expect(defaultScore).toBeLessThan(typeWeightedScore);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens as size / 4', () => {
      expect(estimateTokens(1000)).toBe(250);
      expect(estimateTokens(4000)).toBe(1000);
      expect(estimateTokens(100)).toBe(25);
    });

    it('should round up for non-divisible sizes', () => {
      expect(estimateTokens(1001)).toBe(251);
    });
  });

  describe('rankAndBudgetFiles', () => {
    const createMockFile = (
      name: string,
      size: number,
      depth: number
    ): Omit<FileMetadata, 'score'> => {
      const segments = Array.from({ length: depth }, () => 'dir');
      const relativePath = [...segments, name].join('/');

      return {
        path: `/repo/${relativePath}`,
        relativePath,
        hash: 'x'.repeat(64),
        size,
        mtime: new Date(),
        estimatedTokens: estimateTokens(size),
      };
    };

    it('should rank files by composite score', () => {
      const files = [
        createMockFile('test.spec.ts', 5000, 3), // Lower score (test, deep)
        createMockFile('README.md', 5000, 0), // Highest score (README, root)
        createMockFile('index.ts', 5000, 1), // Medium score (source, shallow)
      ];

      const result = rankAndBudgetFiles(files, 100000);

      expect(result.included[0].relativePath).toBe('README.md');
      expect(result.included[1].relativePath).toBe('dir/index.ts');
      expect(result.included[2].relativePath).toBe('dir/dir/dir/test.spec.ts');
    });

    it('should respect token budget', () => {
      const files = [
        createMockFile('a.ts', 4000, 0), // ~1000 tokens
        createMockFile('b.ts', 4000, 0), // ~1000 tokens
        createMockFile('c.ts', 4000, 0), // ~1000 tokens
      ];

      const result = rankAndBudgetFiles(files, 2000);

      expect(result.included.length).toBe(2);
      expect(result.excluded.length).toBe(1);
      expect(result.totalTokens).toBeLessThanOrEqual(2000);
    });

    it('should respect maxFiles limit', () => {
      const files = Array.from({ length: 10 }, (_, i) => createMockFile(`file${i}.ts`, 1000, 0));

      const result = rankAndBudgetFiles(files, 100000, { maxFiles: 5 });

      expect(result.included.length).toBe(5);
      expect(result.excluded.length).toBe(5);
    });

    it('should apply both maxFiles and token budget', () => {
      const files = [
        createMockFile('a.ts', 8000, 0), // ~2000 tokens
        createMockFile('b.ts', 8000, 0), // ~2000 tokens
        createMockFile('c.ts', 8000, 0), // ~2000 tokens
        createMockFile('d.ts', 8000, 0), // ~2000 tokens
      ];

      const result = rankAndBudgetFiles(files, 5000, { maxFiles: 3 });

      // maxFiles cuts to 3, then budget cuts to 2
      expect(result.included.length).toBe(2);
      expect(result.totalTokens).toBeLessThanOrEqual(5000);
    });

    it('should include diagnostics', () => {
      const files = [createMockFile('a.ts', 4000, 0), createMockFile('b.ts', 4000, 0)];

      const result = rankAndBudgetFiles(files, 1500, { maxFiles: 5 });

      expect(result.diagnostics).toEqual({
        totalFiles: 2,
        includedCount: 1,
        excludedCount: 1,
        tokenBudget: 1500,
        maxFiles: 5,
      });
    });
  });
});

describe('Context Aggregator Integration', () => {
  let testRepoDir: string;
  let testRunDir: string;

  beforeEach(async () => {
    // Create temporary repository
    testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-aggregator-test-'));

    // Create temporary run directory
    testRunDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-run-test-'));

    // Create subdirectories
    await fs.mkdir(path.join(testRunDir, 'context'), { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testRepoDir, { recursive: true, force: true });
    await fs.rm(testRunDir, { recursive: true, force: true });
  });

  describe('resolveAggregatorConfig', () => {
    it('should merge RepoConfig with CLI overrides', () => {
      const repoConfig: RepoConfig = {
        schema_version: '1.0.0',
        project: {
          id: 'test-project',
          repo_url: 'https://github.com/test/repo.git',
          default_branch: 'main',
          context_paths: ['src/', 'docs/'],
          project_leads: [],
        },
        github: {
          enabled: false,
          token_env_var: 'GITHUB_TOKEN',
          api_base_url: 'https://api.github.com',
          required_scopes: ['repo'],
          default_reviewers: [],
        },
        linear: { enabled: false, api_key_env_var: 'LINEAR_API_KEY' },
        runtime: {
          agent_endpoint_env_var: 'AGENT_ENDPOINT',
          max_concurrent_tasks: 3,
          timeout_minutes: 30,
          context_token_budget: 32000,
          logs_format: 'ndjson',
          run_directory: '.codepipe/runs',
        },
        safety: {
          redact_secrets: true,
          require_approval_for_prd: true,
          require_approval_for_plan: true,
          require_approval_for_pr: true,
          prevent_force_push: true,
          allowed_file_patterns: [],
          blocked_file_patterns: [],
        },
        feature_flags: {
          enable_auto_merge: false,
          enable_deployment_triggers: false,
          enable_linear_sync: false,
          enable_context_summarization: true,
          enable_resumability: true,
          enable_developer_preview: false,
        },
        constraints: {
          max_file_size_kb: 1000,
          max_context_files: 100,
        },
        config_history: [],
      };

      const config = resolveAggregatorConfig(repoConfig, testRunDir, 'test-feature-id', {
        includeOverrides: ['README.md'],
        tokenBudget: 10000,
        maxFiles: 50,
      });

      expect(config.contextPaths).toContain('src/');
      expect(config.contextPaths).toContain('docs/');
      expect(config.contextPaths).toContain('README.md');
      expect(config.tokenBudget).toBe(10000);
      expect(config.maxFiles).toBe(50);
    });
  });

  describe('aggregateContext', () => {
    it('should discover and aggregate files', async () => {
      // Create test files
      await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Test Project\n\nThis is a test.');
      await fs.mkdir(path.join(testRepoDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testRepoDir, 'src', 'index.ts'), 'export const foo = "bar";');

      const config: AggregatorConfig = {
        repoRoot: testRepoDir,
        runDir: testRunDir,
        featureId: 'test-feature',
        contextPaths: ['**/*.md', 'src/**/*.ts'],
        tokenBudget: 10000,
      };

      const result = await aggregateContext(config);

      expect(result.contextDocument.files).toBeDefined();
      expect(Object.keys(result.contextDocument.files).length).toBeGreaterThan(0);
      expect(result.ranking.included.length).toBeGreaterThan(0);
      expect(result.diagnostics.discovered).toBeGreaterThan(0);
    });

    it('should persist context artifacts', async () => {
      // Create test file
      await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Test');

      const config: AggregatorConfig = {
        repoRoot: testRepoDir,
        runDir: testRunDir,
        featureId: 'test-feature',
        contextPaths: ['**/*.md'],
        tokenBudget: 10000,
      };

      await aggregateContext(config);

      // Check persisted artifacts
      const summaryPath = path.join(testRunDir, 'context', 'summary.json');
      const hashManifestPath = path.join(testRunDir, 'context', 'file_hashes.json');

      const summaryExists = await fs
        .access(summaryPath)
        .then(() => true)
        .catch(() => false);
      const hashManifestExists = await fs
        .access(hashManifestPath)
        .then(() => true)
        .catch(() => false);

      expect(summaryExists).toBe(true);
      expect(hashManifestExists).toBe(true);

      // Validate summary.json
      const summaryContent = await fs.readFile(summaryPath, 'utf-8');
      const parsed = parseContextDocument(JSON.parse(summaryContent));
      expect(parsed.success).toBe(true);

      // Validate file_hashes.json
      const hashManifest = await loadHashManifest(hashManifestPath);
      expect(hashManifest.schema_version).toBe('1.0.0');
      expect(Object.keys(hashManifest.files).length).toBeGreaterThan(0);
    });

    it('should support incremental hashing', async () => {
      // Create initial file
      await fs.writeFile(path.join(testRepoDir, 'test.md'), 'Initial content');

      const config: AggregatorConfig = {
        repoRoot: testRepoDir,
        runDir: testRunDir,
        featureId: 'test-feature',
        contextPaths: ['**/*.md'],
        tokenBudget: 10000,
      };

      // First aggregation
      const result1 = await aggregateContext(config);
      expect(result1.diagnostics.hashed).toBeGreaterThan(0);
      expect(result1.diagnostics.skipped).toBe(0);

      // Second aggregation without changes
      const result2 = await aggregateContext(config);
      expect(result2.diagnostics.skipped).toBeGreaterThan(0);

      // Modify file
      await fs.writeFile(path.join(testRepoDir, 'test.md'), 'Modified content');

      // Third aggregation with changes
      const result3 = await aggregateContext(config);
      expect(result3.diagnostics.hashed).toBeGreaterThan(0);
    });

    it('should respect token budget', async () => {
      // Create multiple files
      await fs.mkdir(path.join(testRepoDir, 'src'), { recursive: true });
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(
          path.join(testRepoDir, 'src', `file${i}.ts`),
          'x'.repeat(1000) // ~250 tokens each
        );
      }

      const config: AggregatorConfig = {
        repoRoot: testRepoDir,
        runDir: testRunDir,
        featureId: 'test-feature',
        contextPaths: ['src/**/*.ts'],
        tokenBudget: 1000, // Tight budget
      };

      const result = await aggregateContext(config);

      expect(result.contextDocument.total_token_count).toBeLessThanOrEqual(1000);
      expect(result.ranking.excluded.length).toBeGreaterThan(0);
    });

    it('should handle exclusion patterns', async () => {
      // Create files including excluded patterns
      await fs.mkdir(path.join(testRepoDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(testRepoDir, 'node_modules', 'test.js'), 'should be excluded');
      await fs.writeFile(path.join(testRepoDir, 'index.js'), 'should be included');

      const config: AggregatorConfig = {
        repoRoot: testRepoDir,
        runDir: testRunDir,
        featureId: 'test-feature',
        contextPaths: ['**/*.js'],
        tokenBudget: 10000,
      };

      const result = await aggregateContext(config);

      const paths = Object.keys(result.contextDocument.files);
      expect(paths).not.toContain('node_modules/test.js');
      expect(paths.some((p) => p.includes('index.js'))).toBe(true);
    });
  });

  describe('getGitMetadata', () => {
    it('should handle non-git repositories gracefully', async () => {
      const metadata = await getGitMetadata(testRepoDir);

      expect(metadata.commitSha).toBeUndefined();
      expect(metadata.branch).toBeUndefined();
      expect(metadata.fileCommitDates.size).toBe(0);
    });

    // Skip git tests if running in an environment without .git directory
    const projectRoot = path.resolve(__dirname, '../..');
    const hasGit = (() => {
      try {
        return fsSync.existsSync(path.join(projectRoot, '.git'));
      } catch {
        return false;
      }
    })();

    (hasGit ? it : it.skip)(
      'should return git metadata for actual git repository (CDMCH-91)',
      async () => {
        const metadata = await getGitMetadata(projectRoot);

        // In a real git repo, we should get commit SHA and branch
        expect(metadata.commitSha).toBeDefined();
        expect(metadata.commitSha).toMatch(/^[a-f0-9]{40}$/);
        expect(metadata.branch).toBeDefined();
        expect(typeof metadata.branch).toBe('string');
      }
    );

    (hasGit ? it : it.skip)(
      'should populate fileCommitDates map for git repository (CDMCH-91)',
      async () => {
        const metadata = await getGitMetadata(projectRoot);

        // fileCommitDates should have entries for tracked files
        expect(metadata.fileCommitDates.size).toBeGreaterThan(0);
      }
    );
  });
});
