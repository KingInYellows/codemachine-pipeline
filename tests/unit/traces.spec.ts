import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TraceManager,
  createTraceManager,
  createRunTraceManager,
  withSpan,
  withSpanSync,
  SpanStatusCode,
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

async function readTraceFile(filePath: string): Promise<unknown[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line)
    .map((line) => JSON.parse(line) as unknown);
}

function buildToken(prefix: string, body: string): string {
  return `${prefix}${body}`;
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

describe('TraceManager Redaction', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('redacts secrets from async span error attributes and status messages before persistence', async () => {
    const traceManager = createRunTraceManager(tempDir);
    const token = buildToken('ghp_', 'a'.repeat(36));
    const apiKey = buildToken('api', 'b'.repeat(30));
    const message = `Request failed: Authorization: Bearer ${token} url=https://example.test?api_key=${apiKey}`;

    await expect(
      withSpan(traceManager, 'failing_operation', async () => {
        throw new Error(message);
      })
    ).rejects.toThrow(message);

    await traceManager.flush();

    const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
    const traceContent = await fs.readFile(tracesPath, 'utf-8');
    expect(traceContent).not.toContain(token);
    expect(traceContent).not.toContain(apiKey);

    const [span] = (await readTraceFile(tracesPath)) as Array<{
      status: { code: SpanStatusCode; message: string };
      attributes: Record<string, string | number | boolean>;
    }>;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(span.status.message).toContain('api_key=[REDACTED]');
    expect(span.attributes['error.message']).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(span.attributes['error.stack']).not.toContain(token);
  });

  it('redacts sensitive span attributes and event attributes', async () => {
    const traceManager = createRunTraceManager(tempDir, undefined, undefined);
    const span = traceManager.startSpan('span_with_sensitive_attributes', undefined, {
      Authorization: 'Bearer token-value-that-is-long-enough',
      endpoint: 'https://example.test?token=shhh1234567890',
    });
    span.addEvent('http_retry', { api_key: 'test-api-key', detail: 'safe detail' });
    span.end({ code: SpanStatusCode.ERROR, message: 'failed with password=super-secret' });

    await traceManager.flush();

    const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
    const [recordedSpan] = (await readTraceFile(tracesPath)) as Array<{
      status: { message: string };
      attributes: Record<string, string | number | boolean>;
      events: Array<{ attributes?: Record<string, string | number | boolean> }>;
    }>;

    expect(recordedSpan.attributes.Authorization).toBe('[REDACTED]');
    expect(recordedSpan.attributes.endpoint).toContain('token=[REDACTED]');
    expect(recordedSpan.events[0].attributes?.api_key).toBe('[REDACTED]');
    expect(recordedSpan.events[0].attributes?.detail).toBe('safe detail');
    expect(recordedSpan.status.message).toBe('failed with password=[REDACTED]');
  });

  it('redacts secrets from sync span error attributes and status messages', () => {
    const traceManager = createRunTraceManager(tempDir);
    const token = buildToken('ghp_', 'c'.repeat(36));

    expect(() =>
      withSpanSync(traceManager, 'sync_failure', () => {
        throw new Error(`sync failure token=${token}`);
      })
    ).toThrow(`sync failure token=${token}`);

    const [span] = traceManager.getSpans() as Array<{
      status: { message: string };
      attributes: Record<string, string | number | boolean>;
    }>;
    expect(span.status.message).toBe('sync failure token=[REDACTED_GITHUB_TOKEN]');
    expect(span.attributes['error.message']).toBe('sync failure token=[REDACTED_GITHUB_TOKEN]');
  });
});
