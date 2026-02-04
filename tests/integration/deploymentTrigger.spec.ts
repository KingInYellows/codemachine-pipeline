/**
 * Integration tests for Deployment Trigger Module
 *
 * Tests cover:
 * - Happy path auto-merge
 * - Manual merge execution
 * - Workflow dispatch
 * - Blocker detection (failing checks, missing reviews, stale branch)
 * - Rate limit handling
 * - Resume scenarios
 * - Configuration edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  triggerDeployment,
  loadDeploymentContext,
  assessMergeReadiness,
  selectDeploymentStrategy,
  DeploymentStrategy,
  type DeploymentContext,
  type DeploymentHistory,
  type MergeReadiness,
} from '../../src/workflows/deploymentTrigger';
import type { GitHubAdapter, PullRequest, MergeResult } from '../../src/adapters/github/GitHubAdapter';
import type { BranchProtectionReport } from '../../src/workflows/branchProtectionReporter';
import type { PRMetadata } from '../../src/cli/pr/shared';
import type { RepoConfig } from '../../src/core/config/RepoConfig';
import type { LoggerInterface } from '../../src/adapters/http/client';
import type { RunManifest } from '../../src/persistence/runDirectoryManager';

type RepoConfigWithDeployment = RepoConfig & {
  deployment?: {
    workflow_dispatch?: {
      workflow_id: string;
      inputs?: Record<string, string>;
    };
  };
};

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockLogger = (): LoggerInterface & Record<'debug' | 'info' | 'warn' | 'error', Mock> => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}) as LoggerInterface & Record<'debug' | 'info' | 'warn' | 'error', Mock>;

const createMockPRMetadata = (overrides?: Partial<PRMetadata>): PRMetadata => ({
  pr_number: 42,
  url: 'https://github.com/acme/api/pull/42',
  branch: 'feature-auth-123',
  base_branch: 'main',
  head_sha: 'abc123def456',
  base_sha: 'xyz789abc123',
  state: 'open',
  mergeable: true,
  created_at: '2025-12-18T10:00:00Z',
  reviewers_requested: ['reviewer1', 'reviewer2'],
  auto_merge_enabled: false,
  status_checks: [],
  merge_ready: false,
  last_updated: '2025-12-18T10:30:00Z',
  ...overrides,
});

const createMockBranchProtectionReport = (
  overrides?: Partial<BranchProtectionReport>
): BranchProtectionReport => ({
  schema_version: '1.0.0',
  feature_id: 'feature-auth-123',
  branch: 'feature-auth-123',
  sha: 'abc123def456',
  base_sha: 'xyz789abc123',
  pull_number: 42,
  protected: true,
  compliant: true,
  required_checks: ['ci/build', 'test/unit', 'security/scan'],
  checks_passing: true,
  failing_checks: [],
  reviews_required: 2,
  reviews_count: 2,
  reviews_satisfied: true,
  up_to_date: true,
  stale_commit: false,
  allows_auto_merge: true,
  allows_force_push: false,
  blockers: [],
  evaluated_at: '2025-12-18T10:30:00Z',
  ...overrides,
});

const createMockRepoConfig = (overrides?: Partial<RepoConfig>): RepoConfig => ({
  schema_version: '1.0.0',
  project: {
    id: 'test-project',
    repo_url: 'https://github.com/acme/api',
    default_branch: 'main',
    context_paths: ['src/'],
    project_leads: [],
  },
  github: {
    enabled: true,
    token_env_var: 'GITHUB_TOKEN',
    api_base_url: 'https://api.github.com',
    required_scopes: ['repo', 'workflow'],
    default_reviewers: [],
    branch_protection: {
      respect_required_reviews: true,
      respect_status_checks: true,
    },
  },
  linear: {
    enabled: false,
    api_key_env_var: 'LINEAR_API_KEY',
    auto_link_issues: true,
  },
  runtime: {
    agent_endpoint_env_var: 'AGENT_ENDPOINT',
    max_concurrent_tasks: 3,
    timeout_minutes: 30,
    context_token_budget: 32000,
    context_cost_budget_usd: 5,
    logs_format: 'ndjson',
    run_directory: '.codepipe/runs',
  },
  safety: {
    redact_secrets: true,
    require_approval_for_prd: true,
    require_approval_for_plan: true,
    require_approval_for_pr: true,
    prevent_force_push: true,
    allowed_file_patterns: ['**/*.ts', '**/*.js'],
    blocked_file_patterns: ['.env'],
  },
  feature_flags: {
    enable_auto_merge: true,
    enable_deployment_triggers: true,
    enable_linear_sync: false,
    enable_context_summarization: true,
    enable_resumability: true,
    enable_developer_preview: false,
  },
  governance: {
    approval_workflow: {
      require_approval_for_prd: true,
      require_approval_for_spec: true,
      require_approval_for_plan: true,
      require_approval_for_code: true,
      require_approval_for_pr: true,
      require_approval_for_deploy: true,
    },
    accountability: {
      record_approver_identity: true,
      require_approval_reason: false,
      audit_log_retention_days: 365,
    },
    risk_controls: {
      prevent_auto_merge: false, // Allow auto-merge for testing
      prevent_force_push: true,
      require_branch_protection: true,
      max_files_per_pr: 100,
      max_lines_changed_per_pr: 5000,
    },
    compliance_tags: [],
  },
  validation: {
    commands: [
      {
        type: 'lint',
        description: 'Run linter',
        command: 'npm run lint',
        timeout_ms: 300000,
        max_retries: 0,
        cwd: '.',
      },
    ],
  },
  constraints: {
    max_file_size_kb: 1000,
    max_context_files: 100,
  },
  ...overrides,
});

const createMockGitHubAdapter = (): GitHubAdapter & Record<
  'getPullRequest' | 'mergePullRequest' | 'enableAutoMerge' | 'triggerWorkflow' | 'getStatusChecks',
  Mock
> => {
  return {
    getPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
    enableAutoMerge: vi.fn(),
    triggerWorkflow: vi.fn(),
    getStatusChecks: vi.fn(),
  } as unknown as GitHubAdapter & Record<
    'getPullRequest' | 'mergePullRequest' | 'enableAutoMerge' | 'triggerWorkflow' | 'getStatusChecks',
    Mock
  >;
};

const createMockManifest = (overrides?: Partial<RunManifest>): RunManifest => {
  const baseTimestamp = '2025-12-18T10:00:00Z';

  return {
    schema_version: overrides?.schema_version ?? '1.0.0',
    feature_id: overrides?.feature_id ?? 'feature-auth-123',
    repo: overrides?.repo ?? {
      url: 'https://github.com/acme/api',
      default_branch: 'main',
    },
    status: overrides?.status ?? 'pending',
    execution: {
      completed_steps: overrides?.execution?.completed_steps ?? 0,
      last_step: overrides?.execution?.last_step,
      last_error: overrides?.execution?.last_error,
      current_step: overrides?.execution?.current_step,
      total_steps: overrides?.execution?.total_steps,
    },
    timestamps: {
      created_at: overrides?.timestamps?.created_at ?? baseTimestamp,
      updated_at: overrides?.timestamps?.updated_at ?? baseTimestamp,
      started_at: overrides?.timestamps?.started_at,
      completed_at: overrides?.timestamps?.completed_at,
    },
    approvals: {
      approvals_file: overrides?.approvals?.approvals_file ?? 'approvals/approvals.json',
      pending: overrides?.approvals?.pending ?? [],
      completed: overrides?.approvals?.completed ?? [],
    },
    queue: {
      queue_dir: overrides?.queue?.queue_dir ?? 'queue',
      pending_count: overrides?.queue?.pending_count ?? 0,
      completed_count: overrides?.queue?.completed_count ?? 0,
      failed_count: overrides?.queue?.failed_count ?? 0,
      sqlite_index: overrides?.queue?.sqlite_index,
    },
    artifacts: overrides?.artifacts ?? {},
    telemetry: {
      logs_dir: overrides?.telemetry?.logs_dir ?? 'logs',
      metrics_file: overrides?.telemetry?.metrics_file,
      traces_file: overrides?.telemetry?.traces_file,
      costs_file: overrides?.telemetry?.costs_file,
    },
    rate_limits: overrides?.rate_limits,
    metadata: overrides?.metadata,
  };
};

async function seedManifest(runDir: string, overrides?: Partial<RunManifest>): Promise<void> {
  const manifest = createMockManifest(overrides);
  await fs.writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function seedApprovalsFile(runDir: string, approvals: unknown[] = []): Promise<void> {
  const approvalsDir = path.join(runDir, 'approvals');
  await fs.mkdir(approvalsDir, { recursive: true });
  const payload = {
    schema_version: '1.0.0',
    feature_id: 'feature-auth-123',
    approvals,
  };
  await fs.writeFile(path.join(approvalsDir, 'approvals.json'), JSON.stringify(payload, null, 2));
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Deployment Trigger Module', () => {
  let tmpDir: string;
  let runDirectory: string;
  let mockLogger: LoggerInterface;
  let mockConfig: RepoConfig;
  let mockGitHubAdapter: GitHubAdapter;

  beforeEach(async () => {
    // Create temporary test directory
    tmpDir = path.join(process.cwd(), 'tmp', 'test-deployment-trigger');
    runDirectory = path.join(tmpDir, 'runs', 'feature-auth-123');

    await fs.mkdir(runDirectory, { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'status'), { recursive: true });
    await seedManifest(runDirectory, {
      approvals: {
        approvals_file: 'approvals/approvals.json',
        pending: [],
        completed: ['deploy'],
      },
    });
    await seedApprovalsFile(runDirectory);

    mockLogger = createMockLogger();
    mockConfig = createMockRepoConfig();
    mockGitHubAdapter = createMockGitHubAdapter();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Data Loading Tests
  // ==========================================================================

  describe('loadDeploymentContext', () => {
    it('should load deployment context with pr.json and branch protection', async () => {
      // Setup: Create pr.json
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      // Setup: Create branch_protection.json
      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      // Execute
      const context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      // Assert
      expect(context.pr.pr_number).toBe(42);
      expect(context.branchProtection?.compliant).toBe(true);
      expect(context.config.enable_auto_merge).toBe(true);
      expect(context.featureId).toBe('feature-auth-123');
      expect(context.approvals.deployApprovalGranted).toBe(true);
      expect(context.approvals.pending).toEqual([]);
    });

    it('should handle missing branch_protection.json gracefully', async () => {
      // Setup: Create only pr.json
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      // Execute
      const context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      // Assert
      expect(context.pr.pr_number).toBe(42);
      expect(context.branchProtection).toBeNull();
    });

    it('should throw error when pr.json is missing', async () => {
      // Execute & Assert
      await expect(
        loadDeploymentContext(runDirectory, 'feature-auth-123', mockConfig, mockLogger)
      ).rejects.toThrow('PR metadata not found');
    });
  });

  // ==========================================================================
  // Readiness Assessment Tests
  // ==========================================================================

  describe('assessMergeReadiness', () => {
    let context: DeploymentContext;

    beforeEach(async () => {
      // Setup base context
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );
    });

    it('should assess as eligible when all requirements met', async () => {
      // Setup: Mock fresh PR data
      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(true);
      expect(readiness.blockers).toHaveLength(0);
      expect(readiness.context.pr_state).toBe('open');
      expect(readiness.context.checks_passing).toBe(true);
      expect(readiness.context.reviews_satisfied).toBe(true);
    });

    it('should detect failing status checks blocker', async () => {
      // Setup: Branch protection with failing checks
      const branchProtection = createMockBranchProtectionReport({
        checks_passing: false,
        failing_checks: ['ci/build', 'security/scan'],
        compliant: false,
        blockers: ['2 required status checks failing'],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'blocked',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('status_checks');
      expect(blocker.message).toContain('2 required status check(s) failing');
      expect(blocker.recommended_action).toContain('ci/build, security/scan');
    });

    it('should detect insufficient reviews blocker', async () => {
      // Setup: Branch protection with missing reviews
      const branchProtection = createMockBranchProtectionReport({
        reviews_required: 2,
        reviews_count: 0,
        reviews_satisfied: false,
        compliant: false,
        blockers: ['Insufficient approving reviews (0/2)'],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'blocked',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('reviews');
      expect(blocker.message).toContain('(0/2)');
      expect(blocker.recommended_action).toContain('2 more approving review');
    });

    it('should detect stale branch blocker', async () => {
      // Setup: Branch protection with stale branch
      const branchProtection = createMockBranchProtectionReport({
        up_to_date: false,
        stale_commit: true,
        compliant: false,
        blockers: ['Branch is not up-to-date with base branch'],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'behind',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('branch_stale');
      expect(blocker.message).toContain('not up-to-date');
      expect(blocker.recommended_action).toContain('merging or rebasing');
    });

    it('should detect pending deployment approval blocker', async () => {
      // Seed manifest with pending deploy approval
      await seedManifest(runDirectory, {
        approvals: {
          approvals_file: 'approvals/approvals.json',
          pending: ['deploy'],
          completed: [],
        },
      });

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('approvals');
      expect(blocker.message).toContain('deploy');
      expect(blocker.recommended_action).toContain('approve');
      expect(readiness.context.pending_approvals).toContain('deploy');
      expect(readiness.context.deploy_approval_granted).toBe(false);
    });

    it('should detect merge conflicts blocker', async () => {
      // Setup: PR with merge conflicts
      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: false, // Conflicts!
        mergeable_state: 'dirty',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('conflicts');
      expect(blocker.message).toContain('merge conflicts');
      expect(blocker.recommended_action).toContain('Resolve merge conflicts');
    });

    it('should detect draft PR blocker', async () => {
      // Setup: Draft PR
      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: true, // Draft!
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('draft');
      expect(blocker.message).toContain('draft mode');
      expect(blocker.recommended_action).toContain('ready for review');
    });

    it('should detect closed PR blocker', async () => {
      // Setup: Closed PR
      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'closed', // Closed!
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const readiness = await assessMergeReadiness(context, mockGitHubAdapter);

      // Assert
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockers).toHaveLength(1);
      const blocker = readiness.blockers[0];
      expect(blocker.type).toBe('closed');
      expect(blocker.message).toContain('closed');
      expect(blocker.recommended_action).toContain('Reopen');
    });
  });

  // ==========================================================================
  // Strategy Selection Tests
  // ==========================================================================

  describe('selectDeploymentStrategy', () => {
    let context: DeploymentContext;
    let readiness: MergeReadiness;

    beforeEach(async () => {
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      readiness = {
        eligible: true,
        blockers: [],
        context: {
          pr_state: 'open',
          mergeable: true,
          mergeable_state: 'clean',
          checks_passing: true,
          reviews_satisfied: true,
          branch_up_to_date: true,
          pending_approvals: [],
          deploy_approval_required: true,
          deploy_approval_granted: true,
        },
      };
    });

    it('should select BLOCKED when not eligible', () => {
      readiness.eligible = false;
      readiness.blockers = [
        {
          type: 'status_checks',
          message: 'Checks failing',
          recommended_action: 'Wait for checks',
        },
      ];

      const strategy = selectDeploymentStrategy(context, readiness);

      expect(strategy).toBe(DeploymentStrategy.BLOCKED);
    });

    it('should select AUTO_MERGE when all conditions met', () => {
      const strategy = selectDeploymentStrategy(context, readiness);

      expect(strategy).toBe(DeploymentStrategy.AUTO_MERGE);
    });

    it('should select MANUAL_MERGE when auto-merge disabled by governance', async () => {
      const baseGovernance = mockConfig.governance;
      if (!baseGovernance) {
        throw new Error('Mock config missing governance configuration');
      }

      // Update config to prevent auto-merge
      const configWithoutAutoMerge = createMockRepoConfig({
        governance: {
          ...baseGovernance,
          risk_controls: {
            ...baseGovernance.risk_controls,
            prevent_auto_merge: true, // Prevent auto-merge
          },
        },
      });

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        configWithoutAutoMerge,
        mockLogger
      );

      const strategy = selectDeploymentStrategy(context, readiness);

      expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
    });

    it('should select MANUAL_MERGE when auto-merge feature flag disabled', async () => {
      const configWithoutAutoMerge = createMockRepoConfig({
        feature_flags: {
          ...mockConfig.feature_flags,
          enable_auto_merge: false,
        },
      });

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        configWithoutAutoMerge,
        mockLogger
      );

      const strategy = selectDeploymentStrategy(context, readiness);

      expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
    });

    it('should select MANUAL_MERGE when branch protection disallows auto-merge', async () => {
      // Update branch protection to disallow auto-merge
      const branchProtection = createMockBranchProtectionReport({
        allows_auto_merge: false,
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      context = await loadDeploymentContext(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockLogger
      );

      const strategy = selectDeploymentStrategy(context, readiness);

      expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
    });

    it('should select WORKFLOW_DISPATCH when workflow inputs provided', () => {
      const strategy = selectDeploymentStrategy(context, readiness, {
        workflow_inputs: { environment: 'production' },
      });

      expect(strategy).toBe(DeploymentStrategy.WORKFLOW_DISPATCH);
    });
  });

  // ==========================================================================
  // End-to-End Deployment Tests
  // ==========================================================================

  describe('triggerDeployment - Auto-Merge', () => {
    it('should successfully trigger auto-merge deployment', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      (mockGitHubAdapter.enableAutoMerge as Mock).mockResolvedValue(undefined);

      // Execute
      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      // Assert
      expect(outcome.success).toBe(true);
      expect(outcome.strategy).toBe(DeploymentStrategy.AUTO_MERGE);
      expect(outcome.action).toBe('auto-merge');
      const enableAutoMergeSpy = mockGitHubAdapter.enableAutoMerge as Mock;
      expect(enableAutoMergeSpy).toHaveBeenCalledWith(42, 'MERGE');

      // Verify deployment.json was persisted
      const deploymentPath = path.join(runDirectory, 'deployment.json');
      const deploymentContent = await fs.readFile(deploymentPath, 'utf-8');
      const parsedDeployment: unknown = JSON.parse(deploymentContent);
      const deployment = parsedDeployment as DeploymentHistory;
      expect(deployment.outcomes).toHaveLength(1);
      expect(deployment.outcomes[0].strategy).toBe('AUTO_MERGE');
    });
  });

  describe('triggerDeployment - Manual Merge', () => {
    it('should successfully trigger manual merge deployment', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport({
        allows_auto_merge: false, // Force manual merge
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      (mockGitHubAdapter.mergePullRequest as Mock).mockResolvedValue({
        merged: true,
        sha: 'merge123sha456',
        message: 'Merge successful',
      } as MergeResult);

      // Execute
      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      // Assert
      expect(outcome.success).toBe(true);
      expect(outcome.strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
      expect(outcome.action).toBe('merge');
      expect(outcome.merge_sha).toBe('merge123sha456');
      const mergePullRequestSpy = mockGitHubAdapter.mergePullRequest as Mock;
      expect(mergePullRequestSpy).toHaveBeenCalledWith({
        pull_number: 42,
        merge_method: 'merge',
        sha: 'abc123def456',
      });
    });
  });

  describe('triggerDeployment - Workflow Dispatch', () => {
    it('should successfully trigger workflow dispatch', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      (mockGitHubAdapter.triggerWorkflow as Mock).mockResolvedValue(undefined);

      // Add workflow config to context
      const configWithWorkflow = createMockRepoConfig() as RepoConfigWithDeployment;
      configWithWorkflow.deployment = {
        workflow_dispatch: {
          workflow_id: 'deploy.yml',
          inputs: { environment: 'production' },
        },
      };

      // Execute
      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        configWithWorkflow,
        mockGitHubAdapter,
        mockLogger,
        {
          workflow_inputs: { environment: 'production', notify: 'true' },
        }
      );

      // Assert
      expect(outcome.success).toBe(true);
      expect(outcome.strategy).toBe(DeploymentStrategy.WORKFLOW_DISPATCH);
      expect(outcome.action).toBe('workflow-dispatch');
    });
  });

  describe('triggerDeployment - Blocked', () => {
    it('should return blocked outcome when checks failing', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport({
        checks_passing: false,
        failing_checks: ['ci/build'],
        compliant: false,
        blockers: ['1 required status check failing'],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'blocked',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      // Assert
      expect(outcome.success).toBe(false);
      expect(outcome.strategy).toBe(DeploymentStrategy.BLOCKED);
      expect(outcome.action).toBe('none');
      expect(outcome.blockers).toHaveLength(1);
      expect(outcome.blockers[0].type).toBe('status_checks');
      expect(outcome.blockers[0].message).toContain('failing');
    });

    it('should block deployment when pending approvals exist', async () => {
      // Setup manifest with pending approvals
      await seedManifest(runDirectory, {
        approvals: {
          approvals_file: 'approvals/approvals.json',
          pending: ['deploy'],
          completed: [],
        },
      });

      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      expect(outcome.success).toBe(false);
      expect(outcome.strategy).toBe(DeploymentStrategy.BLOCKED);
      expect(outcome.blockers[0].type).toBe('approvals');
      expect(outcome.blockers[0].message).toContain('deploy');
    });
  });

  describe('triggerDeployment - Dry Run', () => {
    it('should assess readiness without executing in dry run mode', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      const branchProtection = createMockBranchProtectionReport();
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtection, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // Execute
      const outcome = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger,
        { dry_run: true }
      );

      // Assert
      expect(outcome.success).toBe(false); // No action taken
      expect(outcome.action).toBe('none');
      expect(outcome.strategy).toBe(DeploymentStrategy.AUTO_MERGE);
      const enableAutoMergeSpy = mockGitHubAdapter.enableAutoMerge as Mock;
      const mergePullRequestSpy = mockGitHubAdapter.mergePullRequest as Mock;
      expect(enableAutoMergeSpy).not.toHaveBeenCalled();
      expect(mergePullRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('triggerDeployment - Resume Scenario', () => {
    it('should support resume after blocked deployment', async () => {
      // Setup
      const prMetadata = createMockPRMetadata();
      await fs.writeFile(
        path.join(runDirectory, 'pr.json'),
        JSON.stringify(prMetadata, null, 2)
      );

      // Initial attempt: Blocked by failing checks
      const branchProtectionBlocked = createMockBranchProtectionReport({
        checks_passing: false,
        failing_checks: ['ci/build'],
        compliant: false,
        blockers: ['1 required status check failing'],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtectionBlocked, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'blocked',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      // First attempt - should be blocked
      const outcome1 = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      expect(outcome1.success).toBe(false);
      expect(outcome1.strategy).toBe(DeploymentStrategy.BLOCKED);

      // Simulate checks passing (operator fixed the issue)
      const branchProtectionPassing = createMockBranchProtectionReport({
        checks_passing: true,
        failing_checks: [],
        compliant: true,
        blockers: [],
      });
      await fs.writeFile(
        path.join(runDirectory, 'status', 'branch_protection.json'),
        JSON.stringify(branchProtectionPassing, null, 2)
      );

      (mockGitHubAdapter.getPullRequest as Mock).mockResolvedValue({
        number: 42,
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'feature-auth-123', sha: 'abc123def456' },
        base: { ref: 'main', sha: 'xyz789abc123' },
      } as PullRequest);

      (mockGitHubAdapter.enableAutoMerge as Mock).mockResolvedValue(undefined);

      // Second attempt - should succeed
      const outcome2 = await triggerDeployment(
        runDirectory,
        'feature-auth-123',
        mockConfig,
        mockGitHubAdapter,
        mockLogger
      );

      expect(outcome2.success).toBe(true);
      expect(outcome2.strategy).toBe(DeploymentStrategy.AUTO_MERGE);

      // Verify deployment history includes both attempts
      const deploymentPath = path.join(runDirectory, 'deployment.json');
      const deploymentContent = await fs.readFile(deploymentPath, 'utf-8');
      const parsedDeployment: unknown = JSON.parse(deploymentContent);
      const deployment = parsedDeployment as DeploymentHistory;
      expect(deployment.outcomes).toHaveLength(2);
      expect(deployment.outcomes[0].strategy).toBe('BLOCKED');
      expect(deployment.outcomes[1].strategy).toBe('AUTO_MERGE');
    });
  });
});
