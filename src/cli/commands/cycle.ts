/**
 * Cycle Command
 *
 * Fetches all issues from a Linear cycle, orders them by dependency
 * and priority, then runs each through PipelineOrchestrator sequentially.
 */

import { Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { TelemetryCommand } from '../telemetryCommand.js';
import {
  CliError,
  CliErrorCode,
  setJsonOutputMode,
} from '../utils/cliErrors.js';
import { resolveRunDirectorySettings, requireConfig } from '../utils/runDirectory.js';
import { LinearAdapter } from '../../adapters/linear/LinearAdapter.js';
import { orderCycleIssues } from '../../workflows/cycleIssueOrderer.js';
import { CycleOrchestrator, shouldSkipIssue } from '../../workflows/cycleOrchestrator.js';
import {
  renderDryRun,
  renderDashboardHeader,
  renderDashboardUpdate,
  renderCycleSummary,
  renderCycleJson,
} from '../cycleOutput.js';
import { getCyclePayloadCounts, type CycleFlags, type CyclePayload } from '../cycleTypes.js';
import type { CycleIssueResult } from '../../workflows/cycleTypes.js';
import { getErrorMessage } from '../../utils/errors.js';
import { formatLinearContext } from '../startHelpers.js';

export default class Cycle extends TelemetryCommand {
  protected get commandName(): string {
    return 'cycle';
  }

  static description = 'Run all issues in a Linear cycle through the pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --cycle abc123-def456',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --plan-only',
    '<%= config.bin %> <%= command.id %> --fail-fast --json',
  ];

  static flags = {
    cycle: Flags.string({
      char: 'c',
      description: 'Linear cycle ID (defaults to active cycle)',
    }),
    'plan-only': Flags.boolean({
      description: 'Generate PRDs without task execution',
      default: false,
    }),
    'fail-fast': Flags.boolean({
      description: 'Stop on first issue failure',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show ordered issue list without processing',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Detailed per-issue output',
      default: false,
    }),
    'max-issues': Flags.integer({
      description: 'Maximum number of issues to process',
      default: 30,
      min: 1,
      max: 100,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Cycle);
    const typedFlags = flags as CycleFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    // Load and validate repo config
    const settings = await resolveRunDirectorySettings();
    const repoConfig = requireConfig(settings);

    if (!repoConfig.linear.enabled) {
      throw new CliError(
        'Linear integration is not enabled. Set linear.enabled to true in .codepipe/config.json.',
        CliErrorCode.CONFIG_INVALID,
        {
          remediation: 'Enable Linear integration in your config.',
          howToFix: 'Run "codepipe init" and enable the Linear integration.',
          commonFixes: [
            'Set linear.enabled to true in .codepipe/config.json',
            'Run "codepipe init" to configure Linear',
          ],
        }
      );
    }

    if (!repoConfig.linear.team_id) {
      throw new CliError(
        'Linear team_id is not configured. Set linear.team_id in .codepipe/config.json.',
        CliErrorCode.CONFIG_INVALID,
        {
          remediation: 'Set your Linear team ID.',
          howToFix: 'Add linear.team_id to your .codepipe/config.json.',
          commonFixes: [
            'Run "codepipe init" to set up Linear team',
            'Manually set linear.team_id in .codepipe/config.json',
          ],
        }
      );
    }

    // Resolve API key
    const apiKey = process.env[repoConfig.linear.api_key_env_var];
    if (!apiKey) {
      throw new CliError(
        `${repoConfig.linear.api_key_env_var} environment variable is required.`,
        CliErrorCode.TOKEN_MISSING,
        {
          remediation: `Set the ${repoConfig.linear.api_key_env_var} environment variable.`,
          howToFix: `Export your Linear API key: export ${repoConfig.linear.api_key_env_var}="lin_api_..."`,
          commonFixes: [
            'Create a Linear API key at https://linear.app/settings/api',
            `Add ${repoConfig.linear.api_key_env_var} to your .env or shell profile`,
          ],
        }
      );
    }

    // Create run directory for cycle
    const cycleBaseDir = path.join(settings.baseDir, `cycle-${typedFlags.cycle ?? 'active'}`);
    await fs.mkdir(cycleBaseDir, { recursive: true });

    await this.runWithTelemetry(
      {
        runDirPath: cycleBaseDir,
        featureId: `cycle-${typedFlags.cycle ?? 'active'}`,
        jsonMode: typedFlags.json,
        verbose: typedFlags.verbose,
        spanAttributes: {
          dry_run: typedFlags['dry-run'],
          plan_only: typedFlags['plan-only'],
          fail_fast: typedFlags['fail-fast'],
        },
      },
      async (ctx) => {
        const logger = ctx.logger!;
        const metrics = ctx.metrics!;

        const adapter = new LinearAdapter({
          apiKey,
          runDir: cycleBaseDir,
          logger,
        });

        // Resolve cycle
        let cycleId: string;
        let cycleName: string;
        let cycleNumber: number;

        if (typedFlags.cycle) {
          cycleId = typedFlags.cycle;

          // Fetch cycle (narrow try-catch to fetch only)
          let snapshot;
          try {
            snapshot = await adapter.fetchCycleIssues(cycleId);
          } catch (error) {
            throw new CliError(
              `Failed to fetch cycle ${cycleId}: ${getErrorMessage(error)}`,
              CliErrorCode.CYCLE_FETCH_FAILED,
              {
                remediation: 'Check the cycle ID and your API key.',
                howToFix: 'Verify the cycle exists in your Linear workspace.',
                commonFixes: [
                  'Verify the cycle ID is a valid UUID',
                  'Check that your API key has access to this cycle',
                ],
                ...(error instanceof Error && { cause: error }),
              }
            );
          }

          cycleName = snapshot.cycle.name;
          cycleNumber = snapshot.cycle.number;

          const { ordered, hasCycle, cycleInvolvedIds } = orderCycleIssues(
            snapshot.cycle.issues
          );

          if (hasCycle) {
            logger.warn('Dependency cycle detected', { cycleInvolvedIds });
          }

          return await this.executeCycle(
            ordered,
            cycleId,
            cycleName,
            cycleNumber,
            hasCycle,
            cycleInvolvedIds,
            typedFlags,
            cycleBaseDir,
            repoConfig,
            logger,
            metrics
          );
        } else {
          // Use active cycle
          const teamId = repoConfig.linear.team_id!;
          let activeCycle;
          try {
            activeCycle = await adapter.fetchActiveCycle(teamId);
          } catch (error) {
            throw new CliError(
              `Failed to fetch active cycle: ${getErrorMessage(error)}`,
              CliErrorCode.CYCLE_FETCH_FAILED,
              {
                remediation: 'Check your Linear team_id, API key, and network connectivity.',
                commonFixes: [
                  'Verify linear.team_id is correct in .codepipe/config.json',
                  'Check network connectivity to api.linear.app',
                ],
                ...(error instanceof Error && { cause: error }),
              }
            );
          }

          if (!activeCycle) {
            throw new CliError(
              'No active cycle found for this team.',
              CliErrorCode.CYCLE_NOT_FOUND,
              {
                remediation: 'Create a cycle in Linear or specify one with --cycle.',
                howToFix: 'Create a cycle in Linear, or pass --cycle <id> to specify one.',
                commonFixes: [
                  'Create a new cycle in your Linear workspace',
                  'Use --cycle <id> to specify a specific cycle',
                  'Check that the correct team_id is configured',
                ],
              }
            );
          }

          cycleId = activeCycle.id;
          cycleName = activeCycle.name;
          cycleNumber = activeCycle.number;

          // Fetch issues (narrow try-catch to fetch only)
          let snapshot;
          try {
            snapshot = await adapter.fetchCycleIssues(cycleId);
          } catch (error) {
            throw new CliError(
              `Failed to fetch cycle issues: ${getErrorMessage(error)}`,
              CliErrorCode.CYCLE_FETCH_FAILED,
              {
                remediation: 'Check your network connectivity and API key.',
                commonFixes: [
                  'Check network connectivity to api.linear.app',
                  'Verify your API key has not expired',
                ],
                ...(error instanceof Error && { cause: error }),
              }
            );
          }

          const { ordered, hasCycle, cycleInvolvedIds } = orderCycleIssues(
            snapshot.cycle.issues
          );

          if (hasCycle) {
            logger.warn('Dependency cycle detected', { cycleInvolvedIds });
          }

          return await this.executeCycle(
            ordered,
            cycleId,
            cycleName,
            cycleNumber,
            hasCycle,
            cycleInvolvedIds,
            typedFlags,
            cycleBaseDir,
            repoConfig,
            logger,
            metrics
          );
        }
      }
    );
  }

  private async executeCycle(
    ordered: import('../../adapters/linear/LinearAdapterTypes.js').LinearCycleIssue[],
    cycleId: string,
    cycleName: string,
    cycleNumber: number,
    hasCycle: boolean,
    cycleInvolvedIds: string[],
    flags: CycleFlags,
    cycleBaseDir: string,
    repoConfig: import('../../core/config/RepoConfig.js').RepoConfig,
    logger: import('../../telemetry/logger.js').StructuredLogger,
    metrics: import('../../telemetry/metrics.js').MetricsCollector
  ): Promise<{ exitCode: number }> {
    const callbacks = {
      log: (msg: string) => this.log(msg),
      warn: (msg: string) => this.warn(msg),
    };

    // Build payload for dry-run preview (compute skip once per issue)
    const orderedIssues = ordered.map((issue) => {
      const skipCheck = shouldSkipIssue(issue);
      return {
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        state: issue.state.name,
        willSkip: skipCheck.skip,
        skipReason: skipCheck.reason,
      };
    });

    const payload: CyclePayload = {
      cycleId,
      cycleName,
      cycleNumber,
      orderedIssues,
      hasCycles: hasCycle,
      cycleInvolvedIds,
    };

    // Dry run — render preview and exit
    if (flags['dry-run']) {
      if (flags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        renderDryRun(payload, callbacks);
      }
      return { exitCode: 0 };
    }

    // Handle empty cycle
    if (ordered.length === 0) {
      if (flags.json) {
        this.log(JSON.stringify({ cycleId, cycleName, message: 'No issues in cycle' }));
      } else {
        this.log(`\nCycle "${cycleName}" has no issues. Nothing to process.\n`);
      }
      return { exitCode: 0 };
    }

    // All already done?
    const counts = getCyclePayloadCounts(payload);
    if (counts.processable === 0) {
      if (flags.json) {
        this.log(JSON.stringify({ cycleId, cycleName, message: 'All issues already completed' }));
      } else {
        this.log(`\nAll ${ordered.length} issues in "${cycleName}" are already completed or in review.\n`);
      }
      return { exitCode: 0 };
    }

    // Execute
    const repoRoot = process.cwd();
    const startTime = Date.now();
    let issueIndex = 0;

    if (!flags.json) {
      renderDashboardHeader(cycleName, cycleId, counts.processable, callbacks);
    }

    const onIssueComplete = (result: CycleIssueResult) => {
      if (!flags.json) {
        renderDashboardUpdate(result, issueIndex, counts.processable, Date.now() - startTime, callbacks);
      }
      if (result.status !== 'skipped') {
        issueIndex++;
      }
    };

    const orchestrator = new CycleOrchestrator({
      repoRoot,
      cycleBaseDir,
      cycleId,
      cycleName,
      repoConfig,
      logger,
      metrics,
      failFast: flags['fail-fast'],
      planOnly: flags['plan-only'],
      maxIssues: flags['max-issues'],
      formatContext: formatLinearContext,
      onIssueComplete,
    });

    const result = await orchestrator.run(ordered);

    // Render output
    if (flags.json) {
      renderCycleJson(result, callbacks);
    } else {
      renderCycleSummary(result, callbacks);
    }

    return { exitCode: result.failed > 0 ? 1 : 0 };
  }
}
