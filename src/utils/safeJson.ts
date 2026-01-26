/**
 * Safe JSON parsing utilities
 *
 * Provides safe JSON parsing with proper error handling to avoid
 * uncaught exceptions from malformed JSON content.
 */

/**
 * Result type for JSON parse operations
 */
export interface SafeJsonResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Safely parse JSON string with optional default value
 *
 * @param content - JSON string to parse
 * @param defaultValue - Optional default value if parsing fails
 * @returns Parsed value or default value
 *
 * @example
 * ```typescript
 * const data = safeJsonParse<User>(jsonString);
 * if (data) {
 *   console.log(data.name);
 * }
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
 * @param content - JSON string to parse
 * @returns Result object with success status and data or error
 *
 * @example
 * ```typescript
 * const result = safeJsonParseWithResult<Config>(jsonString);
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error('Parse failed:', result.error);
 * }
 * ```
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
 * @param content - JSON string to parse
 * @param validator - Validation function that returns true if data is valid
 * @param errorMessage - Custom error message for validation failures
 * @returns Result object with success status and data or error
 *
 * @example
 * ```typescript
 * const result = safeJsonParseValidated<User>(
 *   jsonString,
 *   (data) => typeof data.name === 'string' && typeof data.age === 'number',
 *   'Invalid user object'
 * );
 * ```
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
