/**
 * Unit tests for src/cli/pr/shared.ts (CDMCH-90)
 *
 * Tests cover:
 * - renderPROutput: JSON and human-readable formatting
 * - isCodeApproved: Approval gate check
 * - hasValidationsPassed: Validation file check
 * - logDeploymentAction: Audit trail logging
 * - persistPRData: Atomic write and feature.json sync
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  renderPROutput,
  isCodeApproved,
  hasValidationsPassed,
  logDeploymentAction,
  persistPRData,
  type PRContext,
  type PRMetadata,
} from '../../../src/cli/pr/shared';
import type { RunManifest } from '../../../src/persistence/manifestManager';
import type { StructuredLogger } from '../../../src/telemetry/logger';

// ============================================================================
// Test Utilities
// ============================================================================

function createMockLogger(): StructuredLogger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => createMockLogger(),
    flush: () => Promise.resolve(),
  } as unknown as StructuredLogger;
}

function createMockContext(runDir: string): PRContext {
  return {
    runDir,
    featureId: 'TEST-123',
    manifest: {
      schema_version: '1.0.0',
      feature_id: 'TEST-123',
      approvals: { pending: [], completed: [] },
    } as unknown as RunManifest,
    config: {} as PRContext['config'],
    logger: createMockLogger(),
  };
}

function createMockPRMetadata(overrides: Partial<PRMetadata> = {}): PRMetadata {
  return {
    pr_number: 42,
    url: 'https://github.com/test/repo/pull/42',
    branch: 'feature/test',
    base_branch: 'main',
    created_at: '2025-01-01T00:00:00.000Z',
    reviewers_requested: ['alice', 'bob'],
    auto_merge_enabled: false,
    last_updated: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// renderPROutput
// ============================================================================

describe('renderPROutput', () => {
  it('should render JSON with sorted keys', () => {
    const data = { pr_number: 42, url: 'https://example.com', branch: 'feature' };
    const output = renderPROutput(data, true);
    const parsed = JSON.parse(output);
    expect(parsed.pr_number).toBe(42);
    // Keys should be sorted alphabetically
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it('should render human-readable PR summary', () => {
    const data = {
      pr_number: 42,
      url: 'https://github.com/test/repo/pull/42',
      branch: 'feature/test',
      base_branch: 'main',
      reviewers_requested: ['alice', 'bob'],
      merge_ready: true,
    };

    const output = renderPROutput(data, false);
    expect(output).toContain('PR #42');
    expect(output).toContain('URL: https://github.com/test/repo/pull/42');
    expect(output).toContain('Branch: feature/test');
    expect(output).toContain('Base: main');
    expect(output).toContain('Reviewers: alice, bob');
    expect(output).toContain('Merge ready:');
  });

  it('should show "Reviewers: none" for empty reviewer list', () => {
    const data = { reviewers_requested: [] };
    const output = renderPROutput(data, false);
    expect(output).toContain('Reviewers: none');
  });

  it('should render blockers when present', () => {
    const data = {
      blockers: ['CI failed', 'Missing approval'],
    };
    const output = renderPROutput(data, false);
    expect(output).toContain('Blockers:');
    expect(output).toContain('CI failed');
    expect(output).toContain('Missing approval');
  });

  it('should render status checks', () => {
    const data = {
      status_checks: [
        { context: 'ci/build', state: 'success', conclusion: 'success' },
        { context: 'test/unit', state: 'failure', conclusion: 'failure' },
        { context: 'test/lint', state: 'pending', conclusion: null },
      ],
    };
    const output = renderPROutput(data, false);
    expect(output).toContain('Status checks (3)');
    expect(output).toContain('ci/build');
    expect(output).toContain('test/unit');
    expect(output).toContain('test/lint');
  });

  it('should render message field', () => {
    const data = { message: 'PR created successfully' };
    const output = renderPROutput(data, false);
    expect(output).toContain('PR created successfully');
  });

  it('should handle empty data object', () => {
    const output = renderPROutput({}, false);
    expect(output).toBe('');
  });

  it('should skip invalid status check objects', () => {
    const data = {
      status_checks: [
        { context: 'valid', state: 'success', conclusion: 'success' },
        { invalid: true },
        null,
      ],
    };
    const output = renderPROutput(data, false);
    expect(output).toContain('valid');
    expect(output).not.toContain('invalid');
  });
});

// ============================================================================
// isCodeApproved
// ============================================================================

describe('isCodeApproved', () => {
  it('should return true when code gate is in completed approvals', () => {
    const manifest = {
      approvals: { completed: ['prd', 'code', 'spec'], pending: [] },
    } as unknown as RunManifest;
    expect(isCodeApproved(manifest)).toBe(true);
  });

  it('should return false when code gate is not completed', () => {
    const manifest = {
      approvals: { completed: ['prd', 'spec'], pending: ['code'] },
    } as unknown as RunManifest;
    expect(isCodeApproved(manifest)).toBe(false);
  });

  it('should return false for empty completed approvals', () => {
    const manifest = {
      approvals: { completed: [], pending: [] },
    } as unknown as RunManifest;
    expect(isCodeApproved(manifest)).toBe(false);
  });
});

// ============================================================================
// hasValidationsPassed
// ============================================================================

describe('hasValidationsPassed', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-shared-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return true when validation.json has success: true', async () => {
    await fs.writeFile(
      path.join(tempDir, 'validation.json'),
      JSON.stringify({ success: true }),
      'utf-8'
    );
    expect(await hasValidationsPassed(tempDir)).toBe(true);
  });

  it('should return false when validation.json has success: false', async () => {
    await fs.writeFile(
      path.join(tempDir, 'validation.json'),
      JSON.stringify({ success: false }),
      'utf-8'
    );
    expect(await hasValidationsPassed(tempDir)).toBe(false);
  });

  it('should return false when validation.json does not exist', async () => {
    expect(await hasValidationsPassed(tempDir)).toBe(false);
  });

  it('should return false for invalid JSON', async () => {
    await fs.writeFile(path.join(tempDir, 'validation.json'), 'not json', 'utf-8');
    expect(await hasValidationsPassed(tempDir)).toBe(false);
  });
});

// ============================================================================
// logDeploymentAction
// ============================================================================

describe('logDeploymentAction', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-shared-deploy-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create deployment.json when it does not exist', async () => {
    const context = createMockContext(tempDir);
    await logDeploymentAction(context, 'pr_created', { pr_number: 42 });

    const content = JSON.parse(await fs.readFile(path.join(tempDir, 'deployment.json'), 'utf-8'));
    expect(content.actions).toHaveLength(1);
    expect(content.actions[0].action).toBe('pr_created');
    expect(content.actions[0].metadata.pr_number).toBe(42);
    expect(content.actions[0].timestamp).toBeDefined();
  });

  it('should append to existing deployment.json', async () => {
    const context = createMockContext(tempDir);
    await logDeploymentAction(context, 'pr_created', { pr_number: 42 });
    await logDeploymentAction(context, 'review_requested', { reviewers: ['alice'] });

    const content = JSON.parse(await fs.readFile(path.join(tempDir, 'deployment.json'), 'utf-8'));
    expect(content.actions).toHaveLength(2);
    expect(content.actions[0].action).toBe('pr_created');
    expect(content.actions[1].action).toBe('review_requested');
  });

  it('should not throw if write fails', async () => {
    const context = createMockContext('/nonexistent/path');
    // Should not throw - logging failure is non-fatal
    await expect(logDeploymentAction(context, 'action', { test: true })).resolves.not.toThrow();
  });
});

// ============================================================================
// persistPRData
// ============================================================================

describe('persistPRData', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-shared-persist-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should persist PR metadata atomically to pr.json', async () => {
    const context = createMockContext(tempDir);
    const prMetadata = createMockPRMetadata();

    await persistPRData(context, prMetadata);

    const content = JSON.parse(await fs.readFile(path.join(tempDir, 'pr.json'), 'utf-8'));
    expect(content.pr_number).toBe(42);
    expect(content.url).toBe('https://github.com/test/repo/pull/42');
    expect(content.branch).toBe('feature/test');
  });

  it('should not leave temp files after successful write', async () => {
    const context = createMockContext(tempDir);
    await persistPRData(context, createMockPRMetadata());

    const files = await fs.readdir(tempDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('should update feature.json external_links when present', async () => {
    // Create a feature.json first
    await fs.writeFile(
      path.join(tempDir, 'feature.json'),
      JSON.stringify({ external_links: {} }),
      'utf-8'
    );

    const context = createMockContext(tempDir);
    await persistPRData(context, createMockPRMetadata({ pr_number: 99 }));

    const featureContent = JSON.parse(
      await fs.readFile(path.join(tempDir, 'feature.json'), 'utf-8')
    );
    expect(featureContent.external_links.github_pr_number).toBe(99);
  });

  it('should not fail if feature.json does not exist', async () => {
    const context = createMockContext(tempDir);
    await expect(persistPRData(context, createMockPRMetadata())).resolves.not.toThrow();
  });
});
