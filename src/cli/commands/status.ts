import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  listRunDirectories,
  readManifest,
  runDirectoryExists,
  type RunManifest,
} from '../../persistence/runDirectoryManager';
import { loadRepoConfig } from '../../core/config/RepoConfig';

const CONFIG_RELATIVE_PATH = path.join('.ai-feature-pipeline', 'config.json');
const DEFAULT_RUNS_DIR = path.join('.ai-feature-pipeline', 'runs');
const MANIFEST_FILE = 'manifest.json';
const MANIFEST_SCHEMA_DOC = 'docs/requirements/run_directory_schema.md';
const MANIFEST_TEMPLATE = '.ai-feature-pipeline/templates/run_manifest.json';

type StatusFlags = {
  feature?: string;
  json: boolean;
  verbose: boolean;
  'show-costs': boolean;
};

interface RunDirectorySettings {
  baseDir: string;
  configPath: string;
  warnings: string[];
  errors: string[];
}

interface ManifestLoadResult {
  manifest?: RunManifest;
  manifestPath: string;
  error?: string;
}

interface StatusPayload {
  feature_id: string | null;
  title?: string;
  source?: string;
  status: RunManifest['status'] | 'unknown';
  manifest_path: string;
  manifest_schema_doc: string;
  manifest_template: string;
  last_step: string | null;
  last_error: RunManifest['execution']['last_error'] | null;
  queue: RunManifest['queue'] | null;
  approvals: RunManifest['approvals'] | null;
  telemetry: RunManifest['telemetry'] | null;
  timestamps: RunManifest['timestamps'] | null;
  config_reference: string;
  config_errors: string[];
  config_warnings: string[];
  notes: string[];
  manifest_error?: string;
}

/**
 * Status command - Display current state of a feature pipeline
 * Implements FR-9: Status reporting and progress tracking
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found)
 */
export default class Status extends Command {
  static description = 'Show the current state of a feature development pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --verbose',
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
      description: 'Show detailed execution logs and task breakdown',
      default: false,
    }),
    'show-costs': Flags.boolean({
      description: 'Include token usage and cost estimates',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const typedFlags = flags as StatusFlags;

    try {
      const settings = this.resolveRunDirectorySettings();
      const featureId = await this.selectFeatureId(settings.baseDir, typedFlags.feature);

      if (typedFlags.feature && featureId !== typedFlags.feature) {
        this.error(`Feature run directory not found: ${typedFlags.feature}`, { exit: 10 });
      }

      const manifestInfo = featureId
        ? await this.loadManifestSnapshot(settings.baseDir, featureId)
        : undefined;

      const payload = this.buildStatusPayload(featureId, settings, manifestInfo);

      if (typedFlags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload, typedFlags);
      }
    } catch (error) {
      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Status command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Status command failed with an unknown error', { exit: 1 });
      }
    }
  }

  private resolveRunDirectorySettings(): RunDirectorySettings {
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
    };
  }

  private async selectFeatureId(baseDir: string, explicit?: string): Promise<string | undefined> {
    if (explicit) {
      const exists = await runDirectoryExists(baseDir, explicit);
      return exists ? explicit : undefined;
    }

    return this.findMostRecentRun(baseDir);
  }

  private async findMostRecentRun(baseDir: string): Promise<string | undefined> {
    const candidates = await listRunDirectories(baseDir);
    let mostRecent: { id: string; mtime: number } | undefined;

    for (const candidate of candidates) {
      const manifestPath = path.join(
        getRunDirectoryPath(baseDir, candidate),
        MANIFEST_FILE
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

  private deriveManifestPath(baseDir: string, featureId?: string): string {
    if (featureId) {
      return path.join(getRunDirectoryPath(baseDir, featureId), MANIFEST_FILE);
    }

    return path.join(baseDir, '<feature_id>', MANIFEST_FILE);
  }

  private async loadManifestSnapshot(
    baseDir: string,
    featureId: string
  ): Promise<ManifestLoadResult> {
    const runDir = getRunDirectoryPath(baseDir, featureId);
    const manifestPath = path.join(runDir, MANIFEST_FILE);

    try {
      const manifest = await readManifest(runDir);
      return { manifest, manifestPath };
    } catch (error) {
      return {
        manifestPath,
        error: error instanceof Error ? error.message : 'Unknown manifest error',
      };
    }
  }

  private buildStatusPayload(
    featureId: string | undefined,
    settings: RunDirectorySettings,
    manifestInfo?: ManifestLoadResult
  ): StatusPayload {
    const manifest = manifestInfo?.manifest;
    const manifestPath = manifestInfo?.manifestPath ?? this.deriveManifestPath(settings.baseDir, featureId);

    const payload: StatusPayload = {
      feature_id: featureId ?? null,
      status: manifest?.status ?? 'unknown',
      manifest_path: manifestPath,
      manifest_schema_doc: MANIFEST_SCHEMA_DOC,
      manifest_template: MANIFEST_TEMPLATE,
      last_step: manifest?.execution.last_step ?? null,
      last_error: manifest?.execution.last_error ?? null,
      queue: manifest?.queue ?? null,
      approvals: manifest?.approvals ?? null,
      telemetry: manifest?.telemetry ?? null,
      timestamps: manifest?.timestamps ?? null,
      config_reference: settings.configPath,
      config_errors: settings.errors,
      config_warnings: settings.warnings,
      notes: [
        `Manifest layout documented at ${MANIFEST_SCHEMA_DOC}`,
        `Template manifest available at ${MANIFEST_TEMPLATE}`,
      ],
    };

    if (manifest?.title) {
      payload.title = manifest.title;
    }

    if (manifest?.source) {
      payload.source = manifest.source;
    }

    if (manifestInfo?.error) {
      payload.manifest_error = manifestInfo.error;
      payload.notes.push('Manifest could not be read; inspect manifest_error for remediation guidance.');
    }

    if (!manifest) {
      payload.notes.push('No manifest found. Run "ai-feature start" to provision a new feature run directory.');
    }

    return payload;
  }

  private printHumanReadable(payload: StatusPayload, flags: StatusFlags): void {
    this.log('');
    this.log(`Feature: ${payload.feature_id ?? '(none detected)'}`);
    if (payload.title) {
      this.log(`Title: ${payload.title}`);
    }
    if (payload.source) {
      this.log(`Source: ${payload.source}`);
    }
    this.log(`Manifest: ${payload.manifest_path}`);
    this.log(`Status: ${payload.status}`);
    this.log(`Last step: ${payload.last_step ?? 'not recorded'}`);

    if (payload.last_error) {
      this.log(
        `Last error: ${payload.last_error.step} — ${payload.last_error.message} (${payload.last_error.recoverable ? 'recoverable' : 'fatal'})`
      );
    } else {
      this.log('Last error: none recorded');
    }

    if (payload.queue) {
      this.log(
        `Queue: pending=${payload.queue.pending_count} completed=${payload.queue.completed_count} failed=${payload.queue.failed_count}`
      );
      if (flags.verbose && payload.queue.sqlite_index) {
        this.log(`Queue SQLite index: ${payload.queue.sqlite_index.database}`);
      }
    } else {
      this.log('Queue: manifest data unavailable');
    }

    if (payload.approvals) {
      this.log(
        `Approvals: pending=${payload.approvals.pending.length} completed=${payload.approvals.completed.length}`
      );
    }

    if (payload.manifest_error) {
      this.warn(`Manifest read warning: ${payload.manifest_error}`);
    }

    if (flags['show-costs']) {
      if (payload.telemetry?.costs_file) {
        this.log(`Telemetry (costs): ${payload.telemetry.costs_file}`);
      } else {
        this.log('Telemetry (costs): not recorded in manifest');
      }
    }

    if (flags.verbose) {
      if (payload.timestamps) {
        const start = payload.timestamps.started_at ? ` started=${payload.timestamps.started_at}` : '';
        const complete = payload.timestamps.completed_at ? ` completed=${payload.timestamps.completed_at}` : '';
        this.log(
          `Timestamps: created=${payload.timestamps.created_at}${start}${complete}`
        );
      }

      if (payload.config_errors.length > 0) {
        this.warn(`Config validation issues: ${payload.config_errors.join(' | ')}`);
      }

      if (payload.config_warnings.length > 0) {
        this.log(`Config warnings: ${payload.config_warnings.join(' | ')}`);
      }

      this.log(`Manifest schema: ${payload.manifest_schema_doc}`);
      this.log(`Manifest template: ${payload.manifest_template}`);
    }

    this.log('');
    for (const note of payload.notes) {
      this.log(`• ${note}`);
    }
    this.log('');
  }
}
