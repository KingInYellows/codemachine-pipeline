/**
 * Branch Compliance Checker
 *
 * Pure domain workflow that orchestrates branch protection compliance evaluation.
 * Delegates HTTP fetching to BranchProtectionAdapter and applies compliance rules
 * without any direct network calls.
 *
 */

import { serializeError } from '../utils/errors';
import { ErrorType } from '../core/sharedTypes';
import { BranchProtectionError } from '../adapters/github/branchProtection';
import type {
  BranchProtectionCompliance,
  BranchProtectionRules,
  CheckRun,
  CommitStatus,
  PullRequestReview,
} from '../adapters/github/branchProtection';

/**
 * Minimal interface for the branch protection adapter methods required by
 * compliance evaluation. Allows the workflow to be tested without a real HTTP client.
 */
export interface BranchProtectionDataSource {
  getBranchProtection(branch: string): Promise<BranchProtectionRules | null>;
  getCommitStatuses(sha: string): Promise<CommitStatus[]>;
  getCheckRuns(sha: string): Promise<CheckRun[]>;
  getPullRequestReviews(pull_number: number): Promise<PullRequestReview[]>;
  getPullRequest(pull_number: number): Promise<{
    number: number;
    state: string;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    mergeable: boolean | null;
    mergeable_state: string | null;
  }>;
  compareCommits(
    base: string,
    head: string
  ): Promise<{ ahead_by: number; behind_by: number; status: string }>;
}

/**
 * Evaluate branch protection compliance for a pull request.
 *
 * This is pure domain logic: it fetches raw data via the adapter interface and
 * applies compliance rules to produce a structured result. No HTTP client is
 * created here.
 */
export async function evaluateCompliance(
  adapter: BranchProtectionDataSource,
  params: {
    branch: string;
    sha: string;
    base_sha: string;
    pull_number?: number;
  },
  logger?: {
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: logger interface accepts arbitrary structured context
    info(message: string, context?: Record<string, unknown>): void;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: logger interface accepts arbitrary structured context
    debug(message: string, context?: Record<string, unknown>): void;
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: logger interface accepts arbitrary structured context
    warn(message: string, context?: Record<string, unknown>): void;
  }
): Promise<BranchProtectionCompliance> {
  logger?.info('Evaluating branch protection compliance', {
    branch: params.branch,
    sha: params.sha,
    pull_number: params.pull_number,
  });

  // Fetch branch protection rules
  const protection = await adapter.getBranchProtection(params.branch);

  // Initialize compliance result
  const compliance: BranchProtectionCompliance = {
    branch: params.branch,
    sha: params.sha,
    protection,
    protected: protection !== null,
    required_checks: [],
    actual_checks: [],
    check_runs: [],
    checks_passing: true,
    failing_checks: [],
    reviews_required: 0,
    reviews: [],
    reviews_satisfied: true,
    up_to_date: true,
    stale_commit: false,
    allows_auto_merge: true,
    allows_force_push: protection?.allow_force_pushes ?? true,
    compliant: true,
    blockers: [],
    evaluated_at: new Date().toISOString(),
  };

  let branchRef = params.branch;
  let evaluationSha = params.sha;
  let baseRef = params.base_sha;

  if (params.pull_number) {
    try {
      const prDetails = await adapter.getPullRequest(params.pull_number);
      if (prDetails.head?.ref) {
        branchRef = prDetails.head.ref;
      }
      if (prDetails.head?.sha) {
        evaluationSha = prDetails.head.sha;
      }
      if (prDetails.base?.ref) {
        baseRef = prDetails.base.ref;
      }

      compliance.branch = branchRef;
      compliance.sha = evaluationSha;
    } catch (error) {
      logger?.warn('Failed to refresh PR references for branch protection evaluation', {
        pull_number: params.pull_number,
        error: serializeError(error),
      });
    }
  }

  if (!evaluationSha) {
    throw new BranchProtectionError(
      'Unable to determine commit SHA for branch protection evaluation',
      ErrorType.PERMANENT,
      undefined,
      undefined,
      'evaluateCompliance'
    );
  }

  compliance.branch = branchRef;
  compliance.sha = evaluationSha;

  // If branch is not protected, it's compliant by default
  if (!protection) {
    logger?.info('Branch is not protected - compliant by default', {
      branch: params.branch,
    });
    return compliance;
  }

  // Fetch commit statuses and check runs
  const [statuses, checkRuns] = await Promise.all([
    adapter.getCommitStatuses(evaluationSha),
    adapter.getCheckRuns(evaluationSha),
  ]);

  compliance.actual_checks = statuses;
  compliance.check_runs = checkRuns;

  // Check required status checks
  if (protection.required_status_checks) {
    compliance.required_checks = protection.required_status_checks.contexts;

    const passingContexts = new Set(
      statuses.filter((s) => s.state === 'success').map((s) => s.context)
    );
    const passingCheckRuns = new Set(
      checkRuns.filter((c) => c.conclusion === 'success').map((c) => c.name)
    );

    for (const requiredContext of compliance.required_checks) {
      if (!passingContexts.has(requiredContext) && !passingCheckRuns.has(requiredContext)) {
        compliance.failing_checks.push(requiredContext);
        compliance.checks_passing = false;
        compliance.compliant = false;
        compliance.blockers.push(`Required status check missing or failing: ${requiredContext}`);
      }
    }

    // Check if branch needs to be up-to-date
    if (protection.required_status_checks.strict) {
      if (baseRef) {
        const comparison = await adapter.compareCommits(baseRef, evaluationSha);
        compliance.up_to_date = comparison.behind_by === 0;
        compliance.stale_commit = comparison.behind_by > 0;

        if (!compliance.up_to_date) {
          compliance.compliant = false;
          compliance.blockers.push(
            `Branch is ${comparison.behind_by} commit(s) behind base - must be up-to-date`
          );
        }
      } else {
        logger?.warn('Strict status checks enabled but base reference is missing', {
          branch: branchRef,
          pull_number: params.pull_number,
        });
      }
    }
  }

  // Check required reviews
  if (protection.required_pull_request_reviews && params.pull_number) {
    compliance.reviews_required =
      protection.required_pull_request_reviews.required_approving_review_count;

    const reviews = await adapter.getPullRequestReviews(params.pull_number);
    compliance.reviews = reviews;

    // Count approved reviews (most recent per user)
    const latestReviews = new Map<number, PullRequestReview>();
    for (const review of reviews) {
      const existing = latestReviews.get(review.user.id);
      if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
        latestReviews.set(review.user.id, review);
      }
    }

    const approvedCount = Array.from(latestReviews.values()).filter(
      (r) => r.state === 'APPROVED'
    ).length;

    compliance.reviews_satisfied = approvedCount >= compliance.reviews_required;

    if (!compliance.reviews_satisfied) {
      compliance.compliant = false;
      compliance.blockers.push(
        `Requires ${compliance.reviews_required} approving review(s), has ${approvedCount}`
      );
    }
  }

  // Check if auto-merge is allowed (no force push restrictions)
  compliance.allows_auto_merge = !protection.allow_force_pushes && compliance.compliant;

  logger?.info('Branch protection compliance evaluated', {
    branch: params.branch,
    sha: params.sha,
    compliant: compliance.compliant,
    blockers: compliance.blockers.length,
  });

  return compliance;
}
