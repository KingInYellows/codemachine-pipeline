/**
 * PR Disable Auto-Merge Command
 *
 * Disables auto-merge for a pull request
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (auto-merge management)
 * - Section 3.10.4: `codepipe pr disable-auto-merge` command flow
 */

import { Command, Flags } from '@oclif/core';
import { createRunMetricsCollector } from '../../../telemetry/metrics';
import { createRunTraceManager, withSpan } from '../../../telemetry/traces';
import { flushTelemetrySuccess, flushTelemetryError } from '../../utils/telemetryLifecycle';
import { resolveRunDirectorySettings, selectFeatureId, requireFeatureId } from '../../utils/runDirectory';
import {
  loadPRContext,
  getPRAdapter,
  persistPRData,
  renderPROutput,
  logDeploymentAction,
  PRExitCode,
  type PRMetadata,
} from '../../pr/shared';
import { setJsonOutputMode, rethrowIfOclifError } from '../../utils/cliErrors';

type DisableAutoMergeFlags = {
  feature?: string;
  json: boolean;
  reason?: string;
};

/**
 * PR Disable Auto-Merge command - Disable auto-merge for a pull request
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found, no PR exists)
 */
export default class PRDisableAutoMerge extends Command {
  static description = 'Disable auto-merge for a pull request';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --reason "Manual merge required for compliance"',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID (defaults to current/latest)',
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    reason: Flags.string({
      char: 'r',
      description: 'Reason for disabling auto-merge (logged to deployment.json)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PRDisableAutoMerge);
    const typedFlags = flags as DisableAutoMergeFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const startTime = Date.now();

    try {
      const settings = await resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
      requireFeatureId(featureId, typedFlags.feature);

      // Load PR context
      const context = await loadPRContext(settings.baseDir, featureId, settings.config!, false);

      const { logger, runDir, prMetadata } = context;
      const metrics = createRunMetricsCollector(runDir, featureId);
      const traceManager = createRunTraceManager(runDir, featureId, logger);
      const commandSpan = traceManager.startSpan('cli.pr.disable_auto_merge');

      try {
        commandSpan.setAttribute('feature_id', featureId);

        logger.info('PR disable-auto-merge command invoked', {
          feature_id: featureId,
          reason: typedFlags.reason,
        });

        // Check if PR exists
        if (!prMetadata) {
          logger.error('No PR found for feature', { feature_id: featureId });
          this.error('No pull request found for this feature. Run "codepipe pr create" first.', {
            exit: PRExitCode.VALIDATION_ERROR,
          });
        }

        // Check if auto-merge is already disabled
        if (!prMetadata.auto_merge_enabled) {
          logger.warn('Auto-merge already disabled', { pr_number: prMetadata.pr_number });
          this.log('Auto-merge is already disabled for this pull request.');
          return;
        }

        // Create GitHub adapter
        const adapter = getPRAdapter(context);

        // Disable auto-merge
        await withSpan(
          traceManager,
          'pr.disable_auto_merge.github_api',
          async (span) => {
            span.setAttribute('pr_number', prMetadata.pr_number);

            logger.info('Disabling auto-merge', {
              pr_number: prMetadata.pr_number,
            });

            await adapter.disableAutoMerge(prMetadata.pr_number);

            logger.info('Auto-merge disabled successfully', {
              pr_number: prMetadata.pr_number,
            });
          },
          commandSpan.context
        );

        // Update PR metadata
        const updatedMetadata: PRMetadata = {
          ...prMetadata,
          auto_merge_enabled: false,
          last_updated: new Date().toISOString(),
        };

        await persistPRData(context, updatedMetadata);

        // Log to deployment.json with governance note
        await logDeploymentAction(context, 'auto_merge_disabled', {
          pr_number: prMetadata.pr_number,
          reason: typedFlags.reason || 'Manual disable requested',
          disabled_at: new Date().toISOString(),
        });

        // Render output
        const output = renderPROutput(
          {
            success: true,
            pr_number: prMetadata.pr_number,
            url: prMetadata.url,
            auto_merge_enabled: false,
            reason: typedFlags.reason,
            message: 'Auto-merge disabled successfully',
          },
          typedFlags.json
        );

        this.log(output);

        commandSpan.setAttribute('pr_number', prMetadata.pr_number);
        await flushTelemetrySuccess(
          {
            commandName: 'pr.disable_auto_merge',
            startTime,
            logger,
            metrics,
            traceManager,
            commandSpan,
            runDirPath: runDir,
          },
          { pr_number: prMetadata.pr_number }
        );
      } catch (error) {
        await flushTelemetryError(
          {
            commandName: 'pr.disable_auto_merge',
            startTime,
            logger,
            metrics,
            traceManager,
            commandSpan,
            runDirPath: runDir,
          },
          error
        );
        throw error;
      }
    } catch (error) {
      rethrowIfOclifError(error);

      if (error instanceof Error) {
        this.error(`PR disable-auto-merge failed: ${error.message}`, {
          exit: PRExitCode.ERROR,
        });
      } else {
        this.error('PR disable-auto-merge failed with an unknown error', {
          exit: PRExitCode.ERROR,
        });
      }
    }
  }
}
