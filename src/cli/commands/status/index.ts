import { Flags } from '@oclif/core';
import * as path from 'node:path';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  type RunDirectorySettings,
} from '../../utils/runDirectory';
import {
  MANIFEST_FILE,
  MANIFEST_SCHEMA_DOC,
  MANIFEST_TEMPLATE,
  type StatusFlags,
  type StatusPayload,
  type ManifestLoadResult,
  type StatusContextPayload,
  type StatusTraceabilityPayload,
  type StatusPlanPayload,
  type StatusValidationPayload,
  type StatusBranchProtectionPayload,
  type StatusIntegrationsPayload,
  type StatusRateLimitsPayload,
  type StatusResearchPayload,
} from '../../status/types';
import {
  loadManifestWithTracing,
  loadContextStatus,
  loadTraceabilityStatus,
  loadPlanStatus,
  loadValidationStatus,
  loadBranchProtectionStatus,
  loadIntegrationsStatus,
  loadRateLimitsStatus,
  loadResearchStatus,
  refreshBranchProtectionArtifact,
} from '../../status/data';
import { renderHumanReadable } from '../../status/renderers';
import {
  CliError,
  CliErrorCode,
  formatErrorJson,
  formatErrorMessage,
  setJsonOutputMode,
} from '../../utils/cliErrors';
import { TelemetryCommand } from '../base';

/**
 * Status command - Display current state of a feature pipeline
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found)
 */
export default class Status extends TelemetryCommand {
  protected get commandName(): string {
    return 'status';
  }

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

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
    const runDirPath = featureId ? getRunDirectoryPath(settings.baseDir, featureId) : undefined;

    await this.runWithTelemetry(
      {
        runDirPath,
        featureId: featureId ?? undefined,
        jsonMode: typedFlags.json,
        verbose: typedFlags.verbose,
        spanAttributes: { verbose_flag: typedFlags.verbose },
      },
      async (ctx) => {
        try {
          ctx.logger?.info('Status command invoked', {
            feature_id: featureId,
            json_mode: typedFlags.json,
            verbose: typedFlags.verbose,
          });

          if (typedFlags.feature && featureId !== typedFlags.feature) {
            ctx.logger?.error('Feature not found', { requested: typedFlags.feature });
            throw new CliError(
              `Feature run directory not found: ${typedFlags.feature}`,
              CliErrorCode.RUN_DIR_NOT_FOUND,
              {
                remediation:
                  'Check the feature ID with "codepipe status" or start a new run with "codepipe start".',
                howToFix:
                  'List available features with "codepipe status" (no --feature flag) to see existing runs.',
                commonFixes: [
                  'Verify the feature ID spelling',
                  'Run "codepipe status" without --feature to see available runs',
                  'Start a new run with "codepipe start"',
                ],
              }
            );
          }

          const manifestInfo = featureId
            ? await loadManifestWithTracing(
                ctx.traceManager,
                ctx.commandSpan,
                settings.baseDir,
                featureId
              )
            : undefined;

          const contextInfo = featureId
            ? await loadContextStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          const traceInfo = featureId
            ? await loadTraceabilityStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          const planInfo = featureId
            ? await loadPlanStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          const validationInfo = featureId
            ? await loadValidationStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          if (featureId) {
            await refreshBranchProtectionArtifact(
              settings,
              featureId,
              manifestInfo?.manifest,
              ctx.logger,
              ctx.traceManager,
              ctx.commandSpan
            );
          }

          const branchProtectionInfo = featureId
            ? await loadBranchProtectionStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          const integrationsInfo = featureId
            ? await loadIntegrationsStatus(settings, featureId, ctx.logger)
            : undefined;

          const rateLimitsInfo = featureId
            ? await loadRateLimitsStatus(settings.baseDir, featureId, ctx.logger)
            : undefined;

          const researchInfo = featureId
            ? await loadResearchStatus(settings.baseDir, featureId, ctx.logger, ctx.metrics)
            : undefined;

          const payload = this.buildStatusPayload(
            featureId,
            settings,
            manifestInfo,
            contextInfo,
            traceInfo,
            planInfo,
            validationInfo,
            branchProtectionInfo,
            integrationsInfo,
            rateLimitsInfo,
            researchInfo
          );

          if (typedFlags.json) {
            this.log(JSON.stringify(payload, null, 2));
          } else {
            renderHumanReadable(payload, typedFlags, {
              log: (msg) => this.log(msg),
              warn: (msg) => this.warn(msg),
            });
          }
        } catch (error) {
          // Preserve structured JSON error output in --json mode
          if (typedFlags.json) {
            const cliErr =
              error instanceof CliError
                ? error
                : new CliError(
                    `Status command failed: ${formatErrorMessage(error)}`,
                    CliErrorCode.GENERAL,
                    error instanceof Error ? { cause: error } : {}
                  );
            this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
            this.exit(cliErr.exitCode);
          }
          throw error;
        }
      }
    );
  }

  private deriveManifestPath(baseDir: string, featureId?: string): string {
    if (featureId) {
      return path.join(getRunDirectoryPath(baseDir, featureId), MANIFEST_FILE);
    }

    return path.join(baseDir, '<feature_id>', MANIFEST_FILE);
  }

  private buildStatusPayload(
    featureId: string | undefined,
    settings: RunDirectorySettings,
    manifestInfo?: ManifestLoadResult,
    contextInfo?: StatusContextPayload,
    traceInfo?: StatusTraceabilityPayload,
    planInfo?: StatusPlanPayload,
    validationInfo?: StatusValidationPayload,
    branchProtectionInfo?: StatusBranchProtectionPayload,
    integrationsInfo?: StatusIntegrationsPayload,
    rateLimitsInfo?: StatusRateLimitsPayload,
    researchInfo?: StatusResearchPayload
  ): StatusPayload {
    const manifest = manifestInfo?.manifest;
    const manifestPath =
      manifestInfo?.manifestPath ?? this.deriveManifestPath(settings.baseDir, featureId);

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
      ...(contextInfo && { context: contextInfo }),
      ...(traceInfo && { traceability: traceInfo }),
      ...(planInfo && { plan: planInfo }),
      ...(validationInfo && { validation: validationInfo }),
      ...(branchProtectionInfo && { branch_protection: branchProtectionInfo }),
      ...(integrationsInfo && { integrations: integrationsInfo }),
      ...(rateLimitsInfo && { rate_limits: rateLimitsInfo }),
      ...(researchInfo && { research: researchInfo }),
    };

    if (manifest?.title) {
      payload.title = manifest.title;
    }

    if (manifest?.source) {
      payload.source = manifest.source;
    }

    if (manifestInfo?.error) {
      payload.manifest_error = manifestInfo.error;
      payload.notes.push(
        'Manifest could not be read; inspect manifest_error for remediation guidance.'
      );
    }

    if (!manifest) {
      payload.notes.push(
        'No manifest found. Run "codepipe start" to provision a new feature run directory.'
      );
    }

    return payload;
  }
}

export type {
  StatusFlags,
  StatusPayload,
  ManifestLoadResult,
  StatusContextPayload,
  StatusTraceabilityPayload,
  StatusPlanPayload,
  StatusValidationPayload,
  StatusBranchProtectionPayload,
  StatusIntegrationsPayload,
  StatusRateLimitsPayload,
  StatusResearchPayload,
} from '../../status/types';

export type { RunManifest, ValidationMismatch } from '../../status/types';
