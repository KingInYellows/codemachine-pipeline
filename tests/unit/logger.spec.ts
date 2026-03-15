import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  LogLevel,
  RedactionEngine,
  createLogger,
  createCliLogger,
  createHttpLogger,
  type LogEntry,
} from '../../src/telemetry/logger';
import { createRunMetricsCollector } from '../../src/telemetry/metrics';
import {
  createRunTraceManager,
  withSpan,
  SpanKind,
  SpanStatusCode,
} from '../../src/telemetry/traces';
import type { Span } from '../../src/telemetry/traces';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function readNdjsonFile(filePath: string): Promise<LogEntry[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line);
  return lines.map((line) => JSON.parse(line) as LogEntry);
}

function buildToken(prefix: string, body: string): string {
  return `${prefix}${body}`;
}

function buildJwtToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '1234567890' })).toString('base64url');
  const signature = Buffer.from('abc123').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

async function readTraceFile(filePath: string): Promise<Span[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line);
  return lines.map((line) => JSON.parse(line) as Span);
}

// ============================================================================
// Logger Tests
// ============================================================================

describe('StructuredLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Basic Logging', () => {
    it('should write structured log entries to file', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logger.info('Test message', { key: 'value' });
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: LogLevel.INFO,
        component: 'test',
        run_id: 'test-run-123',
        message: 'Test message',
        context: { key: 'value' },
      });
      expect(logs[0].timestamp).toBeTruthy();
    });

    it('should support all log levels', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
        minLevel: LogLevel.DEBUG,
      });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      logger.fatal('Fatal message');
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs).toHaveLength(5);
      expect(logs.map((l) => l.level)).toEqual([
        LogLevel.DEBUG,
        LogLevel.INFO,
        LogLevel.WARN,
        LogLevel.ERROR,
        LogLevel.FATAL,
      ]);
    });

    it('should filter logs by minimum level', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
        minLevel: LogLevel.WARN,
      });

      logger.debug('Should not appear');
      logger.info('Should not appear');
      logger.warn('Should appear');
      logger.error('Should appear');
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.level)).toEqual([LogLevel.WARN, LogLevel.ERROR]);
    });

    it('should include base context in all logs', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
        baseContext: { env: 'test', version: '1.0.0' },
      });

      logger.info('Message 1', { specific: 'data' });
      logger.warn('Message 2');
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        env: 'test',
        version: '1.0.0',
        specific: 'data',
      });
      expect(logs[1].context).toMatchObject({
        env: 'test',
        version: '1.0.0',
      });
    });
  });

  describe('Secret Redaction', () => {
    it('should redact GitHub personal access tokens', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
      });

      logger.info(`Token: ${buildToken('gh' + 'p_', '1234567890abcdefghijklmnopqrstuvwxyz')}`, {
        token: buildToken('gh' + 'p_', 'abcdefghijklmnopqrstuvwxyz1234567890'),
      });
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(logs[0].message).not.toContain('ghp_');
      expect(logs[0].context?.token).toBe('[REDACTED]'); // 'token' is a sensitive field name
    });

    it('should redact GitHub OAuth tokens', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
      });

      logger.info(`Using token ${buildToken('gh' + 'o_', '1234567890abcdefghijklmnopqrstuvwxyz')}`);
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(logs[0].message).not.toContain('gho_');
    });

    it('should redact JWT tokens', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
      });

      const jwt = buildJwtToken();
      logger.info(`Bearer token: ${jwt}`);
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('[REDACTED_JWT]');
      expect(logs[0].message).not.toContain('eyJ');
    });

    it('should redact authorization headers', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
      });

      logger.info('Sending request', {
        headers: {
          Authorization: `Bearer ${buildToken('gh' + 'p_', 'secrettoken1234567890abcdefghijklmnopqrstuv')}`,
        },
      });
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      // 'Authorization' is a sensitive field name, so entire value is redacted
      expect(logs[0].context?.headers).toMatchObject({
        Authorization: '[REDACTED]',
      });
    });

    it('should redact sensitive field names', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
      });

      logger.info('Config loaded', {
        password: 'super-secret-password',
        api_key: 'redact-via-field-name',
        secret: 'ssh-secret-value',
        normal_field: 'visible',
      });
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context?.password).toBe('[REDACTED]');
      expect(logs[0].context?.api_key).toBe('[REDACTED]');
      expect(logs[0].context?.secret).toBe('[REDACTED]');
      expect(logs[0].context?.normal_field).toBe('visible');
    });

    it('should allow disabling redaction (for testing)', async () => {
      const logger = createLogger({
        component: 'test',
        runDir: tempDir,
        enableRedaction: false,
      });

      logger.info(`Token: ${buildToken('gh' + 'p_', '1234567890abcdefghijklmnopqrstuvwxyz')}`);
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('ghp_');
    });
  });

  describe('RedactionEngine', () => {
    it('should redact multiple secret types in one string', () => {
      const redactor = new RedactionEngine();
      const input =
        `Tokens: ${buildToken('gh' + 'p_', 'abc1234567890abcdefghijklmnopqrstuvwxyzABCD')} and ${buildToken(
          'gh' + 'o_',
          'xyz1234567890abcdefghijklmnopqrstuvwxyzXYZ'
        )}, JWT: eyJhbGc...`;
      const output = redactor.redact(input);

      expect(output).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(output).not.toContain('ghp_');
      expect(output).not.toContain('gho_');
    });

    it('should redact secrets in nested objects', () => {
      const redactor = new RedactionEngine();
      const input = {
        user: 'alice',
        credentials: {
          token: buildToken('gh' + 'p_', 'secret123456'),
          password: 'my-password',
        },
        data: [buildToken('gh' + 'p_', '1234567890abcdefghijklmnopqrstuvwxyz'), 'normal-value'],
      };

      const output = redactor.redactObject(input);

      // Field name 'credentials' is sensitive, so entire object redacted
      expect(output).toMatchObject({
        user: 'alice',
        credentials: '[REDACTED]',
        data: ['[REDACTED_GITHUB_TOKEN]', 'normal-value'],
      });
    });
  });

  describe('Child Logger', () => {
    it('should inherit parent context', async () => {
      const parent = createLogger({
        component: 'parent',
        runDir: tempDir,
        baseContext: { parent_key: 'parent_value' },
      });

      const child = parent.child({ child_key: 'child_value' });
      child.info('Child message');
      await child.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        parent_key: 'parent_value',
        child_key: 'child_value',
      });
    });
  });

  describe('Factory Functions', () => {
    it('should create CLI logger with correct defaults', async () => {
      const logger = createCliLogger('status', 'run-123', tempDir);
      logger.info('CLI command executed');
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].component).toBe('cli:status');
      expect(logs[0].run_id).toBe('run-123');
    });

    it('should create HTTP logger with correct defaults', async () => {
      const logger = createHttpLogger('github', 'run-456', tempDir);
      logger.debug('HTTP request sent');
      await logger.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].component).toBe('http:github');
      expect(logs[0].run_id).toBe('run-456');
    });
  });
});

// ============================================================================
// Metrics Tests
// ============================================================================

describe('MetricsCollector', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Metrics Collection', () => {
    it('should collect and flush counter metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'run-123');

      metrics.increment('test_counter', { label: 'value' }, 5);
      metrics.increment('test_counter', { label: 'value' }, 3);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('# TYPE codemachine_pipeline_test_counter counter');
      expect(content).toContain(
        'codemachine_pipeline_test_counter{label="value",run_id="run-123"} 8'
      );
    });

    it('should collect gauge metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.gauge('queue_depth', 42, { queue: 'main' });
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('# TYPE codemachine_pipeline_queue_depth gauge');
      expect(content).toContain('codemachine_pipeline_queue_depth{queue="main"} 42');
    });

    it('should collect histogram metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.observe('http_latency', 150, { endpoint: '/api/v1' });
      metrics.observe('http_latency', 350, { endpoint: '/api/v1' });
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('# TYPE codemachine_pipeline_http_latency_bucket histogram');
      expect(content).toContain(
        'codemachine_pipeline_http_latency_bucket{endpoint="/api/v1",le="250"} 1'
      );
      expect(content).toContain(
        'codemachine_pipeline_http_latency_bucket{endpoint="/api/v1",le="500"} 2'
      );
      expect(content).toContain('codemachine_pipeline_http_latency_sum{endpoint="/api/v1"} 500');
      expect(content).toContain('codemachine_pipeline_http_latency_count{endpoint="/api/v1"} 2');
    });
  });

  describe('Standard Metrics', () => {
    it('should record queue depth metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.recordQueueDepth(10, 20, 3);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('codemachine_pipeline_queue_pending_count 10');
      expect(content).toContain('codemachine_pipeline_queue_completed_count 20');
      expect(content).toContain('codemachine_pipeline_queue_failed_count 3');
      expect(content).toContain('codemachine_pipeline_queue_depth 33');
    });

    it('should record rate limit metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.recordRateLimit('github', 4500, 1734256800);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain(
        'codemachine_pipeline_rate_limit_remaining{provider="github"} 4500'
      );
      expect(content).toContain(
        'codemachine_pipeline_rate_limit_reset_timestamp{provider="github"} 1734256800'
      );
    });

    it('should record HTTP request metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.recordHttpRequest('github', '/repos/owner/repo', 200, 423, true);
      metrics.recordHttpRequest('github', '/repos/owner/repo', 500, 850, false);
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('codemachine_pipeline_http_requests_total');
      expect(content).toContain('codemachine_pipeline_http_request_duration_ms_sum');
      expect(content).toContain('codemachine_pipeline_http_errors_total');
    });

    it('should record token usage metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.recordTokenUsage(1500, 500, { model: 'gpt-4' });
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('codemachine_pipeline_token_usage_prompt{model="gpt-4"');
      expect(content).toContain('codemachine_pipeline_token_usage_completion{model="gpt-4"');
      expect(content).toContain('codemachine_pipeline_token_usage_total{model="gpt-4"');
    });
  });

  describe('Prometheus Format', () => {
    it('should format metrics with HELP and TYPE comments', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.increment('custom_counter', {}, 1, 'A custom counter metric');
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain(
        '# HELP codemachine_pipeline_custom_counter A custom counter metric'
      );
      expect(content).toContain('# TYPE codemachine_pipeline_custom_counter counter');
    });

    it('should escape label values', async () => {
      const metrics = createRunMetricsCollector(tempDir);

      metrics.gauge('test_metric', 1, { path: '/api/v1\nwith\\newline"quote' });
      await metrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await fs.readFile(metricsPath, 'utf-8');

      expect(content).toContain('path="/api/v1\\nwith\\\\newline\\"quote"');
    });
  });
});

// ============================================================================
// Trace Tests
// ============================================================================

describe('TraceManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Span Creation', () => {
    it('should create root span with trace ID', async () => {
      const traceManager = createRunTraceManager(tempDir, 'run-123');

      const span = traceManager.startSpan('test_operation');
      span.setAttribute('test_key', 'test_value');
      span.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('test_operation');
      expect(spans[0].traceId).toBeTruthy();
      expect(spans[0].spanId).toBeTruthy();
      expect(spans[0].attributes.test_key).toBe('test_value');
      expect(spans[0].attributes.run_id).toBe('run-123');
    });

    it('should create child spans with parent context', async () => {
      const traceManager = createRunTraceManager(tempDir);

      const parentSpan = traceManager.startSpan('parent');
      const childSpan = traceManager.startChildSpan('child', parentSpan.context);

      parentSpan.end();
      childSpan.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans).toHaveLength(2);
      expect(spans[0].traceId).toBe(spans[1].traceId); // Same trace
      expect(spans[1].parentSpanId).toBe(spans[0].spanId); // Child points to parent
    });

    it('should record span duration', async () => {
      const traceManager = createRunTraceManager(tempDir);

      const span = traceManager.startSpan('timed_operation');
      await new Promise((resolve) => setTimeout(resolve, 75)); // Wait for measurable duration
      span.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].duration).toBeGreaterThanOrEqual(50);
      const span0 = spans[0];
      if (span0.endTime == null) {
        throw new Error('endTime should not be null or undefined');
      }
      expect(span0.startTime).toBeLessThan(span0.endTime);
    });
  });

  describe('Span Attributes', () => {
    it('should attach default attributes to all spans', async () => {
      const traceManager = createRunTraceManager(tempDir, 'run-456');

      const span = traceManager.startSpan('test');
      span.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].attributes['service.name']).toBe('codemachine-pipeline');
      expect(spans[0].attributes.run_id).toBe('run-456');
    });

    it('should support different span kinds', async () => {
      const traceManager = createRunTraceManager(tempDir);

      const serverSpan = traceManager.startSpan('server_op', SpanKind.SERVER);
      const clientSpan = traceManager.startSpan('client_op', SpanKind.CLIENT);

      serverSpan.end();
      clientSpan.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].kind).toBe(SpanKind.SERVER);
      expect(spans[1].kind).toBe(SpanKind.CLIENT);
    });
  });

  describe('Span Events', () => {
    it('should record events within spans', async () => {
      const traceManager = createRunTraceManager(tempDir);

      const span = traceManager.startSpan('operation_with_events');
      span.addEvent('event_1', { detail: 'first' });
      span.addEvent('event_2', { detail: 'second' });
      span.end();

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].events).toHaveLength(2);
      expect(spans[0].events[0].name).toBe('event_1');
      expect(spans[0].events[1].name).toBe('event_2');
    });
  });

  describe('Span Status', () => {
    it('should record error status on exceptions', async () => {
      const traceManager = createRunTraceManager(tempDir);

      try {
        await withSpan(traceManager, 'failing_operation', async (span) => {
          span.setAttribute('attempt', 1);
          await Promise.resolve();
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
      expect(spans[0].status.message).toBe('Test error');
      expect(spans[0].attributes.error).toBe(true);
      expect(spans[0].attributes['error.message']).toBe('Test error');
    });

    it('should record OK status on success', async () => {
      const traceManager = createRunTraceManager(tempDir);

      await withSpan(traceManager, 'successful_operation', async (span) => {
        span.setAttribute('result', 'success');
        await Promise.resolve();
      });

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe('withSpan Helper', () => {
    it('should propagate return values', async () => {
      const traceManager = createRunTraceManager(tempDir);

      const result = await withSpan(traceManager, 'compute', async () => {
        await Promise.resolve();
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should create nested spans with parent context', async () => {
      const traceManager = createRunTraceManager(tempDir);

      await withSpan(traceManager, 'outer', async (outerSpan) => {
        outerSpan.setAttribute('level', 'outer');

        await withSpan(
          traceManager,
          'inner',
          async (innerSpan) => {
            innerSpan.setAttribute('level', 'inner');
            await Promise.resolve();
          },
          outerSpan.context
        );
      });

      await traceManager.flush();

      const tracesPath = path.join(tempDir, 'telemetry', 'traces.json');
      const spans = await readTraceFile(tracesPath);

      expect(spans).toHaveLength(2);
      // Inner span completes first, so appears first in NDJSON
      expect(spans[0].attributes.level).toBe('inner');
      expect(spans[1].attributes.level).toBe('outer');
      expect(spans[0].parentSpanId).toBe(spans[1].spanId);
    });
  });
});
