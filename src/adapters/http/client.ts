import type { RequestInit, Response, HeadersInit } from 'undici-types';
import { RateLimitLedger, type RateLimitEnvelope } from '../../telemetry/rateLimitLedger';
import type { RateLimitRecorder } from './httpTypes.js';
export type { RateLimitRecorder } from './httpTypes.js';
import {
  ErrorType,
  Provider,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_BACKOFF,
  DEFAULT_MAX_BACKOFF,
  JITTER_FACTOR,
  ACCEPT_HEADER,
  GITHUB_API_VERSION,
} from './httpTypes.js';
import type { ZodSchema } from 'zod';
import { validateOrThrow } from '../../validation/helpers.js';
import type { HttpClientConfig, HttpRequestOptions, HttpResponse } from './httpTypes.js';
import type { LoggerInterface } from '../../telemetry/logger';
import { createConsoleLogger, LogLevel } from '../../telemetry/logger';
import {
  generateRequestId,
  generateIdempotencyKey,
  extractHeaders,
  sanitizeUrl,
  sleep,
} from './httpUtils.js';

/**
 * HTTP Client Module
 *
 * Unified HTTP client built on undici that:
 * - Injects standard headers (Accept, X-GitHub-Api-Version, Authorization, Idempotency-Key, tracing)
 * - Implements exponential backoff with jitter for retries
 * - Records rate-limit envelopes to run directory ledgers
 * - Surfaces structured errors with typed taxonomy (transient/permanent/human-action)
 * - Sanitizes sensitive data in logs for observability
 *
 * Implements Technology Stack requirements and Rate Limit Discipline from the Rulebook.
 */

// Re-export types and enums for backward compatibility
export { ErrorType, Provider } from './httpTypes.js';
export type { HttpClientConfig, HttpRequestOptions, HttpResponse } from './httpTypes.js';
export {
  generateRequestId,
  generateIdempotencyKey,
  extractHeaders,
  sanitizeUrl,
  sanitizeHeaders,
  truncate,
  sleep,
  SENSITIVE_HEADERS,
  SENSITIVE_KEYWORDS,
} from './httpUtils.js';

import { HttpError } from '../../core/errors.js';
export { HttpError } from '../../core/errors.js';

type AttemptResult<T> =
  | { ok: true; result: HttpResponse<T> }
  | { ok: false; error: HttpError; rateLimitEnvelope: RateLimitEnvelope | undefined };

/**
 * Unified HTTP client with rate limiting, retries, and structured errors
 */
export class HttpClient {
  private readonly config: Required<Omit<HttpClientConfig, 'rateLimitRecorder'>>;
  private readonly rateLimitRecorder?: RateLimitRecorder;
  private readonly logger: LoggerInterface;

  constructor(config: HttpClientConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      provider: config.provider,
      token: config.token ?? '',
      apiVersion: config.apiVersion ?? GITHUB_API_VERSION,
      runDir: config.runDir ?? '',
      defaultHeaders: config.defaultHeaders ?? {},
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialBackoff: config.initialBackoff ?? DEFAULT_INITIAL_BACKOFF,
      maxBackoff: config.maxBackoff ?? DEFAULT_MAX_BACKOFF,
      logger: config.logger ?? createConsoleLogger('http-client', LogLevel.DEBUG),
    };

    this.logger = this.config.logger;

    if (config.rateLimitRecorder) {
      this.rateLimitRecorder = config.rateLimitRecorder;
    } else if (this.config.runDir) {
      this.rateLimitRecorder = new RateLimitLedger(
        this.config.runDir,
        this.config.provider,
        this.logger
      );
    }
  }

  /**
   * Perform a GET request
   */
  async get<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  /**
   * Perform a POST request
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.mutationRequest<T>('POST', path, body, options);
  }

  /**
   * Perform a PUT request
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.mutationRequest<T>('PUT', path, body, options);
  }

  /**
   * Perform a PATCH request
   */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.mutationRequest<T>('PATCH', path, body, options);
  }

  /**
   * Perform a DELETE request
   */
  async delete<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, { ...options, idempotent: true });
  }

  private mutationRequest<T>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>(method, path, {
      ...options,
      body: JSON.stringify(body),
      idempotent: true,
    });
  }

  /**
   * Core request method with retry logic and error handling
   */
  private async request<T>(
    method: string,
    path: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = new URL(path, this.config.baseUrl).toString();
    const requestId = generateRequestId();
    const idempotencyKey = options.idempotent ? generateIdempotencyKey() : undefined;
    const headers = this.buildHeaders(requestId, idempotencyKey, options.headers);

    const retryEnabled = options.retry?.enabled !== false;
    const maxAttempts = retryEnabled
      ? (options.retry?.maxAttempts ?? this.config.maxRetries) + 1
      : 1;

    const baseFetchOptions: Omit<RequestInit, 'signal'> = {
      method,
      headers: headers as HeadersInit,
    };
    if (options.body) {
      baseFetchOptions.body = options.body;
    }

    let lastError: HttpError | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outcome = await this.executeOnce<T>(
        method,
        url,
        baseFetchOptions,
        requestId,
        attempt + 1,
        maxAttempts,
        options.metadata,
        options.schema
      );

      if (outcome.ok) return outcome.result;

      lastError = outcome.error;

      if (outcome.error.retryable && attempt < maxAttempts - 1) {
        const backoffMs = this.calculateBackoff(attempt, outcome.rateLimitEnvelope);
        const logMessage =
          outcome.error.statusCode !== undefined
            ? 'Retrying after error'
            : 'Retrying after network error';
        this.logger.warn(logMessage, {
          requestId,
          attempt: attempt + 1,
          backoffMs,
          errorType: outcome.error.type,
          statusCode: outcome.error.statusCode,
          errorMessage: outcome.error.message,
        });
        await sleep(backoffMs);
        continue;
      }

      throw outcome.error;
    }

    // Should never reach here, but TypeScript doesn't know that
    throw (
      lastError ??
      new HttpError(
        'Request failed after all retry attempts',
        ErrorType.TRANSIENT,
        undefined,
        undefined,
        undefined,
        requestId,
        false
      )
    );
  }

  /**
   * Execute a single HTTP attempt: fetch, extract rate limits, handle response.
   * Returns a discriminated union so the retry loop can decide what to do next.
   * A fresh AbortSignal timeout is created per attempt so retries get their own deadline.
   */
  private async executeOnce<T>(
    method: string,
    url: string,
    baseFetchOptions: Omit<RequestInit, 'signal'>,
    requestId: string,
    attemptNumber: number,
    maxAttempts: number,
    metadata?: Record<string, unknown>,
    schema?: ZodSchema<unknown>
  ): Promise<AttemptResult<T>> {
    this.logger.debug('HTTP request', {
      method,
      url: sanitizeUrl(url),
      requestId,
      attempt: attemptNumber,
      maxAttempts,
      metadata,
    });

    try {
      const fetchOptions: RequestInit = {
        ...baseFetchOptions,
        signal: AbortSignal.timeout(this.config.timeout),
      };

      const response = await fetch(url, fetchOptions);

      const rateLimitEnvelope = this.extractRateLimitEnvelope(response, requestId);
      if (rateLimitEnvelope && this.rateLimitRecorder) {
        await this.rateLimitRecorder.recordEnvelope(rateLimitEnvelope);
      }

      if (!response.ok) {
        const error = await this.handleErrorResponse(response, requestId, rateLimitEnvelope);
        return { ok: false, error, rateLimitEnvelope };
      }

      const data = await this.parseResponseBody<T>(response, schema);
      this.logger.debug('HTTP response', {
        requestId,
        status: response.status,
        rateLimitRemaining: rateLimitEnvelope?.remaining,
      });

      const result: HttpResponse<T> = {
        status: response.status,
        headers: extractHeaders(response.headers),
        data,
        requestId,
      };
      if (rateLimitEnvelope) {
        result.rateLimitEnvelope = rateLimitEnvelope;
      }

      return { ok: true, result };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      const networkError = this.handleNetworkError(error, requestId);
      return { ok: false, error: networkError, rateLimitEnvelope: undefined };
    }
  }

  /**
   * Build request headers with standard injections
   */
  private buildHeaders(
    requestId: string,
    idempotencyKey?: string,
    customHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      ...this.config.defaultHeaders,
    };

    // Provider-specific headers
    if (this.config.provider === Provider.GITHUB) {
      headers['Accept'] = ACCEPT_HEADER;
      headers['X-GitHub-Api-Version'] = this.config.apiVersion;
    }

    // Authorization
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    // Idempotency key
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    // Merge custom headers (can override defaults)
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

    return headers;
  }

  /**
   * Extract rate limit envelope from response headers
   */
  private extractRateLimitEnvelope(
    response: Response,
    requestId: string
  ): RateLimitEnvelope | undefined {
    const headers = response.headers;

    // GitHub rate limit headers
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const retryAfter = headers.get('retry-after');

    if (remaining !== null || reset !== null || retryAfter !== null) {
      const envelope: RateLimitEnvelope = {
        provider: this.config.provider,
        timestamp: new Date().toISOString(),
        requestId,
        endpoint: sanitizeUrl(response.url),
        statusCode: response.status,
      };

      if (remaining !== null) {
        envelope.remaining = parseInt(remaining, 10);
      }

      if (reset !== null) {
        envelope.reset = parseInt(reset, 10);
      }

      if (retryAfter !== null) {
        envelope.retryAfter = parseInt(retryAfter, 10);
      }

      return envelope;
    }

    return undefined;
  }

  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(
    response: Response,
    requestId: string,
    _rateLimitEnvelope?: RateLimitEnvelope
  ): Promise<HttpError> {
    const status = response.status;
    const headers = extractHeaders(response.headers);
    const body = await this.safeReadText(response);

    // Categorize error by status code
    if (status === 429) {
      // Rate limit hit - transient and retryable
      return new HttpError(
        'Rate limit exceeded',
        ErrorType.TRANSIENT,
        status,
        headers,
        body,
        requestId,
        true
      );
    }

    if (status === 503 || status === 502 || status === 504) {
      // Service unavailable - transient and retryable
      return new HttpError(
        'Service temporarily unavailable',
        ErrorType.TRANSIENT,
        status,
        headers,
        body,
        requestId,
        true
      );
    }

    if (status === 401 || status === 403) {
      // Authentication/authorization failure - human action required
      const message =
        status === 401
          ? 'Authentication failed - token may be missing or invalid'
          : 'Authorization failed - insufficient permissions';

      return new HttpError(
        message,
        ErrorType.HUMAN_ACTION_REQUIRED,
        status,
        headers,
        body,
        requestId,
        false
      );
    }

    if (status === 404) {
      // Not found - permanent error
      return new HttpError(
        'Resource not found',
        ErrorType.PERMANENT,
        status,
        headers,
        body,
        requestId,
        false
      );
    }

    if (status === 422) {
      // Validation error - permanent error
      return new HttpError(
        'Validation failed',
        ErrorType.PERMANENT,
        status,
        headers,
        body,
        requestId,
        false
      );
    }

    if (status >= 500) {
      // Server error - transient and retryable
      return new HttpError(
        'Server error',
        ErrorType.TRANSIENT,
        status,
        headers,
        body,
        requestId,
        true
      );
    }

    // Other 4xx errors - permanent
    return new HttpError(
      'Client error',
      ErrorType.PERMANENT,
      status,
      headers,
      body,
      requestId,
      false
    );
  }

  /**
   * Handle network-level errors
   */
  private handleNetworkError(error: unknown, requestId: string): HttpError {
    const message = error instanceof Error ? error.message : 'Unknown network error';

    // Timeout errors
    if (message.includes('timeout') || message.includes('aborted')) {
      return new HttpError(
        'Request timeout',
        ErrorType.TRANSIENT,
        undefined,
        undefined,
        undefined,
        requestId,
        true
      );
    }

    // Connection errors
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('ECONNRESET')
    ) {
      return new HttpError(
        'Network connection failed',
        ErrorType.TRANSIENT,
        undefined,
        undefined,
        undefined,
        requestId,
        true
      );
    }

    // Generic network error
    return new HttpError(
      `Network error: ${message}`,
      ErrorType.TRANSIENT,
      undefined,
      undefined,
      undefined,
      requestId,
      true
    );
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number, rateLimitEnvelope?: RateLimitEnvelope): number {
    // If retry-after header is present, use it
    if (rateLimitEnvelope?.retryAfter) {
      return rateLimitEnvelope.retryAfter * 1000; // Convert to milliseconds
    }

    // If rate limit reset time is available, calculate backoff until reset
    if (rateLimitEnvelope?.reset) {
      const resetMs = rateLimitEnvelope.reset * 1000;
      const nowMs = Date.now();
      const waitMs = Math.max(0, resetMs - nowMs);

      // Cap at max backoff
      return Math.min(waitMs, this.config.maxBackoff);
    }

    // Exponential backoff: initialBackoff * 2^attempt
    const exponentialBackoff = this.config.initialBackoff * Math.pow(2, attempt);
    const cappedBackoff = Math.min(exponentialBackoff, this.config.maxBackoff);

    // Add jitter to prevent thundering herd
    const jitter = cappedBackoff * JITTER_FACTOR * (Math.random() - 0.5);
    const backoffWithJitter = cappedBackoff + jitter;

    return Math.max(0, Math.round(backoffWithJitter));
  }

  /**
   * Parse response body as JSON
   */

  private async parseResponseBody<T>(response: Response, schema?: ZodSchema<unknown>): Promise<T> {
    const contentType = response.headers.get('content-type') ?? '';

    let parsed: unknown;
    if (contentType.includes('application/json')) {
      parsed = await response.json();
    } else {
      // No content-type or non-JSON: try JSON parsing first (many APIs omit the header),
      // fall back to text. Avoids the unsafe `as unknown as T` silent cast.
      const text = await this.safeReadText(response);
      if (!text) {
        parsed = undefined;
      } else {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new HttpError(
            `Non-JSON response with content type: ${contentType || '(none)'}`,
            ErrorType.PERMANENT,
            response.status,
            extractHeaders(response.headers),
            text,
            undefined,
            false
          );
        }
      }
    }

    if (schema) {
      try {
        return validateOrThrow(schema, parsed, 'http response') as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Schema validation failed';
        throw new HttpError(
          `Response schema validation failed: ${message}`,
          ErrorType.PERMANENT,
          response.status,
          extractHeaders(response.headers),
          JSON.stringify(parsed),
          undefined,
          false
        );
      }
    }
    return parsed as T;
  }

  /**
   * Safely read response text (catches errors)
   */
  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}
