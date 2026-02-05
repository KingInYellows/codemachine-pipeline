import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LogContext } from '../core/sharedTypes';

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
 * Implements Observability Rulebook and NFR-6 (secret protection).
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

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

// ============================================================================
// Redaction Engine
// ============================================================================

/**
 * Secret pattern definitions
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // GitHub tokens (ghp_, gho_, ghs_, ghr_)
  {
    name: 'github_token',
    pattern: /\bgh[psor]_[A-Za-z0-9_]{36,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  // GitHub App installation tokens
  {
    name: 'github_app_token',
    pattern: /\bghs_[A-Za-z0-9_]{36,}\b/g,
    replacement: '[REDACTED_GITHUB_APP_TOKEN]',
  },
  // Linear API keys
  {
    name: 'linear_key',
    pattern: /\blin_api_[A-Za-z0-9]{40}\b/g,
    replacement: '[REDACTED_LINEAR_KEY]',
  },
  // Generic API keys
  {
    name: 'api_key',
    pattern: /\b[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/g,
    replacement: 'api_key=[REDACTED_API_KEY]',
  },
  // JWTs (Bearer tokens)
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED_JWT]',
  },
  // Authorization headers
  {
    name: 'auth_header',
    pattern: /\b[Aa]uthorization\s*:\s*['"]?Bearer\s+([A-Za-z0-9_.-]+)['"]?/g,
    replacement: 'Authorization: Bearer [REDACTED_TOKEN]',
  },
  // Generic tokens
  {
    name: 'token',
    pattern: /\b[Tt]oken\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/g,
    replacement: 'token=[REDACTED_TOKEN]',
  },
  // AWS credentials
  { name: 'aws_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // Generic secrets in environment variable format
  {
    name: 'env_secret',
    pattern: /\b([A-Z_]+_SECRET|[A-Z_]+_PASSWORD|[A-Z_]+_KEY)\s*=\s*['"]?([^\s'"]+)['"]?/g,
    replacement: '$1=[REDACTED]',
  },
];

/**
 * Redaction engine for removing secrets from strings
 */
export interface RedactionReport {
  /** Redacted text */
  text: string;
  /** Flags representing patterns matched during redaction */
  flags: string[];
}

export class RedactionEngine {
  private readonly patterns: Array<{ name: string; pattern: RegExp; replacement: string }>;
  private readonly enabled: boolean;

  constructor(
    enabled = true,
    customPatterns?: Array<{ name: string; pattern: RegExp; replacement: string }>
  ) {
    this.enabled = enabled;
    this.patterns = customPatterns ?? SECRET_PATTERNS;
  }

  /**
   * Redact secrets from a string
   */
  redact(input: string): string {
    return this.redactWithReport(input).text;
  }

  /**
   * Redact secrets from a string and capture flags for matched patterns
   */
  redactWithReport(input: string): RedactionReport {
    if (!this.enabled) {
      return { text: input, flags: [] };
    }

    let output = input;
    const flags = new Set<string>();

    for (const { pattern, replacement, name } of this.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(output)) {
        flags.add(name);
      }
      pattern.lastIndex = 0;
      output = output.replace(pattern, replacement);
    }

    return { text: output, flags: Array.from(flags) };
  }

  /**
   * Redact secrets from structured data (deep traversal)
   */
  redactObject(obj: unknown): unknown {
    if (!this.enabled) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redact(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    if (obj && typeof obj === 'object') {
      const redacted: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        // Redact common secret field names
        if (this.isSensitiveFieldName(key)) {
          redacted[key] = '[REDACTED]';
        } else {
          redacted[key] = this.redactObject(value);
        }
      }

      return redacted;
    }

    return obj;
  }

  /**
   * Check if field name suggests sensitive data
   */
  private isSensitiveFieldName(name: string): boolean {
    const lowerName = name.toLowerCase();
    const sensitiveNames = [
      'password',
      'secret',
      'token',
      'api_key',
      'apikey',
      'auth',
      'authorization',
      'credential',
      'private_key',
      'privatekey',
    ];

    return sensitiveNames.some((pattern) => lowerName.includes(pattern));
  }
}

// ============================================================================
// Structured Logger Implementation
// ============================================================================

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

    // Ensure logs directory exists
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
      await fs.appendFile(this.logFilePath, `${line}\n`, 'utf-8');
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

// ============================================================================
// Factory Functions
// ============================================================================

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
  const options: LoggerOptions = {
    component: `cli:${component}`,
    minLevel: LogLevel.INFO,
    mirrorToStderr: !process.env.JSON_OUTPUT, // Disable stderr mirroring in JSON mode
    ...(overrides ?? {}),
  };

  if (runId) options.runId = runId;
  if (runDir) options.runDir = runDir;

  return createLogger(options);
}

/**
 * Create a logger for HTTP adapters
 */
export function createHttpLogger(
  provider: string,
  runId?: string,
  runDir?: string
): StructuredLogger {
  const options: LoggerOptions = {
    component: `http:${provider}`,
    minLevel: LogLevel.DEBUG,
    mirrorToStderr: false,
  };

  if (runId) options.runId = runId;
  if (runDir) options.runDir = runDir;

  return createLogger(options);
}

/**
 * Create a logger for queue operations
 */
export function createQueueLogger(runId?: string, runDir?: string): StructuredLogger {
  const options: LoggerOptions = {
    component: 'queue',
    minLevel: LogLevel.INFO,
    mirrorToStderr: false,
  };

  if (runId) options.runId = runId;
  if (runDir) options.runDir = runDir;

  return createLogger(options);
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
