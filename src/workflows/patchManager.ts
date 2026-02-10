/**
 * Patch Manager
 *
 * Manages patch application with git safety rails, dry-run validation,
 * allowlist/denylist enforcement from RepoConfig, and rollback snapshots.
 *
 * Key features:
 * - Dry-run validation using `git apply --check`
 * - Path constraint enforcement (allowed/blocked patterns)
 * - Rollback snapshot creation before applying patches
 * - Diff summaries stored in run directory artifacts
 * - Conflict detection and human-action-required state management
 * - Atomic patch application with file locking
 *
 * Implements:
 * - FR-12: Safe Patch Application
 * - FR-13: Git Constraints Enforcement
 * - ADR-3: Git Safety Rails
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import { withLock, getSubdirectoryPath, updateManifest } from '../persistence/runDirectoryManager';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import type { DiffStats } from '../telemetry/executionMetrics';
import { getErrorMessage } from '../utils/errors.js';

const execAsync = promisify(exec);

type ExecCommandResult = { stdout?: string; stderr?: string } | string;

function normalizeExecResult(result: ExecCommandResult): { stdout: string; stderr: string } {
  if (typeof result === 'string') {
    return { stdout: result, stderr: '' };
  }

  return {
    stdout: result?.stdout ?? '',
    stderr: result?.stderr ?? '',
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Patch application configuration
 */
export interface PatchConfig {
  /** Run directory path */
  runDir: string;
  /** Feature identifier */
  featureId: string;
  /** Task ID for traceability */
  taskId?: string;
  /** Repository configuration for constraint enforcement */
  repoConfig: RepoConfig;
  /** Working directory (git repo root) */
  workingDir: string;
}

/**
 * Patch content representation
 */
export interface Patch {
  /** Patch identifier */
  patchId: string;
  /** Patch content (unified diff format) */
  content: string;
  /** Description of the patch */
  description?: string;
  /** Files affected by this patch */
  affectedFiles?: string[];
}

/**
 * Dry-run validation result
 */
export interface DryRunResult {
  /** Whether the patch can be applied cleanly */
  success: boolean;
  /** Validation errors or warnings */
  errors: string[];
  /** Files that would be modified */
  affectedFiles: string[];
  /** Files that violate constraints */
  blockedFiles: string[];
  /** Constraint violation details */
  violations: ConstraintViolation[];
}

/**
 * Constraint violation detail
 */
export interface ConstraintViolation {
  /** File path that violated constraints */
  file: string;
  /** Type of violation */
  type: 'blocked_pattern' | 'not_allowed_pattern';
  /** Pattern that was matched/violated */
  pattern: string;
  /** Human-readable reason */
  reason: string;
}

/**
 * Patch application result
 */
export interface PatchApplicationResult {
  /** Whether the patch was applied successfully */
  success: boolean;
  /** Path to the snapshot created before applying */
  snapshotPath?: string;
  /** Path to the diff summary */
  diffSummaryPath?: string;
  /** Applied patch ID */
  patchId: string;
  /** Files that were modified */
  modifiedFiles: string[];
  /** Error message if failed */
  error?: string;
  /** Whether the error is recoverable */
  recoverable?: boolean;
}

/**
 * Rollback snapshot metadata
 */
interface SnapshotMetadata {
  schema_version: string;
  snapshot_id: string;
  feature_id: string;
  task_id?: string;
  patch_id: string;
  created_at: string;
  git_ref: string;
  git_sha: string;
  working_tree_status: string;
  stashed_changes?: boolean;
}

// ============================================================================
// Constraint Validation
// ============================================================================

/**
 * Validate that affected files comply with RepoConfig constraints
 */
export function validateFileConstraints(
  affectedFiles: string[],
  repoConfig: RepoConfig,
  logger: StructuredLogger
): { valid: boolean; violations: ConstraintViolation[] } {
  const violations: ConstraintViolation[] = [];
  const allowedPatterns = repoConfig.safety.allowed_file_patterns;
  const blockedPatterns = repoConfig.safety.blocked_file_patterns;

  for (const file of affectedFiles) {
    // Check blocked patterns first (higher priority)
    for (const pattern of blockedPatterns) {
      const isMatch = picomatch(pattern);
      if (isMatch(file)) {
        violations.push({
          file,
          type: 'blocked_pattern',
          pattern,
          reason: `File matches blocked pattern "${pattern}" from RepoConfig.safety.blocked_file_patterns`,
        });
        logger.warn('File violates blocked pattern constraint', {
          file,
          pattern,
        });
        break; // One violation per file is enough
      }
    }

    // If not blocked, check if it matches allowed patterns
    if (violations.length === 0 || violations[violations.length - 1].file !== file) {
      const matchesAllowed = allowedPatterns.some((pattern) => {
        const isMatch = picomatch(pattern);
        return isMatch(file);
      });
      if (!matchesAllowed) {
        violations.push({
          file,
          type: 'not_allowed_pattern',
          pattern: allowedPatterns.join(', '),
          reason: `File does not match any allowed pattern from RepoConfig.safety.allowed_file_patterns`,
        });
        logger.warn('File does not match allowed pattern constraint', {
          file,
          allowedPatterns,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

// ============================================================================
// Patch Parsing
// ============================================================================

/**
 * Extract affected files from a unified diff patch
 */
export function extractAffectedFiles(patchContent: string): string[] {
  const files = new Set<string>();
  const lines = patchContent.split('\n');

  for (const line of lines) {
    // Match diff headers: "--- a/path/to/file" or "+++ b/path/to/file"
    const match = line.match(/^(?:---|\+\+\+)\s+[ab]\/(.+)$/);
    if (match && match[1]) {
      // Filter out "/dev/null" which appears in new/deleted files
      if (match[1] !== 'dev/null') {
        files.add(match[1]);
      }
    }
  }

  return Array.from(files);
}

/**
 * Calculate insertion/deletion counts from a unified diff.
 */
function summarizeLineChanges(patchContent: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;

  const lines = patchContent.split('\n');
  for (const line of lines) {
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('diff ') ||
      line.startsWith('@@') ||
      line === '\\ No newline at end of file'
    ) {
      continue;
    }

    if (line.startsWith('+')) {
      insertions++;
    } else if (line.startsWith('-')) {
      deletions++;
    }
  }

  return { insertions, deletions };
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Check if the working tree is clean
 */
export async function isWorkingTreeClean(workingDir: string): Promise<boolean> {
  try {
    const { stdout } = normalizeExecResult(
      await execAsync('git status --porcelain', { cwd: workingDir })
    );
    return stdout.trim().length === 0;
  } catch (error) {
    throw new Error(
      `Failed to check git working tree status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

/**
 * Get current git HEAD reference and SHA
 */
export async function getCurrentGitRef(workingDir: string): Promise<{ ref: string; sha: string }> {
  try {
    const { stdout: ref } = normalizeExecResult(
      await execAsync('git symbolic-ref -q HEAD || git rev-parse HEAD', {
        cwd: workingDir,
      })
    );
    const { stdout: sha } = normalizeExecResult(
      await execAsync('git rev-parse HEAD', { cwd: workingDir })
    );

    return {
      ref: ref.trim(),
      sha: sha.trim(),
    };
  } catch (error) {
    throw new Error(
      `Failed to get current git ref: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

/**
 * Perform dry-run validation of a patch using git apply --check
 */
export async function validatePatchDryRun(
  patch: Patch,
  workingDir: string,
  repoConfig: RepoConfig,
  logger: StructuredLogger
): Promise<DryRunResult> {
  const result: DryRunResult = {
    success: false,
    errors: [],
    affectedFiles: [],
    blockedFiles: [],
    violations: [],
  };

  // Step 1: Extract affected files
  const affectedFiles = patch.affectedFiles || extractAffectedFiles(patch.content);
  result.affectedFiles = affectedFiles;

  logger.debug('Extracted affected files from patch', {
    patchId: patch.patchId,
    affectedFiles,
  });

  // Step 2: Validate file constraints
  const constraintValidation = validateFileConstraints(affectedFiles, repoConfig, logger);
  result.violations = constraintValidation.violations;
  result.blockedFiles = constraintValidation.violations.map((v) => v.file);

  if (!constraintValidation.valid) {
    result.errors.push(
      `Patch violates file constraints: ${constraintValidation.violations.length} violation(s)`
    );
    for (const violation of constraintValidation.violations) {
      result.errors.push(`  - ${violation.file}: ${violation.reason}`);
    }
    return result;
  }

  // Step 3: Verify working tree is clean
  const isClean = await isWorkingTreeClean(workingDir);
  if (!isClean) {
    result.errors.push(
      'Working tree is not clean. Commit or stash changes before applying patches.'
    );
    return result;
  }

  // Step 4: Test patch application with git apply --check
  const patchFile = path.join('/tmp', `patch-${patch.patchId}-${Date.now()}.diff`);
  try {
    await fs.writeFile(patchFile, patch.content, 'utf-8');

    await execAsync(`git apply --check "${patchFile}"`, { cwd: workingDir });

    result.success = true;
    logger.info('Dry-run validation succeeded', {
      patchId: patch.patchId,
      affectedFiles: result.affectedFiles,
    });
  } catch (error) {
    result.errors.push(
      `git apply --check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    logger.warn('Dry-run validation failed', {
      patchId: patch.patchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    // Clean up temporary patch file
    try {
      await fs.unlink(patchFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  return result;
}

// ============================================================================
// Snapshot Management
// ============================================================================

/**
 * Create a rollback snapshot before applying a patch
 */
export async function createRollbackSnapshot(
  config: PatchConfig,
  patch: Patch,
  logger: StructuredLogger
): Promise<string> {
  const snapshotId = `snapshot-${config.taskId || 'unknown'}-${patch.patchId}-${Date.now()}`;
  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  const snapshotDir = path.join(artifactsDir, 'patches', 'snapshots');
  await fs.mkdir(snapshotDir, { recursive: true });

  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json`);

  // Capture current git state
  const gitRef = await getCurrentGitRef(config.workingDir);
  const { stdout: workingTreeStatus } = normalizeExecResult(
    await execAsync('git status --porcelain', {
      cwd: config.workingDir,
    })
  );

  const metadata: SnapshotMetadata = {
    schema_version: '1.0.0',
    snapshot_id: snapshotId,
    feature_id: config.featureId,
    patch_id: patch.patchId,
    created_at: new Date().toISOString(),
    git_ref: gitRef.ref,
    git_sha: gitRef.sha,
    working_tree_status: workingTreeStatus.trim(),
    stashed_changes: false,
    ...(config.taskId ? { task_id: config.taskId } : {}),
  };

  await fs.writeFile(snapshotPath, JSON.stringify(metadata, null, 2), 'utf-8');

  logger.info('Created rollback snapshot', {
    snapshotId,
    patchId: patch.patchId,
    gitSha: gitRef.sha,
  });

  return snapshotPath;
}

/**
 * Generate a diff summary for the applied patch
 */
export async function generateDiffSummary(
  patch: Patch,
  config: PatchConfig,
  modifiedFiles: string[]
): Promise<string> {
  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  const patchesDir = path.join(artifactsDir, 'patches');
  await fs.mkdir(patchesDir, { recursive: true });

  const summaryPath = path.join(patchesDir, `${patch.patchId}-summary.json`);

  const summary = {
    schema_version: '1.0.0',
    patch_id: patch.patchId,
    feature_id: config.featureId,
    task_id: config.taskId,
    description: patch.description,
    modified_files: modifiedFiles,
    applied_at: new Date().toISOString(),
    patch_hash: crypto.createHash('sha256').update(patch.content).digest('hex'),
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  return summaryPath;
}

// ============================================================================
// Patch Application
// ============================================================================

/**
 * Apply a patch to the working directory with safety rails
 */
export async function applyPatch(
  patch: Patch,
  config: PatchConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<PatchApplicationResult> {
  logger.info('Starting patch application', {
    patchId: patch.patchId,
    featureId: config.featureId,
    taskId: config.taskId,
  });

  const result: PatchApplicationResult = {
    success: false,
    patchId: patch.patchId,
    modifiedFiles: [],
  };

  try {
    // Step 1: Dry-run validation
    logger.debug('Running dry-run validation');
    const dryRunResult = await validatePatchDryRun(
      patch,
      config.workingDir,
      config.repoConfig,
      logger
    );

    if (!dryRunResult.success) {
      result.error = `Dry-run validation failed:\n${dryRunResult.errors.join('\n')}`;
      result.recoverable = dryRunResult.violations.length === 0; // Constraint violations are non-recoverable

      logger.error('Patch application blocked by dry-run validation', {
        patchId: patch.patchId,
        errors: dryRunResult.errors,
        violations: dryRunResult.violations,
      });

      metrics.increment('patch_application_failed_total', {
        feature_id: config.featureId,
        reason: 'dry_run_failed',
      });

      return result;
    }

    result.modifiedFiles = dryRunResult.affectedFiles;

    // Step 2: Create rollback snapshot (within lock)
    await withLock(
      config.runDir,
      async () => {
        logger.debug('Creating rollback snapshot');
        const snapshotPath = await createRollbackSnapshot(config, patch, logger);
        result.snapshotPath = snapshotPath;

        // Step 3: Apply the patch
        const patchFile = path.join('/tmp', `patch-${patch.patchId}-${Date.now()}.diff`);
        try {
          await fs.writeFile(patchFile, patch.content, 'utf-8');

          logger.debug('Applying patch with git apply');
          await execAsync(`git apply "${patchFile}"`, { cwd: config.workingDir });

          logger.info('Patch applied successfully', {
            patchId: patch.patchId,
            modifiedFiles: result.modifiedFiles,
          });

          // Step 4: Generate diff summary
          logger.debug('Generating diff summary');
          const diffSummaryPath = await generateDiffSummary(patch, config, result.modifiedFiles);
          result.diffSummaryPath = diffSummaryPath;
          const { insertions, deletions } = summarizeLineChanges(patch.content);
          const diffStats: DiffStats = {
            filesChanged: result.modifiedFiles.length,
            insertions,
            deletions,
            patchId: patch.patchId,
          };
          telemetry?.metrics?.recordDiffStats(diffStats);
          telemetry?.logs?.diffGenerated(config.taskId ?? patch.patchId, patch.patchId, diffStats);

          // Step 5: Update run manifest
          await updateManifest(config.runDir, (manifest) => ({
            artifacts: {
              ...manifest.artifacts,
              [`patch_${patch.patchId}`]: diffSummaryPath,
            },
            metadata: {
              ...(manifest.metadata ?? {}),
              last_applied_patch: patch.patchId,
              last_applied_at: new Date().toISOString(),
            },
          }));

          result.success = true;
          if (telemetry?.logs) {
            try {
              const gitRef = await getCurrentGitRef(config.workingDir);
              telemetry.logs.patchApplied(
                config.taskId ?? patch.patchId,
                patch.patchId,
                gitRef.ref,
                gitRef.sha
              );
            } catch (error) {
              logger.debug('Failed to record patch application telemetry', {
                patchId: patch.patchId,
                error: getErrorMessage(error),
              });
            }
          }

          metrics.increment('patch_application_success_total', {
            feature_id: config.featureId,
          });
        } catch (error) {
          result.error = `git apply failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.recoverable = true; // Git apply failures may be recoverable after conflict resolution

          logger.error('Patch application failed', {
            patchId: patch.patchId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          metrics.increment('patch_application_failed_total', {
            feature_id: config.featureId,
            reason: 'git_apply_failed',
          });
        } finally {
          // Clean up temporary patch file
          try {
            await fs.unlink(patchFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
      { operation: 'apply_patch' }
    );
  } catch (error) {
    result.error = `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.recoverable = false;

    logger.error('Unexpected error during patch application', {
      patchId: patch.patchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    metrics.increment('patch_application_failed_total', {
      feature_id: config.featureId,
      reason: 'unexpected_error',
    });
  }

  return result;
}

/**
 * Apply a patch with automatic conflict detection and state management
 */
export async function applyPatchWithStateManagement(
  patch: Patch,
  config: PatchConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<PatchApplicationResult> {
  const result = await applyPatch(patch, config, logger, metrics, telemetry);

  // If patch failed and is recoverable, mark task as human-action-required
  if (!result.success && result.recoverable) {
    logger.warn('Patch application requires manual intervention', {
      patchId: patch.patchId,
      taskId: config.taskId,
    });

    await updateManifest(config.runDir, (manifest) => ({
      status: 'paused',
      execution: {
        ...manifest.execution,
        last_error: {
          step: config.taskId || 'patch_application',
          message: result.error || 'Patch application failed',
          timestamp: new Date().toISOString(),
          recoverable: true,
        },
      },
    }));
  }

  return result;
}
