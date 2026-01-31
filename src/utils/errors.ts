import { ErrorType, HttpError } from '../adapters/http/client';
import { SerializedError } from '../core/sharedTypes';

/**
 * Error Handling Utilities
 *
 * Shared utilities for consistent error handling across the codebase.
 * Eliminates ~400 lines of duplicated error wrapping patterns.
 */

/**
 * Wraps an error with context, preserving original error information.
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   throw wrapError(error, 'Failed to perform risky operation');
 * }
 */
export function wrapError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`${context}: ${message}`);

  if (error instanceof Error) {
    wrapped.cause = error;
    if (error.stack !== undefined) {
      wrapped.stack = error.stack;
    }
  }

  return wrapped;
}

/**
 * Extracts error message from unknown error type.
 *
 * @param error - Unknown error object
 * @returns Human-readable error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Serializes error for logging/telemetry.
 *
 * @param error - Unknown error object
 * @returns Type-safe JSON-serializable error representation
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof HttpError) {
    try {
      const toJson = error.toJSON();
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        statusCode: error.statusCode,
        requestId: error.requestId,
        type: error.type,
        retryable: error.retryable,
        headers: error.headers ? (toJson.headers as Record<string, string>) : undefined,
        responseBody: error.responseBody ? (toJson.responseBody as string) : undefined,
        cause: error.cause ? serializeError(error.cause) : undefined,
      };
    } catch {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        statusCode: error.statusCode,
        requestId: error.requestId,
        type: error.type,
        retryable: error.retryable,
        cause: error.cause ? serializeError(error.cause) : undefined,
      };
    }
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }

  try {
    return { name: 'UnknownError', message: String(error) };
  } catch {
    return { name: 'UnknownError', message: '[unserializable error]' };
  }
}

/**
 * Classifies error type for retry/handling decisions.
 *
 * @param error - Unknown error object
 * @returns ErrorType classification (TRANSIENT, PERMANENT, HUMAN_ACTION_REQUIRED)
 */
export function classifyError(error: unknown): ErrorType {
  if (error instanceof HttpError) {
    return error.type;
  }

  // Network errors are transient
  if (error instanceof Error) {
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND')
    ) {
      return ErrorType.TRANSIENT;
    }
  }

  return ErrorType.PERMANENT;
}

export function createErrorNormalizer<T extends Error>(
  AdapterErrorClass: new (
    message: string,
    type: ErrorType,
    statusCode?: number,
    requestId?: string,
    operation?: string
  ) => T,
  adapterName: string
): (error: unknown, operation: string) => T {
  return (error: unknown, operation: string): T => {
    if (error instanceof AdapterErrorClass) {
      return error;
    }

    if (error instanceof HttpError) {
      return new AdapterErrorClass(
        `${adapterName} ${operation} failed: ${error.message}`,
        error.type,
        error.statusCode,
        error.requestId,
        operation
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return new AdapterErrorClass(
      `${adapterName} ${operation} failed: ${message}`,
      ErrorType.PERMANENT,
      undefined,
      undefined,
      operation
    );
  };
}
