import { describe, it, expect } from 'vitest';
import {
  scoreByPathDepth,
  scoreByGitRecency,
  scoreByFileType,
  scoreBySize,
  calculateCompositeScore,
  estimateTokens,
  rankAndBudgetFiles,
  getExclusionSummary,
  type FileMetadata,
  type ScoringWeights,
} from '../../src/workflows/contextRanking';

// ============================================================================
// Test Utilities
// ============================================================================

function createTestFileMetadata(
  overrides: Partial<Omit<FileMetadata, 'score'>> = {}
): Omit<FileMetadata, 'score'> {
  return {
    path: '/repo/src/index.ts',
    relativePath: 'src/index.ts',
    hash: 'abc123def456'.repeat(5) + 'abcd',
    size: 5000,
    mtime: new Date('2025-01-01T10:00:00Z'),
    gitLastModified: new Date('2025-01-01T10:00:00Z'),
    estimatedTokens: 1250,
    ...overrides,
  };
}

// ============================================================================
// Path Depth Scoring Tests
// ============================================================================

describe('scoreByPathDepth', () => {
  it('should return 1.0 for root-level files', () => {
    const score = scoreByPathDepth('README.md');
    expect(score).toBe(1.0);
  });

  it('should return high score for shallow files', () => {
    const score = scoreByPathDepth('src/index.ts');
    expect(score).toBe(0.8);
  });

  it('should return lower score for deeper files', () => {
    const score = scoreByPathDepth('src/adapters/github/client.ts');
    expect(score).toBe(0.4);
  });

  it('should return 0.0 for files at depth 5 or deeper', () => {
    const score = scoreByPathDepth('a/b/c/d/e/deep.ts');
    expect(score).toBe(0.0);
  });

  it('should handle files exactly at max depth', () => {
    const score = scoreByPathDepth('a/b/c/d/file.ts');
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('should handle empty path', () => {
    const score = scoreByPathDepth('');
    expect(score).toBe(1.0);
  });
});

// ============================================================================
// Git Recency Scoring Tests
// ============================================================================

describe('scoreByGitRecency', () => {
  it('should return 0.5 when gitLastModified is undefined', () => {
    const score = scoreByGitRecency(undefined);
    expect(score).toBe(0.5);
  });

  it('should return 1.0 for files modified today', () => {
    const now = new Date();
    const score = scoreByGitRecency(now, now);
    expect(score).toBe(1.0);
  });

  it('should return high score for recently modified files', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const modified = new Date('2025-01-25T12:00:00Z'); // 1 day ago
    const score = scoreByGitRecency(modified, now);
    expect(score).toBeCloseTo(1 - 1 / 180, 2);
  });

  it('should return 0.0 for files older than 180 days', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const modified = new Date('2024-07-26T12:00:00Z'); // 184 days ago
    const score = scoreByGitRecency(modified, now);
    expect(score).toBe(0.0);
  });

  it('should return 0.5 for files about 90 days old', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const modified = new Date('2024-10-28T12:00:00Z'); // ~90 days ago
    const score = scoreByGitRecency(modified, now);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('should handle exactly 180 days boundary', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const modified = new Date('2024-07-30T12:00:00Z'); // exactly 180 days
    const score = scoreByGitRecency(modified, now);
    expect(score).toBeCloseTo(0.0, 1);
  });
});

// ============================================================================
// File Type Scoring Tests
// ============================================================================

describe('scoreByFileType', () => {
  describe('README files', () => {
    it('should return 1.0 for README.md', () => {
      expect(scoreByFileType('README.md')).toBe(1.0);
    });

    it('should return 1.0 for readme.txt', () => {
      expect(scoreByFileType('readme.txt')).toBe(1.0);
    });

    it('should return 1.0 for nested README', () => {
      expect(scoreByFileType('docs/README.md')).toBe(1.0);
    });
  });

  describe('Build artifacts and lock files', () => {
    it('should return 0.2 for package-lock.json', () => {
      expect(scoreByFileType('package-lock.json')).toBe(0.2);
    });

    it('should return 0.2 for yarn.lock', () => {
      expect(scoreByFileType('yarn.lock')).toBe(0.2);
    });

    it('should return 0.2 for files in dist/', () => {
      expect(scoreByFileType('dist/index.js')).toBe(0.2);
    });

    it('should return 0.2 for files in build/', () => {
      expect(scoreByFileType('build/bundle.js')).toBe(0.2);
    });

    it('should return 0.2 for files starting with dist/', () => {
      expect(scoreByFileType('dist/main.js')).toBe(0.2);
    });
  });

  describe('Documentation files', () => {
    it('should return 0.8 for .md files', () => {
      expect(scoreByFileType('CONTRIBUTING.md')).toBe(0.8);
    });

    it('should return 0.8 for files in docs/', () => {
      expect(scoreByFileType('docs/api.md')).toBe(0.8);
    });

    it('should return 0.8 for files starting with docs/', () => {
      expect(scoreByFileType('docs/guide/intro.md')).toBe(0.8);
    });
  });

  describe('Source code files', () => {
    it('should return 0.6 for .ts files', () => {
      expect(scoreByFileType('src/index.ts')).toBe(0.6);
    });

    it('should return 0.6 for .js files', () => {
      expect(scoreByFileType('src/utils.js')).toBe(0.6);
    });

    it('should return 0.6 for .tsx files', () => {
      expect(scoreByFileType('src/App.tsx')).toBe(0.6);
    });

    it('should return 0.6 for .jsx files', () => {
      expect(scoreByFileType('src/Component.jsx')).toBe(0.6);
    });

    it('should return 0.6 for .py files', () => {
      expect(scoreByFileType('main.py')).toBe(0.6);
    });

    it('should return 0.6 for .go files', () => {
      expect(scoreByFileType('main.go')).toBe(0.6);
    });

    it('should return 0.6 for .rs files', () => {
      expect(scoreByFileType('src/lib.rs')).toBe(0.6);
    });

    it('should return 0.6 for .java files', () => {
      expect(scoreByFileType('src/Main.java')).toBe(0.6);
    });
  });

  describe('Test files', () => {
    it('should return 0.4 for .test.ts files', () => {
      expect(scoreByFileType('src/utils.test.ts')).toBe(0.4);
    });

    it('should return 0.4 for .spec.ts files', () => {
      expect(scoreByFileType('src/utils.spec.ts')).toBe(0.4);
    });

    it('should return 0.4 for files in tests/ directory with test suffix', () => {
      // Files need .test. or .spec. suffix to be identified as tests
      expect(scoreByFileType('tests/unit/helper.test.ts')).toBe(0.4);
    });

    it('should return 0.4 for files in __tests__ directory', () => {
      expect(scoreByFileType('src/__tests__/utils.ts')).toBe(0.4);
    });

    it('should return 0.5 for non-source files in test directories', () => {
      // JSON files in test directories return config score (0.5)
      expect(scoreByFileType('test/fixtures.json')).toBe(0.5);
    });
  });

  describe('Config files', () => {
    it('should return 0.5 for .json files', () => {
      expect(scoreByFileType('config.json')).toBe(0.5);
    });

    it('should return 0.5 for .yaml files', () => {
      expect(scoreByFileType('config.yaml')).toBe(0.5);
    });

    it('should return 0.5 for .yml files', () => {
      expect(scoreByFileType('.github/workflows/ci.yml')).toBe(0.5);
    });

    it('should return 0.5 for .toml files', () => {
      expect(scoreByFileType('Cargo.toml')).toBe(0.5);
    });

    it('should return 0.5 for package.json', () => {
      expect(scoreByFileType('package.json')).toBe(0.5);
    });

    it('should return 0.5 for tsconfig.json', () => {
      expect(scoreByFileType('tsconfig.json')).toBe(0.5);
    });
  });

  describe('Unknown file types', () => {
    it('should return 0.5 for unknown extensions', () => {
      expect(scoreByFileType('file.xyz')).toBe(0.5);
    });

    it('should return 0.5 for files without extension', () => {
      expect(scoreByFileType('Makefile')).toBe(0.5);
    });
  });
});

// ============================================================================
// File Size Scoring Tests
// ============================================================================

describe('scoreBySize', () => {
  it('should return 0.0 for empty files', () => {
    expect(scoreBySize(0)).toBe(0.0);
  });

  it('should return score proportional to optimal min for small files', () => {
    expect(scoreBySize(512)).toBe(0.5); // 512 / 1024
    expect(scoreBySize(256)).toBe(0.25);
  });

  it('should return 1.0 for files in optimal range (1KB-100KB)', () => {
    expect(scoreBySize(1024)).toBe(1.0); // 1KB
    expect(scoreBySize(50 * 1024)).toBe(1.0); // 50KB
    expect(scoreBySize(100 * 1024)).toBe(1.0); // 100KB
  });

  it('should penalize files larger than 100KB', () => {
    const score = scoreBySize(500 * 1024); // 500KB
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0.0);
  });

  it('should return 0.0 for files larger than 1MB', () => {
    expect(scoreBySize(1000 * 1024)).toBe(0.0); // 1MB
    expect(scoreBySize(2000 * 1024)).toBe(0.0); // 2MB
  });

  it('should handle boundary at optimal min', () => {
    expect(scoreBySize(1023)).toBeLessThan(1.0);
    expect(scoreBySize(1024)).toBe(1.0);
  });

  it('should handle boundary at optimal max', () => {
    expect(scoreBySize(100 * 1024)).toBe(1.0);
    expect(scoreBySize(100 * 1024 + 1)).toBeLessThan(1.0);
  });
});

// ============================================================================
// Composite Score Tests
// ============================================================================

describe('calculateCompositeScore', () => {
  it('should calculate weighted average with default weights', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const metadata = createTestFileMetadata({
      relativePath: 'README.md', // depth: 1.0, type: 1.0
      gitLastModified: now, // recency: 1.0
      size: 5000, // size: 1.0 (in optimal range)
    });

    const score = calculateCompositeScore(metadata, {}, now);
    // 1.0*0.3 + 1.0*0.3 + 1.0*0.3 + 1.0*0.1 = 1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('should use custom weights when provided', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const metadata = createTestFileMetadata({
      relativePath: 'src/deep/nested/file.ts', // low depth score
      gitLastModified: now,
      size: 5000,
    });

    const weights: Partial<ScoringWeights> = {
      pathDepth: 0.0, // Ignore depth
      gitRecency: 0.0, // Ignore recency
      fileType: 1.0, // Only consider file type
      fileSize: 0.0, // Ignore size
    };

    const score = calculateCompositeScore(metadata, weights, now);
    expect(score).toBeCloseTo(0.6, 2); // .ts file score
  });

  it('should clamp result between 0 and 1', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const goodMetadata = createTestFileMetadata({
      relativePath: 'README.md',
      gitLastModified: now,
      size: 5000,
    });

    const score = calculateCompositeScore(goodMetadata, {}, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should handle missing gitLastModified', () => {
    const metadata = createTestFileMetadata({
      gitLastModified: undefined,
    });

    const score = calculateCompositeScore(metadata);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ============================================================================
// Token Estimation Tests
// ============================================================================

describe('estimateTokens', () => {
  it('should estimate 0 tokens for empty file', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('should estimate ~1 token per 4 characters', () => {
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(1000)).toBe(250);
  });

  it('should round up partial tokens', () => {
    expect(estimateTokens(1)).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens(5)).toBe(2); // ceil(5/4) = 2
    expect(estimateTokens(7)).toBe(2); // ceil(7/4) = 2
  });
});

// ============================================================================
// Ranking and Budgeting Tests
// ============================================================================

describe('rankAndBudgetFiles', () => {
  it('should return empty result for empty input', () => {
    const result = rankAndBudgetFiles([], 10000);

    expect(result.included).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.totalTokens).toBe(0);
    expect(result.diagnostics.totalFiles).toBe(0);
  });

  it('should include all files when within budget', () => {
    const files = [
      createTestFileMetadata({ estimatedTokens: 100 }),
      createTestFileMetadata({ estimatedTokens: 200, relativePath: 'b.ts' }),
    ];

    const result = rankAndBudgetFiles(files, 1000);

    expect(result.included.length).toBe(2);
    expect(result.excluded.length).toBe(0);
    expect(result.totalTokens).toBe(300);
  });

  it('should exclude files when budget exceeded', () => {
    const files = [
      createTestFileMetadata({ estimatedTokens: 500, relativePath: 'a.ts' }),
      createTestFileMetadata({ estimatedTokens: 400, relativePath: 'b.ts' }),
      createTestFileMetadata({ estimatedTokens: 300, relativePath: 'c.ts' }),
    ];

    const result = rankAndBudgetFiles(files, 800);

    expect(result.included.length).toBeLessThan(3);
    expect(result.totalTokens).toBeLessThanOrEqual(800);
    expect(result.excluded.length).toBeGreaterThan(0);
  });

  it('should sort files by score descending', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const files = [
      createTestFileMetadata({
        relativePath: 'src/deep/nested/file.ts',
        estimatedTokens: 100,
      }),
      createTestFileMetadata({
        relativePath: 'README.md', // Higher score
        estimatedTokens: 100,
      }),
    ];

    const result = rankAndBudgetFiles(files, 10000, { now });

    expect(result.included[0].relativePath).toBe('README.md');
  });

  it('should apply maxFiles limit', () => {
    const files = [
      createTestFileMetadata({ estimatedTokens: 10, relativePath: 'a.ts' }),
      createTestFileMetadata({ estimatedTokens: 10, relativePath: 'b.ts' }),
      createTestFileMetadata({ estimatedTokens: 10, relativePath: 'c.ts' }),
      createTestFileMetadata({ estimatedTokens: 10, relativePath: 'd.ts' }),
    ];

    const result = rankAndBudgetFiles(files, 10000, { maxFiles: 2 });

    expect(result.included.length).toBe(2);
    expect(result.excluded.length).toBe(2);
    expect(result.diagnostics.maxFiles).toBe(2);
  });

  it('should apply both maxFiles and budget constraints', () => {
    const files = [
      createTestFileMetadata({ estimatedTokens: 500, relativePath: 'a.ts' }),
      createTestFileMetadata({ estimatedTokens: 500, relativePath: 'b.ts' }),
      createTestFileMetadata({ estimatedTokens: 500, relativePath: 'c.ts' }),
    ];

    // maxFiles would allow 2, but budget only allows 1
    const result = rankAndBudgetFiles(files, 600, { maxFiles: 2 });

    expect(result.included.length).toBe(1);
    expect(result.totalTokens).toBe(500);
  });

  it('should calculate composite scores for files', () => {
    const files = [createTestFileMetadata()];

    const result = rankAndBudgetFiles(files, 10000);

    expect(result.included[0].score).toBeGreaterThan(0);
    expect(result.included[0].score).toBeLessThanOrEqual(1);
  });

  it('should provide accurate diagnostics', () => {
    const files = [
      createTestFileMetadata({ estimatedTokens: 100, relativePath: 'a.ts' }),
      createTestFileMetadata({ estimatedTokens: 200, relativePath: 'b.ts' }),
      createTestFileMetadata({ estimatedTokens: 300, relativePath: 'c.ts' }),
    ];

    const result = rankAndBudgetFiles(files, 250, { maxFiles: 10 });

    expect(result.diagnostics.totalFiles).toBe(3);
    expect(result.diagnostics.includedCount).toBe(result.included.length);
    expect(result.diagnostics.excludedCount).toBe(result.excluded.length);
    expect(result.diagnostics.tokenBudget).toBe(250);
    expect(result.diagnostics.maxFiles).toBe(10);
  });

  it('should use custom weights for scoring', () => {
    const now = new Date('2025-01-26T12:00:00Z');
    const files = [
      createTestFileMetadata({
        relativePath: 'deep/nested/file.ts', // Low depth score
        gitLastModified: now, // High recency
        estimatedTokens: 100,
      }),
      createTestFileMetadata({
        relativePath: 'root.ts', // High depth score
        gitLastModified: new Date('2024-01-01'), // Low recency
        estimatedTokens: 100,
      }),
    ];

    // Heavily weight recency
    const resultRecency = rankAndBudgetFiles(files, 10000, {
      weights: { pathDepth: 0, gitRecency: 1.0, fileType: 0, fileSize: 0 },
      now,
    });

    expect(resultRecency.included[0].relativePath).toBe('deep/nested/file.ts');
  });
});

// ============================================================================
// Exclusion Summary Tests
// ============================================================================

describe('getExclusionSummary', () => {
  it('should return zeros for empty excluded array', () => {
    const summary = getExclusionSummary([]);

    expect(summary.totalExcluded).toBe(0);
    expect(summary.excludedByBudget).toBe(0);
    expect(summary.excludedByMaxFiles).toBe(0);
  });

  it('should count all exclusions as budget exclusions when no maxFiles', () => {
    const excluded: FileMetadata[] = [
      { ...createTestFileMetadata(), score: 0.5 },
      { ...createTestFileMetadata(), score: 0.4 },
    ];

    const summary = getExclusionSummary(excluded);

    expect(summary.totalExcluded).toBe(2);
    expect(summary.excludedByBudget).toBe(2);
    expect(summary.excludedByMaxFiles).toBe(0);
  });

  it('should calculate maxFiles exclusions when maxFiles provided', () => {
    const excluded: FileMetadata[] = [
      { ...createTestFileMetadata(), score: 0.5 },
      { ...createTestFileMetadata(), score: 0.4 },
      { ...createTestFileMetadata(), score: 0.3 },
    ];

    const summary = getExclusionSummary(excluded, 5);

    expect(summary.totalExcluded).toBe(3);
    // With maxFiles=5 and 3 excluded, heuristic assumes 3-5=-2, clamped to 0
    expect(summary.excludedByMaxFiles).toBe(0);
    expect(summary.excludedByBudget).toBe(3);
  });

  it('should handle edge case where totalExcluded > maxFiles', () => {
    const excluded: FileMetadata[] = Array(10)
      .fill(null)
      .map(() => ({ ...createTestFileMetadata(), score: 0.5 }));

    const summary = getExclusionSummary(excluded, 5);

    expect(summary.totalExcluded).toBe(10);
    // 10 excluded - 5 maxFiles = 5 excluded by maxFiles
    expect(summary.excludedByMaxFiles).toBe(5);
    expect(summary.excludedByBudget).toBe(5);
  });
});
