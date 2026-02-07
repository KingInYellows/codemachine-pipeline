/**
 * Schema Validation Helpers
 *
 * Generic utilities for validating unknown input against Zod schemas.
 * Provides two modes:
 *   - validateOrThrow: throws ValidationError on failure (for hard boundaries)
 *   - validateOrResult: returns a discriminated union (for soft boundaries)
 */

import type { ZodSchema, ZodError } from 'zod';
import { ValidationError, fromZodError } from './errors.js';

/**
 * Successful validation result.
 */
export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

/**
 * Failed validation result.
 */
export interface ValidationFailure {
  success: false;
  error: ValidationError;
}

/**
 * Discriminated union for validation outcomes.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validate input against a Zod schema. Throws ValidationError on failure.
 *
 * Use at hard boundaries where invalid input should halt execution
 * (e.g. config loading, webhook payloads).
 *
 * @param schema - Zod schema to validate against
 * @param input - Unknown input to validate
 * @param boundary - Label for the validation boundary (e.g. "config", "webhook")
 * @returns Typed, validated data
 * @throws ValidationError with structured issues
 */
export function validateOrThrow<T>(
  schema: ZodSchema<T>,
  input: unknown,
  boundary: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw fromZodError(boundary, result.error as ZodError);
}

/**
 * Validate input against a Zod schema. Returns a result union.
 *
 * Use at soft boundaries where validation failures should be handled
 * gracefully (e.g. AI output parsing, optional config sections).
 *
 * @param schema - Zod schema to validate against
 * @param input - Unknown input to validate
 * @param boundary - Label for the validation boundary
 * @returns Discriminated union with typed data or ValidationError
 */
export function validateOrResult<T>(
  schema: ZodSchema<T>,
  input: unknown,
  boundary: string,
): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: fromZodError(boundary, result.error as ZodError) };
}
