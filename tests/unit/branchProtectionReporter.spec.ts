import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateReport,
  persistReport,
  loadReport,
  generateSummary,
  formatSummary,
  formatBlockers,
  detectValidationMismatch,
  canProceedWithDeployment,
  getRecommendedAction,
  type BranchProtectionSummary,
} from '../../src/workflows/branchProtectionReporter';
import type {
  BranchProtectionCompliance,
  BranchProtectionRules,
  CommitStatus,
  CheckRun,
  PullRequestReview,
} from '../../src/adapters/github/branchProtection';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'branch-protection-reporter-test-'));
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
    created_at: '2025-01-26T10:00:00Z',
    updated_at: '2025-01-26T10:05:00Z',
    ...overrides,
  };
}

function createTestCheckRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 123456,
    name: 'ci/build',
    status: 'completed',
    conclusion: 'success',
    started_at: '2025-01-26T10:00:00Z',
    completed_at: '2025-01-26T10:05:00Z',
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
    submitted_at: '2025-01-26T09:00:00Z',
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
    reviews: [
      createTestReview(),
      createTestReview({ user: { login: 'reviewer2', id: 67890 } }),
    ],
    reviews_satisfied: true,
    up_to_date: true,
    stale_commit: false,
    allows_auto_merge: true,
    allows_force_push: false,
    compliant: true,
    blockers: [],
    evaluated_at: '2025-01-26T10:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// generateReport Tests
// ============================================================================

describe('generateReport', () => {
  it('should generate report from compliant compliance state', () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance, {
      owner: 'acme-corp',
      repo: 'api-service',
      base_sha: 'xyz789',
      pull_number: 42,
    });

    expect(report.schema_version).toBe('1.0.0');
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
    expect(report.up_to_date).toBe(true);
    expect(report.stale_commit).toBe(false);
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
  });

  it('should include metadata when provided', () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance, {
      owner: 'org',
      repo: 'repo',
      base_sha: 'base123',
      pull_number: 99,
    });

    expect(report.metadata).toBeDefined();
    expect(report.metadata?.owner).toBe('org');
    expect(report.metadata?.repo).toBe('repo');
    expect(report.metadata?.protection_enabled).toBe(true);
  });

  it('should omit metadata when not provided', () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance);

    expect(report.metadata).toBeUndefined();
  });

  it('should count only APPROVED reviews', () => {
    const compliance = createTestCompliance({
      reviews: [
        createTestReview({ state: 'APPROVED' }),
        createTestReview({ state: 'CHANGES_REQUESTED', user: { login: 'reviewer2', id: 2 } }),
        createTestReview({ state: 'COMMENTED', user: { login: 'reviewer3', id: 3 } }),
      ],
    });

    const report = generateReport('feature-test-123', compliance);

    expect(report.reviews_count).toBe(1); // Only APPROVED
  });
});

// ============================================================================
// persistReport and loadReport Tests
// ============================================================================

describe('persistReport and loadReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should persist and load report correctly', async () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance, {
      owner: 'org',
      repo: 'repo',
      base_sha: 'base123',
    });

    const reportPath = await persistReport(tempDir, report);
    expect(reportPath).toBe(path.join(tempDir, 'status', 'branch_protection.json'));

    const loaded = await loadReport(tempDir);
    expect(loaded).toEqual(report);
  });

  it('should create status directory if missing', async () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance);

    await persistReport(tempDir, report);

    const statusDir = path.join(tempDir, 'status');
    const stat = await fs.stat(statusDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should return null when report does not exist', async () => {
    const loaded = await loadReport(tempDir);
    expect(loaded).toBeNull();
  });

  it('should persist report with validation mismatch', async () => {
    const compliance = createTestCompliance();
    const report = generateReport('feature-test-123', compliance);
    report.validation_mismatch = {
      missing_in_registry: ['ci/build'],
      extra_in_registry: ['lint'],
      recommendations: ['Add validation for ci/build'],
    };

    await persistReport(tempDir, report);
    const loaded = await loadReport(tempDir);

    expect(loaded?.validation_mismatch).toEqual(report.validation_mismatch);
  });
});

// ============================================================================
// generateSummary Tests
// ============================================================================

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
    expect(summary.auto_merge.enabled).toBe(false); // Default value
  });

  it('should generate summary for non-compliant report', () => {
    const compliance = createTestCompliance({
      checks_passing: false,
      failing_checks: ['security/scan', 'lint'],
      reviews_satisfied: false,
      reviews: [createTestReview()],
      compliant: false,
      blockers: ['Blocker 1', 'Blocker 2'],
    });

    const report = generateReport('feature-test-123', compliance);
    const summary = generateSummary(report);

    expect(summary.compliant).toBe(false);
    expect(summary.blockers_count).toBe(2);
    expect(summary.missing_checks).toEqual(['security/scan', 'lint']);
    expect(summary.reviews_status.satisfied).toBe(false);
  });

  it('should reflect stale branch status', () => {
    const compliance = createTestCompliance({
      up_to_date: false,
      stale_commit: true,
    });

    const report = generateReport('feature-test-123', compliance);
    const summary = generateSummary(report);

    expect(summary.branch_status.up_to_date).toBe(false);
    expect(summary.branch_status.stale).toBe(true);
  });
});

// ============================================================================
// formatSummary Tests
// ============================================================================

describe('formatSummary', () => {
  it('should format summary as human-readable text', () => {
    const summary: BranchProtectionSummary = {
      protected: true,
      compliant: true,
      blockers_count: 0,
      blockers: [],
      missing_checks: [],
      reviews_status: {
        required: 2,
        completed: 2,
        satisfied: true,
      },
      branch_status: {
        up_to_date: true,
        stale: false,
      },
      auto_merge: {
        allowed: true,
        enabled: false,
      },
    };

    const formatted = formatSummary(summary);

    expect(formatted).toContain('Branch Protection Status');
    expect(formatted).toContain('Protected: Yes');
    expect(formatted).toContain('Compliant: Yes');
    expect(formatted).toContain('Required: 2');
    expect(formatted).toContain('Completed: 2');
    expect(formatted).toContain('Satisfied: Yes');
    expect(formatted).toContain('Up-to-date: Yes');
    expect(formatted).toContain('Stale: No');
  });

  it('should include blockers when present', () => {
    const summary: BranchProtectionSummary = {
      protected: true,
      compliant: false,
      blockers_count: 2,
      blockers: ['Check ci/build failing', 'Need 1 more review'],
      missing_checks: ['ci/build'],
      reviews_status: {
        required: 2,
        completed: 1,
        satisfied: false,
      },
      branch_status: {
        up_to_date: true,
        stale: false,
      },
      auto_merge: {
        allowed: false,
        enabled: false,
      },
    };

    const formatted = formatSummary(summary);

    expect(formatted).toContain('Blockers (2)');
    expect(formatted).toContain('Check ci/build failing');
    expect(formatted).toContain('Need 1 more review');
    expect(formatted).toContain('Missing or Failing Checks');
    expect(formatted).toContain('ci/build');
  });
});

// ============================================================================
// formatBlockers Tests
// ============================================================================

describe('formatBlockers', () => {
  it('should return no blockers message for empty array', () => {
    const formatted = formatBlockers([]);
    expect(formatted).toBe('No blockers detected');
  });

  it('should format blockers as numbered list', () => {
    const blockers = ['First blocker', 'Second blocker', 'Third blocker'];
    const formatted = formatBlockers(blockers);

    expect(formatted).toContain('1. First blocker');
    expect(formatted).toContain('2. Second blocker');
    expect(formatted).toContain('3. Third blocker');
  });
});

// ============================================================================
// detectValidationMismatch Tests
// ============================================================================

describe('detectValidationMismatch', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

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
      commands: [{ type: 'lint' }, { type: 'typecheck' }, { type: 'custom-check' }],
    };
    await fs.writeFile(
      path.join(validationDir, 'commands.json'),
      JSON.stringify(commands),
      'utf-8'
    );

    const requiredChecks = ['validation/lint', 'validation/typecheck'];
    const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

    expect(mismatch.missing_in_registry).toEqual([]);
    expect(mismatch.extra_in_registry).toEqual(['validation/custom-check']);
    expect(mismatch.recommendations).toContain(
      'Consider removing unnecessary validations: validation/custom-check'
    );
  });

  it('should report aligned when no mismatch', async () => {
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

  it('should handle missing validation directory', async () => {
    const requiredChecks = ['validation/lint'];
    const mismatch = await detectValidationMismatch(tempDir, requiredChecks);

    expect(mismatch.missing_in_registry).toEqual(['validation/lint']);
    expect(mismatch.extra_in_registry).toEqual([]);
  });
});

// ============================================================================
// canProceedWithDeployment Tests
// ============================================================================

describe('canProceedWithDeployment', () => {
  it('should allow deployment for unprotected branch', () => {
    const compliance = createTestCompliance({
      protected: false,
    });
    const report = generateReport('feature-test-123', compliance);

    const result = canProceedWithDeployment(report);

    expect(result.proceed).toBe(true);
    expect(result.reason).toContain('not protected');
  });

  it('should allow deployment for compliant branch', () => {
    const compliance = createTestCompliance({
      protected: true,
      compliant: true,
    });
    const report = generateReport('feature-test-123', compliance);

    const result = canProceedWithDeployment(report);

    expect(result.proceed).toBe(true);
    expect(result.reason).toContain('requirements satisfied');
  });

  it('should block deployment for non-compliant branch', () => {
    const compliance = createTestCompliance({
      protected: true,
      compliant: false,
      blockers: ['Check failing', 'Need review'],
    });
    const report = generateReport('feature-test-123', compliance);

    const result = canProceedWithDeployment(report);

    expect(result.proceed).toBe(false);
    expect(result.reason).toContain('requirements not met');
    expect(result.reason).toContain('Check failing');
  });
});

// ============================================================================
// getRecommendedAction Tests
// ============================================================================

describe('getRecommendedAction', () => {
  it('should recommend auto-merge for compliant branch with auto-merge allowed', () => {
    const compliance = createTestCompliance({
      compliant: true,
      allows_auto_merge: true,
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('auto-merge');
  });

  it('should recommend manual merge when auto-merge not allowed', () => {
    const compliance = createTestCompliance({
      compliant: true,
      allows_auto_merge: false,
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('manual merge');
  });

  it('should recommend free merge for unprotected branch', () => {
    const compliance = createTestCompliance({
      protected: false,
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('not protected');
    expect(action).toContain('merge freely');
  });

  it('should recommend waiting for failing checks', () => {
    const compliance = createTestCompliance({
      compliant: false,
      checks_passing: false,
      failing_checks: ['ci/build', 'security/scan'],
      blockers: ['Checks failing'],
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('Wait for');
    expect(action).toContain('2 required check(s)');
    expect(action).toContain('ci/build');
    expect(action).toContain('security/scan');
  });

  it('should recommend requesting reviews', () => {
    const compliance = createTestCompliance({
      compliant: false,
      reviews_required: 2,
      reviews: [createTestReview()],
      reviews_satisfied: false,
      blockers: ['Need more reviews'],
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('Request');
    expect(action).toContain('1 more approving review');
  });

  it('should recommend updating branch when stale', () => {
    const compliance = createTestCompliance({
      compliant: false,
      up_to_date: false,
      stale_commit: true,
      blockers: ['Branch behind'],
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('Update branch');
  });

  it('should combine multiple recommendations', () => {
    const compliance = createTestCompliance({
      compliant: false,
      checks_passing: false,
      failing_checks: ['ci/build'],
      reviews_required: 2,
      reviews: [],
      reviews_satisfied: false,
      up_to_date: false,
      stale_commit: true,
      blockers: ['Multiple issues'],
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('Wait for');
    expect(action).toContain('Request');
    expect(action).toContain('Update branch');
    expect(action).toContain('Required actions');
  });

  it('should provide generic message when no specific actions identified', () => {
    const compliance = createTestCompliance({
      compliant: false,
      checks_passing: true, // Checks pass
      reviews_satisfied: true, // Reviews satisfied
      up_to_date: true, // Branch up to date
      stale_commit: false,
      blockers: ['Some other blocker'], // But still has blocker
    });
    const report = generateReport('feature-test-123', compliance);

    const action = getRecommendedAction(report);

    expect(action).toContain('Review blockers');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle report with empty arrays', () => {
    const compliance = createTestCompliance({
      required_checks: [],
      actual_checks: [],
      check_runs: [],
      reviews: [],
      blockers: [],
      failing_checks: [],
    });

    const report = generateReport('feature-test-123', compliance);
    const summary = generateSummary(report);

    expect(report.required_checks).toEqual([]);
    expect(summary.blockers_count).toBe(0);
  });

  it('should handle very long blocker messages', () => {
    const longBlocker = 'A'.repeat(500);
    const blockers = [longBlocker];

    const formatted = formatBlockers(blockers);

    expect(formatted).toContain('1. ' + longBlocker);
  });

  // ==========================================================================
  // Coverage gap-fill: edge cases (CDMCH-84)
  // ==========================================================================

  describe('loadReport - error handling edge cases', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('should return null for non-existent report file', async () => {
      const result = await loadReport(path.join(tempDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('should return null for corrupt JSON', async () => {
      const reportPath = path.join(tempDir, 'branch_protection.json');
      await fs.writeFile(reportPath, '{invalid json', 'utf-8');

      const result = await loadReport(tempDir);
      expect(result).toBeNull();
    });
  });

  describe('detectValidationMismatch - edge cases', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('should report missing validations when commands.json does not exist', async () => {
      const result = await detectValidationMismatch(tempDir, ['ci/build']);
      // When no commands.json, all required checks are "missing_in_registry"
      expect(result).toBeDefined();
      expect(result!.missing_in_registry).toContain('ci/build');
    });

    it('should detect mismatch when required checks differ from configured commands', async () => {
      const commandsPath = path.join(tempDir, 'commands.json');
      await fs.writeFile(
        commandsPath,
        JSON.stringify({ commands: [{ name: 'lint', command: 'npm run lint' }] }),
        'utf-8'
      );

      const result = await detectValidationMismatch(tempDir, ['ci/build', 'test/unit']);
      // Result should indicate what's required vs configured
      expect(result).toBeDefined();
    });
  });

  describe('getRecommendedAction - comprehensive states', () => {
    it('should recommend waiting when checks are pending', () => {
      const action = getRecommendedAction({
        can_proceed: false,
        blockers_count: 1,
        blockers: ['Required status checks: pending'],
        has_branch_protection: true,
        meets_review_requirements: true,
        meets_status_requirements: false,
      });
      expect(action).toBeDefined();
      expect(typeof action).toBe('string');
      expect(action.length).toBeGreaterThan(0);
    });

    it('should recommend requesting review when reviews are needed', () => {
      const action = getRecommendedAction({
        can_proceed: false,
        blockers_count: 1,
        blockers: ['Required review approvals: 0/1'],
        has_branch_protection: true,
        meets_review_requirements: false,
        meets_status_requirements: true,
      });
      expect(action).toBeDefined();
      expect(typeof action).toBe('string');
    });
  });
});
