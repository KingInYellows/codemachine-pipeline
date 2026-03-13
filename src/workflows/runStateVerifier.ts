/**
 * Run State Verifier
 *
 * Per-check helper functions for verifying run state, error classification,
 * and recommendation generation during execution resumption.
 *
 * Shared types (ResumeAnalysis, DiagnosticSeverity, ResumeDiagnostic,
 * ResumeOptions) live in resumeTypes.ts to avoid circular dependencies.
 */

import type { RunManifest } from '../persistence/manifestManager';
import type { ResumeAnalysis, ResumeDiagnostic } from './resumeTypes';

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

/** Handler signature for diagnostic-to-recommendation mapping */
type RecommendationHandler = (diagnostic: ResumeDiagnostic, analysis: ResumeAnalysis) => string;

/** Map of blocker diagnostic codes to recommendation generators */
const BLOCKER_RECOMMENDATION_MAP = new Map<string, RecommendationHandler>([
  [
    'APPROVALS_PENDING',
    (diag) =>
      `   • Complete pending approvals: ${((diag.context?.approvals as string[]) || []).join(', ')}`,
  ],
  [
    'QUEUE_CORRUPTED',
    (_diag, analysis) =>
      `   • Queue files are corrupted. Run 'codepipe queue validate --feature ${analysis.featureId}' and rebuild with 'codepipe queue rebuild --feature ${analysis.featureId} --from-plan'`,
  ],
  [
    'INTEGRITY_HASH_MISMATCH',
    () => '   • Artifacts have been modified. Restore from backup or use --force (risky)',
  ],
  [
    'NON_RECOVERABLE_ERROR',
    () => '   • Manual intervention required. See docs/playbooks/resume_playbook.md',
  ],
]);

/** Map of warning diagnostic codes to recommendation generators */
const WARNING_RECOMMENDATION_MAP = new Map<string, RecommendationHandler>([
  [
    'QUEUE_VALIDATION_WARNINGS',
    (_diag, analysis) =>
      `   • Inspect queue warnings with 'codepipe queue validate --feature ${analysis.featureId} --verbose'`,
  ],
  ['ERROR_RATE_LIMIT', () => '   • Wait for rate limit reset before resuming'],
  ['ERROR_NETWORK', () => '   • Check network connectivity before resuming'],
  ['QUEUE_HAS_FAILURES', () => '   • Review failed tasks in queue before resuming'],
]);

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
      const handler = BLOCKER_RECOMMENDATION_MAP.get(blocker.code ?? '');
      analysis.recommendations.push(
        handler ? handler(blocker, analysis) : `   • ${blocker.message}`
      );
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
      const handler = WARNING_RECOMMENDATION_MAP.get(warning.code ?? '');
      if (handler) {
        analysis.recommendations.push(handler(warning, analysis));
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
