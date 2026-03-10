/**
 * Safe JSON parsing utilities
 *
 * Provides safe JSON parsing with proper error handling to avoid
 * uncaught exceptions from malformed JSON content.
 */

import * as fs from 'fs/promises';

/**
 * Result type for JSON parse operations
 */
export interface SafeJsonResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Extended result type for file-based JSON operations
 */
export interface SafeJsonFileResult<T> extends SafeJsonResult<T> {
  /** Whether the error was due to file not found (vs parse error) */
  fileNotFound?: boolean;
}

/**
 * Check if an error is a file-not-found error (ENOENT)
 *
 * Centralized utility to avoid duplicating this check across the codebase.
 *
 */
export function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Check if an error is a JSON parse error (SyntaxError)
 *
 */
export function isJsonParseError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError;
}

/**
 * Safely read and parse a JSON file
 *
 * Distinguishes between file-not-found errors and JSON parse errors,
 * returning appropriate results for each case.
 *
 *
 */
export async function safeJsonReadFile<T>(filePath: string): Promise<SafeJsonFileResult<T>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as T;
    return { success: true, data };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { success: false, fileNotFound: true, error: error.message };
    }
    if (isJsonParseError(error)) {
      return { success: false, error: `JSON parse error: ${error.message}` };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error reading file',
    };
  }
}

/**
 * Safely parse JSON string with optional default value
 *
 *
 *
 * // With default value
 * const config = safeJsonParse(jsonString, { enabled: false });
 * ```
 */
export function safeJsonParse<T>(content: string, defaultValue?: T): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely parse JSON string with detailed result
 *
 * Returns a result object with success status and either data or error message.
 * Useful when you need to handle errors explicitly.
 *
 *
 */
export function safeJsonParseWithResult<T>(content: string): SafeJsonResult<T> {
  try {
    const data = JSON.parse(content) as T;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown JSON parse error',
    };
  }
}

/**
 * Safely parse JSON from file content with validation
 *
 * Combines parsing with a validation function to ensure the parsed
 * data meets expected schema requirements.
 *
 *
 */
export function safeJsonParseValidated<T>(
  content: string,
  validator: (data: unknown) => data is T,
  errorMessage = 'Validation failed'
): SafeJsonResult<T> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (validator(parsed)) {
      return { success: true, data: parsed };
    }
    return { success: false, error: errorMessage };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown JSON parse error',
    };
  }
}
