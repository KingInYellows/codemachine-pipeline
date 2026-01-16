import { fetch, RequestInit, Response, HeadersInit, Headers } from 'undici';
import * as crypto from 'node:crypto';
import { RateLimitLedger, RateLimitEnvelope } from '../../telemetry/rateLimitLedger';

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

// ============================================================================
// Types & Constants
// ============================================================================

/**
 * Error taxonomy for structured error handling
 */
export enum ErrorType {
  /** Transient errors that should trigger retries (429, 503, network resets) */
  TRANSIENT = 'transient',
  /** Permanent errors that fail fast (validation, missing config, 404) */
  PERMANENT = 'permanent',
  /** Errors requiring human intervention (approval needed, token expired) */
  HUMAN_ACTION_REQUIRED = 'human_action_required',
}

/**
 * Structured HTTP error with metadata
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly type: ErrorType,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
    public readonly responseBody?: string,
    public readonly requestId?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, HttpError.prototype);
  }

  /**
   * Convert to JSON-serializable object for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      statusCode: this.statusCode,
      requestId: this.requestId,
      retryable: this.retryable,
      headers: this.headers ? sanitizeHeaders(this.headers) : undefined,
      responseBody: this.responseBody ? truncate(this.responseBody, 500) : undefined,
    };
  }
}

/**
 * HTTP provider type (GitHub, Linear, etc.)
 */
export enum Provider {
  GITHUB = 'github',
  LINEAR = 'linear',
  GRAPHITE = 'graphite',
  CODEMACHINE = 'codemachine',
  CUSTOM = 'custom',
}

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  /** Base URL for API requests */
  baseUrl: string;
  /** Provider type for rate limit tracking */
  provider: Provider;
  /** Authorization token (will be injected as Bearer token) */
  token?: string;
  /** Run directory path for ledger persistence */
  runDir?: string;
  /** Custom headers to inject on every request */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds */
  initialBackoff?: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoff?: number;
  /** Logger interface for observability */
  logger?: LoggerInterface;
}

/**
 * Logger interface for dependency injection
 */
export interface LoggerInterface {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * HTTP request options
 */
export interface HttpRequestOptions extends Omit<RequestInit, 'headers'> {
  /** Custom headers for this request */
  headers?: Record<string, string>;
  /** Whether to generate an idempotency key */
  idempotent?: boolean;
  /** Override retry behavior for this request */
  retry?: {
    enabled: boolean;
    maxAttempts?: number;
  };
  /** Request metadata for logging */
  metadata?: Record<string, unknown>;
}

/**
 * HTTP response wrapper
 */
export interface HttpResponse<T = unknown> {
  /** Response status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Parsed response body */
  data: T;
  /** Request ID for tracing */
  requestId: string;
  /** Rate limit envelope if applicable */
  rateLimitEnvelope?: RateLimitEnvelope;
}

// Default configuration values
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF = 1000; // 1 second
const DEFAULT_MAX_BACKOFF = 32000; // 32 seconds
const JITTER_FACTOR = 0.1; // 10% jitter

// Standard headers
const ACCEPT_HEADER = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';

// ============================================================================
// HTTP Client
// ============================================================================

/**
 * Unified HTTP client with rate limiting, retries, and structured errors
 */
export class HttpClient {
  private readonly config: Required<HttpClientConfig>;
  private readonly rateLimitLedger?: RateLimitLedger;
  private readonly logger: LoggerInterface;

  constructor(config: HttpClientConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      provider: config.provider,
      token: config.token ?? '',
      runDir: config.runDir ?? '',
      defaultHeaders: config.defaultHeaders ?? {},
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialBackoff: config.initialBackoff ?? DEFAULT_INITIAL_BACKOFF,
      maxBackoff: config.maxBackoff ?? DEFAULT_MAX_BACKOFF,
      logger: config.logger ?? createConsoleLogger(),
    };

    this.logger = this.config.logger;

    // Initialize rate limit ledger if run directory is provided
    if (this.config.runDir) {
      this.rateLimitLedger = new RateLimitLedger(
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
    return this.request<T>('POST', path, {
      ...options,
      body: JSON.stringify(body),
      idempotent: true, // POST requests get idempotency keys by default
    });
  }

  /**
   * Perform a PUT request
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, {
      ...options,
      body: JSON.stringify(body),
      idempotent: true,
    });
  }

  /**
   * Perform a PATCH request
   */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', path, {
      ...options,
      body: JSON.stringify(body),
      idempotent: true,
    });
  }

  /**
   * Perform a DELETE request
   */
  async delete<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, {
      ...options,
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

    const retryConfig = {
      enabled: options.retry?.enabled !== false,
      maxAttempts: options.retry?.maxAttempts ?? this.config.maxRetries,
    };

    let lastError: HttpError | undefined;
    const maxAttempts = retryConfig.enabled ? retryConfig.maxAttempts + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Log sanitized request metadata
        this.logger.debug('HTTP request', {
          method,
          url: sanitizeUrl(url),
          requestId,
          attempt: attempt + 1,
          maxAttempts,
          metadata: options.metadata,
        });

        const fetchOptions: RequestInit = {
          method,
          headers: headers as HeadersInit,
          signal: AbortSignal.timeout(this.config.timeout),
        };

        if (options.body) {
          fetchOptions.body = options.body;
        }

        const response = await fetch(url, fetchOptions);

        // Extract rate limit envelope
        const rateLimitEnvelope = this.extractRateLimitEnvelope(response, requestId);

        // Persist rate limit data if ledger is available
        if (rateLimitEnvelope && this.rateLimitLedger) {
          await this.rateLimitLedger.recordEnvelope(rateLimitEnvelope);
        }

        // Handle error responses
        if (!response.ok) {
          const error = await this.handleErrorResponse(response, requestId, rateLimitEnvelope);

          // Check if error is retryable
          if (error.retryable && attempt < maxAttempts - 1) {
            const backoffMs = this.calculateBackoff(attempt, rateLimitEnvelope);
            this.logger.warn('Retrying after error', {
              requestId,
              attempt: attempt + 1,
              backoffMs,
              errorType: error.type,
              statusCode: error.statusCode,
            });
            await sleep(backoffMs);
            lastError = error;
            continue;
          }

          throw error;
        }

        // Parse response body
        const data = await this.parseResponseBody<T>(response);

        // Log sanitized response metadata
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

        return result;
      } catch (error) {
        // Handle network errors and timeouts
        if (error instanceof HttpError) {
          throw error;
        }

        const networkError = this.handleNetworkError(error, requestId);

        if (networkError.retryable && attempt < maxAttempts - 1) {
          const backoffMs = this.calculateBackoff(attempt);
          this.logger.warn('Retrying after network error', {
            requestId,
            attempt: attempt + 1,
            backoffMs,
            errorMessage: networkError.message,
          });
          await sleep(backoffMs);
          lastError = networkError;
          continue;
        }

        throw networkError;
      }
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
      headers['X-GitHub-Api-Version'] = GITHUB_API_VERSION;
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
  private async parseResponseBody<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    // For non-JSON responses, return text as data
    const text = await response.text();
    return text as unknown as T;
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate unique request ID for tracing
 */
function generateRequestId(): string {
  return `req_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Generate idempotency key for request deduplication
 */
function generateIdempotencyKey(): string {
  return `idem_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Extract headers from Headers object to plain object
 */
function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Sanitize URL by removing query parameters that might contain secrets
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove sensitive query parameters
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('access_token');
    parsed.searchParams.delete('api_key');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize headers by redacting authorization and sensitive values
 */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey === 'authorization' ||
      lowerKey === 'x-api-key' ||
      lowerKey === 'cookie' ||
      lowerKey.includes('token')
    ) {
      sanitized[key] = '***REDACTED***';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Truncate string to maximum length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '... (truncated)';
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a basic console logger implementation
 */
function createConsoleLogger(): LoggerInterface {
  return {
    debug: (message: string, context?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.debug(`[DEBUG] ${message}`, context ? JSON.stringify(context) : '');
    },
    info: (message: string, context?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.info(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.warn(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
    },
    error: (message: string, context?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.error(`[ERROR] ${message}`, context ? JSON.stringify(context) : '');
    },
  };
}
