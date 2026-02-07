import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TraceManager,
  createTraceManager,
  createRunTraceManager,
} from '../../src/telemetry/traces';
import type { LoggerInterface } from '../../src/telemetry/logger';
import type { LogContext } from '../../src/core/sharedTypes';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'traces-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createMockLogger(): LoggerInterface & {
  calls: { level: string; message: string; context?: LogContext }[];
} {
  const calls: { level: string; message: string; context?: LogContext }[] = [];
  return {
    calls,
    debug: (message: string, context?: LogContext) => {
      calls.push({ level: 'debug', message, context });
    },
    info: (message: string, context?: LogContext) => {
      calls.push({ level: 'info', message, context });
    },
    warn: (message: string, context?: LogContext) => {
      calls.push({ level: 'warn', message, context });
    },
    error: (message: string, context?: LogContext) => {
      calls.push({ level: 'error', message, context });
    },
  };
}

// ============================================================================
// TraceManager Error Handling Tests
// ============================================================================

describe('TraceManager Error Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('logger injection', () => {
    it('should accept optional logger in constructor', () => {
      const mockLogger = createMockLogger();
      const tm = createTraceManager({
        runDir: tempDir,
        logger: mockLogger,
      });

      expect(tm).toBeInstanceOf(TraceManager);
    });

    it('should use injected logger for error reporting', async () => {
      const mockLogger = createMockLogger();
      // Create TraceManager with invalid directory to trigger error
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      // Start and end a span to trigger disk write
      const span = tm.startSpan('test-span');
      span.end();

      // Wait for async write to complete
      await tm.flush();

      // Should have logged error via injected logger
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0].message).toContain('TRACE_ERROR');
    });

    it('should not use console.error when logger is provided', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockLogger = createMockLogger();

      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      const span = tm.startSpan('test-span');
      span.end();
      await tm.flush();

      // console.error should NOT be called when logger is provided
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('disk write failure handling', () => {
    it('should track pending spans when disk writes fail', async () => {
      const mockLogger = createMockLogger();
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      const span = tm.startSpan('test-span');
      span.end();
      await tm.flush();

      // Spans should be stored in pending when disk fails
      expect(tm.getPendingSpans().length).toBeGreaterThan(0);
      expect(tm.isDiskWriteFailing()).toBe(true);
    });

    it('should log error with context when directory creation fails', async () => {
      const mockLogger = createMockLogger();
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      const span = tm.startSpan('test-span');
      span.end();
      await tm.flush();

      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.some((c) => c.message.includes('directory'))).toBe(true);
    });
  });

  describe('flush error handling', () => {
    it('should never throw from flush even with disk errors', async () => {
      const mockLogger = createMockLogger();
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      const span = tm.startSpan('test-span');
      span.end();

      // flush should not throw
      await expect(tm.flush()).resolves.toBeUndefined();
    });

    it('should log unflushed span count on flush failure', async () => {
      const mockLogger = createMockLogger();
      const invalidDir = '/nonexistent/path/that/does/not/exist';
      const tm = createTraceManager({
        runDir: invalidDir,
        logger: mockLogger,
      });

      // Create multiple spans
      tm.startSpan('span-1').end();
      tm.startSpan('span-2').end();
      tm.startSpan('span-3').end();

      await tm.flush();

      // Should log count of unflushed spans
      const errorCalls = mockLogger.calls.filter((c) => c.level === 'error');
      expect(errorCalls.some((c) => c.message.includes('unflushed'))).toBe(true);
    });
  });
});

// ============================================================================
// createRunTraceManager Tests
// ============================================================================

describe('createRunTraceManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should accept optional logger parameter', () => {
    const mockLogger = createMockLogger();
    const tm = createRunTraceManager(tempDir, 'test-run-id', mockLogger);

    expect(tm).toBeInstanceOf(TraceManager);
  });
});
