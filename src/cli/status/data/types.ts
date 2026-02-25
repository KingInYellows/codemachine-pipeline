import type { LogContext } from '../../../core/sharedTypes.js';

/** Simple logger interface accepted by data-loading functions. */
export interface DataLogger {
  debug: (msg: string, meta?: LogContext) => void;
  info: (msg: string, meta?: LogContext) => void;
  warn: (msg: string, meta?: LogContext) => void;
}

/**
 * Log an unexpected file-read error if the error is not an ENOENT.
 *
 * ENOENT errors are expected (file simply doesn't exist yet) and are silently
 * swallowed.  Any other error is unexpected and should be logged as a warning.
 *
 * Replaces the repeated inline guard:
 *   if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') { ... }
 *
 * @param error   - The caught error value
 * @param logger  - Optional data logger
 * @param message - Human-readable warning message
 * @param context - Additional log context fields (e.g. path, error_code)
 */
export function logIfUnexpectedFileError(
  error: unknown,
  logger: DataLogger | undefined,
  message: string,
  context: LogContext
): void {
  if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
    logger?.warn(message, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    });
  }
}
