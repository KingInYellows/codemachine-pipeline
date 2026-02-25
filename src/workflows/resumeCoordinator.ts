import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { validateOrThrow } from '../validation/helpers.js';
import {
  readManifest,
  getRunState,
  withLock,
  verifyRunDirectoryIntegrity,
  writeManifest,
  type RunManifest,
} from '../persistence/runDirectoryManager';
import type { VerificationResult } from '../persistence/hashManifest';
import {
  type ExecutionTask,
  canRetry,
  areDependenciesCompleted,
} from '../core/models/ExecutionTask';
import { validateQueue, loadQueue, type QueueValidationResult } from './queueStore';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';

/**
 * Resume Coordinator
 *
 * State recovery brain that implements deterministic resumption
 * of failed or paused execution runs.
 *
 * Implements:
 * - FR-3 (Resumability & Determinism): Hash-based input verification
 * - ADR-2 (State Persistence): Queue state restoration
 * - Blueprint Foundation: Idempotent execution with crash recovery
 *
 * Key Responsibilities:
 * - Read last_step, last_error, and queue state to determine resumption point
 * - Validate artifact integrity via hash manifests before restart
 * - Provide diagnostic summaries when resume is blocked
 * - Enforce safe resumption (no duplicate edits, no corrupted state)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Resume analysis result
 */
export interface ResumeAnalysis {
  /** Whether resume is safe to proceed */
  canResume: boolean;
  /** Feature ID being resumed */
  featureId: string;
  /** Current run status */
  status: RunManifest['status'];
  /** Last successfully completed step */
  lastStep?: string;
  /** Current step that was interrupted */
  currentStep?: string;
  /** Last error details if any */
  lastError?: RunManifest['execution']['last_error'];
  /** Pending approvals that block resume */
  pendingApprovals: string[];
  /** Queue state summary */
  queueState: {
    pending: number;
    completed: number;
    failed: number;
  };
  /** Result of queue validation (if performed) */
  queueValidation?: QueueValidationResult;
  /** Hash integrity check result */
  integrityCheck?: VerificationResult;
  /** Diagnostic messages for operator */
  diagnostics: ResumeDiagnostic[];
  /** Recommended actions for operator */
  recommendations: string[];
}

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'blocker';

/**
 * Resume diagnostic entry
 */
export interface ResumeDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Classification code for mapping to playbook */
  code?: string;
  /** Additional context data */
  context?: {
    step?: string;
    timestamp?: string;
    recoverable?: boolean;
    errorCode?: string;
    [key: string]: unknown;
  };
}

/**
 * Resume options
 */
export interface ResumeOptions {
  /** Force resume even with integrity warnings (use with caution) */
  force?: boolean;
  /** Skip hash verification (dangerous, for debugging only) */
  skipHashVerification?: boolean;
  /** Validate queue files before resuming */
  validateQueue?: boolean;
}

/**
 * Queue snapshot metadata describing the on-disk queue files we expect to load
 */
export interface QueueSnapshotMetadata {
  /** Number of tasks captured in the snapshot */
  taskCount: number;
  /** Snapshot checksum for integrity */
  checksum: string;
  /** Timestamp when snapshot was taken */
  timestamp: string;
  /** Queue file path (relative to queue directory) */
  queueFile: string;
}

const RawSnapshotSchema = z.object({
  schemaVersion: z.string().optional(),
  schema_version: z.string().optional(),
  tasks: z.record(z.string(), z.unknown()),
  counts: z.unknown().optional(),
  dependencyGraph: z.record(z.string(), z.array(z.string())).optional(),
  dependency_graph: z.record(z.string(), z.array(z.string())).optional(),
  checksum: z.string().min(1),
  timestamp: z.string().min(1),
});

// ============================================================================
// Resume Analysis
// ============================================================================

/**
 * Analyze run directory state to determine if resume is safe
 *
 * @param runDir - Run directory path
 * @param options - Resume options
 * @returns Resume analysis result with diagnostics
 */
export async function analyzeResumeState(
  runDir: string,
  options: ResumeOptions = {},
  telemetry?: ExecutionTelemetry
): Promise<ResumeAnalysis> {
  const manifest = await readManifest(runDir);
  const runState = await getRunState(runDir);

  const analysis: ResumeAnalysis = {
    canResume: true,
    featureId: manifest.feature_id,
    status: manifest.status,
    pendingApprovals: manifest.approvals.pending,
    queueState: {
      pending: manifest.queue.pending_count,
      completed: manifest.queue.completed_count,
      failed: manifest.queue.failed_count,
    },
    diagnostics: [],
    recommendations: [],
  };

  if (runState.last_step) {
    analysis.lastStep = runState.last_step;
  }
  if (runState.current_step) {
    analysis.currentStep = runState.current_step;
  }
  if (runState.last_error) {
    analysis.lastError = runState.last_error;
  }

  // Check run status
  checkRunStatus(analysis, manifest);

  // Check for pending approvals
  checkPendingApprovals(analysis, manifest);

  // Verify artifact integrity
  if (!options.skipHashVerification) {
    await checkIntegrity(analysis, runDir, options);
  }

  // Check for last error
  if (runState.last_error) {
    analyzeLastError(analysis, runState.last_error);
  }

  // Check queue state
  checkQueueState(analysis, manifest);

  // Validate queue files if requested
  await checkQueueFiles(analysis, runDir, options);

  telemetry?.metrics?.setQueueDepth(
    analysis.queueState.pending,
    analysis.queueState.completed,
    analysis.queueState.failed
  );
  telemetry?.logs?.queueStateChanged(
    analysis.queueState.pending,
    analysis.queueState.completed,
    analysis.queueState.failed
  );

  // Determine final resume eligibility
  const canResumeBeforeBlockers = analysis.canResume;
  const hasBlockers = analysis.diagnostics.some((d) => d.severity === 'blocker');
  if (hasBlockers) {
    analysis.canResume = options.force === true ? canResumeBeforeBlockers : false;
  } else {
    analysis.canResume = canResumeBeforeBlockers;
  }

  // Generate recommendations
  generateRecommendations(analysis);

  return analysis;
}

/**
 * Check run status and add diagnostics
 */
function checkRunStatus(analysis: ResumeAnalysis, manifest: RunManifest): void {
  switch (manifest.status) {
    case 'completed':
      analysis.diagnostics.push({
        severity: 'info',
        message: 'Run already completed successfully',
        code: 'ALREADY_COMPLETED',
      });
      analysis.canResume = false;
      break;

    case 'failed':
      if (manifest.execution.last_error?.recoverable === false) {
        analysis.diagnostics.push({
          severity: 'blocker',
          message: 'Run failed with non-recoverable error',
          code: 'NON_RECOVERABLE_ERROR',
          context: { error: manifest.execution.last_error },
        });
      } else {
        analysis.diagnostics.push({
          severity: 'warning',
          message: 'Run failed but error may be recoverable',
          code: 'RECOVERABLE_ERROR',
        });
      }
      break;

    case 'paused':
      analysis.diagnostics.push({
        severity: 'info',
        message: 'Run is paused and can be resumed',
        code: 'PAUSED',
      });
      break;

    case 'in_progress':
      analysis.diagnostics.push({
        severity: 'warning',
        message: 'Run appears to be in progress - may have crashed unexpectedly',
        code: 'UNEXPECTED_INTERRUPT',
      });
      break;

    case 'pending':
      analysis.diagnostics.push({
        severity: 'info',
        message: 'Run has not started yet',
        code: 'NOT_STARTED',
      });
      break;
  }
}

/**
 * Check for pending approvals
 */
function checkPendingApprovals(analysis: ResumeAnalysis, manifest: RunManifest): void {
  if (manifest.approvals.pending.length > 0) {
    analysis.diagnostics.push({
      severity: 'blocker',
      message: `${manifest.approvals.pending.length} approval(s) pending: ${manifest.approvals.pending.join(', ')}`,
      code: 'APPROVALS_PENDING',
      context: { approvals: manifest.approvals.pending },
    });
  }
}

/**
 * Check artifact integrity using hash manifest
 */
async function checkIntegrity(
  analysis: ResumeAnalysis,
  runDir: string,
  options: ResumeOptions
): Promise<void> {
  try {
    const integrityResult = await verifyRunDirectoryIntegrity(runDir);
    analysis.integrityCheck = integrityResult;

    if (!integrityResult.valid) {
      const severity: DiagnosticSeverity = options.force ? 'warning' : 'blocker';

      if (integrityResult.failed.length > 0) {
        analysis.diagnostics.push({
          severity,
          message: `${integrityResult.failed.length} artifact(s) failed integrity check`,
          code: 'INTEGRITY_HASH_MISMATCH',
          context: {
            failed: integrityResult.failed.map((f) => ({
              path: f.path,
              reason: f.reason,
            })),
          },
        });
      }

      if (integrityResult.missing.length > 0) {
        analysis.diagnostics.push({
          severity,
          message: `${integrityResult.missing.length} artifact(s) missing`,
          code: 'INTEGRITY_MISSING_FILES',
          context: { missing: integrityResult.missing },
        });
      }
    } else {
      analysis.diagnostics.push({
        severity: 'info',
        message: `All ${integrityResult.passed.length} artifact(s) passed integrity check`,
        code: 'INTEGRITY_OK',
      });
    }
  } catch (error) {
    // Hash manifest may not exist yet (early failure)
    analysis.diagnostics.push({
      severity: 'warning',
      message: 'Could not verify artifact integrity - hash manifest not found',
      code: 'INTEGRITY_NO_MANIFEST',
      context: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
}

/**
 * Analyze last error details
 */
function analyzeLastError(
  analysis: ResumeAnalysis,
  lastError: NonNullable<RunManifest['execution']['last_error']>
): void {
  const errorContext: {
    step: string;
    timestamp: string;
    recoverable: boolean;
    errorCode?: string;
    [key: string]: unknown;
  } = {
    step: lastError.step,
    timestamp: lastError.timestamp,
    recoverable: lastError.recoverable,
  };

  // Classify error type based on message patterns
  const errorCode = classifyErrorMessage(lastError.message);

  analysis.diagnostics.push({
    severity: lastError.recoverable ? 'warning' : 'error',
    message: `Last error at step '${lastError.step}': ${lastError.message}`,
    code: errorCode,
    context: errorContext,
  });
}

/**
 * Classify error message into error code for playbook mapping
 */
function classifyErrorMessage(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('quota exceeded')) {
    return 'ERROR_RATE_LIMIT';
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused')) {
    return 'ERROR_NETWORK';
  }
  if (lower.includes('validation') || lower.includes('invalid')) {
    return 'ERROR_VALIDATION';
  }
  if (lower.includes('permission') || lower.includes('unauthorized')) {
    return 'ERROR_PERMISSION';
  }
  if (lower.includes('corrupt') || lower.includes('integrity')) {
    return 'ERROR_CORRUPTION';
  }
  if (lower.includes('git') || lower.includes('merge conflict')) {
    return 'ERROR_GIT';
  }
  if (lower.includes('agent') || lower.includes('llm')) {
    return 'ERROR_AGENT';
  }

  return 'ERROR_UNKNOWN';
}

/**
 * Check queue state for anomalies
 */
function checkQueueState(analysis: ResumeAnalysis, manifest: RunManifest): void {
  const { pending_count, completed_count, failed_count } = manifest.queue;

  if (pending_count === 0 && failed_count === 0 && completed_count > 0) {
    analysis.diagnostics.push({
      severity: 'info',
      message: 'All queue tasks completed successfully',
      code: 'QUEUE_COMPLETE',
    });
  } else if (failed_count > 0) {
    analysis.diagnostics.push({
      severity: 'warning',
      message: `${failed_count} task(s) failed in queue`,
      code: 'QUEUE_HAS_FAILURES',
      context: { failed_count },
    });
  } else if (pending_count > 0) {
    analysis.diagnostics.push({
      severity: 'info',
      message: `${pending_count} task(s) pending in queue`,
      code: 'QUEUE_HAS_PENDING',
      context: { pending_count },
    });
  }

  // Check if queue directory exists
  const queueDir = manifest.queue.queue_dir;
  if (!queueDir) {
    analysis.diagnostics.push({
      severity: 'error',
      message: 'Queue directory not configured in manifest',
      code: 'QUEUE_DIR_MISSING',
    });
  }
}

/**
 * Validate queue files for corruption or schema mismatches
 */
async function checkQueueFiles(
  analysis: ResumeAnalysis,
  runDir: string,
  options: ResumeOptions
): Promise<void> {
  const shouldValidateQueue = options.validateQueue !== false;
  if (!shouldValidateQueue) {
    return;
  }

  const validation = await validateQueue(runDir);
  analysis.queueValidation = validation;

  if (!validation.valid) {
    analysis.diagnostics.push({
      severity: 'blocker',
      message: `Queue validation failed (${validation.corruptedTasks}/${validation.totalTasks} corrupted entr${validation.corruptedTasks === 1 ? 'y' : 'ies'})`,
      code: 'QUEUE_CORRUPTED',
      context: {
        errors: validation.errors,
      },
    });
    return;
  }

  analysis.diagnostics.push({
    severity: 'info',
    message: `Queue validation succeeded (${validation.totalTasks} task${validation.totalTasks === 1 ? '' : 's'})`,
    code: 'QUEUE_VALIDATED',
  });

  if (validation.warnings.length > 0) {
    analysis.diagnostics.push({
      severity: 'warning',
      message: `${validation.warnings.length} queue warning${validation.warnings.length === 1 ? '' : 's'} detected`,
      code: 'QUEUE_VALIDATION_WARNINGS',
      context: {
        warnings: validation.warnings,
      },
    });
  }
}

/**
 * Generate actionable recommendations based on diagnostics
 */
function generateRecommendations(analysis: ResumeAnalysis): void {
  const blockers = analysis.diagnostics.filter((d) => d.severity === 'blocker');
  const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
  const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning');

  if (blockers.length > 0) {
    analysis.recommendations.push('🚫 Resume is blocked. Address the following issues:');

    for (const blocker of blockers) {
      if (blocker.code === 'APPROVALS_PENDING') {
        analysis.recommendations.push(
          `   • Complete pending approvals: ${((blocker.context?.approvals as string[]) || []).join(', ')}`
        );
      } else if (blocker.code === 'INTEGRITY_HASH_MISMATCH') {
        analysis.recommendations.push(
          '   • Artifacts have been modified. Restore from backup or use --force (risky)'
        );
      } else if (blocker.code === 'NON_RECOVERABLE_ERROR') {
        analysis.recommendations.push(
          '   • Manual intervention required. See docs/playbooks/resume_playbook.md'
        );
      } else if (blocker.code === 'QUEUE_CORRUPTED') {
        analysis.recommendations.push(
          `   • Queue files are corrupted. Run 'codepipe queue validate --feature ${analysis.featureId}' and rebuild with 'codepipe queue rebuild --feature ${analysis.featureId} --from-plan'`
        );
      } else {
        analysis.recommendations.push(`   • ${blocker.message}`);
      }
    }
  }

  if (errors.length > 0) {
    analysis.recommendations.push('⚠️  Errors detected:');
    for (const error of errors) {
      analysis.recommendations.push(`   • ${error.message}`);
    }
  }

  if (warnings.length > 0 && blockers.length === 0) {
    analysis.recommendations.push('⚠️  Warnings (resume may proceed with caution):');
    for (const warning of warnings) {
      if (warning.code === 'ERROR_RATE_LIMIT') {
        analysis.recommendations.push('   • Wait for rate limit reset before resuming');
      } else if (warning.code === 'ERROR_NETWORK') {
        analysis.recommendations.push('   • Check network connectivity before resuming');
      } else if (warning.code === 'QUEUE_HAS_FAILURES') {
        analysis.recommendations.push('   • Review failed tasks in queue before resuming');
      } else if (warning.code === 'QUEUE_VALIDATION_WARNINGS') {
        analysis.recommendations.push(
          `   • Inspect queue warnings with 'codepipe queue validate --feature ${analysis.featureId} --verbose'`
        );
      }
    }
  }

  if (analysis.canResume && blockers.length === 0 && errors.length === 0) {
    analysis.recommendations.push('✅ Resume is safe to proceed');

    if (analysis.lastStep) {
      analysis.recommendations.push(`   • Will resume from step: ${analysis.lastStep}`);
    }

    if (analysis.queueState.pending > 0) {
      analysis.recommendations.push(
        `   • ${analysis.queueState.pending} task(s) remaining in queue`
      );
    }
  }

  // Always add playbook reference
  analysis.recommendations.push('');
  analysis.recommendations.push(
    '📚 For detailed recovery guidance, see: docs/playbooks/resume_playbook.md'
  );
}

// ============================================================================
// Resume Execution
// ============================================================================

/**
 * Prepare run directory for resume
 *
 * This function:
 * - Validates resume eligibility
 * - Clears last_error if recoverable
 * - Returns the resumption point (last completed step or queue state)
 *
 * @param runDir - Run directory path
 * @param options - Resume options
 * @returns Resume analysis with updated state
 * @throws Error if resume is not safe
 */
export async function prepareResume(
  runDir: string,
  options: ResumeOptions = {},
  telemetry?: ExecutionTelemetry
): Promise<ResumeAnalysis> {
  return withLock(
    runDir,
    async () => {
      const analysis = await analyzeResumeState(runDir, options, telemetry);

      if (!analysis.canResume) {
        const blockerMessages = analysis.diagnostics
          .filter((d) => d.severity === 'blocker')
          .map((d) => `  - ${d.message}`)
          .join('\n');

        throw new Error(
          `Cannot resume run ${analysis.featureId}:\n${blockerMessages}\n\n` +
            `See diagnostics for details. Use --force to override (not recommended).`
        );
      }

      const manifest = await readManifest(runDir);
      let manifestChanged = false;
      const updatedExecution = { ...manifest.execution };

      // Clear last_error if it was recoverable
      if (analysis.lastError?.recoverable && updatedExecution.last_error) {
        delete updatedExecution.last_error;
        manifestChanged = true;
      }

      // Update current_step if we have a resumption point
      if (analysis.lastStep && updatedExecution.current_step !== analysis.lastStep) {
        updatedExecution.current_step = analysis.lastStep;
        manifestChanged = true;
      }

      if (manifestChanged) {
        await writeManifest(runDir, {
          ...manifest,
          execution: updatedExecution,
          timestamps: {
            ...manifest.timestamps,
            updated_at: new Date().toISOString(),
          },
        });
      }

      return analysis;
    },
    { operation: 'prepare_resume' }
  );
}

/**
 * Format resume analysis for CLI display
 *
 * @param analysis - Resume analysis result
 * @returns Formatted diagnostic output
 */
export function formatResumeAnalysis(analysis: ResumeAnalysis): string {
  const lines: string[] = [];

  lines.push(`Resume Analysis for Feature: ${analysis.featureId}`);
  lines.push(`Status: ${analysis.status}`);
  lines.push('');

  // Last step info
  if (analysis.lastStep) {
    lines.push(`Last Completed Step: ${analysis.lastStep}`);
  }
  if (analysis.currentStep) {
    lines.push(`Current Step: ${analysis.currentStep}`);
  }
  lines.push('');

  // Queue state
  lines.push('Queue State:');
  lines.push(`  Pending:   ${analysis.queueState.pending}`);
  lines.push(`  Completed: ${analysis.queueState.completed}`);
  lines.push(`  Failed:    ${analysis.queueState.failed}`);
  lines.push('');

  // Integrity check
  if (analysis.integrityCheck) {
    const { passed, failed, missing } = analysis.integrityCheck;
    lines.push('Integrity Check:');
    lines.push(`  ✓ Passed:  ${passed.length}`);
    if (failed.length > 0) {
      lines.push(`  ✗ Failed:  ${failed.length}`);
    }
    if (missing.length > 0) {
      lines.push(`  ? Missing: ${missing.length}`);
    }
    lines.push('');
  }

  // Diagnostics
  if (analysis.diagnostics.length > 0) {
    lines.push('Diagnostics:');
    for (const diag of analysis.diagnostics) {
      const icon = getSeverityIcon(diag.severity);
      lines.push(`  ${icon} ${diag.message}`);
      if (diag.code) {
        lines.push(`     Code: ${diag.code}`);
      }
    }
    lines.push('');
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of analysis.recommendations) {
      lines.push(rec);
    }
  }

  return lines.join('\n');
}

/**
 * Get icon for diagnostic severity
 */
function getSeverityIcon(severity: DiagnosticSeverity): string {
  switch (severity) {
    case 'blocker':
      return '🚫';
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️ ';
    case 'info':
      return 'ℹ️ ';
  }
}

// ============================================================================
// Queue Integration Helpers
// ============================================================================

/**
 * Validate queue snapshot integrity
 *
 * @param runDir - Run directory path
 * @param snapshot - Queue snapshot metadata
 * @returns True if snapshot is valid
 */
export async function validateQueueSnapshot(
  runDir: string,
  snapshot: QueueSnapshotMetadata
): Promise<boolean> {
  try {
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);

    // Note: Don't check queue file existence here - V2 format may not have queue.jsonl
    // The snapshot file itself is the source of truth

    // Load raw snapshot file to check format (handles both V1 and V2)
    const snapshotPath = path.join(queueDir, 'queue_snapshot.json');
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const rawSnapshot = validateOrThrow(RawSnapshotSchema, JSON.parse(content), 'queue snapshot');

    const taskCount = Object.keys(rawSnapshot.tasks).length;
    const normalizedStoredTimestamp = new Date(rawSnapshot.timestamp).toISOString();
    const timestampsMatch = normalizedStoredTimestamp === snapshot.timestamp;

    // Basic validation: task count, checksum, and timestamp must match
    // This works for both V1 and V2 formats since both have these fields
    return (
      taskCount === snapshot.taskCount &&
      rawSnapshot.checksum === snapshot.checksum &&
      timestampsMatch
    );
  } catch {
    return false;
  }
}

/**
 * Get resumable tasks from queue
 *
 * This is a placeholder - actual implementation will use queueStore
 *
 * @param runDir - Run directory path
 * @returns Array of tasks that can be resumed
 */
export async function getResumableTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  const ready: ExecutionTask[] = [];
  const seen = new Set<string>();

  const addTask = (task: ExecutionTask): void => {
    if (!seen.has(task.task_id)) {
      ready.push(task);
      seen.add(task.task_id);
    }
  };

  // Retry any tasks that were running when the crash occurred
  for (const [, task] of tasks) {
    if (task.status === 'running' && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  // Pending tasks are next as long as their dependencies are satisfied
  for (const [, task] of tasks) {
    if (task.status === 'pending' && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  // Finally, include retryable failures
  for (const [, task] of tasks) {
    if (canRetry(task) && areDependenciesCompleted(task, tasks)) {
      addTask(task);
    }
  }

  return ready;
}
