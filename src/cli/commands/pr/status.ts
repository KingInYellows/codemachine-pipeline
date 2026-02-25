/**
 * PR Status Command
 *
 * Shows pull request status including merge readiness and blockers
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (PR orchestration)
 * - Section 3.10.4: `codepipe pr status` command flow
 */

import { Command, Flags } from '@oclif/core';
import { createRunMetricsCollector } from '../../../telemetry/metrics';
import { createRunTraceManager, withSpan } from '../../../telemetry/traces';
import { flushTelemetrySuccess, flushTelemetryError } from '../../utils/telemetryLifecycle';
import { resolveRunDirectorySettings, selectFeatureId } from '../../utils/runDirectory';
import {
  loadPRContext,
  getPRAdapter,
  persistPRData,
  renderPROutput,
  PRExitCode,
  type PRMetadata,
} from '../../pr/shared';
import type { StatusCheck } from '../../../adapters/github/GitHubAdapter';
import { setJsonOutputMode, rethrowIfOclifError } from '../../utils/cliErrors';

type StatusFlags = {
  feature?: string;
  json: boolean;
  'fail-on-blockers': boolean;
};

/**
 * PR Status command - Show PR status and merge readiness
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error (with --fail-on-blockers: blockers present)
 * - 10: Validation error (feature not found, no PR exists)
 */
export default class PRStatus extends Command {
  static description = 'Show pull request status and merge readiness';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --fail-on-blockers',
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
    'fail-on-blockers': Flags.boolean({
      description: 'Exit with code 1 if blockers present',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PRStatus);
    const typedFlags = flags as StatusFlags;

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
      const commandSpan = traceManager.startSpan('cli.pr.status');

      try {
        commandSpan.setAttribute('feature_id', featureId);

        logger.info('PR status command invoked', {
          feature_id: featureId,
        });

        // Check if PR exists
        if (!prMetadata) {
          logger.error('No PR found for feature', { feature_id: featureId });
          this.error('No pull request found for this feature. Run "codepipe pr create" first.', {
            exit: PRExitCode.VALIDATION_ERROR,
          });
        }

        // Create GitHub adapter
        const adapter = getPRAdapter(context);

        // Fetch fresh PR data
        const pr = await withSpan(
          traceManager,
          'pr.status.fetch_pr',
          async (span) => {
            span.setAttribute('pr_number', prMetadata.pr_number);

            logger.debug('Fetching PR details', { pr_number: prMetadata.pr_number });

            const result = await adapter.getPullRequest(prMetadata.pr_number);

            span.setAttribute('pr_state', result.state);
            span.setAttribute('pr_merged', result.merged);

            return result;
          },
          commandSpan.context
        );

        // Get status checks
        const statusChecks = await withSpan(
          traceManager,
          'pr.status.fetch_status_checks',
          async (span) => {
            span.setAttribute('sha', pr.head.sha);

            logger.debug('Fetching status checks', { sha: pr.head.sha });

            const checks = await adapter.getStatusChecks(pr.head.sha);

            span.setAttribute('checks_count', checks.length);

            return checks;
          },
          commandSpan.context
        );

        // Check merge readiness
        const mergeReadiness = await withSpan(
          traceManager,
          'pr.status.check_merge_readiness',
          async (span) => {
            span.setAttribute('pr_number', prMetadata.pr_number);

            logger.debug('Checking merge readiness', { pr_number: prMetadata.pr_number });

            const result = await adapter.isPullRequestReadyToMerge(prMetadata.pr_number);

            span.setAttribute('merge_ready', result.ready);
            span.setAttribute('blockers_count', result.reasons.length);

            return result;
          },
          commandSpan.context
        );

        // Update PR metadata
        const updatedMetadata: PRMetadata = {
          ...prMetadata,
          head_sha: pr.head.sha,
          base_sha: pr.base.sha,
          status_checks: statusChecks.map((check: StatusCheck) => ({
            context: check.id.toString(),
            state: check.status,
            conclusion: check.conclusion,
          })),
          merge_ready: mergeReadiness.ready,
          blockers: mergeReadiness.reasons,
          last_updated: new Date().toISOString(),
        };

        await persistPRData(context, updatedMetadata);

        // Render output
        const output = renderPROutput(
          {
            success: true,
            pr_number: pr.number,
            url: pr.html_url,
            branch: pr.head.ref,
            base_branch: pr.base.ref,
            state: pr.state,
            merged: pr.merged,
            draft: pr.draft,
            reviewers_requested: updatedMetadata.reviewers_requested,
            status_checks: updatedMetadata.status_checks,
            merge_ready: mergeReadiness.ready,
            blockers: mergeReadiness.reasons,
            message: mergeReadiness.ready
              ? 'Pull request is ready to merge'
              : `Pull request has ${mergeReadiness.reasons.length} blocker(s)`,
          },
          typedFlags.json
        );

        this.log(output);

        // Determine exit code
        let exitCode = PRExitCode.SUCCESS;
        if (typedFlags['fail-on-blockers'] && !mergeReadiness.ready) {
          exitCode = PRExitCode.ERROR;
        }

        commandSpan.setAttribute('pr_number', pr.number);
        commandSpan.setAttribute('merge_ready', mergeReadiness.ready);
        await flushTelemetrySuccess(
          {
            commandName: 'pr.status',
            startTime,
            logger,
            metrics,
            traceManager,
            commandSpan,
            runDirPath: runDir,
          },
          { pr_number: pr.number, merge_ready: mergeReadiness.ready },
          exitCode
        );

        // Exit with appropriate code
        if (exitCode !== PRExitCode.SUCCESS) {
          this.exit(exitCode);
        }
      } catch (error) {
        await flushTelemetryError(
          {
            commandName: 'pr.status',
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
        this.error(`PR status failed: ${error.message}`, {
          exit: PRExitCode.ERROR,
        });
      } else {
        this.error('PR status failed with an unknown error', {
          exit: PRExitCode.ERROR,
        });
      }
    }
  }
}
