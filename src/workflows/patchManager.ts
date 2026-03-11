/**
 * Patch Manager
 *
 * Applies patches with git safety rails, dry-run validation, path constraints, and rollback snapshots.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import { withLock, getSubdirectoryPath, updateManifest } from '../persistence';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import type { DiffStats } from '../telemetry/executionMetrics';
import { getErrorMessage } from '../utils/errors.js';

const execFileAsync = promisify(execFile);

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

/**
 * Validate that a patchId contains only safe characters for use in file paths.
 *
 * Allows alphanumeric characters, underscores, hyphens, and dots.
 * Throws an Error if the patchId contains any other characters, preventing
 * command injection or path traversal via crafted patch identifiers.
 *
 * @param patchId - The patch identifier to validate
 * @throws {Error} If patchId contains characters outside the allowed set
 */
function validatePatchId(patchId: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(patchId)) {
    throw new Error(
      `Invalid patchId "${patchId}": must contain only alphanumeric characters, underscores, hyphens, and dots`
    );
  }
}

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

/**
 * Validate that affected files comply with RepoConfig constraints.
 *
 * Algorithm: For each file, blocked patterns are checked first (higher priority).
 * If a file matches any blocked pattern, it is recorded as a violation and no
 * further checks are performed for that file. Otherwise, the file must match at
 * least one allowed pattern or it is recorded as a violation.
 *
 * @param affectedFiles - List of file paths to validate against the constraints
 * @param repoConfig - Repository configuration containing allowed/blocked file patterns
 * @param logger - Logger instance for recording constraint check warnings
 * @returns An object with `valid` (true if no violations) and a `violations` array
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

/**
 * Extract affected files from a unified diff patch.
 *
 * Parses `--- a/...` and `+++ b/...` diff headers to collect unique file paths,
 * filtering out `/dev/null` entries that appear for newly created or deleted files.
 *
 * @param patchContent - Unified diff content to parse
 * @returns Deduplicated array of file paths affected by the patch
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

/**
 * Check if the git working tree is clean (no uncommitted changes).
 *
 * Runs `git status --porcelain` and checks for empty output.
 *
 * @param workingDir - Path to the git repository working directory
 * @returns `true` if the working tree has no uncommitted changes
 * @throws {Error} If `git status` fails to execute (e.g., not a git repository)
 */
export async function isWorkingTreeClean(workingDir: string): Promise<boolean> {
  try {
    const { stdout } = normalizeExecResult(
      await execFileAsync('git', ['status', '--porcelain'], { cwd: workingDir })
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
 * Get the current git HEAD reference (branch name or detached SHA) and full commit SHA.
 *
 * @param workingDir - Path to the git repository working directory
 * @returns An object with `ref` (symbolic ref or SHA) and `sha` (full commit hash)
 * @throws {Error} If git commands fail to execute
 */
export async function getCurrentGitRef(workingDir: string): Promise<{ ref: string; sha: string }> {
  try {
    let ref: string;
    try {
      const result = await execFileAsync('git', ['symbolic-ref', '-q', 'HEAD'], {
        cwd: workingDir,
      });
      ref = normalizeExecResult(result).stdout;
    } catch {
      const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workingDir });
      ref = normalizeExecResult(result).stdout;
    }
    const { stdout: sha } = normalizeExecResult(
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workingDir })
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
 * Perform dry-run validation of a patch before actual application.
 *
 * Algorithm (4-step pipeline):
 * 1. Extract affected files from the patch content (merged with caller-provided list)
 * 2. Validate file paths against RepoConfig allowed/blocked constraints
 * 3. Verify the git working tree is clean
 * 4. Run `git apply --check` to test whether the patch applies cleanly
 *
 * The temporary patch file written to `/tmp` is always cleaned up in a finally block.
 *
 * @param patch - The patch to validate
 * @param workingDir - Git repository working directory
 * @param repoConfig - Repository configuration for constraint enforcement
 * @param logger - Logger for recording validation progress and warnings
 * @returns A {@link DryRunResult} indicating success, errors, affected/blocked files, and violations
 */
export async function validatePatchDryRun(
  patch: Patch,
  workingDir: string,
  repoConfig: RepoConfig,
  logger: StructuredLogger
): Promise<DryRunResult> {
  validatePatchId(patch.patchId);

  const result: DryRunResult = {
    success: false,
    errors: [],
    affectedFiles: [],
    blockedFiles: [],
    violations: [],
  };

  // Step 1: Extract affected files from content, merging caller-provided list for defense-in-depth
  const contentFiles = extractAffectedFiles(patch.content);
  const callerFiles = patch.affectedFiles || [];
  const affectedFiles = [...new Set([...contentFiles, ...callerFiles])];
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
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'codepipe-patch-'));
  const patchFile = path.join(tmpDir, `patch-${patch.patchId}.diff`);
  try {
    await fs.writeFile(patchFile, patch.content, { encoding: 'utf-8', mode: 0o600 });

    await execFileAsync('git', ['apply', '--check', patchFile], { cwd: workingDir });

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
    // Clean up private temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return result;
}

/**
 * Create a rollback snapshot before applying a patch.
 *
 * Captures the current git ref, SHA, and working tree status into a JSON metadata
 * file stored under the run directory's `artifacts/patches/snapshots/` subdirectory.
 * This snapshot enables rollback if the patch application fails or causes issues.
 *
 * @param config - Patch configuration containing runDir, featureId, taskId, and workingDir
 * @param patch - The patch about to be applied (used for the snapshot filename)
 * @param logger - Logger for recording snapshot creation
 * @returns Absolute path to the created snapshot JSON file
 * @throws {Error} If git state cannot be captured or the file cannot be written
 */
export async function createRollbackSnapshot(
  config: PatchConfig,
  patch: Patch,
  logger: StructuredLogger
): Promise<string> {
  validatePatchId(patch.patchId);
  const snapshotId = `snapshot-${config.taskId || 'unknown'}-${patch.patchId}-${Date.now()}`;
  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  const snapshotDir = path.join(artifactsDir, 'patches', 'snapshots');
  await fs.mkdir(snapshotDir, { recursive: true });

  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json`);

  // Capture current git state
  const gitRef = await getCurrentGitRef(config.workingDir);
  const { stdout: workingTreeStatus } = normalizeExecResult(
    await execFileAsync('git', ['status', '--porcelain'], {
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
 * Generate a JSON diff summary artifact for an applied patch.
 *
 * Writes a summary file containing patch metadata, modified files list,
 * application timestamp, and a SHA-256 hash of the patch content to the
 * run directory's `artifacts/patches/` subdirectory.
 *
 * @param patch - The applied patch (content is hashed for the summary)
 * @param config - Patch configuration containing runDir, featureId, and taskId
 * @param modifiedFiles - List of files that were modified by the patch
 * @returns Absolute path to the generated summary JSON file
 */
export async function generateDiffSummary(
  patch: Patch,
  config: PatchConfig,
  modifiedFiles: string[]
): Promise<string> {
  validatePatchId(patch.patchId);
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

/**
 * Apply a patch to the working directory with full safety rails.
 *
 * Algorithm (5-step pipeline, steps 2-5 run under a file lock):
 * 1. Dry-run validation (constraint checks + `git apply --check`)
 * 2. Create a rollback snapshot of the current git state
 * 3. Write the patch to a temp file and run `git apply`
 * 4. Generate a diff summary artifact with line-change statistics
 * 5. Update the run manifest with patch metadata
 *
 * If any step fails, the result includes an error message and a `recoverable`
 * flag indicating whether manual intervention or simple retry may help.
 *
 * @param patch - The patch to apply
 * @param config - Patch configuration (runDir, workingDir, featureId, taskId, repoConfig)
 * @param logger - Logger for recording progress, warnings, and errors
 * @param metrics - Metrics collector for tracking success/failure counters
 * @param telemetry - Optional execution telemetry for diff stats and patch-applied events
 * @returns A {@link PatchApplicationResult} with success status, paths, and error details
 */
export async function applyPatch(
  patch: Patch,
  config: PatchConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  telemetry?: ExecutionTelemetry
): Promise<PatchApplicationResult> {
  validatePatchId(patch.patchId);

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
        const patchTmpDir = await fs.mkdtemp(path.join(tmpdir(), 'codepipe-patch-'));
        const patchFile = path.join(patchTmpDir, `patch-${patch.patchId}.diff`);
        try {
          await fs.writeFile(patchFile, patch.content, { encoding: 'utf-8', mode: 0o600 });

          logger.debug('Applying patch with git apply');
          await execFileAsync('git', ['apply', patchFile], { cwd: config.workingDir });

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
          // Clean up private temporary directory
          try {
            await fs.rm(patchTmpDir, { recursive: true, force: true });
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
 * Apply a patch with automatic conflict detection and state management.
 *
 * Delegates to {@link applyPatch} and, if the result is a recoverable failure,
 * updates the run manifest to mark the execution as `paused` with a
 * human-action-required error record. This enables external tooling to detect
 * tasks that need manual conflict resolution.
 *
 * @param patch - The patch to apply
 * @param config - Patch configuration (runDir, workingDir, featureId, taskId, repoConfig)
 * @param logger - Logger for recording state management actions
 * @param metrics - Metrics collector forwarded to the underlying applyPatch call
 * @param telemetry - Optional execution telemetry forwarded to the underlying applyPatch call
 * @returns A {@link PatchApplicationResult} with success status, paths, and error details
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
