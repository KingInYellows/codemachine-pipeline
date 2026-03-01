/**
 * Context Aggregator
 *
 * Thin orchestrator that coordinates file discovery, ranking, and context
 * document assembly to collect repository context while respecting token
 * budgets defined in ADR-4.
 *
 * Implements FR-7/FR-8 requirements for context gathering.
 */

import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoConfig } from '../core/config/RepoConfig';
import { type ContextDocument } from '../core/models/ContextDocument';
import { getSubdirectoryPath } from '../persistence';
import { rankAndBudgetFiles, type RankingResult, type ScoringWeights } from './contextRanking';
import {
  DEFAULT_EXCLUSIONS,
  discoverFiles,
  getGitMetadata,
  loadPreviousHashes,
  hashDiscoveredFiles,
  collectFileMetadata,
  formatError,
  type GitMetadata,
} from './contextFileDiscovery';
import { buildContextDocument, persistContextArtifacts } from './contextDocumentBuilder';

export type { GitMetadata };
export { getGitMetadata };

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

  // Resolve repoRoot from git to ensure we stay within the repository boundary
  // Only use git root if it's the same as or a child of the configured root (monorepo safety)
  let repoRoot = config.repoRoot;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: config.repoRoot,
    });
    const gitRoot = stdout.trim();
    const relativeToGit = path.relative(gitRoot, config.repoRoot);

    // Only use git root if configured root is within it (not a parent directory)
    // If relativeToGit starts with '..', config.repoRoot is outside/above gitRoot
    if (!relativeToGit.startsWith('..') && !path.isAbsolute(relativeToGit)) {
      repoRoot = gitRoot;
    }
  } catch {
    // Fall back to the configured value if git is unavailable
  }
  const resolvedConfig = { ...config, repoRoot };

  const contextDir = getSubdirectoryPath(resolvedConfig.runDir, 'context');

  const gitMetadata = await getGitMetadata(resolvedConfig.repoRoot);

  const exclusions = [...DEFAULT_EXCLUSIONS, ...(resolvedConfig.excludeOverrides || [])];

  let discoveredFiles: string[];
  try {
    discoveredFiles = await discoverFiles(
      resolvedConfig.repoRoot,
      resolvedConfig.contextPaths,
      exclusions
    );
  } catch (error) {
    errors.push(`File discovery failed: ${formatError(error)}`);
    discoveredFiles = [];
  }

  if (discoveredFiles.length === 0) {
    warnings.push('No files discovered matching configured patterns');
  }

  const previousManifest = await loadPreviousHashes(contextDir);

  const hashResult = await hashDiscoveredFiles(discoveredFiles, previousManifest);

  const fileMetadata = await collectFileMetadata(
    discoveredFiles,
    resolvedConfig.repoRoot,
    gitMetadata
  );

  const rankingOptions: {
    maxFiles?: number;
    weights?: Partial<ScoringWeights>;
    now?: Date;
  } = {};

  if (resolvedConfig.maxFiles !== undefined) {
    rankingOptions.maxFiles = resolvedConfig.maxFiles;
  }
  if (resolvedConfig.weights !== undefined) {
    rankingOptions.weights = resolvedConfig.weights;
  }

  const ranking = rankAndBudgetFiles(fileMetadata, resolvedConfig.tokenBudget, rankingOptions);

  const contextDocument = buildContextDocument(
    resolvedConfig.featureId,
    ranking.included,
    gitMetadata,
    resolvedConfig.repoRoot
  );

  await persistContextArtifacts(
    contextDir,
    resolvedConfig.runDir,
    contextDocument,
    hashResult.manifest
  );

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
