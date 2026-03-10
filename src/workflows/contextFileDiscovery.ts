/**
 * Context File Discovery
 *
 * Handles file scanning, exclusion filtering, git history walking,
 * incremental hashing, and file metadata collection for context aggregation.
 */

import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import { loadHashManifest, computeFileHash, type HashManifest } from '../persistence';
import { estimateTokens, type FileMetadata } from './contextRanking';

const execFileAsync = promisify(execFile);

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

type GlobMatcher = (candidate: string) => boolean;

/**
 * Normalize unknown error inputs for logging and diagnostics
 */
export function formatError(error: unknown): string {
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

/**
 * Default exclusion patterns
 */
export const DEFAULT_EXCLUSIONS = [
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
export async function discoverFiles(
  repoRoot: string,
  patterns: string[],
  exclusions: string[] = DEFAULT_EXCLUSIONS
): Promise<string[]> {
  const logicalRepoRoot = resolve(repoRoot);
  const canonicalRepoRoot = await realpath(logicalRepoRoot).catch(() => logicalRepoRoot);
  const discovered = new Set<string>();
  const visitedDirectories = new Set<string>();
  const inclusionMatchers = createGlobMatchers(patterns);
  const exclusionMatchers = createGlobMatchers(exclusions);

  // Helper to recursively scan directories
  async function scanDirectory(dir: string): Promise<void> {
    try {
      const resolvedDir = await realpath(dir);
      if (visitedDirectories.has(resolvedDir)) {
        return;
      }
      visitedDirectories.add(resolvedDir);
    } catch {
      if (visitedDirectories.has(dir)) {
        return;
      }
      visitedDirectories.add(dir);
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(canonicalRepoRoot, fullPath);
        const normalizedRelativePath = relativePath.replace(/\\/g, '/');

        // Skip excluded paths
        if (shouldExclude(normalizedRelativePath, exclusionMatchers)) {
          continue;
        }

        // Resolve symlinks safely:
        // - ignore targets outside repoRoot
        // - use stat(realPath) for type checks
        // - rely on visitedDirectories to avoid recursive cycles
        if (entry.isSymbolicLink()) {
          try {
            const realPath = await realpath(fullPath);
            const rel = relative(canonicalRepoRoot, realPath);
            const normalizedResolvedRelativePath = rel.replace(/\\/g, '/');
            if (
              !rel.startsWith('..') &&
              !isAbsolute(rel) &&
              !shouldExclude(normalizedResolvedRelativePath, exclusionMatchers)
            ) {
              const stats = await stat(realPath);
              if (stats.isDirectory()) {
                await scanDirectory(realPath);
              } else if (stats.isFile()) {
                discovered.add(realPath);
              }
            }
          } catch {
            // Skip unresolvable symlinks
          }
        } else if (entry.isDirectory()) {
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
  await scanDirectory(canonicalRepoRoot);

  // Filter discovered files by pattern matchers
  const matchedFiles = new Set<string>();
  for (const canonicalPath of discovered) {
    const relativePath = relative(canonicalRepoRoot, canonicalPath);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    const matches = inclusionMatchers.some((matcher) => matcher(normalizedRelativePath));
    if (matches) {
      matchedFiles.add(resolve(logicalRepoRoot, relativePath));
    }
  }

  return Array.from(matchedFiles);
}

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
        const fullPath = resolve(repoRoot, trimmed);

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

/**
 * Load previous hash manifest if it exists
 *
 * @param contextDir - Context directory path
 * @returns Previous hash manifest or null if not found
 */
export async function loadPreviousHashes(contextDir: string): Promise<HashManifest | null> {
  const hashManifestPath = join(contextDir, 'file_hashes.json');

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
export async function hashDiscoveredFiles(
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
    Object.entries(previousManifest?.files || {}).map(([filePath, record]) => [
      filePath,
      record.hash,
    ])
  );

  // Hash files in parallel
  const hashPromises = files.map(async (filePath) => {
    try {
      const [hash, stats] = await Promise.all([computeFileHash(filePath), stat(filePath)]);
      const previousHash = previousHashes.get(filePath);

      if (previousHash === undefined) {
        newFiles.push(filePath);
      } else if (previousHash === hash) {
        unchanged.push(filePath);
      } else {
        changed.push(filePath);
      }

      return { filePath, hash, size: stats.size };
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
      manifestFiles[result.filePath] = {
        path: result.filePath,
        hash: result.hash,
        size: result.size,
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

/**
 * Collect metadata for discovered files
 *
 * @param files - Array of absolute file paths
 * @param repoRoot - Repository root directory
 * @param gitMetadata - Git metadata
 * @returns Array of file metadata
 */
export async function collectFileMetadata(
  files: string[],
  repoRoot: string,
  gitMetadata: GitMetadata
): Promise<Array<Omit<FileMetadata, 'score'>>> {
  const metadata: Array<Omit<FileMetadata, 'score'>> = [];

  for (const filePath of files) {
    try {
      const stats = await stat(filePath);
      const hash = await computeFileHash(filePath);
      const relativePath = relative(repoRoot, filePath);
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
