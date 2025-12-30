import { Command, Flags } from '@oclif/core';
import { createCliLogger, LogLevel, type StructuredLogger } from '../telemetry/logger';
import {
  createRunMetricsCollector,
  StandardMetrics,
  type MetricsCollector,
} from '../telemetry/metrics';
import {
  createRunTraceManager,
  SpanStatusCode,
  type TraceManager,
  type ActiveSpan,
} from '../telemetry/traces';
import { getRunDirectoryPath } from '../persistence/runDirectoryManager';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  ensureTelemetryReferences,
  type RunDirectorySettings,
} from './utils/runDirectory';
import { wrapError } from '../utils/errors';

/**
 * Command execution context with telemetry and configuration
 */
export interface CommandContext {
  logger: StructuredLogger;
  metrics: MetricsCollector;
  traceManager: TraceManager;
  settings: RunDirectorySettings;
  runDir: string;
  featureId: string;
  flags: Record<string, unknown>;
}

/**
 * Base command class for CLI commands
 *
 * Provides shared telemetry initialization, error handling, and cleanup.
 * Eliminates ~30 lines of boilerplate per command.
 *
 * Usage:
 * ```typescript
 * export default class MyCommand extends BaseCommand {
 *   static description = 'My command description';
 *
 *   static flags = {
 *     ...BaseCommand.baseFlags,
 *     myFlag: Flags.string({ description: 'Custom flag' }),
 *   };
 *
 *   protected get commandName() {
 *     return 'my-command';
 *   }
 *
 *   protected async execute(ctx: CommandContext): Promise<void> {
 *     // Command logic here - telemetry already initialized
 *     ctx.logger.info('Doing work');
 *   }
 * }
 * ```
 */
export abstract class BaseCommand extends Command {
  /**
   * Shared flags available to all commands
   */
  static baseFlags = {
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Enable verbose output',
      default: false,
    }),
  };

  /**
   * Command name for telemetry spans and logging
   */
  protected abstract get commandName(): string;

  /**
   * Execute command with initialized telemetry context
   * Override this method with command-specific logic
   */
  protected abstract execute(context: CommandContext): Promise<void>;

  /**
   * Whether this command requires a feature ID
   * Override to return false for commands like init that work without features
   */
  protected get requiresFeature(): boolean {
    return true;
  }

  /**
   * Main run method - handles telemetry lifecycle
   */
  async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as typeof BaseCommand);

    if (flags.json) {
      process.env.JSON_OUTPUT = '1';
    }

    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    const startTime = Date.now();

    try {
      const settings = resolveRunDirectorySettings();
      const featureId = await selectFeatureId(
        settings.baseDir,
        flags.feature as string | undefined
      );

      if (this.requiresFeature && !featureId) {
        this.error('No feature found. Use --feature to specify feature ID.', { exit: 10 });
      }

      const runDir = featureId
        ? getRunDirectoryPath(settings.baseDir, featureId)
        : settings.baseDir;
      logger = createCliLogger(this.commandName, featureId, runDir, {
        minLevel: flags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
        mirrorToStderr: !flags.json,
      });
      metrics = createRunMetricsCollector(runDir, featureId);
      traceManager = createRunTraceManager(runDir, featureId);

      if (featureId) {
        await ensureTelemetryReferences(runDir);
      }

      commandSpan = traceManager.startSpan(`cli.${this.commandName}`);
      commandSpan.setAttribute('command', this.commandName);
      commandSpan.setAttribute('json_mode', flags.json);
      commandSpan.setAttribute('verbose', flags.verbose);
      if (featureId) {
        commandSpan.setAttribute('feature_id', featureId);
      }

      logger.info(`${this.commandName} command invoked`, {
        feature_id: featureId,
        json_mode: flags.json,
        verbose: flags.verbose,
      });

      const context: CommandContext = {
        logger,
        metrics,
        traceManager,
        settings,
        runDir,
        featureId: featureId || '',
        flags,
      };

      await this.execute(context);

      const duration = Date.now() - startTime;
      commandSpan.end({ code: SpanStatusCode.OK });
      metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
        command: this.commandName,
      });
      metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: this.commandName,
        status: 'success',
      });

      logger.info(`${this.commandName} command completed`, { duration_ms: duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      const wrappedError = wrapError(error, `${this.commandName} command failed`);

      if (commandSpan) {
        commandSpan.end({
          code: SpanStatusCode.ERROR,
          message: wrappedError.message,
        });
      }

      if (metrics) {
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: this.commandName,
          status: 'error',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: this.commandName,
          status: 'error',
        });
      }

      if (logger) {
        logger.error(`${this.commandName} command failed`, {
          error: wrappedError.message,
          duration_ms: duration,
        });
      }

      throw wrappedError;
    }
  }
}
