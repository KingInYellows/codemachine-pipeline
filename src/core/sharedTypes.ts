/**
 * Shared Types Module
 *
 * Centralized type definitions to improve type safety across the codebase.
 * Replaces generic `Record<string, unknown>` with specific interfaces where possible.
 *
 * Implements CDMCH-49: Improve type safety - reduce Record<string, unknown>
 *
 * Categories:
 * 1. SerializedError - Error serialization for logging/telemetry
 * 2. LogContext - Structured logging context
 * 3. EntityMetadata - Domain model metadata
 * 4. Type guards - Runtime validation with proper narrowing
 */

// ============================================================================
// SerializedError Types
// ============================================================================

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
  cause?: SerializedError | { error: string } | undefined;
  /** Error type classification */
  type?: string | undefined;
  /** Operation that caused the error */
  operation?: string | undefined;
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

  const candidate = value as Record<string, unknown>;

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
  if (candidate.type !== undefined && typeof candidate.type !== 'string') {
    return false;
  }
  if (candidate.operation !== undefined && typeof candidate.operation !== 'string') {
    return false;
  }
  if (candidate.cause !== undefined && typeof candidate.cause !== 'object') {
    return false;
  }

  return true;
}

// ============================================================================
// LogContext Types
// ============================================================================

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
 * for common properties.
 */
export type LogContext = CommonLogContext & Record<string, unknown>;

/**
 * Type guard for LogContext
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid LogContext (object, not array, not null)
 */
export function isLogContext(value: unknown): value is LogContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return true;
}

/**
 * Factory function for creating typed log context.
 * Provides IDE autocomplete while accepting arbitrary additional fields.
 *
 * @param context - Log context with known and unknown fields
 * @returns Typed LogContext
 */
export function createLogContext(context: LogContext): LogContext {
  return context;
}

// ============================================================================
// EntityMetadata Types
// ============================================================================

/**
 * Common metadata properties for domain entities.
 *
 * Note: Optional properties explicitly allow `undefined` to satisfy
 * `exactOptionalPropertyTypes` when properties may be conditionally assigned.
 */
export interface CommonMetadataFields {
  /** User or system that created the entity */
  createdBy?: string | undefined;
  /** Source system or integration */
  source?: string | undefined;
  /** Version number */
  version?: number | undefined;
  /** Tags for categorization */
  tags?: string[] | undefined;
  /** External reference ID */
  externalId?: string | undefined;
  /** Parent entity ID */
  parentId?: string | undefined;
}

/**
 * Entity metadata type allowing both common properties and arbitrary additional fields.
 * Used for `metadata` fields in domain models.
 */
export type EntityMetadata = CommonMetadataFields & Record<string, unknown>;

/**
 * Type guard for EntityMetadata
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid EntityMetadata (object, not array, not null)
 */
export function isEntityMetadata(value: unknown): value is EntityMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return true;
}

/**
 * Merges multiple metadata objects, with later objects taking precedence.
 *
 * @param base - Base metadata
 * @param override - Override metadata (takes precedence)
 * @returns Merged metadata
 */
export function mergeMetadata(
  base: EntityMetadata | undefined,
  override: EntityMetadata | undefined
): EntityMetadata {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

// ============================================================================
// Generic Type Guards
// ============================================================================

/**
 * Type guard for checking if a value is a non-null object.
 * Useful for narrowing `unknown` to `Record<string, unknown>` for further checks.
 *
 * @param value - Unknown value to check
 * @returns True if value is a non-null object (not array)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard for checking if a value is a string.
 *
 * @param value - Unknown value to check
 * @returns True if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for checking if a value is a number.
 *
 * @param value - Unknown value to check
 * @returns True if value is a number (not NaN)
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Type guard for checking if a value is a boolean.
 *
 * @param value - Unknown value to check
 * @returns True if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
