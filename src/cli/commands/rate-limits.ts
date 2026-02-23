import { Command, Flags } from '@oclif/core';
import { getRunDirectoryPath } from '../../persistence/runDirectoryManager';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector } from '../../telemetry/metrics';
import { createRunTraceManager } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import { flushTelemetrySuccess, flushTelemetryError } from '../utils/telemetryLifecycle';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
} from '../utils/runDirectory';
import {
  generateRateLimitReport,
  exportRateLimitMetrics,
  formatRateLimitCLIOutput,
  type RateLimitReport,
} from '../../telemetry/rateLimitReporter';
import { RateLimitLedger } from '../../telemetry/rateLimitLedger';
import { setJsonOutputMode } from '../utils/cliErrors';

type RateLimitsFlags = {
  feature?: string;
  json: boolean;
  verbose: boolean;
  provider?: string;
  clear?: string;
};

/**
 * Rate-Limits Command
 *
 * Displays current rate limit state across all providers.
 * Surfaces cooldown timers, backlog states, and manual intervention requirements.
 * Exports Prometheus metrics for GitHub/Linear budgets.
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Feature not found
 */
export default class RateLimits extends Command {
  static description = 'Display rate limit status and telemetry for API providers';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --provider github',
    '<%= config.bin %> <%= command.id %> --clear github --feature feature-auth-123',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to query (defaults to current/latest)',
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed rate limit history and diagnostics',
      default: false,
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Filter output to specific provider (github, linear, etc.)',
    }),
    clear: Flags.string({
      description: 'Clear cooldown for specified provider (requires confirmation)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RateLimits);
    const typedFlags = flags as RateLimitsFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    // Initialize telemetry
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    let runDirPath: string | undefined;
    const startTime = Date.now();

    try {
      const settings = await resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      // Require feature ID
      if (!featureId) {
        this.error('No feature run directory found. Use --feature to specify a feature ID.', {
          exit: 10,
        });
      }

      if (typedFlags.feature && featureId !== typedFlags.feature) {
        this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
      }

      // Initialize telemetry
      runDirPath = getRunDirectoryPath(settings.baseDir, featureId);
      logger = createCliLogger('rate-limits', featureId, runDirPath, {
        minLevel: typedFlags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
        mirrorToStderr: !typedFlags.json,
      });
      metrics = createRunMetricsCollector(runDirPath, featureId);
      traceManager = createRunTraceManager(runDirPath, featureId, logger);
      commandSpan = traceManager.startSpan('cli.rate_limits');
      commandSpan.setAttribute('feature_id', featureId);
      commandSpan.setAttribute('json_mode', typedFlags.json);
      commandSpan.setAttribute('verbose_flag', typedFlags.verbose);

      logger.info('Rate-limits command invoked', {
        feature_id: featureId,
        json_mode: typedFlags.json,
        verbose: typedFlags.verbose,
        provider_filter: typedFlags.provider,
        clear_provider: typedFlags.clear,
      });

      // Handle clear operation
      if (typedFlags.clear) {
        await this.handleClearCooldown(runDirPath, typedFlags.clear, logger, typedFlags.json);
        commandSpan?.setAttribute('clear_provider', typedFlags.clear);
        await flushTelemetrySuccess(
          { commandName: 'rate-limits', startTime, logger, metrics, traceManager, commandSpan, runDirPath },
          { operation: 'clear' }
        );
        return;
      }

      // Generate rate limit report
      const report = await generateRateLimitReport(runDirPath);

      // Filter by provider if requested
      let filteredReport = report;
      if (typedFlags.provider) {
        filteredReport = this.filterReportByProvider(report, typedFlags.provider);
      }

      // Export metrics
      await exportRateLimitMetrics(runDirPath, metrics);

      // Output report
      if (typedFlags.json) {
        this.log(JSON.stringify(filteredReport, null, 2));
      } else {
        const lines = formatRateLimitCLIOutput(filteredReport, {
          verbose: typedFlags.verbose,
          showWarnings: true,
        });
        for (const line of lines) {
          this.log(line);
        }
      }

      commandSpan?.setAttribute('provider_count', Object.keys(filteredReport.providers).length);
      await flushTelemetrySuccess({ commandName: 'rate-limits', startTime, logger, metrics, traceManager, commandSpan, runDirPath });
    } catch (error) {
      await flushTelemetryError({ commandName: 'rate-limits', startTime, logger, metrics, traceManager, commandSpan, runDirPath }, error);

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Rate-limits command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Rate-limits command failed with an unknown error', { exit: 1 });
      }
    }
  }

  /**
   * Handle clear cooldown operation
   */
  private async handleClearCooldown(
    runDir: string,
    provider: string,
    logger: StructuredLogger,
    jsonMode: boolean
  ): Promise<void> {
    const ledger = new RateLimitLedger(runDir, provider, logger);

    // Check if provider is in cooldown
    const isInCooldown = await ledger.isInCooldown(provider);

    if (!isInCooldown) {
      if (jsonMode) {
        this.log(
          JSON.stringify(
            {
              success: false,
              provider,
              message: 'Provider is not in cooldown',
            },
            null,
            2
          )
        );
      } else {
        this.warn(`Provider ${provider} is not in cooldown. No action taken.`);
      }
      return;
    }

    // Clear cooldown
    await ledger.clearCooldown(provider);

    if (jsonMode) {
      this.log(
        JSON.stringify(
          {
            success: true,
            provider,
            message: 'Cooldown cleared successfully',
          },
          null,
          2
        )
      );
    } else {
      this.log('');
      this.log(`✓ Cooldown cleared for provider: ${provider}`);
      this.log('');
      this.warn('Note: Ensure rate limits have actually reset before resuming operations.');
      this.log('');
    }

    logger.info('Cooldown cleared', { provider });
  }

  /**
   * Filter report to show only specified provider
   */
  private filterReportByProvider(report: RateLimitReport, provider: string): RateLimitReport {
    const filteredProviders: Record<string, (typeof report.providers)[string]> = {};

    if (report.providers[provider]) {
      filteredProviders[provider] = report.providers[provider];
    }

    // Recalculate summary for filtered report
    const providerCount = Object.keys(filteredProviders).length;
    let providersInCooldown = 0;
    let providersRequiringAck = 0;

    for (const providerReport of Object.values(filteredProviders)) {
      if (providerReport.inCooldown) {
        providersInCooldown++;
      }
      if (providerReport.manualAckRequired) {
        providersRequiringAck++;
      }
    }

    return {
      ...report,
      providers: filteredProviders,
      summary: {
        providerCount,
        providersInCooldown,
        providersRequiringAck,
        anyInCooldown: providersInCooldown > 0,
        anyRequiresAck: providersRequiringAck > 0,
      },
    };
  }
}
