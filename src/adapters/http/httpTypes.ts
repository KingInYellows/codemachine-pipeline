/**
 * HTTP Client Types
 *
 * Type definitions, enums, and constants for the HTTP client module.
 * Extracted from client.ts for single-responsibility.
 */

import type { RequestInit } from 'undici-types';
import type { ZodSchema } from 'zod';
import type { LoggerInterface } from '../../telemetry/logger';
import { Provider } from '../../core/sharedTypes.js';
export { ErrorType, Provider } from '../../core/sharedTypes.js';

/**
 * Minimal interface for recording rate-limit envelopes.
 * Allows HttpClient to accept an injected recorder instead of directly
 * instantiating RateLimitLedger, decoupling the transport layer from telemetry.
 */
export interface RateLimitRecorder {
  recordEnvelope(
    envelope: import('../../telemetry/rateLimitLedger').RateLimitEnvelope
  ): Promise<void>;
}

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  baseUrl: string;
  provider: Provider;
  token?: string;
  /** Provider API version header value (used for GitHub's X-GitHub-Api-Version) */
  apiVersion?: string;
  runDir?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  initialBackoff?: number;
  maxBackoff?: number;
  logger?: LoggerInterface;
  /** Optional rate-limit recorder; if omitted a RateLimitLedger is created from runDir */
  rateLimitRecorder?: RateLimitRecorder;
}

/**
 * HTTP request options
 */
export interface HttpRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  idempotent?: boolean;
  retry?: {
    enabled: boolean;
    maxAttempts?: number;
  };
  /** Intentional: request metadata for logging — varies per caller */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: request metadata for logging varies per caller
  metadata?: Record<string, unknown>;
  /** Optional Zod schema to validate the parsed response body */
  schema?: ZodSchema<unknown>;
}

/**
 * HTTP response wrapper
 */
export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
  requestId: string;
  /** Rate limit envelope if applicable */
  rateLimitEnvelope?: import('../../telemetry/rateLimitLedger').RateLimitEnvelope;
}

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
/** Default GitHub API version; overridden by GitHubAdapterConfig.apiVersion when provided */
export const GITHUB_API_VERSION = '2022-11-28';
