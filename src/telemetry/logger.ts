import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LogContext } from '../core/sharedTypes';
import { RedactionEngine } from '../utils/redaction.js';
export { RedactionEngine, type RedactionReport } from '../utils/redaction.js';

/**
 * Structured Logger
 *
 * Provides consistent JSON-line logging with:
 * - Log levels (debug, info, warn, error, fatal)
 * - Structured context fields (run_id, component, trace_id)
 * - Secret redaction (GitHub tokens, API keys, JWTs)
 * - NDJSON file persistence + optional stderr mirroring
 * - Integration with run directory structure
 *
 * Includes automatic secret redaction for tokens and API keys.
 */

/**
 * Log severity levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * Structured log entry schema
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Severity level */
  level: LogLevel;
  /** Run identifier (feature_id) */
  run_id?: string;
  /** Component identifier (e.g., http-client, queue, cli) */
  component: string;
  /** Trace ID for correlation */
  trace_id?: string;
  /** Event name or message */
  message: string;
  /** Structured context data */
  context?: LogContext;
  /** Optional error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger interface (compatible with existing rateLimitLedger)
 * Uses LogContext for better autocomplete of common fields while remaining flexible.
 */
export interface LoggerInterface {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Run directory path */
  runDir?: string;
  /** Component identifier */
  component: string;
  /** Run ID (feature_id) */
  runId?: string;
  /** Trace ID for correlation */
  traceId?: string;
  /** Minimum log level to emit */
  minLevel?: LogLevel;
  /** Enable stderr mirroring (for interactive feedback) */
  mirrorToStderr?: boolean;
  /** Enable redaction (default: true) */
  enableRedaction?: boolean;
  /** Base context attached to all log entries */
  baseContext?: LogContext;
}

/**
 * Structured logger with NDJSON file output and optional stderr mirroring
 */
export class StructuredLogger implements LoggerInterface {
  private readonly options: Required<LoggerOptions>;
  private readonly redactor: RedactionEngine;
  private readonly logFilePath?: string;
  private writeQueue: Promise<void> = Promise.resolve();
  /** Pending log entries that failed to persist to disk - used as fallback storage */
  private pendingLogs: string[] = [];
  /** Flag indicating if disk writes are currently failing */
  private diskWritesFailing = false;
  /** Maximum number of pending logs to keep in memory before dropping oldest */
  private static readonly MAX_PENDING_LOGS = 1000;

  constructor(options: LoggerOptions) {
    this.options = {
      runDir: options.runDir ?? '',
      component: options.component,
      runId: options.runId ?? '',
      traceId: options.traceId ?? '',
      minLevel: options.minLevel ?? LogLevel.INFO,
      mirrorToStderr: options.mirrorToStderr ?? false,
      enableRedaction: options.enableRedaction ?? true,
      baseContext: options.baseContext ?? {},
    };

    this.redactor = new RedactionEngine(this.options.enableRedaction);

    // Determine log file path if run directory is provided
    if (this.options.runDir) {
      this.logFilePath = path.join(this.options.runDir, 'logs', 'logs.ndjson');
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.log(LogLevel.FATAL, message, context);
  }

  /**
   * Log with explicit error object
   */
  logError(level: LogLevel, message: string, error: Error, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    this.log(level, message, errorContext);
  }

  /**
   * Core logging implementation
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    // Check minimum level
    if (!this.shouldLog(level)) {
      return;
    }

    // Build log entry
    const entry = this.buildLogEntry(level, message, context);

    // Redact entry
    const redactedEntry = this.redactor.redactObject(entry) as LogEntry;

    // Serialize to JSON
    const serialized = JSON.stringify(redactedEntry);

    // Write to file (async, queued)
    if (this.logFilePath) {
      this.writeQueue = this.writeQueue.then(async () => {
        try {
          // First, try to flush any pending logs from previous failures
          if (this.pendingLogs.length > 0 && !this.diskWritesFailing) {
            await this.flushPendingLogs();
          }
          await this.appendToFile(serialized);
          // If we get here, disk writes are working
          this.diskWritesFailing = false;
        } catch (error) {
          // Log the failure to stderr
          console.error('[LOGGER_ERROR] Failed to write log to disk:', error);
          // Store in memory as fallback
          this.addToPendingLogs(serialized);
          this.diskWritesFailing = true;
          // Logging continues - entry is stored in pendingLogs
        }
      });
    }

    // Mirror to stderr if enabled
    if (this.options.mirrorToStderr) {
      this.writeToStderr(redactedEntry);
    }
  }

  /**
   * Build structured log entry
   */
  private buildLogEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.options.component,
      message,
    };

    if (this.options.runId) {
      entry.run_id = this.options.runId;
    }

    if (this.options.traceId) {
      entry.trace_id = this.options.traceId;
    }

    // Merge base context and call-site context
    if (this.options.baseContext || context) {
      entry.context = {
        ...this.options.baseContext,
        ...context,
      };
    }

    return entry;
  }

  /**
   * Check if log level should be emitted
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const minLevelIndex = levels.indexOf(this.options.minLevel);
    const currentLevelIndex = levels.indexOf(level);

    return currentLevelIndex >= minLevelIndex;
  }

  /**
   * Append log line to NDJSON file
   * @throws {Error} If file write fails (caller should handle fallback)
   */
  private async appendToFile(line: string): Promise<void> {
    if (!this.logFilePath) {
      return;
    }

    const logsDir = path.dirname(this.logFilePath);
    try {
      await fs.mkdir(logsDir, { recursive: true });
    } catch (mkdirError) {
      // Directory creation failed - this is a critical disk issue
      const error = mkdirError instanceof Error ? mkdirError : new Error(String(mkdirError));
      console.error('[LOGGER_ERROR] Failed to create logs directory:', error.message);
      throw error;
    }

    // Append log line
    try {
      await fs.appendFile(this.logFilePath, `${line}\n`, { encoding: 'utf-8', mode: 0o600 });
    } catch (appendError) {
      const error = appendError instanceof Error ? appendError : new Error(String(appendError));
      console.error('[LOGGER_ERROR] Failed to append log to file:', error.message);
      throw error;
    }
  }

  /**
   * Add a log entry to pending logs with size limit management
   */
  private addToPendingLogs(serialized: string): void {
    this.pendingLogs.push(serialized);
    // Drop oldest logs if we exceed the limit to prevent unbounded memory growth
    if (this.pendingLogs.length > StructuredLogger.MAX_PENDING_LOGS) {
      const dropped = this.pendingLogs.shift();
      console.error(
        `[LOGGER_ERROR] Pending logs exceeded ${StructuredLogger.MAX_PENDING_LOGS}, dropping oldest entry`
      );
      // Optionally log the dropped entry to stderr for debugging
      if (dropped) {
        console.error('[LOGGER_DROPPED]', dropped);
      }
    }
  }

  /**
   * Attempt to flush pending logs that failed to persist earlier
   */
  private async flushPendingLogs(): Promise<void> {
    if (!this.logFilePath || this.pendingLogs.length === 0) {
      return;
    }

    const logsToFlush = [...this.pendingLogs];
    this.pendingLogs = [];

    for (const logLine of logsToFlush) {
      try {
        await this.appendToFile(logLine);
      } catch (error) {
        // Re-add to pending if flush fails
        this.pendingLogs.push(logLine);
        throw error; // Propagate to indicate ongoing disk issues
      }
    }
  }

  /**
   * Write human-readable log to stderr
   */
  private writeToStderr(entry: LogEntry): void {
    const levelPrefix = `[${entry.level.toUpperCase()}]`;
    const componentPrefix = entry.component ? `[${entry.component}]` : '';
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';

    console.error(`${levelPrefix} ${componentPrefix} ${entry.message}${contextStr}`);
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext: LogContext): StructuredLogger {
    return new StructuredLogger({
      ...this.options,
      baseContext: {
        ...this.options.baseContext,
        ...additionalContext,
      },
    });
  }

  /**
   * Get log entries that failed to persist to disk (for debugging/recovery)
   */
  getPendingLogs(): string[] {
    return [...this.pendingLogs];
  }

  /**
   * Check if disk writes are currently failing
   */
  isDiskWriteFailing(): boolean {
    return this.diskWritesFailing;
  }

  /**
   * Flush pending writes (call before process exit)
   * This method never throws - it logs errors and returns gracefully
   */
  async flush(): Promise<void> {
    try {
      await this.writeQueue;
      // Attempt one final flush of pending logs
      if (this.pendingLogs.length > 0) {
        try {
          await this.flushPendingLogs();
        } catch (error) {
          console.error(
            '[LOGGER_ERROR] Failed to flush pending logs on shutdown:',
            error instanceof Error ? error.message : error
          );
          console.error(
            `[LOGGER_ERROR] ${this.pendingLogs.length} log entries remain unflushed (available via getPendingLogs())`
          );
        }
      }
    } catch (error) {
      // Never throw from flush - logging should not crash the application
      console.error(
        '[LOGGER_ERROR] Error during log flush:',
        error instanceof Error ? error.message : error
      );
    }
  }
}

/**
 * Create a logger instance for a run directory
 */
export function createLogger(options: LoggerOptions): StructuredLogger {
  return new StructuredLogger(options);
}

/**
 * Create a logger for CLI command execution
 */
export function createCliLogger(
  component: string,
  runId?: string,
  runDir?: string,
  overrides?: Partial<Omit<LoggerOptions, 'component'>>
): StructuredLogger {
  return createLogger({
    component: `cli:${component}`,
    minLevel: LogLevel.INFO,
    mirrorToStderr: !process.env.JSON_OUTPUT, // Disable stderr mirroring in JSON mode
    ...(runId !== undefined && { runId }),
    ...(runDir !== undefined && { runDir }),
    ...(overrides ?? {}),
  });
}

/**
 * Create a logger for HTTP adapters
 */
export function createHttpLogger(
  provider: string,
  runId?: string,
  runDir?: string
): StructuredLogger {
  return createLogger({
    component: `http:${provider}`,
    minLevel: LogLevel.DEBUG,
    mirrorToStderr: false,
    ...(runId !== undefined && { runId }),
    ...(runDir !== undefined && { runDir }),
  });
}

/**
 * Create a logger for queue operations
 */
export function createQueueLogger(runId?: string, runDir?: string): StructuredLogger {
  return createLogger({
    component: 'queue',
    minLevel: LogLevel.INFO,
    mirrorToStderr: false,
    ...(runId !== undefined && { runId }),
    ...(runDir !== undefined && { runDir }),
  });
}

/**
 * Create console-only logger (no file persistence)
 */
export function createConsoleLogger(component: string, minLevel = LogLevel.INFO): StructuredLogger {
  return createLogger({
    component,
    minLevel,
    mirrorToStderr: true,
  });
}
