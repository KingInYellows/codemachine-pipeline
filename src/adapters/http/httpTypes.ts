/**
 * HTTP Client Types
 *
 * Type definitions, enums, and constants for the HTTP client module.
 * Extracted from client.ts for single-responsibility.
 */

import type { RequestInit } from 'undici-types';
import type { LoggerInterface } from '../../telemetry/logger';
import { Provider } from '../../core/sharedTypes.js';
export { ErrorType, Provider } from '../../core/sharedTypes.js';

// ============================================================================
// Enums
// ============================================================================

// ============================================================================
// Interfaces
// ============================================================================

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
  /** Intentional: request metadata for logging — varies per caller */
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
  rateLimitEnvelope?: import('../../telemetry/rateLimitLedger').RateLimitEnvelope;
}

// ============================================================================
// Constants
// ============================================================================

/** Default request timeout (30 seconds) */
export const DEFAULT_TIMEOUT = 30000;
/** Default maximum retry attempts */
export const DEFAULT_MAX_RETRIES = 3;
/** Default initial backoff delay (1 second) */
export const DEFAULT_INITIAL_BACKOFF = 1000;
/** Default maximum backoff delay (32 seconds) */
export const DEFAULT_MAX_BACKOFF = 32000;
/** Jitter factor for backoff (10%) */
export const JITTER_FACTOR = 0.1;
/** Standard Accept header for GitHub API */
export const ACCEPT_HEADER = 'application/vnd.github+json';
/** GitHub API version header value */
export const GITHUB_API_VERSION = '2022-11-28';
