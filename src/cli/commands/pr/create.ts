/**
 * PR Create Command
 *
 * Creates a pull request on GitHub with preflight validation
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (PR orchestration)
 * - Section 3.10.4: `codepipe pr create` command flow
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
  isCodeApproved,
  hasValidationsPassed,
  isBranchLocal,
  logDeploymentAction,
  PRExitCode,
  type PRMetadata,
} from '../../pr/shared';
import { setJsonOutputMode } from '../../utils/cliErrors';

type CreateFlags = {
  feature?: string;
  json: boolean;
  reviewers?: string;
  draft: boolean;
  title?: string;
  body?: string;
  base?: string;
};

/**
 * PR Create command - Create a pull request on GitHub
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (feature not found, invalid inputs)
 * - 30: Human action required (approvals missing, validations failed)
 */
export default class PRCreate extends Command {
  static description = 'Create a pull request on GitHub for the feature branch';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --reviewers user1,user2',
    '<%= config.bin %> <%= command.id %> --draft',
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
    reviewers: Flags.string({
      char: 'r',
      description: 'Comma-separated list of reviewer usernames',
    }),
    draft: Flags.boolean({
      char: 'd',
      description: 'Create PR as draft',
      default: false,
    }),
    title: Flags.string({
      char: 't',
      description: 'PR title (defaults to feature title)',
    }),
    body: Flags.string({
      char: 'b',
      description: 'PR body/description (defaults to generated summary)',
    }),
    base: Flags.string({
      description: 'Base branch (defaults to default branch from config)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PRCreate);
    const typedFlags = flags as CreateFlags;

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

      const { logger, manifest, runDir, config } = context;
      const metrics = createRunMetricsCollector(runDir, featureId);
      const traceManager = createRunTraceManager(runDir, featureId, logger);
      const commandSpan = traceManager.startSpan('cli.pr.create');

      try {
        commandSpan.setAttribute('feature_id', featureId);
        commandSpan.setAttribute('draft', typedFlags.draft);

        logger.info('PR create command invoked', {
          feature_id: featureId,
          draft: typedFlags.draft,
          reviewers: typedFlags.reviewers,
        });

        // Preflight validation
        await withSpan(
          traceManager,
          'pr.create.preflight',
          async (span) => {
            span.setAttribute('feature_id', featureId);

            // Check if PR already exists
            if (context.prMetadata) {
              logger.warn('PR already exists', {
                pr_number: context.prMetadata.pr_number,
                url: context.prMetadata.url,
              });
              this.error(
                `PR already exists: #${context.prMetadata.pr_number} (${context.prMetadata.url})`,
                { exit: PRExitCode.VALIDATION_ERROR }
              );
            }

            // Check Code approval gate
            if (!isCodeApproved(manifest)) {
              logger.error('Code approval gate not completed', {
                pending: manifest.approvals.pending,
                completed: manifest.approvals.completed,
              });
              span.setAttribute('preflight_failure', 'code_not_approved');
              this.error(
                'Code approval gate is required before creating PR. Run "codepipe approve code --signer <email>" first.',
                { exit: PRExitCode.HUMAN_ACTION_REQUIRED }
              );
            }

            // Check validations passed
            const validationsPassed = await hasValidationsPassed(runDir);
            if (!validationsPassed) {
              logger.error('Validations have not passed', { run_dir: runDir });
              span.setAttribute('preflight_failure', 'validations_failed');
              this.error(
                'Validations (lint/test/build) must pass before creating PR. Run "codepipe validate" first.',
                { exit: PRExitCode.HUMAN_ACTION_REQUIRED }
              );
            }

            // Determine branch name from manifest or Git
            const branchName = manifest.source || (await this.getCurrentBranch());
            if (!branchName) {
              span.setAttribute('preflight_failure', 'branch_unknown');
              this.error('Unable to determine branch name', {
                exit: PRExitCode.VALIDATION_ERROR,
              });
            }

            // Check branch exists locally
            const branchExists = await isBranchLocal(branchName);
            if (!branchExists) {
              span.setAttribute('preflight_failure', 'branch_not_found');
              this.error(`Branch not found locally: ${branchName}`, {
                exit: PRExitCode.VALIDATION_ERROR,
              });
            }

            span.setAttribute('branch', branchName);
            logger.debug('Preflight validation passed', { branch: branchName });
          },
          commandSpan.context
        );

        // Create GitHub adapter
        const adapter = getPRAdapter(context);

        // Determine PR parameters
        const branchName = manifest.source || (await this.getCurrentBranch())!;
        const baseBranch = typedFlags.base || config.project.default_branch;
        const prTitle = typedFlags.title || manifest.title || `Feature: ${featureId}`;
        const prBody = typedFlags.body || this.generatePRBody(manifest);

        // Create PR
        const pr = await withSpan(
          traceManager,
          'pr.create.github_api',
          async (span) => {
            span.setAttribute('head', branchName);
            span.setAttribute('base', baseBranch);
            span.setAttribute('draft', typedFlags.draft);

            logger.info('Creating pull request', {
              head: branchName,
              base: baseBranch,
              draft: typedFlags.draft,
            });

            const result = await adapter.createPullRequest({
              title: prTitle,
              body: prBody,
              head: branchName,
              base: baseBranch,
              draft: typedFlags.draft,
            });

            span.setAttribute('pr_number', result.number);
            logger.info('Pull request created', {
              pr_number: result.number,
              url: result.html_url,
            });

            return result;
          },
          commandSpan.context
        );

        // Request reviewers if specified
        let reviewersRequested: string[] = [];
        if (typedFlags.reviewers) {
          reviewersRequested = await withSpan(
            traceManager,
            'pr.create.request_reviewers',
            async (span) => {
              const reviewersList = typedFlags
                .reviewers!.split(',')
                .map((r) => r.trim())
                .filter((r) => r.length > 0);

              span.setAttribute('reviewers_count', reviewersList.length);

              logger.info('Requesting reviewers', {
                pr_number: pr.number,
                reviewers: reviewersList,
              });

              await adapter.requestReviewers({
                pull_number: pr.number,
                reviewers: reviewersList,
              });

              logger.info('Reviewers requested', {
                pr_number: pr.number,
                reviewers: reviewersList,
              });

              return reviewersList;
            },
            commandSpan.context
          );
        }

        // Persist PR metadata
        const prMetadata: PRMetadata = {
          pr_number: pr.number,
          url: pr.html_url,
          branch: branchName,
          base_branch: baseBranch,
          head_sha: pr.head.sha,
          base_sha: pr.base.sha,
          created_at: pr.created_at,
          reviewers_requested: reviewersRequested,
          auto_merge_enabled: false,
          last_updated: new Date().toISOString(),
        };

        await persistPRData(context, prMetadata);

        // Log to deployment.json
        await logDeploymentAction(context, 'pr_created', {
          pr_number: pr.number,
          url: pr.html_url,
          branch: branchName,
          base_branch: baseBranch,
          reviewers_requested: reviewersRequested,
        });

        // Render output
        const output = renderPROutput(
          {
            success: true,
            pr_number: pr.number,
            url: pr.html_url,
            branch: branchName,
            base_branch: baseBranch,
            reviewers_requested: reviewersRequested,
            message: `Pull request created successfully. View at: ${pr.html_url}`,
          },
          typedFlags.json
        );

        this.log(output);

        // Record success metrics
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'pr.create',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'pr.create',
          exit_code: '0',
        });
        await metrics.flush();

        commandSpan.setAttribute('exit_code', 0);
        commandSpan.setAttribute('pr_number', pr.number);
        commandSpan.end({ code: SpanStatusCode.OK });

        await traceManager.flush();
        await ensureTelemetryReferences(runDir);

        logger.info('PR create command completed', {
          duration_ms: duration,
          pr_number: pr.number,
        });
        await logger.flush();
      } catch (error) {
        // Record error metrics
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'pr.create',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'pr.create',
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
          logger.error('PR create command failed', {
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
        this.error(`PR create failed: ${error.message}`, {
          exit: PRExitCode.ERROR,
        });
      } else {
        this.error('PR create failed with an unknown error', {
          exit: PRExitCode.ERROR,
        });
      }
    }
  }

  private async getCurrentBranch(): Promise<string | null> {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: process.cwd(),
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  private generatePRBody(manifest: { title?: string; source?: string }): string {
    const lines: string[] = [];

    lines.push('## Summary');
    lines.push('');
    if (manifest.title) {
      lines.push(manifest.title);
    } else {
      lines.push('Generated by CodeMachine Pipeline');
    }
    lines.push('');

    lines.push('## Test Plan');
    lines.push('');
    lines.push('- [ ] Validations passed (lint, test, build)');
    lines.push('- [ ] Code reviewed and approved');
    lines.push('- [ ] Manual testing completed');
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('🤖 Generated with [CodeMachine Pipeline](https://github.com/codemachine/pipeline)');

    return lines.join('\n');
  }
}
