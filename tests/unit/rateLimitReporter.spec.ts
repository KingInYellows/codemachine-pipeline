import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateRateLimitReport,
  exportRateLimitMetrics,
  formatRateLimitCLIOutput,
  type RateLimitReport,
  type ProviderRateLimitReport,
} from '../../src/telemetry/rateLimitReporter';
import {
  writeRateLimitLedger,
  type RateLimitLedgerData,
  type ProviderRateLimitState,
  type RateLimitEnvelope,
} from '../../src/telemetry/rateLimitLedger';
import { createRunMetricsCollector } from '../../src/telemetry/metrics';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'rate-limit-reporter-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createTestEnvelope(overrides: Partial<RateLimitEnvelope> = {}): RateLimitEnvelope {
  return {
    provider: 'github',
    remaining: 5000,
    reset: Math.floor(Date.now() / 1000) + 3600,
    timestamp: new Date().toISOString(),
    requestId: 'req_test123',
    endpoint: 'https://api.github.com/repos/org/repo',
    statusCode: 200,
    ...overrides,
  };
}

function createTestProviderState(
  provider: string,
  overrides: Partial<ProviderRateLimitState> = {}
): ProviderRateLimitState {
  return {
    provider,
    state: {
      remaining: 5000,
      reset: Math.floor(Date.now() / 1000) + 3600,
      inCooldown: false,
    },
    recentEnvelopes: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function createTestLedger(
  providers: Record<string, ProviderRateLimitState> = {}
): RateLimitLedgerData {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    feature_id: 'test-feature-123',
    providers,
    metadata: {
      created_at: now,
      updated_at: now,
    },
  };
}

// ============================================================================
// Rate Limit Reporter Tests
// ============================================================================

describe('RateLimitReporter', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('generateReport', () => {
    it('should generate report with empty ledger', async () => {
      const ledger = createTestLedger();
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.featureId).toBe('test-feature-123');
      expect(report.providers).toEqual({});
      expect(report.summary.providerCount).toBe(0);
      expect(report.summary.anyInCooldown).toBe(false);
      expect(report.summary.anyRequiresAck).toBe(false);
    });

    it('should generate report with single provider', async () => {
      const githubState = createTestProviderState('github', {
        state: {
          remaining: 4850,
          reset: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
          inCooldown: false,
        },
        recentEnvelopes: [createTestEnvelope()],
      });

      const ledger = createTestLedger({ github: githubState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.github).toBeDefined();
      expect(report.providers.github.provider).toBe('github');
      expect(report.providers.github.remaining).toBe(4850);
      expect(report.providers.github.inCooldown).toBe(false);
      expect(report.providers.github.manualAckRequired).toBe(false);
      expect(report.providers.github.recentHitCount).toBe(0);
      expect(report.summary.providerCount).toBe(1);
    });

    it('should detect cooldown state', async () => {
      const now = Date.now();
      const cooldownUntil = new Date(now + 600000).toISOString(); // 10 minutes from now

      const linearState = createTestProviderState('linear', {
        state: {
          remaining: 8,
          reset: Math.floor(now / 1000) + 600,
          inCooldown: true,
          cooldownUntil,
        },
      });

      const ledger = createTestLedger({ linear: linearState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.linear.inCooldown).toBe(true);
      expect(report.providers.linear.cooldownUntil).toBe(cooldownUntil);
      expect(report.providers.linear.secondsUntilCooldownEnd).toBeGreaterThan(0);
      expect(report.providers.linear.secondsUntilCooldownEnd).toBeLessThanOrEqual(600);
      expect(report.summary.providersInCooldown).toBe(1);
      expect(report.summary.anyInCooldown).toBe(true);
    });

    it('should detect manual acknowledgement requirement (3+ consecutive 429s)', async () => {
      const envelope429_1 = createTestEnvelope({ statusCode: 429, errorMessage: 'Rate limit exceeded' });
      const envelope429_2 = createTestEnvelope({ statusCode: 429, errorMessage: 'Rate limit exceeded' });
      const envelope429_3 = createTestEnvelope({ statusCode: 429, errorMessage: 'Rate limit exceeded' });

      const linearState = createTestProviderState('linear', {
        state: {
          remaining: 0,
          reset: Math.floor(Date.now() / 1000) + 600,
          inCooldown: true,
        },
        recentEnvelopes: [envelope429_3, envelope429_2, envelope429_1],
        lastError: {
          timestamp: envelope429_3.timestamp,
          message: 'Rate limit exceeded',
          requestId: envelope429_3.requestId,
        },
      });

      const ledger = createTestLedger({ linear: linearState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.linear.manualAckRequired).toBe(true);
      expect(report.providers.linear.recentHitCount).toBe(3);
      expect(report.summary.providersRequiringAck).toBe(1);
      expect(report.summary.anyRequiresAck).toBe(true);
    });

    it('should not require manual ack for non-consecutive 429s', async () => {
      const envelope200 = createTestEnvelope({ statusCode: 200 });
      const envelope429_1 = createTestEnvelope({ statusCode: 429, errorMessage: 'Rate limit exceeded' });
      const envelope429_2 = createTestEnvelope({ statusCode: 429, errorMessage: 'Rate limit exceeded' });

      const githubState = createTestProviderState('github', {
        recentEnvelopes: [envelope429_2, envelope200, envelope429_1],
      });

      const ledger = createTestLedger({ github: githubState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.github.manualAckRequired).toBe(false);
      expect(report.providers.github.recentHitCount).toBe(2);
    });

    it('should count recent hits correctly', async () => {
      const envelope200 = createTestEnvelope({ statusCode: 200 });
      const envelope429_1 = createTestEnvelope({ statusCode: 429 });
      const envelope429_2 = createTestEnvelope({ statusCode: 429 });
      const envelope429_3 = createTestEnvelope({ statusCode: 429 });

      const githubState = createTestProviderState('github', {
        recentEnvelopes: [envelope200, envelope429_3, envelope200, envelope429_2, envelope429_1],
      });

      const ledger = createTestLedger({ github: githubState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.github.recentHitCount).toBe(3);
    });

    it('should calculate seconds until reset correctly', async () => {
      const now = Date.now();
      const reset = Math.floor(now / 1000) + 1800; // 30 minutes from now

      const githubState = createTestProviderState('github', {
        state: {
          remaining: 4850,
          reset,
          inCooldown: false,
        },
      });

      const ledger = createTestLedger({ github: githubState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.providers.github.secondsUntilReset).toBeGreaterThan(1700);
      expect(report.providers.github.secondsUntilReset).toBeLessThanOrEqual(1800);
    });

    it('should handle multiple providers', async () => {
      const githubState = createTestProviderState('github', {
        state: { remaining: 4850, reset: Math.floor(Date.now() / 1000) + 1800, inCooldown: false },
      });

      const linearState = createTestProviderState('linear', {
        state: { remaining: 1200, reset: Math.floor(Date.now() / 1000) + 900, inCooldown: false },
      });

      const ledger = createTestLedger({ github: githubState, linear: linearState });
      await writeRateLimitLedger(tempDir, ledger);

      const report = await generateRateLimitReport(tempDir);

      expect(report.summary.providerCount).toBe(2);
      expect(report.providers.github).toBeDefined();
      expect(report.providers.linear).toBeDefined();
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics for all providers', async () => {
      const githubState = createTestProviderState('github', {
        state: { remaining: 4850, reset: Math.floor(Date.now() / 1000) + 1800, inCooldown: false },
      });

      const linearState = createTestProviderState('linear', {
        state: { remaining: 8, reset: Math.floor(Date.now() / 1000) + 600, inCooldown: true },
      });

      const ledger = createTestLedger({ github: githubState, linear: linearState });
      await writeRateLimitLedger(tempDir, ledger);

      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      await exportRateLimitMetrics(tempDir, metrics);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('codemachine_pipeline_rate_limit_remaining');
      expect(content).toContain('provider="github"');
      expect(content).toContain('provider="linear"');
      expect(content).toContain('codemachine_pipeline_rate_limit_cooldown_active');
    });

    it('should export cooldown active metric correctly', async () => {
      const githubState = createTestProviderState('github', {
        state: { remaining: 4850, reset: Math.floor(Date.now() / 1000) + 1800, inCooldown: false },
      });

      const linearState = createTestProviderState('linear', {
        state: { remaining: 8, reset: Math.floor(Date.now() / 1000) + 600, inCooldown: true },
      });

      const ledger = createTestLedger({ github: githubState, linear: linearState });
      await writeRateLimitLedger(tempDir, ledger);

      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      await exportRateLimitMetrics(tempDir, metrics);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      // GitHub should be 0 (not in cooldown)
      const githubCooldownMatch = content.match(
        /codemachine_pipeline_rate_limit_cooldown_active\{.*provider="github".*\} (\d+)/
      );
      expect(githubCooldownMatch).toBeTruthy();
      expect(githubCooldownMatch?.[1]).toBe('0');

      // Linear should be 1 (in cooldown)
      const linearCooldownMatch = content.match(
        /codemachine_pipeline_rate_limit_cooldown_active\{.*provider="linear".*\} (\d+)/
      );
      expect(linearCooldownMatch).toBeTruthy();
      expect(linearCooldownMatch?.[1]).toBe('1');
    });
  });

  describe('formatCLIOutput', () => {
    it('should format empty report', () => {
      const report: RateLimitReport = {
        featureId: 'test-feature-123',
        providers: {},
        summary: {
          providerCount: 0,
          providersInCooldown: 0,
          providersRequiringAck: 0,
          anyInCooldown: false,
          anyRequiresAck: false,
        },
        generatedAt: new Date().toISOString(),
      };

      const lines = formatRateLimitCLIOutput(report);

      expect(lines.join('\n')).toContain('Providers tracked: 0');
      expect(lines.join('\n')).toContain('No rate limit data available yet.');
    });

    it('should format single provider report', () => {
      const now = Date.now();
      const providerReport: ProviderRateLimitReport = {
        provider: 'github',
        remaining: 4850,
        reset: Math.floor(now / 1000) + 1800,
        resetAt: new Date(now + 1800000).toISOString(),
        secondsUntilReset: 1800,
        inCooldown: false,
        manualAckRequired: false,
        recentHitCount: 0,
        lastUpdated: new Date().toISOString(),
      };

      const report: RateLimitReport = {
        featureId: 'test-feature-123',
        providers: { github: providerReport },
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
      const output = lines.join('\n');

      expect(output).toContain('Provider: github');
      expect(output).toContain('Remaining: 4850');
      expect(output).toContain('Cooldown: Inactive');
    });

    it('should format cooldown warning', () => {
      const now = Date.now();
      const cooldownUntil = new Date(now + 600000).toISOString();

      const providerReport: ProviderRateLimitReport = {
        provider: 'linear',
        remaining: 8,
        reset: Math.floor(now / 1000) + 600,
        resetAt: new Date(now + 600000).toISOString(),
        secondsUntilReset: 600,
        inCooldown: true,
        cooldownUntil,
        secondsUntilCooldownEnd: 600,
        manualAckRequired: false,
        recentHitCount: 1,
        lastUpdated: new Date().toISOString(),
      };

      const report: RateLimitReport = {
        providers: { linear: providerReport },
        summary: {
          providerCount: 1,
          providersInCooldown: 1,
          providersRequiringAck: 0,
          anyInCooldown: true,
          anyRequiresAck: false,
        },
        generatedAt: new Date().toISOString(),
      };

      const lines = formatRateLimitCLIOutput(report);
      const output = lines.join('\n');

      expect(output).toContain('⚠ Providers in cooldown: 1');
      expect(output).toContain('⚠ Cooldown: Active');
      expect(output).toContain('One or more providers are in cooldown');
    });

    it('should format manual acknowledgement warning', () => {
      const now = Date.now();

      const providerReport: ProviderRateLimitReport = {
        provider: 'linear',
        remaining: 0,
        reset: Math.floor(now / 1000) + 600,
        resetAt: new Date(now + 600000).toISOString(),
        secondsUntilReset: 600,
        inCooldown: true,
        manualAckRequired: true,
        recentHitCount: 3,
        lastUpdated: new Date().toISOString(),
      };

      const report: RateLimitReport = {
        providers: { linear: providerReport },
        summary: {
          providerCount: 1,
          providersInCooldown: 1,
          providersRequiringAck: 1,
          anyInCooldown: true,
          anyRequiresAck: true,
        },
        generatedAt: new Date().toISOString(),
      };

      const lines = formatRateLimitCLIOutput(report);
      const output = lines.join('\n');

      expect(output).toContain('⚠ Providers requiring manual acknowledgement: 1');
      expect(output).toContain('⚠ Manual Acknowledgement Required');
      expect(output).toContain('3 consecutive rate limit hits');
      expect(output).toContain('codepipe rate-limits clear');
    });

    it('should show verbose details when requested', () => {
      const now = Date.now();

      const providerReport: ProviderRateLimitReport = {
        provider: 'github',
        remaining: 4850,
        reset: Math.floor(now / 1000) + 1800,
        resetAt: new Date(now + 1800000).toISOString(),
        secondsUntilReset: 1800,
        inCooldown: false,
        manualAckRequired: false,
        recentHitCount: 2,
        lastError: {
          timestamp: new Date().toISOString(),
          message: 'Rate limit exceeded',
          requestId: 'req_test123',
        },
        lastUpdated: new Date().toISOString(),
      };

      const report: RateLimitReport = {
        providers: { github: providerReport },
        summary: {
          providerCount: 1,
          providersInCooldown: 0,
          providersRequiringAck: 0,
          anyInCooldown: false,
          anyRequiresAck: false,
        },
        generatedAt: new Date().toISOString(),
      };

      const lines = formatRateLimitCLIOutput(report, { verbose: true });
      const output = lines.join('\n');

      expect(output).toContain('Recent hits: 2');
      expect(output).toContain('Last error: Rate limit exceeded');
      expect(output).toContain('Request ID: req_test123');
      expect(output).toContain('Last updated:');
    });

    it('should hide warnings when requested', () => {
      const now = Date.now();

      const providerReport: ProviderRateLimitReport = {
        provider: 'linear',
        remaining: 8,
        reset: Math.floor(now / 1000) + 600,
        resetAt: new Date(now + 600000).toISOString(),
        secondsUntilReset: 600,
        inCooldown: true,
        manualAckRequired: true,
        recentHitCount: 3,
        lastUpdated: new Date().toISOString(),
      };

      const report: RateLimitReport = {
        providers: { linear: providerReport },
        summary: {
          providerCount: 1,
          providersInCooldown: 1,
          providersRequiringAck: 1,
          anyInCooldown: true,
          anyRequiresAck: true,
        },
        generatedAt: new Date().toISOString(),
      };

      const lines = formatRateLimitCLIOutput(report, { showWarnings: false });
      const output = lines.join('\n');

      expect(output).not.toContain('Warnings:');
      expect(output).not.toContain('One or more providers are in cooldown');
    });
  });
});
