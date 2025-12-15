import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  listRunDirectories,
  runDirectoryExists,
  updateManifest,
} from '../../persistence/runDirectoryManager';
import { loadRepoConfig, type RepoConfig } from '../../core/config/RepoConfig';

export const CONFIG_RELATIVE_PATH = path.join('.ai-feature-pipeline', 'config.json');
export const DEFAULT_RUNS_DIR = path.join('.ai-feature-pipeline', 'runs');

export interface RunDirectorySettings {
  baseDir: string;
  configPath: string;
  warnings: string[];
  errors: string[];
  config?: RepoConfig;
}

export function resolveRunDirectorySettings(): RunDirectorySettings {
  const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
  const validation = loadRepoConfig(configPath);

  if (!validation.success || !validation.config) {
    return {
      baseDir: path.resolve(process.cwd(), DEFAULT_RUNS_DIR),
      configPath,
      warnings: validation.warnings ?? [],
      errors: (validation.errors ?? []).map(err => `${err.path}: ${err.message}`),
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

export async function selectFeatureId(baseDir: string, explicit?: string): Promise<string | undefined> {
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
    const manifestPath = path.join(
      getRunDirectoryPath(baseDir, candidate),
      'manifest.json'
    );

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

export async function ensureTelemetryReferences(runDir: string): Promise<void> {
  const metricsPath = 'metrics/prometheus.txt';
  const tracesPath = 'telemetry/traces.json';
  const costsPath = 'telemetry/costs.json';

  await updateManifest(runDir, manifest => {
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
