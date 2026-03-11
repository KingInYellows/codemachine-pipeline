/**
 * Resume Command Output
 *
 * Formatting functions for the resume command's terminal and JSON output.
 * Extracted from resume.ts to mirror the startOutput.ts pattern.
 */

import * as path from 'node:path';
import { formatResumeAnalysis } from '../workflows/resumeCoordinator';
import type { analyzeResumeState } from '../workflows/resumeCoordinator';
import type { QueueValidationResult } from '../workflows/queue/queueStore.js';
import type { ResumeFlags, ResumePayload } from './resumeTypes';

type LogFn = (message: string) => void;

/**
 * Print human-readable resume analysis to the terminal.
 */
export function printResumeAnalysis(
  analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
  queueValidation: QueueValidationResult | undefined,
  flags: ResumeFlags,
  payload: ResumePayload,
  log: LogFn,
  warn: LogFn
): void {
  log('');
  log('═══════════════════════════════════════════════════════════');
  log('  Resume Analysis');
  log('═══════════════════════════════════════════════════════════');
  log('');

  // Use the formatted output from resumeCoordinator
  log(formatResumeAnalysis(analysis));

  // Resume instructions section
  if (analysis.canResume && !flags['dry-run']) {
    log('');
    log('Resume Instructions:');
    if (analysis.lastStep) {
      log(`  Last checkpoint: ${analysis.lastStep}`);
    }
    if (analysis.currentStep) {
      log(`  Next step: ${analysis.currentStep}`);
    }
    if (analysis.pendingApprovals.length > 0) {
      log('  Pending approvals:');
      analysis.pendingApprovals.forEach((gate) => {
        log(`    • ${gate.toUpperCase()} - Run: codepipe approve ${gate}`);
      });
    }
  }

  // Queue validation results
  if (queueValidation && flags.verbose) {
    log('');
    log('Queue Validation:');
    if (queueValidation.valid) {
      log(`  ✓ Queue is valid (${queueValidation.totalTasks} tasks)`);
    } else {
      log(`  ✗ Queue validation failed`);
      log(`    Total tasks: ${queueValidation.totalTasks}`);
      log(`    Corrupted: ${queueValidation.corruptedTasks}`);
      if (queueValidation.errors.length > 0) {
        log('  Errors:');
        for (const error of queueValidation.errors.slice(0, 5)) {
          log(`    • Line ${error.line}: ${error.message}`);
        }
        if (queueValidation.errors.length > 5) {
          log(`    ... and ${queueValidation.errors.length - 5} more`);
        }
      }
    }
  }

  // Rate limit warnings
  if (payload.rate_limit_warnings && payload.rate_limit_warnings.length > 0) {
    log('');
    log('Rate Limit Warnings:');
    for (const warning of payload.rate_limit_warnings) {
      log(`  ${warning.provider}:`);
      if (warning.in_cooldown) {
        warn(`    ⚠ In cooldown until ${warning.reset_at}`);
      }
      if (warning.manual_ack_required) {
        warn(`    ⚠ Manual acknowledgement required`);
        log(`       Use: codepipe rate-limits clear ${warning.provider}`);
      }
    }
  }

  // Integration blockers
  if (payload.integration_blockers) {
    const blockers = payload.integration_blockers;
    if (
      (blockers.github && blockers.github.length > 0) ||
      (blockers.linear && blockers.linear.length > 0)
    ) {
      log('');
      log('Integration Blockers:');

      if (blockers.github && blockers.github.length > 0) {
        log('  GitHub:');
        blockers.github.forEach((blocker) => {
          warn(`    ⚠ ${blocker}`);
        });
      }

      if (blockers.linear && blockers.linear.length > 0) {
        log('  Linear:');
        blockers.linear.forEach((blocker) => {
          warn(`    ⚠ ${blocker}`);
        });
      }
    }
  }

  if (payload.branch_protection_blockers && payload.branch_protection_blockers.length > 0) {
    log('');
    log('Branch Protection Blockers:');
    payload.branch_protection_blockers.forEach((blocker) => {
      warn(`  ⚠ ${blocker}`);
    });
  }

  log('');
  log('═══════════════════════════════════════════════════════════');

  // Warnings for dangerous flags
  if (flags.force) {
    log('');
    warn('⚠️  WARNING: Force flag enabled - blockers overridden');
    log('');
  }

  if (flags['skip-hash-verification']) {
    log('');
    warn('⚠️  WARNING: Hash verification skipped - integrity not verified');
    log('');
  }

  if (flags['dry-run']) {
    log('');
    log('ℹ️  This was a dry run. No changes were made.');
    log('   To execute resume, run without --dry-run flag.');
    log('');
  }
}

/**
 * Print execution results after a successful resume run.
 */
export function printExecutionResults(
  featureId: string,
  runDirPath: string,
  executionResults: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    permanentlyFailedTasks: number;
    skippedTasks: number;
  },
  executionDuration: number,
  log: LogFn,
  warn: LogFn
): void {
  log('');
  log('✅ Resume execution successful');
  log('');
  log('Execution results:');
  log(`  Total tasks: ${executionResults.totalTasks}`);
  log(`  Completed: ${executionResults.completedTasks}`);
  log(`  Failed: ${executionResults.failedTasks}`);
  log(`  Permanently failed: ${executionResults.permanentlyFailedTasks}`);
  log(`  Skipped: ${executionResults.skippedTasks}`);
  log(`  Duration: ${(executionDuration / 1000).toFixed(2)}s`);
  log('');
  log('Next steps:');
  log(`  • Monitor progress with: codepipe status --feature ${featureId}`);
  log(`  • View logs in: ${path.join(runDirPath, 'logs', 'logs.ndjson')}`);
  log('');

  if (executionResults.failedTasks > 0) {
    warn(
      `Warning: ${executionResults.failedTasks} task(s) failed. Run 'codepipe resume' to retry.`
    );
  }
}

/**
 * Determine the exit code for a blocked resume based on diagnostics.
 */
export function determineResumeExitCode(
  analysis: Awaited<ReturnType<typeof analyzeResumeState>>
): number {
  // Check for integrity failures
  const hasIntegrityFailure = analysis.diagnostics.some(
    (d) => d.code === 'INTEGRITY_HASH_MISMATCH' || d.code === 'INTEGRITY_MISSING_FILES'
  );
  if (hasIntegrityFailure) {
    return 20;
  }

  // Check for queue validation failures
  if (analysis.queueValidation && !analysis.queueValidation.valid) {
    return 30;
  }

  // General blocker
  return 10;
}
