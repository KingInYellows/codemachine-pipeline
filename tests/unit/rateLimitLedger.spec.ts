import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  RateLimitLedger,
  createRateLimitLedger,
  type LoggerInterface,
  type RateLimitEnvelope,
} from '../../src/telemetry/rateLimitLedger';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'ratelimit-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createMockLogger(): LoggerInterface & {
  calls: { level: string; message: string; context?: Record<string, unknown> }[];
} {
  const calls: { level: string; message: string; context?: Record<string, unknown> }[] = [];
  return {
    calls,
    debug: (message: string, context?: Record<string, unknown>) => {
      calls.push({ level: 'debug', message, context });
    },
    info: (message: string, context?: Record<string, unknown>) => {
      calls.push({ level: 'info', message, context });
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      calls.push({ level: 'warn', message, context });
    },
    error: (message: string, context?: Record<string, unknown>) => {
      calls.push({ level: 'error', message, context });
    },
  };
}

function createTestEnvelope(overrides: Partial<RateLimitEnvelope> = {}): RateLimitEnvelope {
  return {
    provider: 'github',
    remaining: 100,
    reset: Math.floor(Date.now() / 1000) + 3600,
    timestamp: new Date().toISOString(),
    requestId: 'req-123',
    endpoint: '/api/test',
    statusCode: 200,
    ...overrides,
  };
}

// ============================================================================
// RateLimitLedger Error Handling Tests
// ============================================================================

describe('RateLimitLedger Error Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('logger requirement', () => {
    it('should require logger in constructor', () => {
      const mockLogger = createMockLogger();
      const ledger = createRateLimitLedger(tempDir, 'github', mockLogger);

      expect(ledger).toBeInstanceOf(RateLimitLedger);
    });

    it('should throw if logger is not provided', () => {
      // Without logger, constructor should throw
      expect(() => {
        createRateLimitLedger(tempDir, 'github');
      }).toThrow();
    });
  });

  describe('getProviderState error handling', () => {
    it('should log error when ledger file is corrupted', async () => {
      const mockLogger = createMockLogger();
      const ledger = createRateLimitLedger(tempDir, 'github', mockLogger);

      // Write corrupted JSON to ledger file
      const ledgerPath = path.join(tempDir, 'rate_limits.json');
      await fs.writeFile(ledgerPath, '{ invalid json }', 'utf-8');

      // getProviderState should handle error gracefully
      const state = await ledger.getProviderState('github');

      // Should return undefined for corrupted file
      expect(state).toBeUndefined();

      // Should log the error
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0].message).toContain('Failed to read');
    });

    it('should not silently swallow read errors', async () => {
      const mockLogger = createMockLogger();
      const ledger = createRateLimitLedger(tempDir, 'github', mockLogger);

      // Write corrupted JSON
      const ledgerPath = path.join(tempDir, 'rate_limits.json');
      await fs.writeFile(ledgerPath, 'not valid json at all', 'utf-8');

      await ledger.getProviderState('github');

      // Error should be logged, not silently ignored
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
    });
  });

  describe('recordEnvelope error handling', () => {
    it('should log error when write fails', async () => {
      const mockLogger = createMockLogger();
      // Use invalid directory to trigger write failure
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const ledger = createRateLimitLedger(invalidDir, 'github', mockLogger);

      const envelope = createTestEnvelope();
      await ledger.recordEnvelope(envelope);

      // Should log error but not throw
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0].message).toContain('Failed to record');
    });

    it('should include error details in log context', async () => {
      const mockLogger = createMockLogger();
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const ledger = createRateLimitLedger(invalidDir, 'github', mockLogger);

      const envelope = createTestEnvelope();
      await ledger.recordEnvelope(envelope);

      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls[0].context).toHaveProperty('error');
      expect(errorCalls[0].context).toHaveProperty('provider', 'github');
    });
  });

  describe('clearCooldown error handling', () => {
    it('should log error when clear fails', async () => {
      const mockLogger = createMockLogger();
      // Write corrupted JSON to force parse error
      const ledgerPath = path.join(tempDir, 'rate_limits.json');
      await fs.writeFile(ledgerPath, '{ corrupted }', 'utf-8');

      const ledger = createRateLimitLedger(tempDir, 'github', mockLogger);
      await ledger.clearCooldown('github');

      // Should log error
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// No console.log fallback tests
// ============================================================================

describe('RateLimitLedger no console fallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should not use console methods when logger is provided', async () => {
    const consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    const mockLogger = createMockLogger();
    const ledger = createRateLimitLedger(tempDir, 'github', mockLogger);

    // Perform operations that would use logging
    const envelope = createTestEnvelope({ statusCode: 429, remaining: 0 });
    await ledger.recordEnvelope(envelope);

    // None of the console methods should be called
    expect(consoleSpy.debug).not.toHaveBeenCalled();
    expect(consoleSpy.info).not.toHaveBeenCalled();
    expect(consoleSpy.warn).not.toHaveBeenCalled();
    expect(consoleSpy.error).not.toHaveBeenCalled();

    // Restore spies
    Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
  });
});
