/**
 * Branch Protection Reporter
 *
 * Workflow helper that evaluates branch protection compliance and generates
 * deterministic JSON artifacts for CLI status/deploy commands.
 *
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { BranchProtectionCompliance } from '../adapters/github/branchProtection';
import type { BranchProtectionReport } from '../core/models/BranchProtectionReport';
import { validateOrThrow } from '../validation/helpers.js';

export { BranchProtectionReportSchema } from '../core/models/BranchProtectionReport';
export type { BranchProtectionReport } from '../core/models/BranchProtectionReport';

/**
 * Summary for CLI display
 */
export interface BranchProtectionSummary {
  protected: boolean;
  compliant: boolean;
  blockers_count: number;
  blockers: string[];
  missing_checks: string[];
  reviews_status: {
    required: number;
    completed: number;
    satisfied: boolean;
  };
  branch_status: {
    up_to_date: boolean;
    stale: boolean;
  };
  auto_merge: {
    allowed: boolean;
    enabled: boolean;
  };
}

/**
 * Validation mismatch (pipeline checks vs GitHub required checks)
 */
export interface ValidationMismatch {
  /** Checks required by GitHub but not in validation registry */
  missing_in_registry: string[];
  /** Checks in validation registry but not required by GitHub */
  extra_in_registry: string[];
  /** Recommended actions */
  recommendations: string[];
}

const CommandsDataSchema = z.object({
  commands: z
    .array(
      z.object({
        type: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/, 'Command type must contain only safe characters'),
        description: z.string().optional(),
      })
    )
    .optional(),
});

const SCHEMA_VERSION = '1.0.0';

/**
 * Generate branch protection report from compliance result
 */
export function generateReport(
  featureId: string,
  compliance: BranchProtectionCompliance,
  metadata?: {
    owner: string;
    repo: string;
    base_sha: string;
    pull_number?: number;
  }
): BranchProtectionReport {
  const approvedReviews = compliance.reviews.filter((r) => r.state === 'APPROVED');

  return {
    schema_version: SCHEMA_VERSION,
    feature_id: featureId,
    branch: compliance.branch,
    sha: compliance.sha,
    base_sha: metadata?.base_sha ?? '',
    pull_number: metadata?.pull_number,
    protected: compliance.protected,
    compliant: compliance.compliant,
    required_checks: compliance.required_checks,
    checks_passing: compliance.checks_passing,
    failing_checks: compliance.failing_checks,
    reviews_required: compliance.reviews_required,
    reviews_count: approvedReviews.length,
    reviews_satisfied: compliance.reviews_satisfied,
    up_to_date: compliance.up_to_date,
    stale_commit: compliance.stale_commit,
    allows_auto_merge: compliance.allows_auto_merge,
    allows_force_push: compliance.allows_force_push,
    blockers: compliance.blockers,
    evaluated_at: compliance.evaluated_at,
    metadata: metadata
      ? {
          owner: metadata.owner,
          repo: metadata.repo,
          protection_enabled: compliance.protected,
          enforce_admins: compliance.protection?.enforce_admins,
          required_linear_history: compliance.protection?.required_linear_history,
          required_conversation_resolution: compliance.protection?.required_conversation_resolution,
        }
      : undefined,
  };
}

/**
 * Generate summary for CLI display
 */
export function generateSummary(report: BranchProtectionReport): BranchProtectionSummary {
  return {
    protected: report.protected,
    compliant: report.compliant,
    blockers_count: report.blockers.length,
    blockers: report.blockers,
    missing_checks: report.failing_checks,
    reviews_status: {
      required: report.reviews_required,
      completed: report.reviews_count,
      satisfied: report.reviews_satisfied,
    },
    branch_status: {
      up_to_date: report.up_to_date,
      stale: report.stale_commit,
    },
    auto_merge: {
      allowed: report.allows_auto_merge,
      enabled: false, // This would come from PR metadata
    },
  };
}

/**
 * Detect validation mismatches between GitHub required checks and validation registry
 */
export async function detectValidationMismatch(
  runDir: string,
  requiredChecks: string[]
): Promise<ValidationMismatch> {
  const validationCommandsPath = path.join(runDir, 'validation', 'commands.json');

  let registryContexts: string[] = [];

  try {
    const commandsContent = await fs.readFile(validationCommandsPath, 'utf-8');
    const commandsData = validateOrThrow(
      CommandsDataSchema,
      JSON.parse(commandsContent),
      'validation commands'
    );

    // Map validation command types to GitHub check contexts
    // Convention: validation type maps to "validation/{type}" context
    if (commandsData.commands) {
      registryContexts = commandsData.commands.map((cmd) => `validation/${cmd.type}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const requiredSet = new Set(requiredChecks);
  const registrySet = new Set(registryContexts);

  const missingInRegistry = requiredChecks.filter((check) => !registrySet.has(check));
  const extraInRegistry = registryContexts.filter((context) => !requiredSet.has(context));

  const recommendations: string[] = [];

  if (missingInRegistry.length > 0) {
    recommendations.push(`Add validation commands for: ${missingInRegistry.join(', ')}`);
  }

  if (extraInRegistry.length > 0) {
    recommendations.push(
      `Consider removing unnecessary validations: ${extraInRegistry.join(', ')}`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('Validation registry is aligned with branch protection requirements');
  }

  return {
    missing_in_registry: missingInRegistry,
    extra_in_registry: extraInRegistry,
    recommendations,
  };
}

/**
 * Format blockers for human-readable output
 */
export function formatBlockers(blockers: string[]): string {
  if (blockers.length === 0) {
    return 'No blockers detected';
  }

  return blockers.map((blocker, index) => `${index + 1}. ${blocker}`).join('\n');
}

/**
 * Format summary for human-readable output
 */
export function formatSummary(summary: BranchProtectionSummary): string {
  const lines: string[] = [];

  lines.push(`Branch Protection Status:`);
  lines.push(`  Protected: ${summary.protected ? 'Yes' : 'No'}`);
  lines.push(`  Compliant: ${summary.compliant ? 'Yes' : 'No'}`);
  lines.push('');

  if (summary.blockers_count > 0) {
    lines.push(`Blockers (${summary.blockers_count}):`);
    summary.blockers.forEach((blocker, index) => {
      lines.push(`  ${index + 1}. ${blocker}`);
    });
    lines.push('');
  }

  if (summary.missing_checks.length > 0) {
    lines.push(`Missing or Failing Checks:`);
    summary.missing_checks.forEach((check) => {
      lines.push(`  - ${check}`);
    });
    lines.push('');
  }

  lines.push(`Reviews:`);
  lines.push(`  Required: ${summary.reviews_status.required}`);
  lines.push(`  Completed: ${summary.reviews_status.completed}`);
  lines.push(`  Satisfied: ${summary.reviews_status.satisfied ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push(`Branch Status:`);
  lines.push(`  Up-to-date: ${summary.branch_status.up_to_date ? 'Yes' : 'No'}`);
  lines.push(`  Stale: ${summary.branch_status.stale ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push(`Auto-merge:`);
  lines.push(`  Allowed: ${summary.auto_merge.allowed ? 'Yes' : 'No'}`);
  lines.push(`  Enabled: ${summary.auto_merge.enabled ? 'Yes' : 'No'}`);

  return lines.join('\n');
}

/**
 * Determine if deployment should proceed based on branch protection
 */
export function canProceedWithDeployment(report: BranchProtectionReport): {
  proceed: boolean;
  reason: string;
} {
  if (!report.protected) {
    return {
      proceed: true,
      reason: 'Branch is not protected - no restrictions',
    };
  }

  if (report.compliant) {
    return {
      proceed: true,
      reason: 'All branch protection requirements satisfied',
    };
  }

  return {
    proceed: false,
    reason: `Branch protection requirements not met: ${report.blockers.join('; ')}`,
  };
}

/**
 * Get recommended action based on report
 */
export function getRecommendedAction(report: BranchProtectionReport): string {
  if (!report.protected) {
    return 'Branch is not protected. You may merge freely.';
  }

  if (report.compliant) {
    if (report.allows_auto_merge) {
      return 'All requirements met. Consider enabling auto-merge for automatic merging when checks pass.';
    }
    return 'All requirements met. You may proceed with manual merge.';
  }

  const actions: string[] = [];

  if (!report.checks_passing) {
    actions.push(
      `Wait for ${report.failing_checks.length} required check(s) to pass: ${report.failing_checks.join(', ')}`
    );
  }

  if (!report.reviews_satisfied) {
    const needed = report.reviews_required - report.reviews_count;
    actions.push(`Request ${needed} more approving review(s)`);
  }

  if (!report.up_to_date && report.stale_commit) {
    actions.push('Update branch with latest changes from base branch');
  }

  if (actions.length === 0) {
    return 'Review blockers and address issues before merging.';
  }

  return `Required actions:\n${actions.map((action, i) => `  ${i + 1}. ${action}`).join('\n')}`;
}
