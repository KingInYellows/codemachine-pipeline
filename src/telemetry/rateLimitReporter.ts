import { readRateLimitLedger, type ProviderRateLimitState } from './rateLimitLedger';
import type { MetricsCollector } from './metrics';
import { StandardMetrics } from './metrics';

/**
 * Rate Limit Reporter
 *
 * Provides reporting and telemetry surfaces for rate limit state:
 * - Formats ledger data for CLI output (JSON and human-readable)
 * - Exports Prometheus metrics for rate limit budgets and cooldowns
 * - Calculates time-to-reset and cooldown ETAs
 * - Detects manual acknowledgement requirements
 *
 * Integrates with:
 * - RateLimitLedger for reading current state
 * - MetricsCollector for exporting provider-specific gauges
 * - CLI commands (status, rate-limits) for operator visibility
 */

/**
 * Rate limit report for a single provider
 */
export interface ProviderRateLimitReport {
  /** Provider identifier */
  provider: string;
  /** Requests remaining in current window */
  remaining: number;
  /** Unix timestamp when rate limit resets */
  reset: number;
  /** ISO 8601 timestamp when rate limit resets */
  resetAt: string;
  /** Seconds until reset (calculated from current time) */
  secondsUntilReset: number;
  /** Whether provider is in cooldown */
  inCooldown: boolean;
  /** ISO 8601 timestamp when cooldown expires (if applicable) */
  cooldownUntil?: string;
  /** Seconds until cooldown expires (if applicable) */
  secondsUntilCooldownEnd?: number;
  /** Whether manual acknowledgement is required */
  manualAckRequired: boolean;
  /** Number of recent rate limit hits (429s) */
  recentHitCount: number;
  /** Last error message (if any) */
  lastError?: {
    timestamp: string;
    message: string;
    requestId: string;
  };
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Complete rate limit report for all providers
 */
export interface RateLimitReport {
  /** Feature ID associated with this run (undefined if not set in ledger) */
  featureId: string | undefined;
  /** Provider-specific reports */
  providers: Record<string, ProviderRateLimitReport>;
  /** Overall summary */
  summary: {
    /** Total number of providers tracked */
    providerCount: number;
    /** Number of providers in cooldown */
    providersInCooldown: number;
    /** Number of providers requiring manual acknowledgement */
    providersRequiringAck: number;
    /** Whether any provider is in cooldown */
    anyInCooldown: boolean;
    /** Whether any provider requires manual acknowledgement */
    anyRequiresAck: boolean;
  };
  /** Report generation timestamp */
  generatedAt: string;
}

/**
 * Human-readable CLI output formatting options
 */
export interface RateLimitCLIOutputOptions {
  /** Whether to include verbose details */
  verbose?: boolean;
  /** Whether to show warnings for cooldowns */
  showWarnings?: boolean;
}

/**
 * Rate limit reporter for generating telemetry and CLI output
 */
export class RateLimitReporter {
  /**
   * Generate a complete rate limit report from ledger data
   */
  static async generateReport(runDir: string): Promise<RateLimitReport> {
    const ledger = await readRateLimitLedger(runDir);
    const now = Date.now();
    const providers: Record<string, ProviderRateLimitReport> = {};

    // Process each provider
    for (const [providerName, providerState] of Object.entries(ledger.providers)) {
      providers[providerName] = this.buildProviderReport(providerState, now);
    }

    // Calculate summary
    const summary = this.calculateSummary(providers);

    return {
      featureId: ledger.feature_id,
      providers,
      summary,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Export rate limit metrics to Prometheus
   */
  static async exportMetrics(runDir: string, metrics: MetricsCollector): Promise<void> {
    const report = await this.generateReport(runDir);

    for (const [providerName, providerReport] of Object.entries(report.providers)) {
      // Export remaining requests gauge
      metrics.gauge(
        StandardMetrics.RATE_LIMIT_REMAINING,
        providerReport.remaining,
        { provider: providerName },
        'Requests remaining before rate limit'
      );

      // Export reset timestamp gauge
      metrics.gauge(
        StandardMetrics.RATE_LIMIT_RESET_TIMESTAMP,
        providerReport.reset,
        { provider: providerName },
        'Unix timestamp when rate limit resets'
      );

      // Export cooldown active gauge (0 or 1)
      metrics.gauge(
        StandardMetrics.RATE_LIMIT_COOLDOWN_ACTIVE,
        providerReport.inCooldown ? 1 : 0,
        { provider: providerName },
        'Whether provider is in cooldown (1 = active, 0 = inactive)'
      );

      // Export recent hit count gauge
      metrics.gauge(
        'rate_limit_recent_hits',
        providerReport.recentHitCount,
        { provider: providerName },
        'Number of recent rate limit hits (429 responses)'
      );

      // Export manual acknowledgement required gauge
      metrics.gauge(
        'rate_limit_manual_ack_required',
        providerReport.manualAckRequired ? 1 : 0,
        { provider: providerName },
        'Whether manual acknowledgement is required (1 = required, 0 = not required)'
      );
    }
  }

  /**
   * Format report as human-readable CLI output
   */
  static formatCLIOutput(
    report: RateLimitReport,
    options: RateLimitCLIOutputOptions = {}
  ): string[] {
    const lines: string[] = [];
    const { verbose = false, showWarnings = true } = options;

    // Header
    lines.push('');
    lines.push(`Rate Limit Status (${report.generatedAt})`);
    lines.push('');

    // Summary
    lines.push(`Providers tracked: ${report.summary.providerCount}`);
    if (report.summary.providersInCooldown > 0) {
      lines.push(`⚠ Providers in cooldown: ${report.summary.providersInCooldown}`);
    }
    if (report.summary.providersRequiringAck > 0) {
      lines.push(
        `⚠ Providers requiring manual acknowledgement: ${report.summary.providersRequiringAck}`
      );
    }
    lines.push('');

    // Provider details
    if (Object.keys(report.providers).length === 0) {
      lines.push('No rate limit data available yet.');
      lines.push('');
      return lines;
    }

    for (const [providerName, providerReport] of Object.entries(report.providers)) {
      lines.push(`Provider: ${providerName}`);
      lines.push(`  Remaining: ${providerReport.remaining}`);
      lines.push(
        `  Reset: ${providerReport.resetAt} (${this.formatDuration(providerReport.secondsUntilReset)})`
      );

      if (providerReport.inCooldown) {
        if (providerReport.cooldownUntil && providerReport.secondsUntilCooldownEnd !== undefined) {
          lines.push(
            `  ⚠ Cooldown: Active until ${providerReport.cooldownUntil} (${this.formatDuration(providerReport.secondsUntilCooldownEnd)})`
          );
        } else {
          lines.push(`  ⚠ Cooldown: Active`);
        }
      } else {
        lines.push(`  Cooldown: Inactive`);
      }

      if (providerReport.manualAckRequired) {
        lines.push(
          `  ⚠ Manual Acknowledgement Required: ${providerReport.recentHitCount} consecutive rate limit hits`
        );
        if (showWarnings) {
          lines.push(
            `     Action: Review rate limit strategy and clear cooldown manually when ready`
          );
        }
      }

      if (verbose) {
        lines.push(`  Recent hits: ${providerReport.recentHitCount}`);
        if (providerReport.lastError) {
          lines.push(
            `  Last error: ${providerReport.lastError.message} (${providerReport.lastError.timestamp})`
          );
          lines.push(`  Request ID: ${providerReport.lastError.requestId}`);
        }
        lines.push(`  Last updated: ${providerReport.lastUpdated}`);
      }

      lines.push('');
    }

    // Warnings section
    if (showWarnings && (report.summary.anyInCooldown || report.summary.anyRequiresAck)) {
      lines.push('Warnings:');
      if (report.summary.anyInCooldown) {
        lines.push(
          '  • One or more providers are in cooldown. Consider throttling requests or waiting for reset.'
        );
      }
      if (report.summary.anyRequiresAck) {
        lines.push(
          '  • One or more providers require manual acknowledgement due to repeated rate limit hits.'
        );
        lines.push(
          '    Review your rate limit strategy and use `codepipe rate-limits clear <provider>` when ready.'
        );
      }
      lines.push('');
    }

    return lines;
  }

  /**
   * Build a provider report from ledger state
   */
  private static buildProviderReport(
    providerState: ProviderRateLimitState,
    now: number
  ): ProviderRateLimitReport {
    const resetTimestamp = providerState.state.reset * 1000; // Convert to milliseconds
    const secondsUntilReset = Math.max(0, Math.floor((resetTimestamp - now) / 1000));

    const report: ProviderRateLimitReport = {
      provider: providerState.provider,
      remaining: providerState.state.remaining,
      reset: providerState.state.reset,
      resetAt: new Date(resetTimestamp).toISOString(),
      secondsUntilReset,
      inCooldown: providerState.state.inCooldown,
      manualAckRequired: this.checkManualAckRequired(providerState),
      recentHitCount: this.countRecentHits(providerState),
      lastUpdated: providerState.lastUpdated,
    };

    // Add cooldown details if applicable
    if (providerState.state.inCooldown && providerState.state.cooldownUntil) {
      const cooldownEnd = new Date(providerState.state.cooldownUntil).getTime();
      report.cooldownUntil = providerState.state.cooldownUntil;
      report.secondsUntilCooldownEnd = Math.max(0, Math.floor((cooldownEnd - now) / 1000));
    }

    // Add last error if present
    if (providerState.lastError) {
      report.lastError = {
        timestamp: providerState.lastError.timestamp,
        message: providerState.lastError.message,
        requestId: providerState.lastError.requestId,
      };
    }

    return report;
  }

  /**
   * Calculate summary statistics from provider reports
   */
  private static calculateSummary(
    providers: Record<string, ProviderRateLimitReport>
  ): RateLimitReport['summary'] {
    const providerCount = Object.keys(providers).length;
    let providersInCooldown = 0;
    let providersRequiringAck = 0;

    for (const report of Object.values(providers)) {
      if (report.inCooldown) {
        providersInCooldown++;
      }
      if (report.manualAckRequired) {
        providersRequiringAck++;
      }
    }

    return {
      providerCount,
      providersInCooldown,
      providersRequiringAck,
      anyInCooldown: providersInCooldown > 0,
      anyRequiresAck: providersRequiringAck > 0,
    };
  }

  /**
   * Check if provider requires manual acknowledgement
   * (3+ consecutive 429s)
   */
  private static checkManualAckRequired(providerState: ProviderRateLimitState): boolean {
    const consecutiveHits = this.countConsecutiveHits(providerState);
    return consecutiveHits >= 3;
  }

  /**
   * Count consecutive 429 responses from most recent envelopes
   */
  private static countConsecutiveHits(providerState: ProviderRateLimitState): number {
    let count = 0;
    for (const envelope of providerState.recentEnvelopes) {
      if (envelope.statusCode === 429) {
        count++;
      } else {
        break; // Stop at first non-429
      }
    }
    return count;
  }

  /**
   * Count total 429 responses in recent envelopes
   */
  private static countRecentHits(providerState: ProviderRateLimitState): number {
    return providerState.recentEnvelopes.filter((e) => e.statusCode === 429).length;
  }

  /**
   * Format duration in seconds as human-readable string
   */
  private static formatDuration(seconds: number): string {
    if (seconds <= 0) {
      return 'now';
    }

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) {
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
}

/**
 * Generate a rate limit report for a run directory
 */
export async function generateRateLimitReport(runDir: string): Promise<RateLimitReport> {
  return RateLimitReporter.generateReport(runDir);
}

/**
 * Export rate limit metrics for a run directory
 */
export async function exportRateLimitMetrics(
  runDir: string,
  metrics: MetricsCollector
): Promise<void> {
  return RateLimitReporter.exportMetrics(runDir, metrics);
}

/**
 * Format rate limit report as CLI output
 */
export function formatRateLimitCLIOutput(
  report: RateLimitReport,
  options?: RateLimitCLIOutputOptions
): string[] {
  return RateLimitReporter.formatCLIOutput(report, options);
}
