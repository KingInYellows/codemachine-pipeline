/**
 * PR Disable Auto-Merge Command
 *
 * Disables auto-merge for a pull request
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (auto-merge management)
 * - Section 3.10.4: `ai-feature pr disable-auto-merge` command flow
 */

import { Command, Flags } from '@oclif/core';
import { createRunMetricsCollector, StandardMetrics } from '../../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode, withSpan } from '../../../telemetry/traces';
import {
  ensureTelemetryReferences,
  resolveRunDirectorySettings,
  selectFeatureId,
} from '../../utils/runDirectory';
import {
  loadPRContext,
  getPRAdapter,
  persistPRData,
  renderPROutput,
  logDeploymentAction,
  PRExitCode,
  type PRMetadata,
} from '../../pr/shared';

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
      process.env.JSON_OUTPUT = '1';
    }

    const startTime = Date.now();

    try {
      const settings = resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      if (!featureId) {
        this.error('No feature run directory found. Run "ai-feature start" first.', {
          exit: PRExitCode.VALIDATION_ERROR,
        });
      }

      if (typedFlags.feature && featureId !== typedFlags.feature) {
        this.error(`Feature run directory not found: ${typedFlags.feature}`, {
          exit: PRExitCode.VALIDATION_ERROR,
        });
      }

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
          this.error('No pull request found for this feature. Run "ai-feature pr create" first.', {
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

        // Record success metrics
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'pr.disable_auto_merge',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'pr.disable_auto_merge',
          exit_code: '0',
        });
        await metrics.flush();

        commandSpan.setAttribute('exit_code', 0);
        commandSpan.setAttribute('pr_number', prMetadata.pr_number);
        commandSpan.end({ code: SpanStatusCode.OK });

        await traceManager.flush();
        await ensureTelemetryReferences(runDir);

        logger.info('PR disable-auto-merge command completed', {
          duration_ms: duration,
          pr_number: prMetadata.pr_number,
        });
        await logger.flush();
      } catch (error) {
        // Record error metrics
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'pr.disable_auto_merge',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'pr.disable_auto_merge',
          exit_code: '1',
        });
        await metrics.flush();

        commandSpan.setAttribute('exit_code', 1);
        commandSpan.setAttribute('error', true);
        if (error instanceof Error) {
          commandSpan.setAttribute('error.message', error.message);
          commandSpan.setAttribute('error.name', error.name);
        }
        commandSpan.end({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });

        await traceManager.flush();
        await ensureTelemetryReferences(runDir);

        if (error instanceof Error) {
          logger.error('PR disable-auto-merge command failed', {
            error: error.message,
            stack: error.stack,
            duration_ms: duration,
          });
        }
        await logger.flush();

        throw error;
      }
    } catch (error) {
      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

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
