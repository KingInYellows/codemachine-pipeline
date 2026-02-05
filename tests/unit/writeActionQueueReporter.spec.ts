import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateWriteActionQueueReport,
  formatWriteActionQueueCLIOutput,
  formatWriteActionQueueJSON,
  getWriteActionQueueStatus,
  formatQueueStatusForCLI,
  formatQueueStatusAsJSON,
  type WriteActionQueueReport,
} from '../../src/cli/utils/writeActionQueueReporter';
import type { WriteActionQueueManifest } from '../../src/workflows/writeActionQueue';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'write-action-queue-reporter-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createTestManifest(
  overrides: Partial<WriteActionQueueManifest> = {}
): WriteActionQueueManifest {
  return {
    schema_version: '1.0.0',
    feature_id: 'test-feature-123',
    total_actions: 100,
    pending_count: 10,
    in_progress_count: 5,
    completed_count: 80,
    failed_count: 3,
    skipped_count: 2,
    queue_checksum: 'abc123',
    updated_at: new Date().toISOString(),
    concurrency_limit: 10,
    ...overrides,
  };
}

async function writeQueueManifest(
  runDir: string,
  manifest: WriteActionQueueManifest
): Promise<void> {
  const queueDir = path.join(runDir, 'write_actions');
  await fs.mkdir(queueDir, { recursive: true });
  await fs.writeFile(path.join(queueDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
}

// ============================================================================
// generateWriteActionQueueReport Tests
// ============================================================================

describe('generateWriteActionQueueReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should return null when queue does not exist', async () => {
    const report = await generateWriteActionQueueReport(tempDir);
    expect(report).toBeNull();
  });

  it('should generate report from manifest', async () => {
    const manifest = createTestManifest();
    await writeQueueManifest(tempDir, manifest);

    const report = await generateWriteActionQueueReport(tempDir);

    expect(report).not.toBeNull();
    expect(report?.featureId).toBe('test-feature-123');
    expect(report?.totalActions).toBe(100);
    expect(report?.pendingCount).toBe(10);
    expect(report?.inProgressCount).toBe(5);
    expect(report?.completedCount).toBe(80);
    expect(report?.failedCount).toBe(3);
    expect(report?.skippedCount).toBe(2);
    expect(report?.concurrencyLimit).toBe(10);
  });

  it('should calculate derived metrics correctly', async () => {
    const manifest = createTestManifest({
      pending_count: 20,
      in_progress_count: 5,
      concurrency_limit: 10,
    });
    await writeQueueManifest(tempDir, manifest);

    const report = await generateWriteActionQueueReport(tempDir);

    expect(report?.backlog).toBe(25); // pending + in_progress
    expect(report?.utilizationPercent).toBe(50); // 5/10 * 100
  });

  it('should detect failures', async () => {
    const manifest = createTestManifest({ failed_count: 5 });
    await writeQueueManifest(tempDir, manifest);

    const report = await generateWriteActionQueueReport(tempDir);

    expect(report?.hasFailures).toBe(true);
  });

  it('should detect pending actions', async () => {
    const manifest = createTestManifest({ pending_count: 10 });
    await writeQueueManifest(tempDir, manifest);

    const report = await generateWriteActionQueueReport(tempDir);

    expect(report?.hasPending).toBe(true);
  });

  it('should handle zero concurrency limit gracefully', async () => {
    const manifest = createTestManifest({ concurrency_limit: 0 });
    await writeQueueManifest(tempDir, manifest);

    const report = await generateWriteActionQueueReport(tempDir);

    expect(report?.utilizationPercent).toBe(0);
  });

  describe('health status calculation', () => {
    it('should report healthy status when normal', async () => {
      const manifest = createTestManifest({
        pending_count: 5,
        in_progress_count: 2,
        failed_count: 0,
        concurrency_limit: 10,
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('healthy');
      expect(report?.healthReasons).toContain('Queue operating normally');
    });

    it('should report warning when backlog is high', async () => {
      const manifest = createTestManifest({
        pending_count: 45,
        in_progress_count: 10, // Backlog = 55, threshold is 50
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('warning');
      expect(report?.healthReasons.some((r) => r.includes('backlog'))).toBe(true);
    });

    it('should report critical when backlog is very high', async () => {
      const manifest = createTestManifest({
        pending_count: 195,
        in_progress_count: 10, // Backlog = 205, threshold is 200
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('critical');
      expect(report?.healthReasons.some((r) => r.includes('Critical backlog'))).toBe(true);
    });

    it('should report warning when failures exceed threshold', async () => {
      const manifest = createTestManifest({
        failed_count: 8, // Warning threshold is 5
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('warning');
      expect(report?.healthReasons.some((r) => r.includes('failures'))).toBe(true);
    });

    it('should report critical when failures are very high', async () => {
      const manifest = createTestManifest({
        failed_count: 25, // Critical threshold is 20
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('critical');
      expect(report?.healthReasons.some((r) => r.includes('Critical failures'))).toBe(true);
    });

    it('should report warning when queue is at capacity with pending', async () => {
      const manifest = createTestManifest({
        pending_count: 10,
        in_progress_count: 10,
        concurrency_limit: 10, // 100% utilization
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('warning');
      expect(report?.healthReasons.some((r) => r.includes('capacity'))).toBe(true);
    });

    it('should escalate to most severe condition', async () => {
      const manifest = createTestManifest({
        pending_count: 190,
        in_progress_count: 15, // Critical backlog
        failed_count: 8, // Warning failures
      });
      await writeQueueManifest(tempDir, manifest);

      const report = await generateWriteActionQueueReport(tempDir);

      expect(report?.health).toBe('critical');
    });
  });
});

// ============================================================================
// formatWriteActionQueueCLIOutput Tests
// ============================================================================

describe('formatWriteActionQueueCLIOutput', () => {
  it('should format null report as not initialized', () => {
    const lines = formatWriteActionQueueCLIOutput(null);

    expect(lines).toContain('Write Action Queue: Not initialized');
  });

  it('should include header with health status', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 10,
      inProgressCount: 5,
      completedCount: 80,
      failedCount: 3,
      skippedCount: 2,
      concurrencyLimit: 10,
      backlog: 15,
      utilizationPercent: 50,
      hasFailures: true,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: ['Queue operating normally'],
    };

    const lines = formatWriteActionQueueCLIOutput(report);
    const output = lines.join('\n');

    expect(output).toContain('Write Action Queue (healthy)');
    expect(output).toContain('Total actions: 100');
  });

  it('should show backlog details', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 10,
      inProgressCount: 5,
      completedCount: 80,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 15,
      utilizationPercent: 50,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: [],
    };

    const lines = formatWriteActionQueueCLIOutput(report);
    const output = lines.join('\n');

    expect(output).toContain('Backlog: 15');
    expect(output).toContain('10 pending');
    expect(output).toContain('5 in-progress');
    expect(output).toContain('Completed: 80');
  });

  it('should show failure count with warning', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 5,
      inProgressCount: 2,
      completedCount: 90,
      failedCount: 3,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 7,
      utilizationPercent: 20,
      hasFailures: true,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['Some failures detected'],
    };

    const lines = formatWriteActionQueueCLIOutput(report);
    const output = lines.join('\n');

    expect(output).toContain('Failed: 3');
  });

  it('should show skipped count in verbose mode', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 5,
      inProgressCount: 2,
      completedCount: 90,
      failedCount: 0,
      skippedCount: 3,
      concurrencyLimit: 10,
      backlog: 7,
      utilizationPercent: 20,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: [],
    };

    const normalLines = formatWriteActionQueueCLIOutput(report, { verbose: false });
    const verboseLines = formatWriteActionQueueCLIOutput(report, { verbose: true });

    expect(normalLines.join('\n')).not.toContain('Skipped');
    expect(verboseLines.join('\n')).toContain('Skipped (deduped): 3');
  });

  it('should show concurrency and utilization', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 5,
      inProgressCount: 8,
      completedCount: 85,
      failedCount: 0,
      skippedCount: 2,
      concurrencyLimit: 10,
      backlog: 13,
      utilizationPercent: 80,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: [],
    };

    const lines = formatWriteActionQueueCLIOutput(report);
    const output = lines.join('\n');

    expect(output).toContain('Concurrency: 8/10');
    expect(output).toContain('80% utilized');
  });

  it('should show health status when not healthy', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 100,
      inProgressCount: 10,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 110,
      utilizationPercent: 100,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['High backlog: 110 actions pending/in-progress (threshold: 50)'],
    };

    const lines = formatWriteActionQueueCLIOutput(report, { showWarnings: true });
    const output = lines.join('\n');

    expect(output).toContain('Health Status');
    expect(output).toContain('High backlog');
  });

  it('should hide health status when showWarnings is false', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 100,
      inProgressCount: 10,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 110,
      utilizationPercent: 100,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['High backlog'],
    };

    const lines = formatWriteActionQueueCLIOutput(report, { showWarnings: false });
    const output = lines.join('\n');

    expect(output).not.toContain('Health Status');
    expect(output).not.toContain('Recommendations');
  });

  it('should show recommendations for high backlog', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 45,
      inProgressCount: 10,
      completedCount: 40,
      failedCount: 0,
      skippedCount: 5,
      concurrencyLimit: 10,
      backlog: 55,
      utilizationPercent: 100,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['High backlog'],
    };

    const lines = formatWriteActionQueueCLIOutput(report, { showWarnings: true });
    const output = lines.join('\n');

    expect(output).toContain('Recommendations');
    expect(output).toContain('concurrency limit');
  });

  it('should show recommendations for failures', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 5,
      inProgressCount: 2,
      completedCount: 85,
      failedCount: 8,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 7,
      utilizationPercent: 20,
      hasFailures: true,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['Multiple failures'],
    };

    const lines = formatWriteActionQueueCLIOutput(report, { showWarnings: true });
    const output = lines.join('\n');

    expect(output).toContain('Recommendations');
    expect(output).toContain('failed actions');
  });

  it('should show recommendations when pending but not draining', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 10,
      inProgressCount: 0, // Nothing in progress but pending exists
      completedCount: 90,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 10,
      utilizationPercent: 0,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: [],
    };

    const lines = formatWriteActionQueueCLIOutput(report, { showWarnings: true });
    const output = lines.join('\n');

    expect(output).toContain('Recommendations');
    expect(output).toContain('rate limit cooldown');
  });
});

// ============================================================================
// formatWriteActionQueueJSON Tests
// ============================================================================

describe('formatWriteActionQueueJSON', () => {
  it('should format null report as not initialized', () => {
    const json = formatWriteActionQueueJSON(null);

    expect(json.initialized).toBe(false);
    expect(json.message).toBe('Write action queue not initialized');
  });

  it('should format report as structured JSON', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 10,
      inProgressCount: 5,
      completedCount: 80,
      failedCount: 3,
      skippedCount: 2,
      concurrencyLimit: 10,
      backlog: 15,
      utilizationPercent: 50,
      hasFailures: true,
      hasPending: true,
      updatedAt: '2025-01-26T12:00:00Z',
      health: 'warning',
      healthReasons: ['Some failures detected'],
    };

    const json = formatWriteActionQueueJSON(report);

    expect(json.initialized).toBe(true);
    expect(json.feature_id).toBe('feature-123');
    expect(json.queue_dir).toBe('/path/to/queue');
    expect(json.total_actions).toBe(100);
    expect(json.pending_count).toBe(10);
    expect(json.in_progress_count).toBe(5);
    expect(json.completed_count).toBe(80);
    expect(json.failed_count).toBe(3);
    expect(json.skipped_count).toBe(2);
    expect(json.concurrency_limit).toBe(10);
    expect(json.backlog).toBe(15);
    expect(json.utilization_percent).toBe(50);
    expect(json.has_failures).toBe(true);
    expect(json.has_pending).toBe(true);
    expect(json.updated_at).toBe('2025-01-26T12:00:00Z');
    expect(json.health).toEqual({
      status: 'warning',
      reasons: ['Some failures detected'],
    });
  });

  it('should include recommendations in JSON output', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 60,
      inProgressCount: 10,
      completedCount: 30,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 70,
      utilizationPercent: 100,
      hasFailures: false,
      hasPending: true,
      updatedAt: '2025-01-26T12:00:00Z',
      health: 'warning',
      healthReasons: ['High backlog'],
    };

    const json = formatWriteActionQueueJSON(report);

    expect(json.recommendations).toBeDefined();
    expect(Array.isArray(json.recommendations)).toBe(true);
    expect((json.recommendations as string[]).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('getWriteActionQueueStatus', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should be an alias for generateWriteActionQueueReport', async () => {
    const manifest = createTestManifest();
    await writeQueueManifest(tempDir, manifest);

    const status = await getWriteActionQueueStatus(tempDir);
    const report = await generateWriteActionQueueReport(tempDir);

    expect(status).toEqual(report);
  });
});

describe('formatQueueStatusForCLI', () => {
  it('should call formatWriteActionQueueCLIOutput with showWarnings true', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 60,
      inProgressCount: 10,
      completedCount: 30,
      failedCount: 0,
      skippedCount: 0,
      concurrencyLimit: 10,
      backlog: 70,
      utilizationPercent: 100,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'warning',
      healthReasons: ['High backlog'],
    };

    const lines = formatQueueStatusForCLI(report, false);
    const output = lines.join('\n');

    // Should show warnings by default
    expect(output).toContain('Health Status');
    expect(output).not.toContain('Skipped'); // verbose=false
  });

  it('should pass verbose option correctly', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 5,
      inProgressCount: 2,
      completedCount: 90,
      failedCount: 0,
      skippedCount: 3,
      concurrencyLimit: 10,
      backlog: 7,
      utilizationPercent: 20,
      hasFailures: false,
      hasPending: true,
      updatedAt: new Date().toISOString(),
      health: 'healthy',
      healthReasons: [],
    };

    const verboseLines = formatQueueStatusForCLI(report, true);
    expect(verboseLines.join('\n')).toContain('Skipped');
  });
});

describe('formatQueueStatusAsJSON', () => {
  it('should be an alias for formatWriteActionQueueJSON', () => {
    const report: WriteActionQueueReport = {
      featureId: 'feature-123',
      queueDir: '/path/to/queue',
      totalActions: 100,
      pendingCount: 10,
      inProgressCount: 5,
      completedCount: 80,
      failedCount: 3,
      skippedCount: 2,
      concurrencyLimit: 10,
      backlog: 15,
      utilizationPercent: 50,
      hasFailures: true,
      hasPending: true,
      updatedAt: '2025-01-26T12:00:00Z',
      health: 'healthy',
      healthReasons: [],
    };

    const json1 = formatQueueStatusAsJSON(report);
    const json2 = formatWriteActionQueueJSON(report);

    expect(json1).toEqual(json2);
  });
});
