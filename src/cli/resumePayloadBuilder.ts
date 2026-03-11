/**
 * Resume Payload Builder
 *
 * Extracted from resume.ts: constructs the ResumePayload object and
 * attaches rate-limit warnings and branch-protection blockers.
 */

import type { analyzeResumeState } from '../workflows/resumeCoordinator';
import type { QueueValidationResult } from '../workflows/queue/queueStore.js';
import type { loadPlanSummary } from '../workflows/taskPlanner';
import { RateLimitReporter } from '../telemetry/rateLimitReporter';
import { loadReport as loadBranchProtectionReport } from '../persistence/branchProtectionStore';
import type { ResumePayload } from './resumeTypes';

export async function buildResumePayload(
  analysis: Awaited<ReturnType<typeof analyzeResumeState>>,
  queueValidation?: QueueValidationResult,
  planSummary?: Awaited<ReturnType<typeof loadPlanSummary>>,
  dryRun = false,
  runDir?: string
): Promise<ResumePayload> {
  const payload: ResumePayload = {
    feature_id: analysis.featureId,
    can_resume: analysis.canResume,
    status: analysis.status,
    queue_state: analysis.queueState,
    pending_approvals: analysis.pendingApprovals,
    diagnostics: analysis.diagnostics.map((d) => {
      const diag: { severity: string; message: string; code?: string } = {
        severity: d.severity,
        message: d.message,
      };
      if (d.code) {
        diag.code = d.code;
      }
      return diag;
    }),
    recommendations: analysis.recommendations,
    dry_run: dryRun,
    playbook_reference: 'docs/playbooks/resume_playbook.md',
    last_error: analysis.lastError ?? null,
  };

  if (analysis.lastStep) {
    payload.last_step = analysis.lastStep;
  }
  if (analysis.currentStep) {
    payload.current_step = analysis.currentStep;
  }

  if (analysis.integrityCheck) {
    payload.integrity_check = {
      valid: analysis.integrityCheck.valid,
      passed: analysis.integrityCheck.passed.length,
      failed: analysis.integrityCheck.failed.length,
      missing: analysis.integrityCheck.missing.length,
    };
  }

  if (queueValidation) {
    payload.queue_validation = {
      valid: queueValidation.valid,
      total_tasks: queueValidation.totalTasks,
      corrupted_tasks: queueValidation.corruptedTasks,
      errors: queueValidation.errors,
    };
  }

  if (planSummary) {
    payload.plan_summary = {
      total_tasks: planSummary.totalTasks,
      entry_tasks: planSummary.entryTasks.length,
      next_tasks: planSummary.queueState.ready.slice(0, 3),
    };
  }

  // Build resume instructions
  const resumeInstructions: ResumePayload['resume_instructions'] = {};

  if (analysis.lastStep) {
    resumeInstructions.checkpoint = analysis.lastStep;
  }

  if (analysis.currentStep) {
    resumeInstructions.next_step = analysis.currentStep;
  }

  if (analysis.pendingApprovals.length > 0) {
    resumeInstructions.pending_approvals = analysis.pendingApprovals;
  }

  if (Object.keys(resumeInstructions).length > 0) {
    payload.resume_instructions = resumeInstructions;
  }

  // Load rate limit warnings and integration blockers
  if (runDir) {
    await attachRateLimitWarnings(payload, runDir);
    await attachBranchProtectionBlockers(payload, runDir);
  }

  return payload;
}

async function attachRateLimitWarnings(
  payload: ResumePayload,
  runDir: string
): Promise<void> {
  try {
    const rateLimitReport = await RateLimitReporter.generateReport(runDir);

    const rateLimitWarnings: ResumePayload['rate_limit_warnings'] = [];
    const integrationBlockers: ResumePayload['integration_blockers'] = {};

    for (const [providerName, providerData] of Object.entries(rateLimitReport.providers)) {
      if (providerData.inCooldown || providerData.manualAckRequired) {
        rateLimitWarnings.push({
          provider: providerName,
          in_cooldown: providerData.inCooldown,
          manual_ack_required: providerData.manualAckRequired,
          reset_at: providerData.resetAt,
        });

        // Track integration-specific blockers for known providers
        if (providerName === 'github' || providerName === 'linear') {
          const key: 'github' | 'linear' = providerName;
          if (!integrationBlockers[key]) {
            integrationBlockers[key] = [];
          }
          if (providerData.inCooldown) {
            integrationBlockers[key]?.push(`Rate limit cooldown until ${providerData.resetAt}`);
          }
          if (providerData.manualAckRequired) {
            integrationBlockers[key]?.push(
              `Manual acknowledgement required (${providerData.recentHitCount} consecutive hits)`
            );
          }
        }
      }
    }

    if (rateLimitWarnings.length > 0) {
      payload.rate_limit_warnings = rateLimitWarnings;
    }

    if (Object.keys(integrationBlockers).length > 0) {
      payload.integration_blockers = integrationBlockers;
    }
  } catch {
    // Rate limit data unavailable, skip
  }
}

async function attachBranchProtectionBlockers(
  payload: ResumePayload,
  runDir: string
): Promise<void> {
  try {
    const report = await loadBranchProtectionReport(runDir);
    if (report && report.blockers.length > 0) {
      payload.branch_protection_blockers = [...report.blockers];
    }
  } catch {
    // Branch protection artifact missing or invalid; skip without blocking resume output
  }
}
