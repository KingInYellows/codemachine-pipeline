import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  HttpClient,
  HttpError,
  ErrorType,
  Provider,
  LoggerInterface,
} from '../../src/adapters/http/client';
import type { RateLimitLedgerData } from '../../src/telemetry/rateLimitLedger';

type MockedLogger = {
  [K in keyof LoggerInterface]: Mock;
};

/**
 * HTTP Client Unit Tests
 *
 * Tests cover:
 * - Header injection (Accept, X-GitHub-Api-Version, Authorization, Idempotency-Key, X-Request-ID)
 * - Retry logic with exponential backoff and jitter
 * - Rate limit envelope extraction and ledger persistence
 * - Error taxonomy (transient, permanent, human-action-required)
 * - Request/response sanitization for logging
 * - Timeout handling
 */

describe('HttpClient', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;
  let testRunDir: string;
  let mockLogger: MockedLogger;
  const captureReplyHeaders = (opts: { headers?: unknown }): Record<string, string> => {
    if (Array.isArray(opts.headers)) {
      const headersObj: Record<string, string> = {};
      for (let i = 0; i < opts.headers.length; i += 2) {
        headersObj[opts.headers[i] as string] = opts.headers[i + 1] as string;
      }
      return headersObj;
    }
    return (opts.headers as Record<string, string>) ?? {};
  };

  beforeEach(async () => {
    // Setup mock agent for undici
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    originalDispatcher = getGlobalDispatcher();
    setGlobalDispatcher(mockAgent);

    // Create temporary run directory for tests
    testRunDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-client-test-'));

    // Create mock logger with spies
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(async () => {
    // Restore original dispatcher
    setGlobalDispatcher(originalDispatcher);

    // Cleanup test run directory
    try {
      await fs.rm(testRunDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Header Injection', () => {
    it('should inject standard headers for GitHub API', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        token: 'test-token',
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      // Capture request headers
      let capturedHeaders: Record<string, string> = {};

      pool
        .intercept({
          path: '/repos/test/repo',
          method: 'GET',
        })
        .reply((opts) => {
          capturedHeaders = captureReplyHeaders(opts);

          return {
            statusCode: 200,
            data: { message: 'success' },
            headers: {
              'content-type': 'application/json',
            },
          };
        });

      await client.get('/repos/test/repo');

      // Verify headers (headers may be lowercase)
      expect(capturedHeaders['accept'] || capturedHeaders['Accept']).toBe(
        'application/vnd.github+json'
      );
      expect(
        capturedHeaders['x-github-api-version'] || capturedHeaders['X-GitHub-Api-Version']
      ).toBe('2022-11-28');
      expect(capturedHeaders['authorization'] || capturedHeaders['Authorization']).toBe(
        'Bearer test-token'
      );
      expect(capturedHeaders['x-request-id'] || capturedHeaders['X-Request-ID']).toMatch(
        /^req_[a-f0-9]{32}$/
      );
      expect(capturedHeaders['content-type'] || capturedHeaders['Content-Type']).toBe(
        'application/json'
      );
    });

    it('should use configured GitHub API version header when provided', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        token: 'test-token',
        apiVersion: '2024-01-15',
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      let capturedHeaders: Record<string, string> = {};

      pool
        .intercept({
          path: '/repos/test/repo',
          method: 'GET',
        })
        .reply((opts) => {
          capturedHeaders = captureReplyHeaders(opts);

          return {
            statusCode: 200,
            data: { message: 'success' },
            headers: {
              'content-type': 'application/json',
            },
          };
        });

      await client.get('/repos/test/repo');

      expect(
        capturedHeaders['x-github-api-version'] || capturedHeaders['X-GitHub-Api-Version']
      ).toBe('2024-01-15');
    });

    it('should inject idempotency key for POST requests', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        token: 'test-token',
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      let capturedHeaders: Record<string, string> = {};

      pool
        .intercept({
          path: '/repos/test/repo/issues',
          method: 'POST',
        })
        .reply((opts) => {
          capturedHeaders = captureReplyHeaders(opts);

          return {
            statusCode: 201,
            data: { id: 1 },
            headers: {
              'content-type': 'application/json',
            },
          };
        });

      await client.post('/repos/test/repo/issues', { title: 'Test Issue' });

      const idempotencyKey =
        capturedHeaders['idempotency-key'] || capturedHeaders['Idempotency-Key'];
      expect(idempotencyKey).toBeDefined();
      expect(idempotencyKey).toMatch(/^idem_[a-f0-9]{32}$/);
    });

    it('should allow custom headers to override defaults', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      let capturedHeaders: Record<string, string> = {};

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply((opts) => {
          capturedHeaders = captureReplyHeaders(opts);

          return {
            statusCode: 200,
            data: {},
            headers: {
              'content-type': 'application/json',
            },
          };
        });

      await client.get('/test', {
        headers: {
          'X-Custom-Header': 'custom-value',
          Accept: 'application/json', // Override default
        },
      });

      expect(capturedHeaders['x-custom-header'] || capturedHeaders['X-Custom-Header']).toBe(
        'custom-value'
      );
      expect(capturedHeaders['accept'] || capturedHeaders['Accept']).toBe('application/json');
    });
  });

  describe('Rate Limit Handling', () => {
    it('should extract rate limit envelope from response headers', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        runDir: testRunDir,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          200,
          { data: 'test' },
          {
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-remaining': '4999',
              'x-ratelimit-reset': '1234567890',
            },
          }
        );

      const response = await client.get('/test');

      expect(response.rateLimitEnvelope).toBeDefined();
      expect(response.rateLimitEnvelope?.remaining).toBe(4999);
      expect(response.rateLimitEnvelope?.reset).toBe(1234567890);
      expect(response.rateLimitEnvelope?.provider).toBe(Provider.GITHUB);
    });

    it('should persist rate limit envelope to ledger file', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        runDir: testRunDir,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          200,
          { data: 'test' },
          {
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-remaining': '100',
              'x-ratelimit-reset': '1234567890',
            },
          }
        );

      await client.get('/test');

      // Wait for async ledger write
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify ledger file was created
      const ledgerPath = path.join(testRunDir, 'rate_limits.json');
      const ledgerExists = await fs
        .access(ledgerPath)
        .then(() => true)
        .catch(() => false);
      expect(ledgerExists).toBe(true);

      // Verify ledger content
      const ledgerContent = await fs.readFile(ledgerPath, 'utf-8');
      const ledgerRaw: unknown = JSON.parse(ledgerContent);
      const ledger = ledgerRaw as RateLimitLedgerData;

      expect(ledger.schema_version).toBe('1.0.0');
      expect(ledger.providers.github).toBeDefined();
      expect(ledger.providers.github.state.remaining).toBe(100);
      expect(ledger.providers.github.state.reset).toBe(1234567890);
    });

    it('should retry on 429 rate limit with retry-after header', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 2,
        initialBackoff: 10,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      // First request returns 429 with retry-after
      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          429,
          { message: 'Rate limit exceeded' },
          {
            headers: {
              'content-type': 'application/json',
              'retry-after': '1', // 1 second
              'x-ratelimit-remaining': '0',
            },
          }
        );

      // Second request succeeds
      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          200,
          { data: 'success' },
          {
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-remaining': '4999',
            },
          }
        );

      const response = await client.get('/test');

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ data: 'success' });

      // Verify retry was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Retrying after error',
        expect.objectContaining({
          errorType: ErrorType.TRANSIENT,
          statusCode: 429,
        })
      );
    });
  });

  describe('Error Handling and Taxonomy', () => {
    it('should classify 429 as TRANSIENT error', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 0, // No retries for this test
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          429,
          { message: 'Rate limit exceeded' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      try {
        await client.get('/test');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.type).toBe(ErrorType.TRANSIENT);
        expect(httpError.statusCode).toBe(429);
        expect(httpError.retryable).toBe(true);
      }
    });

    it('should classify 401 as HUMAN_ACTION_REQUIRED error', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          401,
          { message: 'Bad credentials' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      try {
        await client.get('/test');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.type).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
        expect(httpError.statusCode).toBe(401);
        expect(httpError.retryable).toBe(false);
        expect(httpError.message).toContain('Authentication failed');
      }
    });

    it('should classify 404 as PERMANENT error', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          404,
          { message: 'Not Found' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      try {
        await client.get('/test');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.type).toBe(ErrorType.PERMANENT);
        expect(httpError.statusCode).toBe(404);
        expect(httpError.retryable).toBe(false);
      }
    });

    it('should classify 503 as TRANSIENT error', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 0,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          503,
          { message: 'Service Unavailable' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      try {
        await client.get('/test');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.type).toBe(ErrorType.TRANSIENT);
        expect(httpError.retryable).toBe(true);
      }
    });
  });

  describe('Retry Logic', () => {
    it('should implement exponential backoff with jitter', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 3,
        initialBackoff: 100,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      // Fail three times, then succeed
      for (let i = 0; i < 3; i++) {
        pool
          .intercept({
            path: '/test',
            method: 'GET',
          })
          .reply(503, { message: 'Service Unavailable' });
      }

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          200,
          { data: 'success' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      const startTime = Date.now();
      const response = await client.get('/test');
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);

      // Verify backoff happened (should take at least: 100 + 200 + 400 = 700ms)
      // Allow margin for jitter
      expect(duration).toBeGreaterThan(600);

      // Verify retries were logged
      expect(mockLogger.warn).toHaveBeenCalledTimes(3);
    });

    it('should respect max retries', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 2,
        initialBackoff: 10,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      // Always fail
      for (let i = 0; i < 10; i++) {
        pool
          .intercept({
            path: '/test',
            method: 'GET',
          })
          .reply(503, { message: 'Service Unavailable' });
      }

      await expect(client.get('/test')).rejects.toThrow(HttpError);

      // Should retry 2 times (3 total attempts)
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on permanent errors', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        maxRetries: 3,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(404, { message: 'Not Found' });

      await expect(client.get('/test')).rejects.toThrow(HttpError);

      // Should not retry
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Request Sanitization', () => {
    it('should sanitize authorization headers in logs', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.github.com',
        provider: Provider.GITHUB,
        token: 'secret-token-12345',
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.github.com');

      pool
        .intercept({
          path: '/test',
          method: 'GET',
        })
        .reply(
          401,
          { message: 'Unauthorized' },
          {
            headers: {
              'www-authenticate': 'Bearer',
              authorization: 'Bearer should-be-redacted',
            },
          }
        );

      try {
        await client.get('/test');
        expect.fail('Should have thrown error');
      } catch (error) {
        const httpError = error as HttpError;
        const jsonError = httpError.toJSON();

        // Verify response headers are sanitized when they contain auth data
        expect(jsonError.headers).toBeDefined();
        const headers = jsonError.headers as Record<string, string>;

        // Response may include auth headers that should be redacted
        if (headers['authorization'] || headers['Authorization']) {
          const authHeader = headers['authorization'] || headers['Authorization'];
          expect(authHeader).toBe('[REDACTED]');
        } else {
          // If no auth header in response, verify error at least has headers
          expect(headers).toBeDefined();
          expect(httpError.statusCode).toBe(401);
        }
      }
    });

    it('should redact set-cookie, proxy-authorization, and secret-bearing headers', () => {
      const error = new HttpError('Bad Gateway', ErrorType.TRANSIENT, 502, {
        'content-type': 'application/json',
        'set-cookie': 'session=abc123; HttpOnly; Secure',
        'proxy-authorization': 'Basic dXNlcjpwYXNz',
        'x-csrf-token': 'csrf-value-here',
        'x-custom-secret': 'my-secret-value',
        'x-request-id': 'req-999',
        authorization: 'Bearer tok-redact-me',
      });

      const json = error.toJSON();
      const headers = json.headers as Record<string, string>;

      // These must be redacted
      expect(headers['set-cookie']).toBe('[REDACTED]');
      expect(headers['proxy-authorization']).toBe('[REDACTED]');
      expect(headers['x-csrf-token']).toBe('[REDACTED]');
      expect(headers['x-custom-secret']).toBe('[REDACTED]');
      expect(headers['authorization']).toBe('[REDACTED]');

      // These must be preserved
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-request-id']).toBe('req-999');
    });

    it('should sanitize URLs with tokens in query parameters', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        provider: Provider.CUSTOM,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.example.com');

      pool
        .intercept({
          path: '/test?access_token=secret123',
          method: 'GET',
        })
        .reply(
          200,
          { data: 'test' },
          {
            headers: {
              'content-type': 'application/json',
            },
          }
        );

      await client.get('/test?access_token=secret123');

      // Verify URL was sanitized in logs
      const debugCalls = getMockCalls<[string, Record<string, unknown>]>(mockLogger.debug);
      const requestLog = debugCalls.find(([message]) => message === 'HTTP request');
      expect(requestLog).toBeDefined();

      if (!requestLog) {
        throw new Error('HTTP request log entry missing');
      }

      const [, context] = requestLog;
      expect(isRecord(context)).toBe(true);

      if (!isRecord(context) || typeof context.url !== 'string') {
        throw new Error('HTTP request context missing url field');
      }

      expect(context.url).not.toContain('secret123');
    });
  });

  describe('HTTP Methods', () => {
    it('should support GET requests', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.test.com',
        provider: Provider.CUSTOM,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.test.com');

      pool
        .intercept({
          path: '/data',
          method: 'GET',
        })
        .reply(
          200,
          { result: 'success' },
          {
            headers: { 'content-type': 'application/json' },
          }
        );

      const response = await client.get('/data');

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ result: 'success' });
    });

    it('should support POST requests with body', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.test.com',
        provider: Provider.CUSTOM,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.test.com');

      let capturedBody: string | undefined;

      pool
        .intercept({
          path: '/items',
          method: 'POST',
        })
        .reply((opts) => {
          capturedBody = opts.body as string;
          return {
            statusCode: 201,
            data: { id: 1 },
            headers: { 'content-type': 'application/json' },
          };
        });

      await client.post('/items', { name: 'Test Item' });

      expect(capturedBody).toBe(JSON.stringify({ name: 'Test Item' }));
    });

    it('should support PUT, PATCH, and DELETE methods', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.test.com',
        provider: Provider.CUSTOM,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.test.com');

      // PUT
      pool
        .intercept({ path: '/items/1', method: 'PUT' })
        .reply(200, { updated: true }, { headers: { 'content-type': 'application/json' } });

      // PATCH
      pool
        .intercept({ path: '/items/1', method: 'PATCH' })
        .reply(200, { patched: true }, { headers: { 'content-type': 'application/json' } });

      // DELETE
      pool.intercept({ path: '/items/1', method: 'DELETE' }).reply(204, '', { headers: {} });

      const putResponse = await client.put('/items/1', { name: 'Updated' });
      const patchResponse = await client.patch('/items/1', { name: 'Patched' });
      const deleteResponse = await client.delete('/items/1');

      expect(putResponse.status).toBe(200);
      expect(patchResponse.status).toBe(200);
      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout requests after configured duration', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.test.com',
        provider: Provider.CUSTOM,
        timeout: 100, // 100ms timeout
        maxRetries: 0,
        logger: mockLogger,
      });

      const pool = mockAgent.get('https://api.test.com');

      pool
        .intercept({
          path: '/slow',
          method: 'GET',
        })
        .reply(() => {
          return new Promise(() => {
            // Never resolve - simulate hanging request
          });
        });

      await expect(client.get('/slow')).rejects.toThrow(HttpError);

      try {
        await client.get('/slow');
      } catch (error) {
        const httpError = error as HttpError;
        expect(httpError.type).toBe(ErrorType.TRANSIENT);
        expect(httpError.retryable).toBe(true);
      }
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getMockCalls<TArgs extends unknown[]>(mockFn: Mock): TArgs[] {
  return mockFn.mock.calls as TArgs[];
}
