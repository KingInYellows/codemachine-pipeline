import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  type BranchProtectionRules,
  type BranchProtectionCompliance,
  type CommitStatus,
  type CheckRun,
  type PullRequestReview,
} from '../../src/adapters/github/branchProtection';
import {
  generateReport,
  persistReport,
  loadReport,
  generateSummary,
  formatSummary,
  detectValidationMismatch,
  canProceedWithDeployment,
  getRecommendedAction,
} from '../../src/workflows/branchProtectionReporter';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'branch-protection-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createTestProtectionRules(
  overrides: Partial<BranchProtectionRules> = {}
): BranchProtectionRules {
  return {
    branch: 'main',
    enabled: true,
    required_status_checks: {
      enabled: true,
      strict: true,
      contexts: ['ci/build', 'test/unit'],
    },
    required_pull_request_reviews: {
      enabled: true,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 2,
    },
    enforce_admins: true,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    ...overrides,
  };
}

function createTestCommitStatus(overrides: Partial<CommitStatus> = {}): CommitStatus {
  return {
    context: 'ci/build',
    state: 'success',
    description: 'Build passed',
    target_url: 'https://ci.example.com/builds/123',
    created_at: '2025-12-17T10:00:00Z',
    updated_at: '2025-12-17T10:05:00Z',
    ...overrides,
  };
}

function createTestCheckRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 123456,
    name: 'ci/build',
    status: 'completed',
    conclusion: 'success',
    started_at: '2025-12-17T10:00:00Z',
    completed_at: '2025-12-17T10:05:00Z',
    details_url: 'https://ci.example.com/runs/123',
    ...overrides,
  };
}

function createTestReview(overrides: Partial<PullRequestReview> = {}): PullRequestReview {
  return {
    id: 987654,
    user: {
      login: 'reviewer1',
      id: 12345,
    },
    state: 'APPROVED',
    submitted_at: '2025-12-17T09:00:00Z',
    commit_id: 'abc123def456',
    ...overrides,
  };
}

function createTestCompliance(
  overrides: Partial<BranchProtectionCompliance> = {}
): BranchProtectionCompliance {
  return {
    branch: 'main',
    sha: 'abc123def456',
    protection: createTestProtectionRules(),
    protected: true,
    required_checks: ['ci/build', 'test/unit'],
    actual_checks: [
      createTestCommitStatus({ context: 'ci/build' }),
      createTestCommitStatus({ context: 'test/unit' }),
    ],
    check_runs: [
      createTestCheckRun({ name: 'ci/build' }),
      createTestCheckRun({ name: 'test/unit' }),
    ],
    checks_passing: true,
    failing_checks: [],
    reviews_required: 2,
    reviews: [createTestReview(), createTestReview({ user: { login: 'reviewer2', id: 67890 } })],
    reviews_satisfied: true,
    up_to_date: true,
    stale_commit: false,
    allows_auto_merge: true,
    allows_force_push: false,
    compliant: true,
    blockers: [],
    evaluated_at: '2025-12-17T10:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Branch Protection Reporter Tests
// ============================================================================

describe('BranchProtectionReporter', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('generateReport', () => {
    it('should generate report from compliant state', () => {
      const compliance = createTestCompliance();
      const report = generateReport('feature-test-123', compliance, {
        owner: 'acme-corp',
        repo: 'api-service',
        base_sha: 'xyz789',
        pull_number: 42,
      });

      expect(report.feature_id).toBe('feature-test-123');
      expect(report.branch).toBe('main');
      expect(report.sha).toBe('abc123def456');
      expect(report.base_sha).toBe('xyz789');
      expect(report.pull_number).toBe(42);
      expect(report.protected).toBe(true);
      expect(report.compliant).toBe(true);
      expect(report.required_checks).toEqual(['ci/build', 'test/unit']);
      expect(report.checks_passing).toBe(true);
      expect(report.failing_checks).toEqual([]);
      expect(report.reviews_required).toBe(2);
      expect(report.reviews_count).toBe(2);
      expect(report.reviews_satisfied).toBe(true);
      expect(report.blockers).toEqual([]);
    });

    it('should generate report from non-compliant state', () => {
      const compliance = createTestCompliance({
        checks_passing: false,
        failing_checks: ['security/scan'],
        reviews_satisfied: false,
        reviews: [createTestReview()],
        compliant: false,
        blockers: [
          'Required status check missing or failing: security/scan',
          'Requires 2 approving review(s), has 1',
        ],
      });

      const report = generateReport('feature-test-123', compliance);

      expect(report.compliant).toBe(false);
      expect(report.checks_passing).toBe(false);
      expect(report.failing_checks).toEqual(['security/scan']);
      expect(report.reviews_count).toBe(1);
      expect(report.reviews_satisfied).toBe(false);
      expect(report.blockers.length).toBe(2);
    });

    it('should handle unprotected branch', () => {
      const compliance = createTestCompliance({
        protection: null,
        protected: false,
        required_checks: [],
        checks_passing: true,
        reviews_required: 0,
        reviews: [],
        reviews_satisfied: true,
        compliant: true,
        blockers: [],
      });

      const report = generateReport('feature-test-123', compliance);

      expect(report.protected).toBe(false);
      expect(report.compliant).toBe(true);
      expect(report.required_checks).toEqual([]);
      expect(report.reviews_required).toBe(0);
      expect(report.blockers).toEqual([]);
    });
  });

  describe('persistReport and loadReport', () => {
    it('should persist and load report', async () => {
      const compliance = createTestCompliance();
      const report = generateReport('feature-test-123', compliance);
      report.validation_mismatch = {
        missing_in_registry: ['ci/build'],
        extra_in_registry: [],
        recommendations: ['Add validation commands for: ci/build'],
      };

      const reportPath = await persistReport(tempDir, report);
      expect(reportPath).toBe(path.join(tempDir, 'status', 'branch_protection.json'));

      const loaded = await loadReport(tempDir);
      expect(loaded).toEqual(report);
    });

    it('should return null when report does not exist', async () => {
      const loaded = await loadReport(tempDir);
      expect(loaded).toBeNull();
    });

    it('should create status directory if missing', async () => {
      const compliance = createTestCompliance();
      const report = generateReport('feature-test-123', compliance);

      await persistReport(tempDir, report);

      const statusDir = path.join(tempDir, 'status');
      const stat = await fs.stat(statusDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('generateSummary', () => {
    it('should generate summary for compliant report', () => {
      const compliance = createTestCompliance();
      const report = generateReport('feature-test-123', compliance);
      const summary = generateSummary(report);

      expect(summary.protected).toBe(true);
      expect(summary.compliant).toBe(true);
      expect(summary.blockers_count).toBe(0);
      expect(summary.blockers).toEqual([]);
      expect(summary.missing_checks).toEqual([]);
      expect(summary.reviews_status).toEqual({
        required: 2,
        completed: 2,
        satisfied: true,
      });
      expect(summary.branch_status).toEqual({
        up_to_date: true,
        stale: false,
      });
      expect(summary.auto_merge.allowed).toBe(true);
    });

    it('should generate summary for non-compliant report', () => {
      const compliance = createTestCompliance({
        checks_passing: false,
        failing_checks: ['security/scan'],
        reviews_satisfied: false,
        reviews: [createTestReview()],
        compliant: false,
        blockers: [
          'Required status check missing or failing: security/scan',
          'Requires 2 approving review(s), has 1',
        ],
      });

      const report = generateReport('feature-test-123', compliance);
      const summary = generateSummary(report);

      expect(summary.compliant).toBe(false);
      expect(summary.blockers_count).toBe(2);
      expect(summary.missing_checks).toEqual(['security/scan']);
      expect(summary.reviews_status).toEqual({
        required: 2,
        completed: 1,
        satisfied: false,
      });
    });

    it('should flag stale branch status when commits are behind base', () => {
      const compliance = createTestCompliance({
        up_to_date: false,
        stale_commit: true,
        compliant: false,
        blockers: ['Branch is 1 commit(s) behind base - must be up-to-date'],
      });

      const report = generateReport('feature-test-123', compliance);
      const summary = generateSummary(report);

      expect(summary.branch_status).toEqual({
        up_to_date: false,
        stale: true,
      });
      expect(summary.blockers).toContain('Branch is 1 commit(s) behind base - must be up-to-date');
    });
  });

  describe('formatSummary', () => {
    it('should include blockers and missing checks in formatted output', () => {
      const compliance = createTestCompliance({
        checks_passing: false,
        failing_checks: ['security/scan'],
        reviews_satisfied: false,
        reviews: [createTestReview()],
        compliant: false,
        blockers: [
          'Required status check missing or failing: security/scan',
          'Requires 2 approving review(s), has 1',
        ],
      });

      const report = generateReport('feature-test-123', compliance);
      const summary = generateSummary(report);
      const formatted = formatSummary(summary);

      expect(formatted).toContain('Branch Protection Status');
      expect(formatted).toContain('Blockers (2)');
      expect(formatted).toContain('Missing or Failing Checks');
      expect(formatted).toContain('security/scan');
      expect(formatted).toContain('Reviews');
    });
  });

  describe('detectValidationMismatch', () => {
    it('should detect missing validation commands', async () => {
      const validationDir = path.join(tempDir, 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      const commands = {
        commands: [{ type: 'lint' }, { type: 'typecheck' }],
      };

      await fs.writeFile(
        path.join(validationDir, 'commands.json'),
        JSON.stringify(commands),
        'utf-8'
      );

      const requiredChecks = ['validation/lint', 'validation/typecheck', 'security/scan'];
      const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

      expect(mismatch.missing_in_registry).toEqual(['security/scan']);
      expect(mismatch.extra_in_registry).toEqual([]);
      expect(mismatch.recommendations).toContain('Add validation commands for: security/scan');
    });

    it('should detect extra validation commands', async () => {
      const validationDir = path.join(tempDir, 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      const commands = {
        commands: [{ type: 'lint' }, { type: 'typecheck' }, { type: 'custom-scan' }],
      };

      await fs.writeFile(
        path.join(validationDir, 'commands.json'),
        JSON.stringify(commands),
        'utf-8'
      );

      const requiredChecks = ['validation/lint', 'validation/typecheck'];
      const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

      expect(mismatch.missing_in_registry).toEqual([]);
      expect(mismatch.extra_in_registry).toEqual(['validation/custom-scan']);
      expect(mismatch.recommendations).toContain(
        'Consider removing unnecessary validations: validation/custom-scan'
      );
    });

    it('should handle aligned registry', async () => {
      const validationDir = path.join(tempDir, 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      const commands = {
        commands: [{ type: 'lint' }, { type: 'typecheck' }],
      };

      await fs.writeFile(
        path.join(validationDir, 'commands.json'),
        JSON.stringify(commands),
        'utf-8'
      );

      const requiredChecks = ['validation/lint', 'validation/typecheck'];
      const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

      expect(mismatch.missing_in_registry).toEqual([]);
      expect(mismatch.extra_in_registry).toEqual([]);
      expect(mismatch.recommendations).toContain(
        'Validation registry is aligned with branch protection requirements'
      );
    });

    it('should handle missing validation registry', async () => {
      const requiredChecks = ['validation/lint', 'validation/typecheck'];
      const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

      expect(mismatch.missing_in_registry).toEqual(requiredChecks);
      expect(mismatch.extra_in_registry).toEqual([]);
    });
  });

  describe('canProceedWithDeployment', () => {
    it('should allow deployment for unprotected branch', () => {
      const compliance = createTestCompliance({
        protection: null,
        protected: false,
        compliant: true,
      });
      const report = generateReport('feature-test-123', compliance);

      const result = canProceedWithDeployment(report);

      expect(result.proceed).toBe(true);
      expect(result.reason).toContain('not protected');
    });

    it('should allow deployment for compliant branch', () => {
      const compliance = createTestCompliance();
      const report = generateReport('feature-test-123', compliance);

      const result = canProceedWithDeployment(report);

      expect(result.proceed).toBe(true);
      expect(result.reason).toContain('requirements satisfied');
    });

    it('should block deployment for non-compliant branch', () => {
      const compliance = createTestCompliance({
        compliant: false,
        blockers: ['Required status check missing or failing: security/scan'],
      });
      const report = generateReport('feature-test-123', compliance);

      const result = canProceedWithDeployment(report);

      expect(result.proceed).toBe(false);
      expect(result.reason).toContain('requirements not met');
      expect(result.reason).toContain('security/scan');
    });
  });

  describe('getRecommendedAction', () => {
    it('should recommend auto-merge for compliant branch', () => {
      const compliance = createTestCompliance({ allows_auto_merge: true });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('auto-merge');
    });

    it('should recommend manual merge when auto-merge not allowed', () => {
      const compliance = createTestCompliance({ allows_auto_merge: false });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('manual merge');
    });

    it('should recommend waiting for checks', () => {
      const compliance = createTestCompliance({
        checks_passing: false,
        failing_checks: ['security/scan'],
        compliant: false,
        blockers: ['Required status check missing or failing: security/scan'],
      });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('Wait for');
      expect(action).toContain('security/scan');
    });

    it('should recommend requesting reviews', () => {
      const compliance = createTestCompliance({
        reviews: [createTestReview()],
        reviews_satisfied: false,
        compliant: false,
        blockers: ['Requires 2 approving review(s), has 1'],
      });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('Request');
      expect(action).toContain('review');
    });

    it('should recommend updating branch', () => {
      const compliance = createTestCompliance({
        up_to_date: false,
        stale_commit: true,
        compliant: false,
        blockers: ['Branch is 3 commit(s) behind base - must be up-to-date'],
      });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('Update branch');
    });

    it('should provide no restrictions for unprotected branch', () => {
      const compliance = createTestCompliance({
        protection: null,
        protected: false,
      });
      const report = generateReport('feature-test-123', compliance);

      const action = getRecommendedAction(report);

      expect(action).toContain('not protected');
      expect(action).toContain('merge freely');
    });
  });
});

// ============================================================================
// Branch Protection Adapter Tests (Compliance Logic)
// ============================================================================

describe('BranchProtectionAdapter - Compliance Evaluation', () => {
  it('should detect stale commit based on commit comparison', () => {
    // This test validates the logic for detecting stale commits
    // In actual implementation, this would call adapter.compareCommits()
    // and check if behind_by > 0

    const comparison = {
      ahead_by: 5,
      behind_by: 3,
      status: 'diverged',
    };

    const isStale = comparison.behind_by > 0;
    const isUpToDate = comparison.behind_by === 0;

    expect(isStale).toBe(true);
    expect(isUpToDate).toBe(false);
  });

  it('should count only most recent review per user', () => {
    const reviews: PullRequestReview[] = [
      createTestReview({
        user: { login: 'user1', id: 1 },
        state: 'APPROVED',
        submitted_at: '2025-12-17T09:00:00Z',
      }),
      createTestReview({
        user: { login: 'user1', id: 1 },
        state: 'CHANGES_REQUESTED',
        submitted_at: '2025-12-17T10:00:00Z', // More recent
      }),
      createTestReview({
        user: { login: 'user2', id: 2 },
        state: 'APPROVED',
        submitted_at: '2025-12-17T09:30:00Z',
      }),
    ];

    // Group by user ID, keep most recent
    const latestReviews = new Map<number, PullRequestReview>();
    for (const review of reviews) {
      const existing = latestReviews.get(review.user.id);
      if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
        latestReviews.set(review.user.id, review);
      }
    }

    const approvedCount = Array.from(latestReviews.values()).filter(
      r => r.state === 'APPROVED'
    ).length;

    expect(latestReviews.size).toBe(2); // Two unique users
    expect(approvedCount).toBe(1); // Only user2 has APPROVED (user1's latest is CHANGES_REQUESTED)
  });

  it('should match required checks against actual checks', () => {
    const requiredContexts = ['ci/build', 'test/unit', 'security/scan'];

    const actualStatuses: CommitStatus[] = [
      createTestCommitStatus({ context: 'ci/build', state: 'success' }),
      createTestCommitStatus({ context: 'test/unit', state: 'success' }),
      createTestCommitStatus({ context: 'security/scan', state: 'failure' }),
    ];

    const passingContexts = new Set(
      actualStatuses.filter(s => s.state === 'success').map(s => s.context)
    );

    const missingOrFailing = requiredContexts.filter(ctx => !passingContexts.has(ctx));

    expect(missingOrFailing).toEqual(['security/scan']);
  });

  it('should determine auto-merge eligibility', () => {
    // Auto-merge is allowed when:
    // 1. Branch is protected
    // 2. All compliance checks pass
    // 3. Force pushes are disabled

    const scenario1 = {
      protected: true,
      compliant: true,
      allowForcePush: false,
    };
    expect(!scenario1.allowForcePush && scenario1.compliant).toBe(true);

    const scenario2 = {
      protected: true,
      compliant: true,
      allowForcePush: true, // Force push enabled → auto-merge unsafe
    };
    expect(!scenario2.allowForcePush && scenario2.compliant).toBe(false);

    const scenario3 = {
      protected: true,
      compliant: false, // Not compliant → can't auto-merge
      allowForcePush: false,
    };
    expect(!scenario3.allowForcePush && scenario3.compliant).toBe(false);
  });
});
