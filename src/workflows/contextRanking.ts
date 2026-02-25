/**
 * Context Ranking Module
 *
 * Provides scoring and ranking functions for repository files
 * to prioritize context aggregation under token budgets.
 *
 *
 * Scoring factors:
 * - Path depth (shallower files = higher priority)
 * - Git recency (recently modified = higher priority)
 * - File type (README/docs > source > tests)
 * - File size (reasonable size preferred)
 */

/**
 * File metadata used for ranking
 */
export interface FileMetadata {
  /** Absolute path to the file */
  path: string;
  /** Relative path from repository root */
  relativePath: string;
  /** SHA-256 hash of file contents */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Last modified time from filesystem */
  mtime: Date;
  /** Last modified time from git (if available) */
  gitLastModified?: Date;
  /** Composite score (0-1, higher is better) */
  score: number;
  /** Estimated token count */
  estimatedTokens: number;
}

/**
 * Scoring weights configuration
 */
export interface ScoringWeights {
  /** Weight for path depth factor (default: 0.3) */
  pathDepth: number;
  /** Weight for git recency factor (default: 0.3) */
  gitRecency: number;
  /** Weight for file type factor (default: 0.3) */
  fileType: number;
  /** Weight for file size factor (default: 0.1) */
  fileSize: number;
}

/**
 * Result of ranking and budgeting operation
 */
export interface RankingResult {
  /** Files included within budget, sorted by score descending */
  included: FileMetadata[];
  /** Files excluded due to budget constraints */
  excluded: FileMetadata[];
  /** Total tokens for included files */
  totalTokens: number;
  /** Diagnostics about the ranking process */
  diagnostics: {
    /** Total files evaluated */
    totalFiles: number;
    /** Files included count */
    includedCount: number;
    /** Files excluded count */
    excludedCount: number;
    /** Token budget limit */
    tokenBudget: number;
    /** File count limit (if any) */
    maxFiles?: number;
  };
}

/**
 * Score a file based on its path depth
 *
 * Shallower files get higher scores (closer to repository root).
 * Normalized to 0-1 range.
 *
 */
export function scoreByPathDepth(relativePath: string): number {
  const depth = relativePath.split('/').length - 1;

  // Normalize: depth 0 = 1.0, depth 5+ = 0.0
  const maxDepth = 5;
  const score = Math.max(0, 1 - depth / maxDepth);

  return score;
}

/**
 * Score a file based on git recency
 *
 * Recently modified files get higher scores.
 * Normalized to 0-1 range.
 *
 */
export function scoreByGitRecency(
  gitLastModified: Date | undefined,
  now: Date = new Date()
): number {
  if (!gitLastModified) {
    // No git data available, use neutral score
    return 0.5;
  }

  const ageMs = now.getTime() - gitLastModified.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Normalize: 0 days = 1.0, 180+ days = 0.0
  const maxAgeDays = 180;
  const score = Math.max(0, 1 - ageDays / maxAgeDays);

  return score;
}

/**
 * Score a file based on its type
 *
 * Priority order:
 * - README files: 1.0
 * - Documentation: 0.8
 * - Source code: 0.6
 * - Config files: 0.5
 * - Tests: 0.4
 * - Build artifacts: 0.2
 *
 */
export function scoreByFileType(relativePath: string): number {
  const pathLower = relativePath.toLowerCase();
  const fileName = relativePath.split('/').pop()?.toLowerCase() || '';

  // README files
  if (fileName.startsWith('readme')) {
    return 1.0;
  }

  // Build artifacts and lock files (check EARLY before source code)
  if (
    fileName.includes('package-lock') ||
    fileName.includes('yarn.lock') ||
    pathLower.includes('/dist/') ||
    pathLower.includes('/build/') ||
    pathLower.startsWith('dist/') ||
    pathLower.startsWith('build/')
  ) {
    return 0.2;
  }

  // Documentation
  if (pathLower.includes('/docs/') || pathLower.startsWith('docs/') || fileName.endsWith('.md')) {
    return 0.8;
  }

  // Source code
  if (
    fileName.endsWith('.ts') ||
    fileName.endsWith('.js') ||
    fileName.endsWith('.tsx') ||
    fileName.endsWith('.jsx') ||
    fileName.endsWith('.py') ||
    fileName.endsWith('.go') ||
    fileName.endsWith('.rs') ||
    fileName.endsWith('.java')
  ) {
    // Downgrade test files
    if (
      pathLower.includes('/test/') ||
      pathLower.includes('/tests/') ||
      pathLower.includes('/__tests__/') ||
      fileName.includes('.test.') ||
      fileName.includes('.spec.')
    ) {
      return 0.4;
    }
    return 0.6;
  }

  // Config files
  if (
    fileName.endsWith('.json') ||
    fileName.endsWith('.yaml') ||
    fileName.endsWith('.yml') ||
    fileName.endsWith('.toml') ||
    fileName === 'package.json' ||
    fileName === 'tsconfig.json'
  ) {
    return 0.5;
  }

  // Tests
  if (
    pathLower.includes('/test/') ||
    pathLower.includes('/tests/') ||
    fileName.includes('.test.') ||
    fileName.includes('.spec.')
  ) {
    return 0.4;
  }

  // Default for unknown types
  return 0.5;
}

/**
 * Score a file based on its size
 *
 * Prefer files in a reasonable size range (1KB - 100KB).
 * Very small or very large files get lower scores.
 *
 */
export function scoreBySize(size: number): number {
  // Empty files get lowest score
  if (size === 0) {
    return 0.0;
  }

  // Optimal range: 1KB - 100KB
  const optimalMin = 1024; // 1KB
  const optimalMax = 100 * 1024; // 100KB

  if (size >= optimalMin && size <= optimalMax) {
    return 1.0;
  }

  // Too small (< 1KB)
  if (size < optimalMin) {
    return size / optimalMin;
  }

  // Too large (> 100KB), penalize heavily
  const maxSize = 1000 * 1024; // 1MB
  if (size > optimalMax) {
    const penalty = (size - optimalMax) / (maxSize - optimalMax);
    return Math.max(0, 1 - penalty);
  }

  return 0.5;
}

/**
 * Calculate composite score for a file
 *
 * Combines all scoring factors using weighted average.
 *
 */
export function calculateCompositeScore(
  metadata: Omit<FileMetadata, 'score'>,
  weights: Partial<ScoringWeights> = {},
  now: Date = new Date()
): number {
  // Default weights
  const finalWeights: ScoringWeights = {
    pathDepth: weights.pathDepth ?? 0.3,
    gitRecency: weights.gitRecency ?? 0.3,
    fileType: weights.fileType ?? 0.3,
    fileSize: weights.fileSize ?? 0.1,
  };

  // Calculate individual scores
  const depthScore = scoreByPathDepth(metadata.relativePath);
  const recencyScore = scoreByGitRecency(metadata.gitLastModified, now);
  const typeScore = scoreByFileType(metadata.relativePath);
  const sizeScore = scoreBySize(metadata.size);

  // Weighted average
  const compositeScore =
    depthScore * finalWeights.pathDepth +
    recencyScore * finalWeights.gitRecency +
    typeScore * finalWeights.fileType +
    sizeScore * finalWeights.fileSize;

  // Ensure result is in [0, 1] range
  return Math.max(0, Math.min(1, compositeScore));
}

/**
 * Estimate token count for a file
 *
 * Uses a simple heuristic: characters / 4
 * This approximates typical tokenization for English text and code.
 *
 */
export function estimateTokens(size: number): number {
  // Simple heuristic: ~4 characters per token
  return Math.ceil(size / 4);
}

/**
 * Rank files and apply token budget constraints
 *
 * Steps:
 * 1. Calculate composite scores for all files
 * 2. Sort files by score (descending)
 * 3. Apply max_files limit if specified
 * 4. Accumulate files until token budget exhausted
 * 5. Return included and excluded lists
 *
 */
export function rankAndBudgetFiles(
  files: Array<Omit<FileMetadata, 'score'>>,
  tokenBudget: number,
  options: {
    maxFiles?: number;
    weights?: Partial<ScoringWeights>;
    now?: Date;
  } = {}
): RankingResult {
  const { maxFiles, weights, now = new Date() } = options;

  const scoredFiles: FileMetadata[] = files.map((file) => ({
    ...file,
    score: calculateCompositeScore(file, weights, now),
  }));

  scoredFiles.sort((a, b) => b.score - a.score);

  const candidateFiles = maxFiles ? scoredFiles.slice(0, maxFiles) : scoredFiles;

  const included: FileMetadata[] = [];
  const excluded: FileMetadata[] = [];
  let totalTokens = 0;

  for (const file of candidateFiles) {
    if (totalTokens + file.estimatedTokens <= tokenBudget) {
      included.push(file);
      totalTokens += file.estimatedTokens;
    } else {
      excluded.push(file);
    }
  }

  // Add files excluded by maxFiles limit
  if (maxFiles && scoredFiles.length > maxFiles) {
    excluded.push(...scoredFiles.slice(maxFiles));
  }

  const diagnostics: {
    totalFiles: number;
    includedCount: number;
    excludedCount: number;
    tokenBudget: number;
    maxFiles?: number;
  } = {
    totalFiles: files.length,
    includedCount: included.length,
    excludedCount: excluded.length,
    tokenBudget,
  };

  if (maxFiles !== undefined) {
    diagnostics.maxFiles = maxFiles;
  }

  const result: RankingResult = {
    included,
    excluded,
    totalTokens,
    diagnostics,
  };

  return result;
}

/**
 * Get a summary of excluded files by reason
 *
 * Categorizes excluded files to help understand budget constraints.
 *
 */
export function getExclusionSummary(
  excluded: FileMetadata[],
  maxFiles?: number
): {
  excludedByBudget: number;
  excludedByMaxFiles: number;
  totalExcluded: number;
} {
  const totalExcluded = excluded.length;

  // Simple heuristic: if we have maxFiles, assume the first
  // (totalExcluded - maxFiles) were excluded by max files limit
  const excludedByMaxFiles = maxFiles ? Math.max(0, totalExcluded - maxFiles) : 0;

  const excludedByBudget = totalExcluded - excludedByMaxFiles;

  return {
    excludedByBudget,
    excludedByMaxFiles,
    totalExcluded,
  };
}
