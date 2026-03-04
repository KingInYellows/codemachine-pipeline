/**
 * Core HTTP Error Class
 *
 * Moved here from src/adapters/http/client.ts so that the utils layer can
 * reference HttpError without importing from the adapters layer, eliminating
 * the boundary violation identified in finding 125.
 */

import { ErrorType } from './sharedTypes.js';
import { RedactionEngine, REDACTED } from '../utils/redaction.js';

export { ErrorType };

const MAX_RESPONSE_BODY_SIZE = 2048;

function truncateStr(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}... (truncated)`;
}

function sanitizeHttpHeaders(headers: Record<string, string>): Record<string, string> {
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
