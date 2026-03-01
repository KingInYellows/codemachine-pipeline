import type { LogContext } from '../../../core/sharedTypes.js';

/** Simple logger interface accepted by data-loading functions. */
export interface DataLogger {
  debug: (msg: string, meta?: LogContext) => void;
  info: (msg: string, meta?: LogContext) => void;
  warn: (msg: string, meta?: LogContext) => void;
}
