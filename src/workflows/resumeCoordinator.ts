/**
 * Resume Coordinator
 *
 * Thin orchestrator that implements deterministic resumption of failed or
 * paused execution runs. Delegates state verification to runStateVerifier
 * and queue recovery to resumeQueueRecovery.
 *
 */

import {
  readManifest,
  getRunState,
  withLock,
  writeManifest,
} from '../persistence/runDirectoryManager';
import type { ExecutionTelemetry } from '../telemetry/executionTelemetry';
import {
  checkRunStatus,
  checkPendingApprovals,
  analyzeLastError,
  checkQueueState,
  generateRecommendations,
  type ResumeAnalysis,
  type DiagnosticSeverity,
  type ResumeDiagnostic,
  type ResumeOptions,
} from './runStateVerifier';
import { checkIntegrity } from './resumeIntegrityChecker';
import { checkQueueFiles } from './resumeQueueRecovery';

// Re-export types for consumers
export type { ResumeAnalysis, DiagnosticSeverity, ResumeDiagnostic, ResumeOptions };

// Re-export integrity checker for backward compatibility
export { checkIntegrity, type VerificationResult } from './resumeIntegrityChecker';

// Re-export queue recovery helpers for backward compatibility
export {
  validateQueueSnapshot,
  getResumableTasks,
  type QueueSnapshotMetadata,
} from './resumeQueueRecovery';

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
