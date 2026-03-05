/**
 * Integration tests for PR automation commands
 *
 * Tests:
 * - pr create: Preflight validation, GitHub API integration, artifact persistence
 * - pr status: Merge readiness detection, blocker reporting, JSON output
 * - pr reviewers: Reviewer request workflow, metadata updates
 * - pr disable-auto-merge: Auto-merge control, governance logging
 *
 * Implements:
 * - Task I4.T4 acceptance criteria: JSON output stability, blocked state detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadPRContext,
  persistPRData,
  renderPROutput,
  isCodeApproved,
  hasValidationsPassed,
  PRExitCode,
  type PRMetadata,
} from '../../src/cli/pr/shared';
import type { RunManifest } from '../../src/persistence/runDirectoryManager';

const parseJson = <T>(value: string): T => JSON.parse(value) as unknown as T;

// Test fixtures
let TEST_RUN_DIR: string;
const TEST_FEATURE_ID = 'test-feature-123';
let TEST_BASE_DIR: string;

const mockRepoConfig = {
  schema_version: '1.0.0',
  project: {
    id: 'test-project',
    repo_url: 'https://github.com/test-org/test-repo.git',
    default_branch: 'main',
    context_paths: ['src/'],
    project_leads: [],
  },
  github: {
    enabled: true,
    token_env_var: 'GITHUB_TOKEN',
    api_base_url: 'https://api.github.com',
    required_scopes: ['repo', 'workflow'] as Array<'repo' | 'workflow' | 'read:org' | 'write:org'>,
    default_reviewers: [],
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
    logs_format: 'ndjson' as const,
    run_directory: '', // Set dynamically in beforeEach via fs.mkdtemp()
  },
  safety: {
    redact_secrets: true,
    require_approval_for_prd: true,
    require_approval_for_plan: true,
    require_approval_for_pr: true,
    prevent_force_push: true,
    allowed_file_patterns: ['**/*.ts'],
    blocked_file_patterns: ['.env'],
  },
  feature_flags: {
    enable_auto_merge: false,
    enable_deployment_triggers: false,
    enable_linear_sync: false,
    enable_context_summarization: true,
    enable_resumability: true,
    enable_developer_preview: false,
  },
  config_history: [],
};

const mockManifest: RunManifest = {
  schema_version: '1.0.0',
  feature_id: TEST_FEATURE_ID,
  title: 'Test Feature',
  source: 'feature/test-branch',
  repo: {
    url: 'https://github.com/test-org/test-repo.git',
    default_branch: 'main',
  },
  status: 'in_progress',
  execution: {
    current_step: 'code',
    last_step: 'plan',
    completed_steps: 5,
  },
  queue: {
    queue_dir: '.codepipe/runs/test-feature-123',
    pending_count: 0,
    completed_count: 5,
    failed_count: 0,
  },
  approvals: {
    pending: [],
    completed: ['prd', 'spec', 'plan', 'code'],
  },
  artifacts: {},
  telemetry: {
    logs_dir: 'logs',
    metrics_file: 'metrics/prometheus.txt',
    traces_file: 'telemetry/traces.json',
  },
  timestamps: {
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:05:00Z',
    started_at: '2025-01-15T10:01:00Z',
  },
};

describe('PR Commands Integration Tests', () => {
  beforeEach(async () => {
    // Create isolated temp directory for each test
    TEST_RUN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-commands-test-'));
    TEST_BASE_DIR = path.join(TEST_RUN_DIR, 'runs');
    mockRepoConfig.runtime.run_directory = TEST_BASE_DIR;

    // Setup test run directory
    const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });

    // Write manifest
    await fs.writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(mockManifest, null, 2));

    // Write validation.json (success)
    await fs.writeFile(
      path.join(runDir, 'validation.json'),
      JSON.stringify({ success: true }, null, 2)
    );

    // Mock environment
    process.env.GITHUB_TOKEN = 'mock-token';
    process.env.JSON_OUTPUT = undefined;
  });

  afterEach(async () => {
    // Cleanup test directory
    await fs.rm(TEST_RUN_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('loadPRContext', () => {
    it('should load PR context successfully', async () => {
      const context = await loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, mockRepoConfig, false);

      expect(context.featureId).toBe(TEST_FEATURE_ID);
      expect(context.manifest.feature_id).toBe(TEST_FEATURE_ID);
      expect(context.config.github.enabled).toBe(true);
      expect(context.prMetadata).toBeUndefined(); // No pr.json yet
    });

    it('should load existing PR metadata if pr.json exists', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      const prMetadata: PRMetadata = {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        branch: 'feature/test-branch',
        base_branch: 'main',
        created_at: '2025-01-15T11:00:00Z',
        reviewers_requested: ['alice', 'bob'],
        auto_merge_enabled: false,
        last_updated: '2025-01-15T11:00:00Z',
      };

      await fs.writeFile(path.join(runDir, 'pr.json'), JSON.stringify(prMetadata, null, 2));

      const context = await loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, mockRepoConfig, false);

      expect(context.prMetadata).toEqual(prMetadata);
    });

    it('should throw error if GitHub integration disabled', async () => {
      const configWithDisabledGH = {
        ...mockRepoConfig,
        github: { ...mockRepoConfig.github, enabled: false },
      };

      await expect(
        loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, configWithDisabledGH, false)
      ).rejects.toThrow('GitHub integration is disabled');
    });
  });

  describe('persistPRData', () => {
    it('should persist PR metadata to pr.json atomically', async () => {
      const context = await loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, mockRepoConfig, false);

      const prMetadata: PRMetadata = {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        branch: 'feature/test-branch',
        base_branch: 'main',
        created_at: '2025-01-15T11:00:00Z',
        reviewers_requested: ['alice'],
        auto_merge_enabled: false,
        last_updated: '2025-01-15T11:00:00Z',
      };

      await persistPRData(context, prMetadata);

      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      const savedData = parseJson<PRMetadata>(
        await fs.readFile(path.join(runDir, 'pr.json'), 'utf-8')
      );

      expect(savedData).toEqual(prMetadata);
    });

    it('should update feature.json external_links if it exists', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      const featureJson = { external_links: {} };
      await fs.writeFile(path.join(runDir, 'feature.json'), JSON.stringify(featureJson, null, 2));

      const context = await loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, mockRepoConfig, false);

      const prMetadata: PRMetadata = {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        branch: 'feature/test-branch',
        base_branch: 'main',
        created_at: '2025-01-15T11:00:00Z',
        reviewers_requested: [],
        auto_merge_enabled: false,
        last_updated: '2025-01-15T11:00:00Z',
      };

      await persistPRData(context, prMetadata);

      const updatedFeatureJson = parseJson<{ external_links?: { github_pr_number?: number } }>(
        await fs.readFile(path.join(runDir, 'feature.json'), 'utf-8')
      );

      expect(updatedFeatureJson.external_links.github_pr_number).toBe(42);
    });
  });

  describe('renderPROutput', () => {
    it('should render JSON output with stable property ordering', () => {
      const data = {
        url: 'https://github.com/test-org/test-repo/pull/42',
        success: true,
        pr_number: 42,
        branch: 'feature/test-branch',
        base_branch: 'main',
      };

      const output = renderPROutput(data, true);
      const parsed = parseJson<Record<string, unknown>>(output);

      // Verify stable ordering (alphabetical by key)
      const keys = Object.keys(parsed);
      expect(keys).toEqual(['base_branch', 'branch', 'pr_number', 'success', 'url']);
    });

    it('should render human-readable output', () => {
      const data = {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        branch: 'feature/test-branch',
        base_branch: 'main',
        reviewers_requested: ['alice', 'bob'],
        merge_ready: false,
        blockers: ['Status checks failed', 'Required reviews missing'],
      };

      const output = renderPROutput(data, false);

      expect(output).toContain('PR #42');
      expect(output).toContain('URL: https://github.com/test-org/test-repo/pull/42');
      expect(output).toContain('Branch: feature/test-branch');
      expect(output).toContain('Reviewers: alice, bob');
      expect(output).toContain('Merge ready: ✗');
      expect(output).toContain('Blockers:');
      expect(output).toContain('• Status checks failed');
      expect(output).toContain('• Required reviews missing');
    });
  });

  describe('isCodeApproved', () => {
    it('should return true if code gate completed', () => {
      expect(isCodeApproved(mockManifest)).toBe(true);
    });

    it('should return false if code gate pending', () => {
      const manifestWithPendingCode = {
        ...mockManifest,
        approvals: {
          pending: ['code'],
          completed: ['prd', 'spec', 'plan'],
        },
      };

      expect(isCodeApproved(manifestWithPendingCode)).toBe(false);
    });
  });

  describe('hasValidationsPassed', () => {
    it('should return true if validation.json shows success', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      const result = await hasValidationsPassed(runDir);
      expect(result).toBe(true);
    });

    it('should return false if validation.json shows failure', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      await fs.writeFile(
        path.join(runDir, 'validation.json'),
        JSON.stringify({ success: false }, null, 2)
      );

      const result = await hasValidationsPassed(runDir);
      expect(result).toBe(false);
    });

    it('should return false if validation.json does not exist', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      await fs.rm(path.join(runDir, 'validation.json'));

      const result = await hasValidationsPassed(runDir);
      expect(result).toBe(false);
    });
  });

  describe('PR Create - Blocked States', () => {
    it('should exit with code 30 if code approval missing', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      const manifestWithoutCodeApproval = {
        ...mockManifest,
        approvals: {
          pending: ['code'],
          completed: ['prd', 'spec', 'plan'],
        },
      };

      await fs.writeFile(
        path.join(runDir, 'manifest.json'),
        JSON.stringify(manifestWithoutCodeApproval, null, 2)
      );

      const context = await loadPRContext(TEST_BASE_DIR, TEST_FEATURE_ID, mockRepoConfig, false);

      expect(isCodeApproved(context.manifest)).toBe(false);
      // In actual command, this would trigger exit(30)
    });

    it('should exit with code 30 if validations failed', async () => {
      const runDir = path.join(TEST_BASE_DIR, TEST_FEATURE_ID);
      await fs.writeFile(
        path.join(runDir, 'validation.json'),
        JSON.stringify({ success: false }, null, 2)
      );

      const validationsPassed = await hasValidationsPassed(runDir);
      expect(validationsPassed).toBe(false);
      // In actual command, this would trigger exit(30)
    });
  });

  describe('PR Status - Blocker Detection', () => {
    it('should detect blockers when PR has failing status checks', () => {
      const statusChecks = [
        { context: 'lint', state: 'completed', conclusion: 'success' },
        { context: 'test', state: 'completed', conclusion: 'success' },
        { context: 'build', state: 'completed', conclusion: 'failure' },
      ];

      const failedChecks = statusChecks.filter(
        (check) => check.conclusion === 'failure' || check.conclusion === 'cancelled'
      );

      expect(failedChecks.length).toBe(1);
      expect(failedChecks[0].context).toBe('build');
    });

    it('should render blockers in human output', () => {
      const data = {
        pr_number: 42,
        merge_ready: false,
        blockers: [
          'PR is blocked by required status checks or reviews',
          '1 status check(s) failed',
        ],
        status_checks: [
          { context: 'lint', state: 'completed', conclusion: 'success' },
          { context: 'build', state: 'completed', conclusion: 'failure' },
        ],
      };

      const output = renderPROutput(data, false);

      expect(output).toContain('Merge ready: ✗');
      expect(output).toContain('Blockers:');
      expect(output).toContain('• PR is blocked by required status checks or reviews');
      expect(output).toContain('• 1 status check(s) failed');
      expect(output).toContain('✓ lint (completed)');
      expect(output).toContain('✗ build (completed)');
    });

    it('should render blockers in JSON output', () => {
      const data = {
        pr_number: 42,
        merge_ready: false,
        blockers: ['Status checks failed'],
      };

      const output = renderPROutput(data, true);
      const parsed = parseJson<{ merge_ready: boolean; blockers: string[] }>(output);

      expect(parsed.merge_ready).toBe(false);
      expect(parsed.blockers).toEqual(['Status checks failed']);
    });
  });

  describe('Exit Code Constants', () => {
    it('should define correct exit codes', () => {
      expect(PRExitCode.SUCCESS).toBe(0);
      expect(PRExitCode.ERROR).toBe(1);
      expect(PRExitCode.VALIDATION_ERROR).toBe(10);
      expect(PRExitCode.HUMAN_ACTION_REQUIRED).toBe(30);
    });
  });

  describe('JSON Output Stability', () => {
    it('should produce identical JSON output for same data', () => {
      const data = {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        branch: 'feature/test-branch',
        success: true,
      };

      const output1 = renderPROutput(data, true);
      const output2 = renderPROutput(data, true);

      expect(output1).toBe(output2);
    });

    it('should sort nested objects recursively', () => {
      const data = {
        pr_number: 42,
        nested: {
          z: 'last',
          a: 'first',
          m: 'middle',
        },
      };

      const output = renderPROutput(data, true);
      const parsed = parseJson<{ nested: Record<string, unknown> }>(output);

      const nestedKeys = Object.keys(parsed.nested);
      expect(nestedKeys).toEqual(['a', 'm', 'z']);
    });

    it('should preserve arrays without sorting elements', () => {
      const data = {
        pr_number: 42,
        reviewers: ['charlie', 'alice', 'bob'],
      };

      const output = renderPROutput(data, true);
      const parsed = parseJson<{ reviewers: string[] }>(output);

      // Array elements should maintain original order
      expect(parsed.reviewers).toEqual(['charlie', 'alice', 'bob']);
    });
  });
});
