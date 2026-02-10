/**
 * HTTP Client Utilities
 *
 * Helper functions for the HTTP client module.
 * Extracted from client.ts for single-responsibility.
 */

import type { Headers } from 'undici-types';
import type { LogContext } from '../../core/sharedTypes';
import * as crypto from 'node:crypto';
import {
  createLogger,
  type StructuredLogger,
  LogLevel,
} from '../../telemetry/logger';
import type { LoggerInterface } from '../../telemetry/logger';

// ============================================================================
// Sensitive Data Constants
// ============================================================================

export const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-csrf-token',
]);

export const SENSITIVE_KEYWORDS = ['token', 'secret', 'password', 'credential'];

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate unique request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Generate idempotency key for request deduplication
 */
export function generateIdempotencyKey(): string {
  return `idem_${crypto.randomBytes(16).toString('hex')}`;
}

// ============================================================================
// Header & URL Utilities
// ============================================================================

/**
 * Extract headers from Headers object to plain object
 */
export function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Sanitize URL by removing query parameters that might contain secrets
 */
export function sanitizeUrl(url: string): string {
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
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_HEADERS.has(lowerKey) || SENSITIVE_KEYWORDS.some((kw) => lowerKey.includes(kw))) {
      sanitized[key] = '***REDACTED***';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================================
// String & Timing Utilities
// ============================================================================

/**
 * Truncate string to maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '... (truncated)';
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Create a default logger implementation using StructuredLogger
 */
export function createConsoleLogger(): LoggerInterface {
  const logger: StructuredLogger = createLogger({
    component: 'http-client',
    minLevel: LogLevel.DEBUG,
    mirrorToStderr: true,
  });

  return {
    debug: (message: string, context?: LogContext) => {
      logger.debug(message, context);
    },
    info: (message: string, context?: LogContext) => {
      logger.info(message, context);
    },
    warn: (message: string, context?: LogContext) => {
      logger.warn(message, context);
    },
    error: (message: string, context?: LogContext) => {
      logger.error(message, context);
    },
  };
}
