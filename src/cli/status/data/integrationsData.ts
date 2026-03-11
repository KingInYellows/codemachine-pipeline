import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../../utils/safeJson';
import type { RunManifest } from '../../../persistence/runDirectoryManager';
import { RateLimitReporter } from '../../../telemetry/rateLimitReporter';
import type { RunDirectorySettings } from '../../utils/runDirectory';
import type { StatusIntegrationsPayload } from '../types';
import type { DataLogger } from './types';
import { loadPRMetadata } from './prMetadataData';

type GitHubIntegration = NonNullable<StatusIntegrationsPayload['github']>;
type LinearIntegration = NonNullable<StatusIntegrationsPayload['linear']>;

function applyRateLimitWarnings(
  warnings: string[],
  providerName: 'GitHub' | 'Linear',
  provider:
    | {
        remaining: number;
        resetAt: string;
        inCooldown: boolean;
        manualAckRequired: boolean;
        recentHitCount: number;
      }
    | undefined
): GitHubIntegration['rate_limit'] | undefined {
  if (!provider) {
    return undefined;
  }

  if (provider.inCooldown) {
    warnings.push(`${providerName} API is in cooldown until ${provider.resetAt}`);
  }
  if (provider.manualAckRequired) {
    warnings.push(
      `${providerName} rate limit requires manual acknowledgement (${provider.recentHitCount} consecutive hits)`
    );
  }

  return {
    remaining: provider.remaining,
    reset_at: provider.resetAt,
    in_cooldown: provider.inCooldown,
  };
}

async function loadLinearIssueStatus(
  runDir: string,
  logger?: DataLogger
): Promise<LinearIntegration['issue_status']> {
  const manifestPath = join(runDir, 'manifest.json');

  try {
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifest = safeJsonParse<RunManifest>(manifestContent);

    if (manifest?.source === 'linear' && manifest.title) {
      return {
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

  return undefined;
}

async function loadGitHubIntegration(
  runDir: string,
  logger?: DataLogger
): Promise<GitHubIntegration> {
  const warnings: string[] = [];

  try {
    const rateLimitReport = await RateLimitReporter.generateReport(runDir);
    const github: GitHubIntegration = {
      enabled: true,
      warnings,
    };

    const githubRateLimit = applyRateLimitWarnings(
      warnings,
      'GitHub',
      rateLimitReport.providers['github']
    );
    if (githubRateLimit !== undefined) {
      github.rate_limit = githubRateLimit;
    }

    const prMetadata = await loadPRMetadata(runDir);
    if (prMetadata?.pr_number) {
      github.pr_status = {
        number: prMetadata.pr_number,
        state: prMetadata.state ?? 'unknown',
        mergeable: prMetadata.mergeable ?? null,
        url: prMetadata.url ?? '',
      };
    }

    return github;
  } catch (error) {
    logger?.warn('Failed to load GitHub integration data', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: runDir,
      error_code: 'STATUS_GITHUB_INTEGRATION_LOAD_FAILED',
    });
    return {
      enabled: true,
      warnings: [
        `Failed to load GitHub integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
      ],
    };
  }
}

async function loadLinearIntegration(
  runDir: string,
  logger?: DataLogger
): Promise<LinearIntegration> {
  const warnings: string[] = [];

  try {
    const rateLimitReport = await RateLimitReporter.generateReport(runDir);
    const linear: LinearIntegration = {
      enabled: true,
      warnings,
    };

    const linearRateLimit = applyRateLimitWarnings(
      warnings,
      'Linear',
      rateLimitReport.providers['linear']
    );
    if (linearRateLimit !== undefined) {
      linear.rate_limit = linearRateLimit;
    }

    const issueStatus = await loadLinearIssueStatus(runDir, logger);
    if (issueStatus) {
      linear.issue_status = issueStatus;
    }

    return linear;
  } catch (error) {
    logger?.warn('Failed to load Linear integration data', {
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      run_dir: runDir,
      error_code: 'STATUS_LINEAR_INTEGRATION_LOAD_FAILED',
    });
    return {
      enabled: true,
      warnings: [
        `Failed to load Linear integration data: ${error instanceof Error ? error.message : 'unknown error'}`,
      ],
    };
  }
}

export async function loadIntegrationsStatus(
  settings: RunDirectorySettings,
  featureId: string,
  logger?: DataLogger
): Promise<StatusIntegrationsPayload | undefined> {
  const runDir = getRunDirectoryPath(settings.baseDir, featureId);
  const integrations: StatusIntegrationsPayload = {};

  if (settings.config?.github.enabled && settings.config?.linear?.enabled) {
    const [github, linear] = await Promise.all([
      loadGitHubIntegration(runDir, logger),
      loadLinearIntegration(runDir, logger),
    ]);
    integrations.github = github;
    integrations.linear = linear;
  } else if (settings.config?.github.enabled) {
    integrations.github = await loadGitHubIntegration(runDir, logger);
  } else if (settings.config?.linear?.enabled) {
    integrations.linear = await loadLinearIntegration(runDir, logger);
  }

  return Object.keys(integrations).length > 0 ? integrations : undefined;
}
