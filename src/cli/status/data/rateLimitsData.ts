import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { RateLimitReporter } from '../../../telemetry/rateLimitReporter';
import type { StatusRateLimitsPayload } from '../types';
import type { DataLogger } from './types';

export async function loadRateLimitsStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusRateLimitsPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  try {
    const report = await RateLimitReporter.generateReport(runDir);

    if (Object.keys(report.providers).length === 0) {
      return undefined;
    }

    const providers: StatusRateLimitsPayload['providers'] = {};
    const warnings: string[] = [];

    for (const [providerName, providerReport] of Object.entries(report.providers)) {
      providers[providerName] = {
        remaining: providerReport.remaining,
        reset_at: providerReport.resetAt,
        in_cooldown: providerReport.inCooldown,
        manual_ack_required: providerReport.manualAckRequired,
        recent_hit_count: providerReport.recentHitCount,
      };

      if (providerReport.inCooldown) {
        warnings.push(`${providerName}: In cooldown until ${providerReport.resetAt}`);
      }
      if (providerReport.manualAckRequired) {
        warnings.push(
          `${providerName}: Manual acknowledgement required (${providerReport.recentHitCount} consecutive rate limit hits)`
        );
      }
    }

    return {
      providers,
      summary: {
        any_in_cooldown: report.summary.anyInCooldown,
        any_requires_ack: report.summary.anyRequiresAck,
        providers_in_cooldown: report.summary.providersInCooldown,
      },
      warnings,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      logger?.warn('Failed to load rate limits', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_RATE_LIMITS_LOAD_FAILED',
      });
    }
    return undefined;
  }
}
