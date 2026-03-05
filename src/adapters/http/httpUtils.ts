/**
 * HTTP Client Utilities
 *
 * Helper functions for the HTTP client module.
 * Extracted from client.ts for single-responsibility.
 */

import type { Headers } from 'undici-types';
import * as crypto from 'node:crypto';
import { RedactionEngine, REDACTED } from '../../utils/redaction.js';

// ID Generation

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

// Header & URL Utilities

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
    for (const key of [...parsed.searchParams.keys()]) {
      if (RedactionEngine.isSensitiveUrlQueryParamName(key)) {
        parsed.searchParams.delete(key);
      } else if (RedactionEngine.isSensitiveFieldName(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
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
    if (RedactionEngine.isSensitiveFieldName(key)) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// String & Timing Utilities

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

// Logger Factory
