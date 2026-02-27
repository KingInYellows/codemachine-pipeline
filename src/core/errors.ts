/**
 * Core HTTP Error Class
 *
 * Moved here from src/adapters/http/client.ts so that the utils layer can
 * reference HttpError without importing from the adapters layer, eliminating
 * the boundary violation identified in finding 125.
 */

import { ErrorType } from './sharedTypes.js';

export { ErrorType };

const MAX_RESPONSE_BODY_SIZE = 2048;

const SENSITIVE_HTTP_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-csrf-token',
]);

const SENSITIVE_KEYWORDS = ['token', 'secret', 'password', 'credential'];

function truncateStr(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}... (truncated)`;
}

function sanitizeHttpHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_HTTP_HEADERS.has(lowerKey) ||
      SENSITIVE_KEYWORDS.some((kw) => lowerKey.includes(kw))
    ) {
      sanitized[key] = '***REDACTED***';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly type: ErrorType,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
    responseBody?: string,
    public readonly requestId?: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'HttpError';
    this.responseBody = responseBody
      ? truncateStr(responseBody, MAX_RESPONSE_BODY_SIZE)
      : undefined;
    Object.setPrototypeOf(this, HttpError.prototype);
  }

  public readonly responseBody: string | undefined;

  toJSON(): {
    name: string;
    message: string;
    type: ErrorType;
    statusCode?: number | undefined;
    requestId?: string | undefined;
    retryable: boolean;
    headers?: Record<string, string> | undefined;
    responseBody?: string | undefined;
  } {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      statusCode: this.statusCode,
      requestId: this.requestId,
      retryable: this.retryable,
      headers: this.headers ? sanitizeHttpHeaders(this.headers) : undefined,
      responseBody: this.responseBody ? truncateStr(this.responseBody, 500) : undefined,
    };
  }
}
