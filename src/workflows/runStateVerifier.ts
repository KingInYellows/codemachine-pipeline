/**
 * Run State Verifier
 *
 * Extracted from resumeCoordinator.ts: shared types, per-check helper
 * functions for verifying run state, artifact integrity, and error
 * classification during execution resumption.
 */

import { verifyRunDirectoryIntegrity } from '../persistence/runDirectoryManager';
import type { RunManifest } from '../persistence/runDirectoryManager';
import type { VerificationResult } from '../persistence/hashManifest';
import type { QueueValidationResult } from './queueStore';

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
 * Check run status and add diagnostics
 */
export function checkRunStatus(analysis: ResumeAnalysis, manifest: RunManifest): void {
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

    default:
      analysis.diagnostics.push({
        severity: 'warning',
        message: `Unknown run status: ${String(manifest.status)}`,
        code: 'UNKNOWN_STATUS',
      });
      break;
  }
}

/**
 * Check for pending approvals
 */
export function checkPendingApprovals(analysis: ResumeAnalysis, manifest: RunManifest): void {
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
export async function checkIntegrity(
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
export function analyzeLastError(
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
export function classifyErrorMessage(message: string): string {
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
export function checkQueueState(analysis: ResumeAnalysis, manifest: RunManifest): void {
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

/** Static message map for blocker diagnostic codes */
const BLOCKER_RECOMMENDATION_MAP: Record<string, string> = {
  INTEGRITY_HASH_MISMATCH:
    '   • Artifacts have been modified. Restore from backup or use --force (risky)',
  NON_RECOVERABLE_ERROR: '   • Manual intervention required. See docs/playbooks/resume_playbook.md',
};

/** Static message map for warning diagnostic codes */
const WARNING_RECOMMENDATION_MAP: Record<string, string> = {
  ERROR_RATE_LIMIT: '   • Wait for rate limit reset before resuming',
  ERROR_NETWORK: '   • Check network connectivity before resuming',
  QUEUE_HAS_FAILURES: '   • Review failed tasks in queue before resuming',
};

/**
 * Generate actionable recommendations based on diagnostics
 */
export function generateRecommendations(analysis: ResumeAnalysis): void {
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
      } else if (blocker.code === 'QUEUE_CORRUPTED') {
        analysis.recommendations.push(
          `   • Queue files are corrupted. Run 'codepipe queue validate --feature ${analysis.featureId}' and rebuild with 'codepipe queue rebuild --feature ${analysis.featureId} --from-plan'`
        );
      } else {
        analysis.recommendations.push(
          BLOCKER_RECOMMENDATION_MAP[blocker.code ?? ''] ?? `   • ${blocker.message}`
        );
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
      if (warning.code === 'QUEUE_VALIDATION_WARNINGS') {
        analysis.recommendations.push(
          `   • Inspect queue warnings with 'codepipe queue validate --feature ${analysis.featureId} --verbose'`
        );
      } else {
        const mapped = WARNING_RECOMMENDATION_MAP[warning.code ?? ''];
        if (mapped) {
          analysis.recommendations.push(mapped);
        }
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

export type { VerificationResult };
