import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  listRunDirectories,
  runDirectoryExists,
  updateManifest,
} from '../../persistence/runDirectoryManager';
import { loadRepoConfig, type RepoConfig } from '../../core/config/RepoConfig';
import { CliError, CliErrorCode, ERROR_MESSAGES } from './cliErrors';

export const CONFIG_RELATIVE_PATH = path.join('.codepipe', 'config.json');
export const DEFAULT_RUNS_DIR = path.join('.codepipe', 'runs');

export interface RunDirectorySettings {
  baseDir: string;
  configPath: string;
  warnings: string[];
  errors: string[];
  config?: RepoConfig;
}

export async function resolveRunDirectorySettings(): Promise<RunDirectorySettings> {
  const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
  const validation = await loadRepoConfig(configPath);

  if (!validation.success || !validation.config) {
    return {
      baseDir: path.resolve(process.cwd(), DEFAULT_RUNS_DIR),
      configPath,
      warnings: validation.warnings ?? [],
      errors: (validation.errors ?? []).map((err) => `${err.path}: ${err.message}`),
    };
  }

  const configuredRunDir = validation.config.runtime.run_directory || DEFAULT_RUNS_DIR;
  const baseDir = path.isAbsolute(configuredRunDir)
    ? configuredRunDir
    : path.resolve(process.cwd(), configuredRunDir);

  return {
    baseDir,
    configPath,
    warnings: validation.warnings ?? [],
    errors: [],
    config: validation.config,
  };
}

export async function selectFeatureId(
  baseDir: string,
  explicit?: string
): Promise<string | undefined> {
  if (explicit) {
    const exists = await runDirectoryExists(baseDir, explicit);
    return exists ? explicit : undefined;
  }

  return findMostRecentRun(baseDir);
}

export async function findMostRecentRun(baseDir: string): Promise<string | undefined> {
  const candidates = await listRunDirectories(baseDir);
  let mostRecent: { id: string; mtime: number } | undefined;

  for (const candidate of candidates) {
    const manifestPath = path.join(getRunDirectoryPath(baseDir, candidate), 'manifest.json');

    try {
      const stats = await fs.stat(manifestPath);
      if (!mostRecent || stats.mtimeMs > mostRecent.mtime) {
        mostRecent = { id: candidate, mtime: stats.mtimeMs };
      }
    } catch {
      // Ignore runs missing a manifest
    }
  }

  return mostRecent?.id;
}

/**
 * Guard that ensures a feature ID was resolved.
 *
 * Throws a {@link CliError} with exit code 20 if:
 * - No feature run directory was found (featureId is undefined/null)
 * - An explicit feature ID was requested but that run directory does not exist
 *
 * This replaces the identical guard block copy-pasted across 9 commands
 * after every `selectFeatureId` call.
 *
 * @param featureId - Resolved feature ID (may be undefined if none was found)
 * @param requestedFeature - Explicit feature ID requested via flag (optional)
 * @returns The confirmed feature ID (never undefined after this call)
 * @throws CliError if no feature directory found or the requested feature is missing
 */
export function requireFeatureId(
  featureId: string | undefined,
  requestedFeature?: string
): asserts featureId is string {
  if (!featureId) {
    const message = requestedFeature
      ? `Feature run directory not found: ${requestedFeature}`
      : 'No feature run directory found. Run "codepipe start" first.';

    throw new CliError(message, CliErrorCode.RUN_DIR_NOT_FOUND);
  }
}

/**
 * Guard that ensures settings are valid and config is present.
 *
 * Throws a {@link CliError} with exit code 10 if settings contain errors
 * or the config was not loaded.  This replaces the identical validation block
 * in start.ts and approve.ts.
 *
 * @param settings - Run directory settings returned by resolveRunDirectorySettings
 * @returns The validated RepoConfig
 * @throws CliError if settings have errors or config is missing
 */
export function requireConfig(settings: RunDirectorySettings): RepoConfig {
  if (settings.errors.length > 0 || !settings.config) {
    const message =
      settings.errors.length > 0 ? settings.errors.join('\n') : ERROR_MESSAGES.REPO_NOT_INITIALIZED;
    throw new CliError(message, CliErrorCode.CONFIG_NOT_FOUND, {
      remediation: 'Run "codepipe init" to initialize the repository configuration.',
    });
  }
  return settings.config;
}

export async function ensureTelemetryReferences(runDir: string): Promise<void> {
  const metricsPath = 'metrics/prometheus.txt';
  const tracesPath = 'telemetry/traces.json';
  const costsPath = 'telemetry/costs.json';

  await updateManifest(runDir, (manifest) => {
    const telemetry = {
      ...(manifest.telemetry ?? {}),
    };

    let changed = false;

    if (!telemetry.logs_dir) {
      telemetry.logs_dir = 'logs';
      changed = true;
    }

    if (telemetry.metrics_file !== metricsPath) {
      telemetry.metrics_file = metricsPath;
      changed = true;
    }

    if (telemetry.traces_file !== tracesPath) {
      telemetry.traces_file = tracesPath;
      changed = true;
    }

    if (telemetry.costs_file !== costsPath) {
      telemetry.costs_file = costsPath;
      changed = true;
    }

    return changed ? { telemetry } : null;
  });
}
