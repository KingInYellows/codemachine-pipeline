/**
 * Branch Manager
 *
 * Manages git branch operations with safety rails, including branch creation,
 * remote tracking, push operations, and branch metadata persistence.
 *
 * Key features:
 * - Feature branch creation from default branch
 * - Branch naming conventions (feature/, bugfix/, etc.)
 * - Remote push with upstream tracking
 * - Branch metadata storage in run directory
 * - Git safety validations (prevent force push, protect main branches)
 * - Status introspection (local/remote sync state)
 *
 * Implements:
 * - FR-12: Branch Lifecycle Management
 * - FR-13: Git Safety Rails
 * - ADR-3: Git Integration Patterns
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { validateOrThrow } from '../validation/helpers.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wrapError } from '../utils/errors';
import { withLock, getSubdirectoryPath, updateManifest } from '../persistence';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

/**
 * Branch manager configuration
 */
export interface BranchConfig {
  /** Run directory path */
  runDir: string;
  /** Feature identifier */
  featureId: string;
  /** Working directory (git repo root) */
  workingDir: string;
  /** Repository configuration */
  repoConfig: RepoConfig;
}

/**
 * Branch metadata persisted in run directory
 */
export interface BranchMetadata {
  schema_version: string;
  feature_id: string;
  branch_name: string;
  base_branch: string;
  created_at: string;
  updated_at: string;
  last_commit_sha?: string;
  remote_tracking_branch?: string;
  remote_url?: string;
  local_commits_ahead?: number;
  remote_commits_behind?: number;
  sync_status: 'synced' | 'ahead' | 'behind' | 'diverged' | 'unknown';
}

const BranchMetadataSchema = z.object({
  schema_version: z.string(),
  feature_id: z.string(),
  branch_name: z.string(),
  base_branch: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_commit_sha: z.string().optional(),
  remote_tracking_branch: z.string().optional(),
  remote_url: z.string().optional(),
  local_commits_ahead: z.number().optional(),
  remote_commits_behind: z.number().optional(),
  sync_status: z.enum(['synced', 'ahead', 'behind', 'diverged', 'unknown']),
});

/**
 * Branch creation options
 */
export interface CreateBranchOptions {
  /** Branch name (without prefix) */
  branchName?: string;
  /** Branch prefix (default: 'feature/') */
  branchPrefix?: 'feature/' | 'bugfix/' | 'hotfix/' | 'experiment/';
  /** Base branch to create from (default: repoConfig.project.default_branch) */
  baseBranch?: string;
  /** Whether to push to remote immediately */
  pushToRemote?: boolean;
  /** Remote name (default: 'origin') */
  remoteName?: string;
}

/**
 * Branch creation result
 */
export interface CreateBranchResult {
  /** Whether branch was created successfully */
  success: boolean;
  /** Created branch name */
  branchName?: string;
  /** Base commit SHA */
  baseSha?: string;
  /** Error message if failed */
  error?: string;
  /** Path to branch metadata file */
  metadataPath?: string;
}

/**
 * Branch push result
 */
export interface PushBranchResult {
  /** Whether push was successful */
  success: boolean;
  /** Remote URL */
  remoteUrl?: string;
  /** Remote tracking branch */
  trackingBranch?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Branch sync status
 */
export interface BranchSyncStatus {
  /** Current branch name */
  branchName: string;
  /** Remote tracking branch */
  trackingBranch?: string;
  /** Number of commits ahead of remote */
  commitsAhead: number;
  /** Number of commits behind remote */
  commitsBehind: number;
  /** Sync status */
  status: BranchMetadata['sync_status'];
  /** Last commit SHA */
  lastCommitSha: string;
}

// ============================================================================
// Branch Validation
// ============================================================================

/**
 * Check if a branch name is protected (e.g., main, master, develop)
 */
export function isProtectedBranch(branchName: string, repoConfig: RepoConfig): boolean {
  const protectedBranches = [
    repoConfig.project.default_branch,
    'main',
    'master',
    'develop',
    'production',
  ];

  return protectedBranches.some(
    (protectedBranch) =>
      branchName === protectedBranch || branchName.endsWith(`/${protectedBranch}`)
  );
}

/**
 * Validate branch name follows conventions
 */
export function validateBranchName(branchName: string): { valid: boolean; error?: string } {
  // Allowlist approach: only permit characters valid in git branch names
  // Rejects shell metacharacters (", `, $, (, ), etc.) as defense-in-depth
  const allowlistPattern = /^[a-zA-Z0-9._\/-]+$/;

  if (!allowlistPattern.test(branchName)) {
    return {
      valid: false,
      error: `Branch name "${branchName}" contains invalid characters (only alphanumeric, dot, underscore, slash, and hyphen are allowed)`,
    };
  }

  // Additional git-specific structural rules
  const invalidPatterns: RegExp[] = [
    /\.\./, // No double dots
    /\/\//, // No double slashes
    /^[./]/, // Cannot start with . or /
    /[/.]$/, // Cannot end with / or .
    /\.lock$/, // Cannot end with .lock
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(branchName)) {
      return {
        valid: false,
        error: `Branch name "${branchName}" contains invalid characters or patterns`,
      };
    }
  }

  return { valid: true };
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Get current branch name
 */
export async function getCurrentBranch(workingDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workingDir,
    });
    return stdout.trim();
  } catch (error) {
    throw wrapError(error, 'get current branch');
  }
}

/**
 * Check if a branch exists locally
 */
export async function branchExists(branchName: string, workingDir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', branchName], { cwd: workingDir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the commit SHA for a given ref
 */
export async function getCommitSha(ref: string, workingDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: workingDir });
    return stdout.trim();
  } catch (error) {
    throw wrapError(error, `get commit SHA for ${ref}`);
  }
}

/**
 * Get remote URL for a given remote name
 */
export async function getRemoteUrl(remoteName: string, workingDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remoteName], {
      cwd: workingDir,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get tracking branch for current branch
 */
export async function getTrackingBranch(workingDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { cwd: workingDir }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get ahead/behind counts relative to upstream
 */
export async function getAheadBehindCounts(
  workingDir: string
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
      { cwd: workingDir }
    );
    const parts = stdout.trim().split(/\s+/);
    return {
      behind: parseInt(parts[0] || '0', 10),
      ahead: parseInt(parts[1] || '0', 10),
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

// ============================================================================
// Branch Creation
// ============================================================================

/**
 * Generate branch name from feature ID
 */
export function generateBranchName(
  featureId: string,
  options: Pick<CreateBranchOptions, 'branchName' | 'branchPrefix'>
): string {
  const prefix = options.branchPrefix || 'feature/';
  const name = options.branchName || featureId;

  // Sanitize name: lowercase, replace spaces/special chars with hyphens
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_/]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${prefix}${sanitized}`;
}

/**
 * Create a new feature branch
 */
export async function createBranch(
  config: BranchConfig,
  options: CreateBranchOptions,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<CreateBranchResult> {
  const result: CreateBranchResult = {
    success: false,
  };

  try {
    // Step 1: Generate and validate branch name
    const branchName = generateBranchName(config.featureId, options);
    const validation = validateBranchName(branchName);

    if (!validation.valid) {
      result.error = validation.error || 'Branch name validation failed';
      logger.error('Branch name validation failed', { branchName, error: validation.error });
      return result;
    }

    // Step 2: Check if branch already exists
    const exists = await branchExists(branchName, config.workingDir);
    if (exists) {
      result.error = `Branch "${branchName}" already exists`;
      logger.warn('Branch already exists', { branchName });
      return result;
    }

    // Step 3: Determine base branch
    const baseBranch = options.baseBranch || config.repoConfig.project.default_branch;

    // Step 4: Ensure we're on the base branch and it's up to date
    const currentBranch = await getCurrentBranch(config.workingDir);
    if (currentBranch !== baseBranch) {
      logger.info('Switching to base branch', { baseBranch });
      await execFileAsync('git', ['checkout', baseBranch], { cwd: config.workingDir });
    }

    // Step 5: Get base commit SHA
    const baseSha = await getCommitSha(baseBranch, config.workingDir);
    result.baseSha = baseSha;

    // Step 6: Create the branch
    logger.info('Creating branch', { branchName, baseBranch, baseSha });
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: config.workingDir });

    result.branchName = branchName;
    result.success = true;

    logger.info('Branch created successfully', { branchName, baseBranch });

    // Step 7: Create branch metadata
    const metadataPath = await saveBranchMetadata(
      config,
      {
        schema_version: '1.0.0',
        feature_id: config.featureId,
        branch_name: branchName,
        base_branch: baseBranch,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_commit_sha: baseSha,
        sync_status: 'synced',
      },
      logger
    );

    result.metadataPath = metadataPath;

    // Step 8: Push to remote if requested
    if (options.pushToRemote) {
      const remoteName = options.remoteName || 'origin';
      const pushResult = await pushBranch(config, branchName, remoteName, logger, metrics);

      if (!pushResult.success) {
        logger.warn('Failed to push branch to remote', {
          branchName,
          error: pushResult.error,
        });
        // Don't fail the overall operation if push fails
      }
    }

    metrics.increment('branch_created_total', {
      feature_id: config.featureId,
    });
  } catch (error) {
    result.error = wrapError(error, 'create branch').message;
    logger.error('Branch creation failed', {
      featureId: config.featureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    metrics.increment('branch_creation_failed_total', {
      feature_id: config.featureId,
    });
  }

  return result;
}

// ============================================================================
// Branch Push
// ============================================================================

/**
 * Push branch to remote with upstream tracking
 */
export async function pushBranch(
  config: BranchConfig,
  branchName: string,
  remoteName: string,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<PushBranchResult> {
  const result: PushBranchResult = {
    success: false,
  };

  try {
    // Step 1: Validate branch is not protected
    if (isProtectedBranch(branchName, config.repoConfig)) {
      result.error = `Cannot push protected branch: ${branchName}`;
      logger.error('Attempted to push protected branch', { branchName });
      return result;
    }

    // Step 2: Check if remote exists
    const remoteUrl = await getRemoteUrl(remoteName, config.workingDir);
    if (!remoteUrl) {
      result.error = `Remote "${remoteName}" does not exist`;
      logger.error('Remote not found', { remoteName });
      return result;
    }

    result.remoteUrl = remoteUrl;

    // Step 3: Push with upstream tracking
    logger.info('Pushing branch to remote', { branchName, remoteName, remoteUrl });
    await execFileAsync('git', ['push', '-u', remoteName, branchName], { cwd: config.workingDir });

    result.trackingBranch = `${remoteName}/${branchName}`;
    result.success = true;

    logger.info('Branch pushed successfully', {
      branchName,
      trackingBranch: result.trackingBranch,
    });

    // Step 4: Update branch metadata
    await updateBranchMetadata(
      config,
      {
        remote_tracking_branch: result.trackingBranch,
        remote_url: remoteUrl,
        sync_status: 'synced',
        updated_at: new Date().toISOString(),
      },
      logger
    );

    metrics.increment('branch_pushed_total', {
      feature_id: config.featureId,
    });
  } catch (error) {
    result.error = wrapError(error, 'push branch').message;
    logger.error('Branch push failed', {
      branchName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    metrics.increment('branch_push_failed_total', {
      feature_id: config.featureId,
    });
  }

  return result;
}

// ============================================================================
// Branch Status
// ============================================================================

/**
 * Get current branch sync status
 */
export async function getBranchSyncStatus(
  config: BranchConfig,
  logger: StructuredLogger
): Promise<BranchSyncStatus> {
  const branchName = await getCurrentBranch(config.workingDir);
  const lastCommitSha = await getCommitSha('HEAD', config.workingDir);
  const trackingBranch = await getTrackingBranch(config.workingDir);

  const status: BranchSyncStatus = {
    branchName,
    commitsAhead: 0,
    commitsBehind: 0,
    status: 'unknown',
    lastCommitSha,
    ...(trackingBranch ? { trackingBranch } : {}),
  };

  if (trackingBranch) {
    try {
      const counts = await getAheadBehindCounts(config.workingDir);
      status.commitsAhead = counts.ahead;
      status.commitsBehind = counts.behind;

      if (counts.ahead === 0 && counts.behind === 0) {
        status.status = 'synced';
      } else if (counts.ahead > 0 && counts.behind === 0) {
        status.status = 'ahead';
      } else if (counts.ahead === 0 && counts.behind > 0) {
        status.status = 'behind';
      } else {
        status.status = 'diverged';
      }
    } catch (error) {
      logger.warn('Failed to get ahead/behind counts', {
        branchName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.debug('Branch sync status', { ...status });

  return status;
}

// ============================================================================
// Metadata Persistence
// ============================================================================

/**
 * Get path to branch metadata file
 */
function getBranchMetadataPath(config: BranchConfig): string {
  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  return path.join(artifactsDir, 'branch_metadata.json');
}

/**
 * Save branch metadata to run directory
 */
export async function saveBranchMetadata(
  config: BranchConfig,
  metadata: BranchMetadata,
  logger: StructuredLogger
): Promise<string> {
  return withLock(
    config.runDir,
    async () => {
      const metadataPath = getBranchMetadataPath(config);
      const artifactsDir = path.dirname(metadataPath);
      await fs.mkdir(artifactsDir, { recursive: true });

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      logger.debug('Saved branch metadata', { metadataPath });

      // Update run manifest
      await updateManifest(config.runDir, (manifest) => ({
        artifacts: {
          ...manifest.artifacts,
          branch_metadata: 'artifacts/branch_metadata.json',
        },
        metadata: {
          ...(manifest.metadata ?? {}),
          current_branch: metadata.branch_name,
        },
      }));

      return metadataPath;
    },
    { operation: 'save_branch_metadata' }
  );
}

/**
 * Update existing branch metadata
 */
export async function updateBranchMetadata(
  config: BranchConfig,
  updates: Partial<BranchMetadata>,
  logger: StructuredLogger
): Promise<void> {
  return withLock(
    config.runDir,
    async () => {
      const metadataPath = getBranchMetadataPath(config);

      let metadata: BranchMetadata;
      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        metadata = validateOrThrow(
          BranchMetadataSchema,
          JSON.parse(content),
          'branch metadata'
        ) as BranchMetadata;
      } catch {
        // If metadata doesn't exist, create minimal metadata
        metadata = {
          schema_version: '1.0.0',
          feature_id: config.featureId,
          branch_name: await getCurrentBranch(config.workingDir),
          base_branch: config.repoConfig.project.default_branch,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sync_status: 'unknown',
        };
      }

      const updated: BranchMetadata = {
        ...metadata,
        ...updates,
        updated_at: new Date().toISOString(),
      };

      await fs.writeFile(metadataPath, JSON.stringify(updated, null, 2), 'utf-8');

      logger.debug('Updated branch metadata', { metadataPath });
    },
    { operation: 'update_branch_metadata' }
  );
}

/**
 * Load branch metadata from run directory
 */
export async function loadBranchMetadata(config: BranchConfig): Promise<BranchMetadata | null> {
  const metadataPath = getBranchMetadataPath(config);

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return validateOrThrow(
      BranchMetadataSchema,
      JSON.parse(content),
      'branch metadata'
    ) as BranchMetadata;
  } catch {
    return null;
  }
}

// ============================================================================
// Safe Commit Operations
// ============================================================================

/**
 * Create a safe commit with automatic metadata tagging
 */
export async function createSafeCommit(
  config: BranchConfig,
  message: string,
  taskId: string,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<{ success: boolean; sha?: string; error?: string }> {
  try {
    // Validate we're not on a protected branch
    const currentBranch = await getCurrentBranch(config.workingDir);
    if (isProtectedBranch(currentBranch, config.repoConfig)) {
      return {
        success: false,
        error: `Cannot commit directly to protected branch: ${currentBranch}`,
      };
    }

    // Ensure governance controls allow commits
    if (config.repoConfig.governance?.risk_controls.prevent_force_push) {
      logger.debug('Force push prevention is enabled', { currentBranch });
    }

    // Create commit with metadata tags
    const commitMessage = `${message}\n\n[task_id: ${taskId}]\n[feature_id: ${config.featureId}]`;

    await execFileAsync('git', ['commit', '-m', commitMessage], {
      cwd: config.workingDir,
    });

    const sha = await getCommitSha('HEAD', config.workingDir);

    logger.info('Safe commit created', { sha, taskId, branch: currentBranch });

    // Update branch metadata
    await updateBranchMetadata(
      config,
      {
        last_commit_sha: sha,
        updated_at: new Date().toISOString(),
      },
      logger
    );

    metrics.increment('commits_created_total', {
      feature_id: config.featureId,
    });

    return { success: true, sha };
  } catch (error) {
    logger.error('Commit creation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: wrapError(error, 'create commit').message,
    };
  }
}
