/**
 * TelemetryCommand — shared base class for CLI commands that follow
 * the standard telemetry lifecycle:
 *
 *   parse flags → setJsonOutputMode → create logger, metrics,
 *   traceManager, commandSpan → try/catch with
 *   flushTelemetrySuccess / flushTelemetryError.
 *
 * Subclasses implement their own `run()` method, then delegate to
 * `this.runWithTelemetry(options, execute)` for the boilerplate.
 */

import { Command } from '@oclif/core';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector } from '../../telemetry/metrics';
import { createRunTraceManager } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import { rethrowIfOclifError } from '../utils/cliErrors';
import { CliError, CliErrorCode } from '../utils/cliErrors';
import {
  flushTelemetrySuccess,
  flushTelemetryError,
  type TelemetryResources,
} from '../utils/telemetryLifecycle';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link TelemetryCommand.runWithTelemetry} to configure
 * how telemetry is initialised for this invocation.
 */
export interface TelemetryCommandOptions {
  /** Directory for metrics / traces output (run-dir or pipeline-dir). */
  runDirPath?: string | undefined;
  /** Identifier written into telemetry labels (feature-id or a label like 'diagnostics'). */
  featureId?: string | undefined;
  /** Whether JSON output mode is active (controls logger stderr mirroring). */
  jsonMode?: boolean;
  /** Enable DEBUG-level logging. */
  verbose?: boolean;
  /** Extra attributes set on the root command span. */
  spanAttributes?: Record<string, string | number | boolean>;
  /**
   * Custom directory for the structured logger.
   * Defaults to {@link runDirPath} when omitted.
   * Useful for commands like `doctor` that write logs to a non-standard path.
   */
  logsDir?: string | undefined;
}

/**
 * Value optionally returned from the `execute` callback to influence the
 * telemetry flush that follows.
 */
export interface TelemetryResult {
  /** Process exit code (default `0`). Non-zero triggers `process.exit`. */
  exitCode?: number;
  /** Extra fields merged into the success log entry. */
  extraLogFields?: Record<string, unknown>;
}

/**
 * Telemetry handles passed into the `execute` callback so that command
 * logic can record spans, metrics and structured logs.
 *
 * All fields are optional because telemetry initialisation may be skipped
 * (e.g. when `runDirPath` is not available).  Commands that know they will
 * always have telemetry can safely use the non-null assertion operator.
 */
export interface TelemetryContext {
  logger: StructuredLogger | undefined;
  metrics: MetricsCollector | undefined;
  traceManager: TraceManager | undefined;
  commandSpan: ActiveSpan | undefined;
  /** Timestamp captured at the start of {@link runWithTelemetry}. */
  startTime: number;
  /** Pre-built resources bag — pass to `flushTelemetrySuccess` / `flushTelemetryError` if you
   *  need to flush manually inside the callback (rare). */
  resources: TelemetryResources;
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Abstract base class that eliminates the duplicated telemetry lifecycle
 * found across CLI commands.
 *
 * ### Usage
 *
 * ```ts
 * export default class MyCmd extends TelemetryCommand {
 *   protected get commandName() { return 'my-cmd'; }
 *
 *   async run() {
 *     const { flags } = await this.parse(MyCmd);
 *     if (flags.json) setJsonOutputMode();
 *
 *     // … resolve runDirPath, featureId, etc.
 *
 *     await this.runWithTelemetry(
 *       { runDirPath, featureId, jsonMode: flags.json },
 *       async (ctx) => {
 *         ctx.logger?.info('doing work');
 *         // … command logic …
 *         return { exitCode: 0 };
 *       },
 *     );
 *   }
 * }
 * ```
 */
export abstract class TelemetryCommand extends Command {
  // ------------------------------------------------------------------
  // Subclass contract
  // ------------------------------------------------------------------

  /**
   * Canonical command name used for metrics labels, log prefixes and the
   * span name (e.g. `'doctor'`, `'rate-limits'`, `'pr.create'`).
   */
  protected abstract get commandName(): string;

  // ------------------------------------------------------------------
  // Template method
  // ------------------------------------------------------------------

  /**
   * Run the `execute` callback inside the standard telemetry lifecycle.
   *
   * 1. Creates logger / metrics / traceManager / commandSpan (when
   *    `runDirPath` is provided).
   * 2. Calls `execute(ctx)`.
   * 3. On success — flushes telemetry with the returned exit-code /
   *    extra-log-fields.  Calls `process.exit` for non-zero codes.
   * 4. On error — flushes error telemetry, re-throws oclif errors,
   *    handles `CliError`, and falls back to a generic error message.
   */
  protected async runWithTelemetry(
    options: TelemetryCommandOptions,
    execute: (ctx: TelemetryContext) => Promise<TelemetryResult | void>
  ): Promise<void> {
    const startTime = Date.now();
    const { runDirPath, featureId, jsonMode, verbose, spanAttributes, logsDir } = options;

    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;

    try {
      // -- Initialise telemetry (best-effort) --------------------------
      if (runDirPath) {
        const telemetryId = featureId ?? this.commandName;
        const logDir = logsDir ?? runDirPath;

        logger = createCliLogger(this.commandName, telemetryId, logDir, {
          minLevel: verbose ? LogLevel.DEBUG : jsonMode ? LogLevel.WARN : LogLevel.INFO,
          mirrorToStderr: !jsonMode,
        });
        metrics = createRunMetricsCollector(runDirPath, telemetryId);
        traceManager = createRunTraceManager(runDirPath, telemetryId, logger);
        commandSpan = traceManager.startSpan(this.deriveSpanName());

        if (jsonMode !== undefined) {
          commandSpan.setAttribute('json_mode', jsonMode);
        }
        if (featureId) {
          commandSpan.setAttribute('feature_id', featureId);
        }
        if (spanAttributes) {
          for (const [key, value] of Object.entries(spanAttributes)) {
            commandSpan.setAttribute(key, value);
          }
        }
      }

      // -- Build context & resources -----------------------------------
      const resources: TelemetryResources = {
        commandName: this.commandName,
        startTime,
        logger,
        metrics,
        traceManager,
        commandSpan,
        runDirPath,
      };

      const ctx: TelemetryContext = {
        logger,
        metrics,
        traceManager,
        commandSpan,
        startTime,
        resources,
      };

      // -- Execute command logic ---------------------------------------
      const result = await execute(ctx);

      // -- Success flush -----------------------------------------------
      const exitCode = result?.exitCode ?? 0;
      await flushTelemetrySuccess(resources, result?.extraLogFields, exitCode);

      if (exitCode !== 0) {
        // Use process.exit so the catch block is not triggered.
        process.exit(exitCode); // eslint-disable-line no-process-exit
      }
    } catch (error) {
      // -- Error flush -------------------------------------------------
      await flushTelemetryError(
        {
          commandName: this.commandName,
          startTime,
          logger,
          metrics,
          traceManager,
          commandSpan,
          runDirPath,
        },
        error
      );

      // Let oclif errors (from this.error / this.exit) propagate as-is.
      rethrowIfOclifError(error);

      // Surface CliError with its structured exit code.
      if (error instanceof CliError) {
        const exitCode = error.code === CliErrorCode.RUN_DIR_NOT_FOUND ? 10 : error.exitCode;
        this.error(error.message, { exit: exitCode });
      }

      // Generic fallback.
      if (error instanceof Error) {
        this.error(`${this.commandName} command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error(`${this.commandName} command failed with an unknown error`, { exit: 1 });
      }
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Derive the OpenTelemetry span name from {@link commandName}.
   *
   * - Hyphens become underscores (`rate-limits` → `rate_limits`)
   * - Colons become dots (`context:summarize` → `context.summarize`)
   * - Prefixed with `cli.`
   */
  private deriveSpanName(): string {
    const normalized = this.commandName.replace(/-/g, '_').replace(/:/g, '.');
    return `cli.${normalized}`;
  }
}
