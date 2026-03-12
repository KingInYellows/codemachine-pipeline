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
