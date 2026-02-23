/**
 * PR Reviewers Command
 *
 * Request reviewers for a pull request
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (PR orchestration, reviewer assignment)
 * - Section 3.10.4: `codepipe pr reviewers` command flow
 */

import { Command, Flags } from '@oclif/core';
import { createRunMetricsCollector } from '../../../telemetry/metrics';
import { createRunTraceManager, withSpan } from '../../../telemetry/traces';
import { flushTelemetrySuccess, flushTelemetryError } from '../../utils/telemetryLifecycle';
import {
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
import { setJsonOutputMode } from '../../utils/cliErrors';

type ReviewersFlags = {
  feature?: string;
  json: boolean;
  add?: string;
};

/**
 * PR Reviewers command - Request reviewers for a pull request
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found, no PR exists)
 */
export default class PRReviewers extends Command {
  static description = 'Request reviewers for a pull request';

  static examples = [
    '<%= config.bin %> <%= command.id %> --add user1,user2',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123 --add reviewer',
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
    add: Flags.string({
      char: 'a',
      description: 'Comma-separated list of reviewer usernames to add',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PRReviewers);
    const typedFlags = flags as ReviewersFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const startTime = Date.now();

    try {
      const settings = await resolveRunDirectorySettings();
      const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);

      if (!featureId) {
        this.error('No feature run directory found. Run "codepipe start" first.', {
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
      const commandSpan = traceManager.startSpan('cli.pr.reviewers');

      try {
        commandSpan.setAttribute('feature_id', featureId);

        logger.info('PR reviewers command invoked', {
          feature_id: featureId,
          add: typedFlags.add,
        });

        // Check if PR exists
        if (!prMetadata) {
          logger.error('No PR found for feature', { feature_id: featureId });
          this.error('No pull request found for this feature. Run "codepipe pr create" first.', {
            exit: PRExitCode.VALIDATION_ERROR,
          });
        }

        // Parse reviewers to add
        const reviewersToAdd = typedFlags.add
          ? typedFlags.add
              .split(',')
              .map((r) => r.trim())
              .filter((r) => r.length > 0)
          : [];

        if (reviewersToAdd.length === 0) {
          this.error('No reviewers specified. Use --add flag with comma-separated usernames.', {
            exit: PRExitCode.VALIDATION_ERROR,
          });
        }

        // Create GitHub adapter
        const adapter = getPRAdapter(context);

        // Request reviewers
        await withSpan(
          traceManager,
          'pr.reviewers.request',
          async (span) => {
            span.setAttribute('pr_number', prMetadata.pr_number);
            span.setAttribute('reviewers_count', reviewersToAdd.length);

            logger.info('Requesting reviewers', {
              pr_number: prMetadata.pr_number,
              reviewers: reviewersToAdd,
            });

            await adapter.requestReviewers({
              pull_number: prMetadata.pr_number,
              reviewers: reviewersToAdd,
            });

            logger.info('Reviewers requested successfully', {
              pr_number: prMetadata.pr_number,
              reviewers: reviewersToAdd,
            });
          },
          commandSpan.context
        );

        // Update PR metadata with new reviewers
        const allReviewers = Array.from(
          new Set([...prMetadata.reviewers_requested, ...reviewersToAdd])
        );

        const updatedMetadata: PRMetadata = {
          ...prMetadata,
          reviewers_requested: allReviewers,
          last_updated: new Date().toISOString(),
        };

        await persistPRData(context, updatedMetadata);

        // Log to deployment.json
        await logDeploymentAction(context, 'reviewers_requested', {
          pr_number: prMetadata.pr_number,
          reviewers_added: reviewersToAdd,
          all_reviewers: allReviewers,
        });

        // Render output
        const output = renderPROutput(
          {
            success: true,
            pr_number: prMetadata.pr_number,
            url: prMetadata.url,
            reviewers_requested: allReviewers,
            reviewers_added: reviewersToAdd,
            message: `Reviewers requested: ${reviewersToAdd.join(', ')}`,
          },
          typedFlags.json
        );

        this.log(output);

        commandSpan.setAttribute('pr_number', prMetadata.pr_number);
        commandSpan.setAttribute('reviewers_added', reviewersToAdd.length);
        await flushTelemetrySuccess(
          { commandName: 'pr.reviewers', startTime, logger, metrics, traceManager, commandSpan, runDirPath: runDir },
          { pr_number: prMetadata.pr_number, reviewers_added: reviewersToAdd.length }
        );
      } catch (error) {
        await flushTelemetryError(
          { commandName: 'pr.reviewers', startTime, logger, metrics, traceManager, commandSpan, runDirPath: runDir },
          error
        );
        throw error;
      }
    } catch (error) {
      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`PR reviewers failed: ${error.message}`, {
          exit: PRExitCode.ERROR,
        });
      } else {
        this.error('PR reviewers failed with an unknown error', {
          exit: PRExitCode.ERROR,
        });
      }
    }
  }
}
