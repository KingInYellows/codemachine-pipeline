/**
 * Shared Types Module
 *
 * Centralized type definitions to improve type safety across the codebase.
 * Replaces generic `Record<string, unknown>` with specific interfaces where possible.
 *
 * Categories:
 * 1. SerializedError - Error serialization for logging/telemetry
 * 2. LogContext - Structured logging context
 */

// SerializedError Types

/**
 * Represents a serialized error for logging/telemetry purposes.
 * Provides type-safe access to common error properties.
 *
 * Note: Optional properties explicitly allow `undefined` to satisfy
 * `exactOptionalPropertyTypes` when properties may be conditionally assigned.
 */
export interface SerializedError {
  /** Error name/type (e.g., 'Error', 'HttpError') */
  name: string;
  /** Human-readable error message */
  message: string;
  /** Stack trace (if available) */
  stack?: string | undefined;
  /** HTTP status code (for HTTP errors) */
  statusCode?: number | undefined;
  /** Request ID for correlation (for HTTP errors) */
  requestId?: string | undefined;
  /** Nested cause error */
  cause?: SerializedError | undefined;
  /** Error type classification */
  type?: string | undefined;
  /** Operation that caused the error */
  operation?: string | undefined;
  /** Whether the error is retryable */
  retryable?: boolean | undefined;
  /** Sanitized response headers (for HTTP errors) */
  headers?: Record<string, string> | undefined;
  /** Truncated response body (for HTTP errors) */
  responseBody?: string | undefined;
}

// Error Types

/**
 * Error taxonomy for structured error handling.
 * Defined here (core layer) so utils and adapters can both depend on it
 * without creating circular imports.
 */
export enum ErrorType {
  /** Transient errors that should trigger retries (429, 503, network resets) */
  TRANSIENT = 'transient',
  /** Permanent errors that fail fast (validation, missing config, 404) */
  PERMANENT = 'permanent',
  /** Errors requiring human intervention (approval needed, token expired) */
  HUMAN_ACTION_REQUIRED = 'human_action_required',
}

// Provider Types

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
 * Type guard for SerializedError
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid SerializedError
 */
export function isSerializedError(value: unknown): value is SerializedError {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    code?: unknown;
    statusCode?: unknown;
    requestId?: unknown;
    type?: unknown;
    operation?: unknown;
    cause?: unknown;
    retryable?: unknown;
    headers?: unknown;
    responseBody?: unknown;
  };

  // Required fields
  if (typeof candidate.name !== 'string' || typeof candidate.message !== 'string') {
    return false;
  }

  // Optional fields type validation
  if (candidate.stack !== undefined && typeof candidate.stack !== 'string') {
    return false;
  }
  if (candidate.statusCode !== undefined && typeof candidate.statusCode !== 'number') {
    return false;
  }
  if (candidate.requestId !== undefined && typeof candidate.requestId !== 'string') {
    return false;
  }
  return (
    (candidate.type === undefined || typeof candidate.type === 'string') &&
    (candidate.operation === undefined || typeof candidate.operation === 'string') &&
    (candidate.cause === undefined || isSerializedError(candidate.cause)) &&
    (candidate.retryable === undefined || typeof candidate.retryable === 'boolean') &&
    (candidate.headers === undefined ||
      (candidate.headers !== null &&
        typeof candidate.headers === 'object' &&
        !Array.isArray(candidate.headers) &&
        Object.values(candidate.headers).every((value) => typeof value === 'string'))) &&
    (candidate.responseBody === undefined || typeof candidate.responseBody === 'string')
  );
}

// LogContext Types

/**
 * Common log context properties used across the codebase.
 *
 * Note: Optional properties explicitly allow `undefined` to satisfy
 * `exactOptionalPropertyTypes` when properties may be conditionally assigned.
 */
export interface CommonLogContext {
  /** Component identifier (e.g., 'http-client', 'queue') */
  component?: string | undefined;
  /** Operation being performed */
  operation?: string | undefined;
  /** Trace ID for request correlation */
  traceId?: string | undefined;
  /** Feature ID for run correlation */
  featureId?: string | undefined;
  /** Run directory path */
  runDir?: string | undefined;
  /** Task ID */
  taskId?: string | undefined;
  /** File path being processed */
  filePath?: string | undefined;
  /** HTTP status code */
  statusCode?: number | undefined;
  /** Duration in milliseconds */
  durationMs?: number | undefined;
  /** Retry attempt number */
  attempt?: number | undefined;
  /** Error details */
  error?: SerializedError | string | undefined;
}

/**
 * Log context type allowing both common properties and arbitrary additional fields.
 * This is intentionally flexible for logging purposes while providing autocomplete
 * for common properties. The `Record<string, unknown>` intersection means known
 * field types are advisory for IDE autocomplete, not enforced at compile time.
 */
export type LogContext = CommonLogContext & Record<string, unknown>;
