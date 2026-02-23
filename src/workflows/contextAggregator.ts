/**
 * Context Aggregator
 *
 * Crawls repository globs, README, docs, and git history to collect
 * file metadata, contents, and scoring heuristics while respecting
 * token budgets defined in ADR-4.
 *
 * Key features:
 * - Configuration-driven glob expansion
 * - Incremental hashing to skip unchanged files
 * - Scoring and ranking with token budget enforcement
 * - Integration with run directory storage
 * - CLI options for manual inclusion/exclusion
 *
 * Implements FR-7/FR-8 requirements for context gathering.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoConfig } from '../core/config/RepoConfig';
import picomatch from 'picomatch';
import {
  createContextDocument,
  type ContextDocument,
  type ContextFileRecord,
  serializeContextDocument,
} from '../core/models/ContextDocument';
import {
  loadHashManifest,
  saveHashManifest,
  computeFileHash,
  type HashManifest,
} from '../persistence/hashManifest';
import { getSubdirectoryPath, withLock } from '../persistence';
import {
  estimateTokens,
  rankAndBudgetFiles,
  type FileMetadata,
  type RankingResult,
  type ScoringWeights,
} from './contextRanking';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for context aggregation
 */
export interface AggregatorConfig {
  /** Repository root directory */
  repoRoot: string;
  /** Run directory path */
  runDir: string;
  /** Feature ID */
  featureId: string;
  /** Glob patterns to include */
  contextPaths: string[];
  /** Token budget limit */
  tokenBudget: number;
  /** Maximum number of files (optional) */
  maxFiles?: number;
  /** Manual include overrides (explicit file paths or globs) */
  includeOverrides?: string[];
  /** Manual exclude overrides (explicit file paths or globs) */
  excludeOverrides?: string[];
  /** Scoring weights (optional) */
  weights?: Partial<ScoringWeights>;
}

/**
 * Git metadata for provenance
 */
export interface GitMetadata {
  /** Current commit SHA */
  commitSha?: string;
  /** Current branch */
  branch?: string;
  /** Map of file paths to last commit dates */
  fileCommitDates: Map<string, Date>;
}

/**
 * Result of context aggregation
 */
export interface AggregationResult {
  /** Generated context document */
  contextDocument: ContextDocument;
  /** Ranking result with included/excluded files */
  ranking: RankingResult;
  /** Diagnostics about the aggregation process */
  diagnostics: {
    /** Files discovered during scan */
    discovered: number;
    /** Files skipped (unchanged) */
    skipped: number;
    /** Files newly hashed */
    hashed: number;
    /** Files with errors */
    errors: string[];
    /** Warnings */
    warnings: string[];
  };
}

type GlobMatcher = (candidate: string) => boolean;

/**
 * Normalize unknown error inputs for logging and diagnostics
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// ============================================================================
// Configuration Resolution
// ============================================================================

/**
 * Resolve aggregator configuration from RepoConfig and CLI overrides
 *
 * @param repoConfig - Repository configuration
 * @param runDir - Run directory path
 * @param featureId - Feature identifier
 * @param overrides - CLI overrides (optional)
 * @returns Resolved aggregator configuration
 */
export function resolveAggregatorConfig(
  repoConfig: RepoConfig,
  runDir: string,
  featureId: string,
  overrides: {
    includeOverrides?: string[];
    excludeOverrides?: string[];
    tokenBudget?: number;
    maxFiles?: number;
  } = {}
): AggregatorConfig {
  // Start with repo config defaults
  const contextPaths = [...repoConfig.project.context_paths];

  // Apply include overrides
  if (overrides.includeOverrides) {
    contextPaths.push(...overrides.includeOverrides);
  }

  const maxFiles = overrides.maxFiles ?? repoConfig.constraints?.max_context_files;

  const config: AggregatorConfig = {
    repoRoot: path.dirname(path.resolve(process.cwd(), '.codemachine.yml')),
    runDir,
    featureId,
    contextPaths,
    tokenBudget: overrides.tokenBudget ?? repoConfig.runtime.context_token_budget,
    ...(maxFiles !== undefined && { maxFiles }),
    ...(overrides.includeOverrides && { includeOverrides: overrides.includeOverrides }),
    ...(overrides.excludeOverrides && { excludeOverrides: overrides.excludeOverrides }),
  };

  return config;
}

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Default exclusion patterns
 */
const DEFAULT_EXCLUSIONS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.log',
  '**/.DS_Store',
  '**/package-lock.json',
  '**/yarn.lock',
];

/**
 * Normalize pattern to forward slashes and expand trailing directory markers
 */
function normalizePattern(pattern: string): string {
  const normalized = pattern.replace(/\\/g, '/');
  if (normalized.endsWith('/')) {
    return `${normalized}**/*`;
  }
  return normalized;
}

/**
 * Create glob matchers using picomatch
 */
function createGlobMatchers(patterns: string[]): GlobMatcher[] {
  return patterns.map((pattern) => picomatch(normalizePattern(pattern), { dot: true }));
}

/**
 * Check if a file should be excluded
 */
function shouldExclude(relativePath: string, exclusionMatchers: GlobMatcher[]): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return exclusionMatchers.some((matcher) => matcher(normalizedPath));
}

/**
 * Recursively discover files matching patterns
 *
 * @param repoRoot - Repository root directory
 * @param patterns - Glob patterns to match
 * @param exclusions - Exclusion patterns
 * @returns Array of absolute file paths
 */
async function discoverFiles(
  repoRoot: string,
  patterns: string[],
  exclusions: string[] = DEFAULT_EXCLUSIONS
): Promise<string[]> {
  const discovered = new Set<string>();
  const inclusionMatchers = createGlobMatchers(patterns);
  const exclusionMatchers = createGlobMatchers(exclusions);

  // Helper to recursively scan directories
  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(repoRoot, fullPath);
        const normalizedRelativePath = relativePath.replace(/\\/g, '/');

        // Skip excluded paths
        if (shouldExclude(normalizedRelativePath, exclusionMatchers)) {
          continue;
        }

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          discovered.add(fullPath);
        }
      }
    } catch (error) {
      // Skip inaccessible directories
      console.warn(`Skipping directory ${dir}: ${formatError(error)}`);
    }
  }

  // Scan directory and collect matching files
  await scanDirectory(repoRoot);

  // Filter discovered files by pattern matchers
  const matchedFiles = new Set<string>();
  for (const fullPath of discovered) {
    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    const matches = inclusionMatchers.some((matcher) => matcher(relativePath));
    if (matches) {
      matchedFiles.add(fullPath);
    }
  }

  return Array.from(matchedFiles);
}

// ============================================================================
// Git Metadata Extraction
// ============================================================================

/**
 * Extract git metadata for the repository
 *
 * @param repoRoot - Repository root directory
 * @returns Git metadata (commit SHA, branch, file dates)
 */
export async function getGitMetadata(repoRoot: string): Promise<GitMetadata> {
  const metadata: GitMetadata = {
    fileCommitDates: new Map(),
  };

  try {
    // Get current commit SHA
    const { stdout: shaOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      timeout: 5000,
    });
    metadata.commitSha = shaOutput.trim();
  } catch {
    // Not a git repository or git not available
  }

  try {
    // Get current branch
    const { stdout: branchOutput } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: repoRoot, timeout: 5000 }
    );
    metadata.branch = branchOutput.trim();
  } catch {
    // Branch not available
  }

  try {
    // Get file modification dates from git log
    const { stdout: logOutput } = await execFileAsync(
      'git',
      ['log', '--name-only', '--format=%ct', '--all'],
      { cwd: repoRoot, timeout: 10000, maxBuffer: 10 * 1024 * 1024 }
    );

    // Parse output: timestamp followed by file paths
    const lines = logOutput.split('\n');
    let currentTimestamp: Date | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if line is a timestamp
      if (/^\d+$/.test(trimmed)) {
        currentTimestamp = new Date(parseInt(trimmed, 10) * 1000);
      } else if (currentTimestamp) {
        // Line is a file path
        const fullPath = path.resolve(repoRoot, trimmed);

        // Only record if we haven't seen this file yet (most recent)
        if (!metadata.fileCommitDates.has(fullPath)) {
          metadata.fileCommitDates.set(fullPath, currentTimestamp);
        }
      }
    }
  } catch (error) {
    // Git log failed, continue without file dates
    console.warn(`Failed to extract git file dates: ${formatError(error)}`);
  }

  return metadata;
}

// ============================================================================
// Incremental Hashing
// ============================================================================

/**
 * Load previous hash manifest if it exists
 *
 * @param contextDir - Context directory path
 * @returns Previous hash manifest or null if not found
 */
async function loadPreviousHashes(contextDir: string): Promise<HashManifest | null> {
  const hashManifestPath = path.join(contextDir, 'file_hashes.json');

  try {
    return await loadHashManifest(hashManifestPath);
  } catch {
    return null;
  }
}

/**
 * Hash discovered files and detect changes
 *
 * @param files - Array of absolute file paths
 * @param previousManifest - Previous hash manifest (optional)
 * @returns Hash manifest and change detection results
 */
async function hashDiscoveredFiles(
  files: string[],
  previousManifest: HashManifest | null
): Promise<{
  manifest: HashManifest;
  unchanged: string[];
  changed: string[];
  new: string[];
}> {
  const unchanged: string[] = [];
  const changed: string[] = [];
  const newFiles: string[] = [];

  const previousHashes = new Map(
    Object.entries(previousManifest?.files || {}).map(([path, record]) => [path, record.hash])
  );

  // Hash files with concurrency control
  const hashPromises = files.map(async (filePath) => {
    try {
      const hash = await computeFileHash(filePath);
      const previousHash = previousHashes.get(filePath);

      if (previousHash === undefined) {
        newFiles.push(filePath);
      } else if (previousHash === hash) {
        unchanged.push(filePath);
      } else {
        changed.push(filePath);
      }

      return { filePath, hash };
    } catch (error) {
      console.warn(`Failed to hash ${filePath}: ${formatError(error)}`);
      return null;
    }
  });

  const results = await Promise.all(hashPromises);

  // Build new manifest
  const manifestFiles: HashManifest['files'] = {};
  const now = new Date().toISOString();

  for (const result of results) {
    if (result) {
      const stats = await fs.stat(result.filePath);
      manifestFiles[result.filePath] = {
        path: result.filePath,
        hash: result.hash,
        size: stats.size,
        timestamp: now,
      };
    }
  }

  const manifest: HashManifest = {
    schema_version: '1.0.0',
    created_at: previousManifest?.created_at || now,
    updated_at: now,
    files: manifestFiles,
  };

  return { manifest, unchanged, changed, new: newFiles };
}

// ============================================================================
// File Metadata Collection
// ============================================================================

/**
 * Collect metadata for discovered files
 *
 * @param files - Array of absolute file paths
 * @param repoRoot - Repository root directory
 * @param gitMetadata - Git metadata
 * @returns Array of file metadata
 */
async function collectFileMetadata(
  files: string[],
  repoRoot: string,
  gitMetadata: GitMetadata
): Promise<Array<Omit<FileMetadata, 'score'>>> {
  const metadata: Array<Omit<FileMetadata, 'score'>> = [];

  for (const filePath of files) {
    try {
      const stats = await fs.stat(filePath);
      const hash = await computeFileHash(filePath);
      const relativePath = path.relative(repoRoot, filePath);
      const gitLastModified = gitMetadata.fileCommitDates.get(filePath);

      const fileMetadata: Omit<FileMetadata, 'score'> = {
        path: filePath,
        relativePath,
        hash,
        size: stats.size,
        mtime: stats.mtime,
        estimatedTokens: estimateTokens(stats.size),
      };

      if (gitLastModified !== undefined) {
        fileMetadata.gitLastModified = gitLastModified;
      }

      metadata.push(fileMetadata);
    } catch (error) {
      console.warn(`Failed to collect metadata for ${filePath}: ${formatError(error)}`);
    }
  }

  return metadata;
}

// ============================================================================
// Main Aggregation Orchestrator
// ============================================================================

/**
 * Aggregate repository context
 *
 * Main entry point for context aggregation. Performs:
 * 1. Configuration resolution
 * 2. File discovery
 * 3. Incremental hashing
 * 4. Metadata collection
 * 5. Ranking and budgeting
 * 6. Context document generation
 * 7. Persistence to run directory
 *
 * @param config - Aggregator configuration
 * @returns Aggregation result
 */
export async function aggregateContext(config: AggregatorConfig): Promise<AggregationResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Step 1: Get context directory
  const contextDir = getSubdirectoryPath(config.runDir, 'context');

  // Step 2: Extract git metadata
  const gitMetadata = await getGitMetadata(config.repoRoot);

  // Step 3: Discover files
  const exclusions = [...DEFAULT_EXCLUSIONS, ...(config.excludeOverrides || [])];

  let discoveredFiles: string[];
  try {
    discoveredFiles = await discoverFiles(config.repoRoot, config.contextPaths, exclusions);
  } catch (error) {
    errors.push(`File discovery failed: ${formatError(error)}`);
    discoveredFiles = [];
  }

  if (discoveredFiles.length === 0) {
    warnings.push('No files discovered matching configured patterns');
  }

  // Step 4: Load previous hashes for incremental processing
  const previousManifest = await loadPreviousHashes(contextDir);

  // Step 5: Hash files and detect changes
  const hashResult = await hashDiscoveredFiles(discoveredFiles, previousManifest);

  // Step 6: Collect metadata
  const fileMetadata = await collectFileMetadata(discoveredFiles, config.repoRoot, gitMetadata);

  // Step 7: Rank and budget files
  const rankingOptions: {
    maxFiles?: number;
    weights?: Partial<ScoringWeights>;
    now?: Date;
  } = {};

  if (config.maxFiles !== undefined) {
    rankingOptions.maxFiles = config.maxFiles;
  }
  if (config.weights !== undefined) {
    rankingOptions.weights = config.weights;
  }

  const ranking = rankAndBudgetFiles(fileMetadata, config.tokenBudget, rankingOptions);

  // Step 8: Build context document
  const contextDocument = buildContextDocument(
    config.featureId,
    ranking.included,
    gitMetadata,
    config.repoRoot
  );

  // Step 9: Persist artifacts
  await persistContextArtifacts(contextDir, config.runDir, contextDocument, hashResult.manifest);

  // Build diagnostics
  const diagnostics = {
    discovered: discoveredFiles.length,
    skipped: hashResult.unchanged.length,
    hashed: hashResult.new.length + hashResult.changed.length,
    errors,
    warnings,
  };

  return {
    contextDocument,
    ranking,
    diagnostics,
  };
}

/**
 * Build context document from ranked files
 *
 * @param featureId - Feature identifier
 * @param files - Included files from ranking
 * @param gitMetadata - Git metadata
 * @param repoRoot - Repository root
 * @returns Context document
 */
function buildContextDocument(
  featureId: string,
  files: FileMetadata[],
  gitMetadata: GitMetadata,
  repoRoot: string
): ContextDocument {
  const options: {
    commitSha?: string;
    branch?: string;
    metadata?: Record<string, unknown>;
  } = {};

  if (gitMetadata.commitSha !== undefined) {
    options.commitSha = gitMetadata.commitSha;
  }
  if (gitMetadata.branch !== undefined) {
    options.branch = gitMetadata.branch;
  }

  const contextDoc = createContextDocument(featureId, 'manual', options);

  // Add file records
  const fileRecords: Record<string, ContextFileRecord> = {};
  for (const file of files) {
    const relativePath = path.relative(repoRoot, file.path);
    const ext = path.extname(relativePath);

    fileRecords[relativePath] = {
      path: relativePath,
      hash: file.hash,
      size: file.size,
      file_type: ext.replace('.', ''),
      token_count: file.estimatedTokens,
    };
  }

  // Calculate total tokens
  const totalTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    ...contextDoc,
    files: fileRecords,
    total_token_count: totalTokens,
  };
}

/**
 * Persist context artifacts to run directory
 *
 * @param contextDir - Context directory path
 * @param runDir - Run directory path
 * @param contextDocument - Context document to persist
 * @param hashManifest - Hash manifest to persist
 */
async function persistContextArtifacts(
  contextDir: string,
  runDir: string,
  contextDocument: ContextDocument,
  hashManifest: HashManifest
): Promise<void> {
  await withLock(runDir, async () => {
    // Ensure context directory exists
    await fs.mkdir(contextDir, { recursive: true });

    // Write summary.json
    const summaryPath = path.join(contextDir, 'summary.json');
    const summaryContent = serializeContextDocument(contextDocument);
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');

    // Write file_hashes.json
    const hashManifestPath = path.join(contextDir, 'file_hashes.json');
    await saveHashManifest(hashManifest, hashManifestPath);
  });
}
