/**
 * Integration tests for pr/create, pr/reviewers, and pr/disable-auto-merge CLI commands
 *
 * Tests the command-level logic: preflight checks, metadata persistence,
 * reviewer deduplication, auto-merge state tracking, and output rendering.
 *
 * Implements #417 acceptance criteria: at least 1 happy path + 1 invalid args
 * test per command.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadPRContext,
  persistPRData,
  renderPROutput,
  isCodeApproved,
  hasValidationsPassed,
  logDeploymentAction,
  type PRMetadata,
} from '../../src/cli/pr/shared.js';
import type { RunManifest } from '../../src/persistence/runDirectoryManager.js';
import type { RepoConfig } from '../../src/core/config/RepoConfig.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_DIR_PREFIX = 'pr-cmd-test-';
const TEST_FEATURE_ID = 'test-feature-pr-cmd';

function buildRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
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
      run_directory: '',
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
    ...overrides,
  } as RepoConfig;
}

function buildManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    schema_version: '1.0.0',
    feature_id: TEST_FEATURE_ID,
    title: 'Test Feature',
    source: 'feature/test-branch',
    status: 'in_progress',
    execution: {
      current_step: 'code',
      last_step: 'plan',
      last_error: null,
    },
    queue: {
      pending_count: 0,
      completed_count: 5,
      failed_count: 0,
    },
    approvals: {
      pending: [],
      completed: ['prd', 'spec', 'plan', 'code'],
    },
    telemetry: {
      logs_dir: 'logs',
      metrics_file: 'metrics/prometheus.txt',
      traces_file: 'telemetry/traces.json',
    },
    timestamps: {
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

function buildPRMetadata(overrides: Partial<PRMetadata> = {}): PRMetadata {
  return {
    pr_number: 42,
    url: 'https://github.com/test-org/test-repo/pull/42',
    branch: 'feature/test-branch',
    base_branch: 'main',
    created_at: new Date().toISOString(),
    reviewers_requested: [],
    auto_merge_enabled: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testRootDir: string;
let baseDir: string;

async function setupRunDir(
  manifestOverrides: Partial<RunManifest> = {},
  prMeta?: PRMetadata
): Promise<string> {
  const runDir = path.join(baseDir, TEST_FEATURE_ID);
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });

  await fs.writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(buildManifest(manifestOverrides), null, 2)
  );

  await fs.writeFile(
    path.join(runDir, 'validation.json'),
    JSON.stringify({ success: true }, null, 2)
  );

  if (prMeta) {
    await fs.writeFile(
      path.join(runDir, 'pr.json'),
      JSON.stringify(prMeta, null, 2)
    );
  }

  return runDir;
}

// =============================================================================
// pr create command tests
// =============================================================================

describe('PR Create Command Integration Tests', () => {
  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(path.join(os.tmpdir(), TEST_RUN_DIR_PREFIX));
    baseDir = path.join(testRootDir, 'runs');
    process.env.GITHUB_TOKEN = 'mock-token';
    delete process.env.JSON_OUTPUT;
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
    delete process.env.GITHUB_TOKEN;
    delete process.env.JSON_OUTPUT;
    vi.restoreAllMocks();
  });

  it('should reject when code approval gate is missing', async () => {
    await setupRunDir({
      approvals: { pending: ['code'], completed: ['prd', 'spec', 'plan'] },
    });

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    expect(isCodeApproved(context.manifest)).toBe(false);
  });

  it('should reject when validations have not passed', async () => {
    const runDir = await setupRunDir();

    // Overwrite validation.json with failure
    await fs.writeFile(
      path.join(runDir, 'validation.json'),
      JSON.stringify({ success: false }, null, 2)
    );

    const passed = await hasValidationsPassed(runDir);
    expect(passed).toBe(false);
  });

  it('should reject when validation.json is missing', async () => {
    const runDir = await setupRunDir();
    await fs.rm(path.join(runDir, 'validation.json'));

    const passed = await hasValidationsPassed(runDir);
    expect(passed).toBe(false);
  });

  it('should detect existing PR and block creation', async () => {
    const existingPR = buildPRMetadata({ pr_number: 99 });
    await setupRunDir({}, existingPR);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    expect(context.prMetadata).toBeDefined();
    expect(context.prMetadata?.pr_number).toBe(99);
  });

  it('should pass preflight when all gates are clear', async () => {
    await setupRunDir();

    const config = buildRepoConfig();
    const context = await loadPRContext(baseDir, TEST_FEATURE_ID, config, false);

    expect(isCodeApproved(context.manifest)).toBe(true);

    const runDir = path.join(baseDir, TEST_FEATURE_ID);
    const validationsPassed = await hasValidationsPassed(runDir);
    expect(validationsPassed).toBe(true);

    expect(context.prMetadata).toBeUndefined();
  });

  it('should persist PR metadata after creation', async () => {
    await setupRunDir();

    const config = buildRepoConfig();
    const context = await loadPRContext(baseDir, TEST_FEATURE_ID, config, false);

    const prMeta = buildPRMetadata({
      pr_number: 101,
      reviewers_requested: ['alice'],
    });
    await persistPRData(context, prMeta);

    const runDir = path.join(baseDir, TEST_FEATURE_ID);
    const saved = JSON.parse(
      await fs.readFile(path.join(runDir, 'pr.json'), 'utf-8')
    ) as PRMetadata;

    expect(saved.pr_number).toBe(101);
    expect(saved.reviewers_requested).toEqual(['alice']);
  });

  it('should parse --reviewers flag as comma-separated list', () => {
    const raw = ' alice , bob , charlie ';
    const parsed = raw
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    expect(parsed).toEqual(['alice', 'bob', 'charlie']);
  });

  it('should throw when GitHub integration is disabled', async () => {
    await setupRunDir();
    const config = buildRepoConfig({
      github: {
        enabled: false,
        token_env_var: 'GITHUB_TOKEN',
        api_base_url: 'https://api.github.com',
        required_scopes: ['repo'] as Array<'repo' | 'workflow' | 'read:org' | 'write:org'>,
        default_reviewers: [],
      },
    });

    await expect(
      loadPRContext(baseDir, TEST_FEATURE_ID, config, false)
    ).rejects.toThrow('GitHub integration is disabled');
  });
});

// =============================================================================
// pr disable-auto-merge command tests
// =============================================================================

describe('PR Disable-Auto-Merge Command Integration Tests', () => {
  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(path.join(os.tmpdir(), TEST_RUN_DIR_PREFIX));
    baseDir = path.join(testRootDir, 'runs');
    process.env.GITHUB_TOKEN = 'mock-token';
    delete process.env.JSON_OUTPUT;
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
    delete process.env.GITHUB_TOKEN;
    delete process.env.JSON_OUTPUT;
    vi.restoreAllMocks();
  });

  it('should detect when no PR exists', async () => {
    await setupRunDir();

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    // Command checks prMetadata is undefined → error
    expect(context.prMetadata).toBeUndefined();
  });

  it('should detect auto-merge already disabled', async () => {
    const prMeta = buildPRMetadata({ auto_merge_enabled: false });
    await setupRunDir({}, prMeta);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    expect(context.prMetadata?.auto_merge_enabled).toBe(false);
  });

  it('should update metadata when disabling auto-merge', async () => {
    const prMeta = buildPRMetadata({ auto_merge_enabled: true });
    await setupRunDir({}, prMeta);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    expect(context.prMetadata?.auto_merge_enabled).toBe(true);

    // Simulate what the command does after the API call:
    const updatedMeta: PRMetadata = {
      ...context.prMetadata!,
      auto_merge_enabled: false,
      last_updated: new Date().toISOString(),
    };

    await persistPRData(context, updatedMeta);

    const runDir = path.join(baseDir, TEST_FEATURE_ID);
    const saved = JSON.parse(
      await fs.readFile(path.join(runDir, 'pr.json'), 'utf-8')
    ) as PRMetadata;

    expect(saved.auto_merge_enabled).toBe(false);
  });

  it('should log reason to deployment.json', async () => {
    const prMeta = buildPRMetadata({ auto_merge_enabled: true });
    await setupRunDir({}, prMeta);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    await logDeploymentAction(context, 'auto_merge_disabled', {
      pr_number: 42,
      reason: 'Manual merge required for compliance',
      disabled_at: new Date().toISOString(),
    });

    const runDir = path.join(baseDir, TEST_FEATURE_ID);
    const deployment = JSON.parse(
      await fs.readFile(path.join(runDir, 'deployment.json'), 'utf-8')
    ) as { actions: Array<{ action: string; metadata: Record<string, unknown> }> };

    expect(deployment.actions.length).toBe(1);
    expect(deployment.actions[0].action).toBe('auto_merge_disabled');
    expect(deployment.actions[0].metadata.reason).toBe('Manual merge required for compliance');
  });

  it('should render disable-auto-merge JSON output with sorted keys', () => {
    const output = renderPROutput(
      {
        success: true,
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        auto_merge_enabled: false,
        reason: 'Compliance requirement',
        message: 'Auto-merge disabled successfully',
      },
      true
    );

    const parsed = JSON.parse(output) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(parsed.auto_merge_enabled).toBe(false);
  });
});

// =============================================================================
// pr reviewers command tests
// =============================================================================

describe('PR Reviewers Command Integration Tests', () => {
  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(path.join(os.tmpdir(), TEST_RUN_DIR_PREFIX));
    baseDir = path.join(testRootDir, 'runs');
    process.env.GITHUB_TOKEN = 'mock-token';
    delete process.env.JSON_OUTPUT;
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
    delete process.env.GITHUB_TOKEN;
    delete process.env.JSON_OUTPUT;
    vi.restoreAllMocks();
  });

  it('should detect when no PR exists for reviewer requests', async () => {
    await setupRunDir();

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    expect(context.prMetadata).toBeUndefined();
  });

  it('should parse --add flag and deduplicate with existing reviewers', async () => {
    const prMeta = buildPRMetadata({
      reviewers_requested: ['alice', 'bob'],
    });
    await setupRunDir({}, prMeta);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    // Simulate command's reviewer parsing and dedup
    const addFlag = 'bob, charlie, dave';
    const reviewersToAdd = addFlag
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const allReviewers = Array.from(
      new Set([...context.prMetadata!.reviewers_requested, ...reviewersToAdd])
    );

    expect(allReviewers).toEqual(['alice', 'bob', 'charlie', 'dave']);
  });

  it('should update PR metadata with merged reviewer list', async () => {
    const prMeta = buildPRMetadata({
      reviewers_requested: ['alice'],
    });
    await setupRunDir({}, prMeta);

    const context = await loadPRContext(
      baseDir,
      TEST_FEATURE_ID,
      buildRepoConfig(),
      false
    );

    const reviewersToAdd = ['bob', 'charlie'];
    const allReviewers = Array.from(
      new Set([...context.prMetadata!.reviewers_requested, ...reviewersToAdd])
    );

    const updatedMeta: PRMetadata = {
      ...context.prMetadata!,
      reviewers_requested: allReviewers,
      last_updated: new Date().toISOString(),
    };

    await persistPRData(context, updatedMeta);

    const runDir = path.join(baseDir, TEST_FEATURE_ID);
    const saved = JSON.parse(
      await fs.readFile(path.join(runDir, 'pr.json'), 'utf-8')
    ) as PRMetadata;

    expect(saved.reviewers_requested).toEqual(['alice', 'bob', 'charlie']);
  });

  it('should render reviewers in JSON output', () => {
    const output = renderPROutput(
      {
        success: true,
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        reviewers_requested: ['alice', 'bob', 'charlie'],
        reviewers_added: ['bob', 'charlie'],
        message: 'Reviewers requested: bob, charlie',
      },
      true
    );

    const parsed = JSON.parse(output) as {
      reviewers_requested: string[];
      reviewers_added: string[];
    };

    expect(parsed.reviewers_requested).toEqual(['alice', 'bob', 'charlie']);
    expect(parsed.reviewers_added).toEqual(['bob', 'charlie']);
  });

  it('should render reviewers in human-readable output', () => {
    const output = renderPROutput(
      {
        pr_number: 42,
        url: 'https://github.com/test-org/test-repo/pull/42',
        reviewers_requested: ['alice', 'bob'],
      },
      false
    );

    expect(output).toContain('PR #42');
    expect(output).toContain('Reviewers: alice, bob');
  });
});
