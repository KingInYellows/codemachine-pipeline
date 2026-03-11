/**
 * Integration tests for approve, resume, and rate-limits CLI commands
 *
 * Tests the underlying workflow functions these commands depend on,
 * covering their unique code paths not exercised by other test suites.
 *
 * Implements #417 acceptance criteria: at least 1 happy path + 1 invalid args
 * test per command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { readManifest, markApprovalRequired, writeManifest } from '../../src/persistence/manifestManager.js';
import { createRunDirectory } from '../../src/persistence/runLifecycle.js';
import {
  requestApproval,
  grantApproval,
  denyApproval,
  getPendingApprovals,
  getApprovalHistory,
  computeContentHash,
  computeArtifactHash,
} from '../../src/workflows/approvalRegistry.js';
import { analyzeResumeState, formatResumeAnalysis } from '../../src/workflows/resumeCoordinator.js';
import {
  generateRateLimitReport,
  formatRateLimitCLIOutput,
  type RateLimitReport,
} from '../../src/telemetry/rateLimitReporter.js';
import { RateLimitLedger } from '../../src/telemetry/rateLimitLedger.js';
import { createCliLogger, LogLevel } from '../../src/telemetry/logger.js';

// =============================================================================
// approve command tests
// =============================================================================

describe('Approve Command Integration Tests', () => {
  let testBaseDir: string;
  let featureId: string;
  let runDir: string;

  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approve-cmd-test-'));
    featureId = `FEAT-${randomUUID().split('-')[0]}`;
    runDir = await createRunDirectory(testBaseDir, featureId, {
      title: 'Test Feature',
      source: 'test',
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
    });

    const artifactsDir = path.join(runDir, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(path.join(artifactsDir, 'prd.md'), '# Test PRD\n\nTest content.', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  it('should grant approval for a pending gate', async () => {
    const prdPath = path.join(runDir, 'artifacts', 'prd.md');
    const prdContent = await fs.readFile(prdPath, 'utf-8');
    const prdHash = computeContentHash(prdContent);

    await requestApproval(runDir, 'prd', {
      artifactPath: 'artifacts/prd.md',
      artifactHash: prdHash,
    });

    const record = await grantApproval(runDir, 'prd', prdHash, {
      signer: 'approver@test.com',
      signerName: 'Approver',
      rationale: 'LGTM',
    });

    expect(record.verdict).toBe('approved');
    expect(record.signer).toBe('approver@test.com');
    expect(record.signer_name).toBe('Approver');
    expect(record.rationale).toBe('LGTM');

    const manifest = await readManifest(runDir);
    expect(manifest.approvals.completed).toContain('prd');
    expect(manifest.approvals.pending).not.toContain('prd');
  });

  it('should deny approval and keep gate pending', async () => {
    const prdPath = path.join(runDir, 'artifacts', 'prd.md');
    const prdContent = await fs.readFile(prdPath, 'utf-8');
    const prdHash = computeContentHash(prdContent);

    await requestApproval(runDir, 'prd', {
      artifactPath: 'artifacts/prd.md',
      artifactHash: prdHash,
    });

    const record = await denyApproval(runDir, 'prd', {
      signer: 'reviewer@test.com',
      reason: 'Needs more detail',
    });

    expect(record.verdict).toBe('rejected');
    expect(record.rationale).toBe('Needs more detail');

    const manifest = await readManifest(runDir);
    expect(manifest.approvals.pending).toContain('prd');
    expect(manifest.approvals.completed).not.toContain('prd');
  });

  it('should detect no pending approval for a gate', async () => {
    // Gate was never requested — getPendingApprovals should not include it
    const pending = await getPendingApprovals(runDir);
    expect(pending).not.toContain('spec');

    // Simulates the command's "already approved" check
    const history = await getApprovalHistory(runDir);
    const alreadyApproved = history.some((a) => a.gate_type === 'spec' && a.verdict === 'approved');
    expect(alreadyApproved).toBe(false);
  });

  it('should detect already-approved gate via history', async () => {
    const prdPath = path.join(runDir, 'artifacts', 'prd.md');
    const prdContent = await fs.readFile(prdPath, 'utf-8');
    const prdHash = computeContentHash(prdContent);

    await requestApproval(runDir, 'prd', {
      artifactPath: 'artifacts/prd.md',
      artifactHash: prdHash,
    });
    await grantApproval(runDir, 'prd', prdHash, { signer: 'u@test.com' });

    // After approval, gate is no longer pending
    const pending = await getPendingApprovals(runDir);
    expect(pending).not.toContain('prd');

    // History shows it was approved
    const history = await getApprovalHistory(runDir);
    const alreadyApproved = history.some((a) => a.gate_type === 'prd' && a.verdict === 'approved');
    expect(alreadyApproved).toBe(true);
  });

  it('should compute artifact hash from file path', async () => {
    const prdPath = path.join(runDir, 'artifacts', 'prd.md');
    const hash = await computeArtifactHash(prdPath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Same content produces same hash
    const content = await fs.readFile(prdPath, 'utf-8');
    const contentHash = computeContentHash(content);
    expect(hash).toBe(contentHash);
  });

  it('should reject hash mismatch when artifact is modified', async () => {
    const prdPath = path.join(runDir, 'artifacts', 'prd.md');
    const originalContent = await fs.readFile(prdPath, 'utf-8');
    const originalHash = computeContentHash(originalContent);

    await requestApproval(runDir, 'prd', {
      artifactPath: 'artifacts/prd.md',
      artifactHash: originalHash,
    });

    // Modify artifact, compute new hash
    await fs.writeFile(prdPath, originalContent + '\n## Added section', 'utf-8');
    const modifiedHash = computeContentHash(await fs.readFile(prdPath, 'utf-8'));
    expect(modifiedHash).not.toBe(originalHash);

    // Attempt grant with modified hash → should throw
    await expect(
      grantApproval(runDir, 'prd', modifiedHash, { signer: 'u@test.com' })
    ).rejects.toThrow(/hash mismatch/i);
  });
});

// =============================================================================
// resume command tests
// =============================================================================

describe('Resume Command Integration Tests', () => {
  let testBaseDir: string;
  let featureId: string;
  let runDir: string;

  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-cmd-test-'));
    featureId = `FEAT-${randomUUID().split('-')[0]}`;
    runDir = await createRunDirectory(testBaseDir, featureId, {
      title: 'Test Feature',
      source: 'test',
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
    });
  });

  afterEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  it('should analyze resume state for a run with pending approvals', async () => {
    // Mark an approval required to simulate paused state
    await markApprovalRequired(runDir, 'prd');

    const analysis = await analyzeResumeState(runDir, {
      skipHashVerification: true,
    });

    expect(analysis.featureId).toBe(featureId);
    expect(analysis.pendingApprovals).toContain('prd');
    // With pending approvals, resume should be blocked
    expect(analysis.canResume).toBe(false);
    expect(analysis.diagnostics.length).toBeGreaterThan(0);
    expect(analysis.diagnostics.some((d) => d.severity === 'blocker')).toBe(true);
  });

  it('should allow resume when no blockers present', async () => {
    // Freshly created run with no pending approvals and in_progress status
    const manifest = await readManifest(runDir);
    expect(manifest.approvals.pending).toHaveLength(0);

    const analysis = await analyzeResumeState(runDir, {
      skipHashVerification: true,
    });

    expect(analysis.featureId).toBe(featureId);
    expect(analysis.pendingApprovals).toHaveLength(0);
    expect(analysis.queueState.pending).toBe(0);
    expect(analysis.canResume).toBe(true);
  });

  it('should report queue state accurately', async () => {
    // Write a manifest with specific queue counts (preserving queue_dir)
    const manifest = await readManifest(runDir);
    const updatedManifest = {
      ...manifest,
      queue: {
        ...manifest.queue,
        pending_count: 3,
        completed_count: 7,
        failed_count: 1,
      },
    };
    await writeManifest(runDir, updatedManifest);

    const analysis = await analyzeResumeState(runDir, {
      skipHashVerification: true,
      validateQueue: false,
    });

    expect(analysis.queueState.pending).toBe(3);
    expect(analysis.queueState.completed).toBe(7);
    expect(analysis.queueState.failed).toBe(1);
  });

  it('should format resume analysis as human-readable text', async () => {
    const analysis = await analyzeResumeState(runDir, {
      skipHashVerification: true,
    });

    const formatted = formatResumeAnalysis(analysis);

    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain(featureId);
  });
});

// =============================================================================
// rate-limits command tests
// =============================================================================

describe('Rate-Limits Command Integration Tests', () => {
  let testBaseDir: string;
  let featureId: string;
  let runDir: string;

  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratelimits-cmd-test-'));
    featureId = `FEAT-${randomUUID().split('-')[0]}`;
    runDir = await createRunDirectory(testBaseDir, featureId, {
      title: 'Test Feature',
      source: 'test',
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
    });
  });

  afterEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  it('should generate empty report when no rate limit data exists', async () => {
    const report = await generateRateLimitReport(runDir);

    expect(report.providers).toEqual({});
    expect(report.summary.providerCount).toBe(0);
    expect(report.summary.anyInCooldown).toBe(false);
    expect(report.summary.anyRequiresAck).toBe(false);
    expect(report.generatedAt).toBeDefined();
  });

  it('should generate report with provider data from ledger', async () => {
    // Write a rate_limits.json fixture
    const now = new Date();
    const resetTime = Math.floor(now.getTime() / 1000) + 3600;
    const ledgerData = {
      schema_version: '1.0.0',
      feature_id: featureId,
      providers: {
        github: {
          provider: 'github',
          state: {
            remaining: 42,
            reset: resetTime,
            inCooldown: false,
          },
          recentEnvelopes: [],
          lastUpdated: now.toISOString(),
        },
      },
      metadata: {
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    };

    await fs.writeFile(
      path.join(runDir, 'rate_limits.json'),
      JSON.stringify(ledgerData, null, 2),
      'utf-8'
    );

    const report = await generateRateLimitReport(runDir);

    expect(report.featureId).toBe(featureId);
    expect(report.summary.providerCount).toBe(1);
    expect(report.providers.github).toBeDefined();
    expect(report.providers.github.remaining).toBe(42);
    expect(report.providers.github.inCooldown).toBe(false);
  });

  it('should format CLI output for providers', async () => {
    const report: RateLimitReport = {
      featureId,
      providers: {
        github: {
          provider: 'github',
          remaining: 100,
          reset: Math.floor(Date.now() / 1000) + 3600,
          resetAt: new Date(Date.now() + 3600000).toISOString(),
          secondsUntilReset: 3600,
          inCooldown: false,
          manualAckRequired: false,
          recentHitCount: 0,
          lastUpdated: new Date().toISOString(),
        },
      },
      summary: {
        providerCount: 1,
        providersInCooldown: 0,
        providersRequiringAck: 0,
        anyInCooldown: false,
        anyRequiresAck: false,
      },
      generatedAt: new Date().toISOString(),
    };

    const lines = formatRateLimitCLIOutput(report);

    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    // Should mention the provider
    const output = lines.join('\n');
    expect(output).toContain('github');
  });

  it('should report not-in-cooldown via RateLimitLedger', async () => {
    const logger = createCliLogger('test', featureId, runDir, {
      minLevel: LogLevel.WARN,
      mirrorToStderr: false,
    });
    const ledger = new RateLimitLedger(runDir, 'github', logger);

    const inCooldown = await ledger.isInCooldown('github');
    expect(inCooldown).toBe(false);
  });
});
