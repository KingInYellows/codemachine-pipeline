import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../../utils/safeJson';
import type { RunManifest } from '../../../persistence/runDirectoryManager';
import type { PRMetadata } from '../../pr/shared';
import { RateLimitReporter } from '../../../telemetry/rateLimitReporter';
import type { RunDirectorySettings } from '../../utils/runDirectory';
import type { StatusIntegrationsPayload, StatusRateLimitsPayload } from '../types';
import type { DataLogger } from './types';

export async function loadPRMetadata(runDir: string): Promise<PRMetadata | null> {
  const prPath = path.join(runDir, 'pr.json');
  try {
    const content = await fs.readFile(prPath, 'utf-8');
    const parsed = safeJsonParse<PRMetadata>(content);
    return parsed ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadIntegrationsStatus(
  settings: RunDirectorySettings,
  featureId: string,
  logger?: DataLogger
): Promise<StatusIntegrationsPayload | undefined> {
  const runDir = getRunDirectoryPath(settings.baseDir, featureId);
  const integrations: StatusIntegrationsPayload = {};

  // GitHub integration
  if (settings.config?.github.enabled) {
    const githubWarnings: string[] = [];

    try {
      const rateLimitReport = await RateLimitReporter.generateReport(runDir);
      const githubProvider = rateLimitReport.providers['github'];

      const github: StatusIntegrationsPayload['github'] = {
        enabled: true,
        warnings: githubWarnings,
      };

      if (githubProvider) {
        github.rate_limit = {
          remaining: githubProvider.remaining,
          reset_at: githubProvider.resetAt,
          in_cooldown: githubProvider.inCooldown,
        };

        if (githubProvider.inCooldown) {
          githubWarnings.push(`GitHub API is in cooldown until ${githubProvider.resetAt}`);
        }
        if (githubProvider.manualAckRequired) {
          githubWarnings.push(
            `GitHub rate limit requires manual acknowledgement (${githubProvider.recentHitCount} consecutive hits)`
          );
        }
      }

      // Load PR status
      const prMetadata = await loadPRMetadata(runDir);
      if (prMetadata && prMetadata.pr_number) {
        github.pr_status = {
          number: prMetadata.pr_number,
          state: prMetadata.state ?? 'unknown',
          mergeable: prMetadata.mergeable ?? null,
          url: prMetadata.url ?? '',
        };
      }

      integrations.github = github;
    } catch (error) {
      logger?.warn('Failed to load GitHub integration data', {
        error: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_GITHUB_INTEGRATION_LOAD_FAILED',
      });
      integrations.github = {
        enabled: true,
        warnings: [
          `Failed to load GitHub integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
        ],
      };
    }
  }

  // Linear integration
  if (settings.config?.linear?.enabled) {
    const linearWarnings: string[] = [];

    try {
      const rateLimitReport = await RateLimitReporter.generateReport(runDir);
      const linearProvider = rateLimitReport.providers['linear'];

      const linear: StatusIntegrationsPayload['linear'] = {
        enabled: true,
        warnings: linearWarnings,
      };

      if (linearProvider) {
        linear.rate_limit = {
          remaining: linearProvider.remaining,
          reset_at: linearProvider.resetAt,
          in_cooldown: linearProvider.inCooldown,
        };

        if (linearProvider.inCooldown) {
          linearWarnings.push(`Linear API is in cooldown until ${linearProvider.resetAt}`);
        }
        if (linearProvider.manualAckRequired) {
          linearWarnings.push(
            `Linear rate limit requires manual acknowledgement (${linearProvider.recentHitCount} consecutive hits)`
          );
        }
      }

      // Load Linear issue status from manifest
      const manifestPath = path.join(runDir, 'manifest.json');
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = safeJsonParse<RunManifest>(manifestContent);
        if (manifest && manifest.source === 'linear' && manifest.title) {
          linear.issue_status = {
            identifier: manifest.title.split(':')[0]?.trim() ?? 'unknown',
            state: 'tracked',
            url: '',
          };
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
          logger?.warn('Failed to read manifest for Linear status', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            manifest_path: manifestPath,
            error_code: 'STATUS_LINEAR_MANIFEST_READ_FAILED',
          });
        }
      }

      integrations.linear = linear;
    } catch (error) {
      logger?.warn('Failed to load Linear integration data', {
        error: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        run_dir: runDir,
        error_code: 'STATUS_LINEAR_INTEGRATION_LOAD_FAILED',
      });
      integrations.linear = {
        enabled: true,
        warnings: [
          `Failed to load Linear integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
        ],
      };
    }
  }

  return Object.keys(integrations).length > 0 ? integrations : undefined;
}

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
