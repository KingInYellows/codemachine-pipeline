/**
 * Resume Types
 *
 * Shared type definitions for run state verification and integrity checking
 * during execution resumption. Extracted to break the circular dependency
 * between resumeIntegrityChecker.ts and runStateVerifier.ts.
 */

import type { RunManifest } from '../persistence/manifestManager';
import type { VerificationResult } from '../persistence/hashManifest';
import type { QueueValidationResult } from './queue/queueStore.js';

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'blocker';

/**
 * Known diagnostic classification codes used by run state verifier,
 * integrity checker, and queue recovery modules.
 */
export type DiagnosticCode =
  | 'ALREADY_COMPLETED'
  | 'NON_RECOVERABLE_ERROR'
  | 'RECOVERABLE_ERROR'
  | 'PAUSED'
  | 'UNEXPECTED_INTERRUPT'
  | 'NOT_STARTED'
  | 'UNKNOWN_STATUS'
  | 'APPROVALS_PENDING'
  | 'QUEUE_COMPLETE'
  | 'QUEUE_HAS_FAILURES'
  | 'QUEUE_HAS_PENDING'
  | 'QUEUE_DIR_MISSING'
  | 'QUEUE_CORRUPTED'
  | 'QUEUE_VALIDATED'
  | 'QUEUE_VALIDATION_WARNINGS'
  | 'INTEGRITY_HASH_MISMATCH'
  | 'INTEGRITY_MISSING_FILES'
  | 'INTEGRITY_OK'
  | 'INTEGRITY_NO_MANIFEST'
  | 'ERROR_RATE_LIMIT'
  | 'ERROR_NETWORK'
  | 'ERROR_VALIDATION'
  | 'ERROR_PERMISSION'
  | 'ERROR_CORRUPTION'
  | 'ERROR_GIT'
  | 'ERROR_AGENT'
  | 'ERROR_UNKNOWN'
  | (string & {}); // allow extension without losing autocomplete

/**
 * Resume diagnostic entry
 */
export interface ResumeDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Classification code for mapping to playbook */
  code?: DiagnosticCode | undefined;
  /** Additional context data */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- diagnostic context varies by subsystem
  context?: Record<string, unknown> | undefined;
}

/**
 * Resume options
 */
export interface ResumeOptions {
  /** Force resume even with integrity warnings (use with caution) */
  force?: boolean | undefined;
  /** Skip hash verification (dangerous, for debugging only) */
  skipHashVerification?: boolean | undefined;
  /** Validate queue files before resuming */
  validateQueue?: boolean | undefined;
}

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
  lastStep?: string | undefined;
  /** Current step that was interrupted */
  currentStep?: string | undefined;
  /** Last error details if any */
  lastError?: RunManifest['execution']['last_error'] | undefined;
  /** Pending approvals that block resume */
  pendingApprovals: string[];
  /** Queue state summary */
  queueState: {
    pending: number;
    completed: number;
    failed: number;
  };
  /** Result of queue validation (if performed) */
  queueValidation?: QueueValidationResult | undefined;
  /** Hash integrity check result */
  integrityCheck?: VerificationResult | undefined;
  /** Diagnostic messages for operator */
  diagnostics: ResumeDiagnostic[];
  /** Recommended actions for operator */
  recommendations: string[];
}
