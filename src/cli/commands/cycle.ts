import { Errors, Flags } from '@oclif/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TelemetryCommand } from '../telemetryCommand';
import { LinearAdapter } from '../../adapters/linear/LinearAdapter';
import { orderCycleIssues } from '../../workflows/cycleIssueOrderer';
import { shouldSkipIssue } from '../../workflows/cycleOrchestrator';
import { CycleOrchestrator } from '../../workflows/cycleOrchestrator';
import {
  renderDryRun,
  renderDashboardHeader,
  renderDashboardUpdate,
  renderCycleSummary,
  renderCycleJson,
} from '../cycleOutput';
import { type CycleFlags, type CyclePayload } from '../cycleTypes';
import { findGitRoot } from '../startHelpers';
import { resolveRunDirectorySettings, requireConfig } from '../utils/runDirectory';
import { CliError, CliErrorCode, formatErrorJson, setJsonOutputMode } from '../utils/cliErrors';

function containsPathTraversal(value: string): boolean {
  return value.includes('..') || value.includes('/') || value.includes('\\');
}

function sanitizeCycleId(cycleId: string): string {
  return cycleId.replace(/[^a-zA-Z0-9_-]/g, '');
}

export default class Cycle extends TelemetryCommand {
  protected get commandName(): string {
    return 'cycle';
  }

  static description = 'Run all issues in a Linear cycle through the pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %> --cycle CYCLE-ID',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --max-issues 10 --fail-fast',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    cycle: Flags.string({
      char: 'c',
      description: 'Cycle ID (defaults to active cycle for the configured team)',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview issue order without processing',
      default: false,
    }),
    'plan-only': Flags.boolean({
      description: 'Generate plans but skip execution',
      default: false,
    }),
    'fail-fast': Flags.boolean({
      description: 'Stop on first issue failure',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed output',
      default: false,
    }),
    'max-issues': Flags.integer({
      description: 'Maximum number of issues to process',
      default: 30,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Cycle);
    const typedFlags = flags as CycleFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const settings = await resolveRunDirectorySettings();
    const config = requireConfig(settings);

    if (!config.linear?.enabled) {
      const error = new CliError(
        'Linear integration is not enabled in this project. Enable it in .codepipe/config.json.',
        CliErrorCode.CONFIG_INVALID
      );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(error), null, 2));
        process.exit(error.exitCode);
        return;
      }
      Errors.error(error.message, { exit: false, code: error.code });
      process.exit(error.exitCode);
      return;
    }

    const apiKeyEnvVar = config.linear.api_key_env_var ?? 'LINEAR_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];
    if (!apiKey) {
      const error = new CliError(
        `Linear API key not found. Set the ${apiKeyEnvVar} environment variable.`,
        CliErrorCode.TOKEN_MISSING
      );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(error), null, 2));
        process.exit(error.exitCode);
        return;
      }
      Errors.error(error.message, { exit: false, code: error.code });
      process.exit(error.exitCode);
      return;
    }

    const teamId = config.linear?.team_id;
    let cycleId = typedFlags.cycle;

    // Validate we have either a cycle ID or team ID before proceeding
    if (!cycleId && !teamId) {
      const error = new CliError(
        'No --cycle flag provided and no team_id configured. Set linear.team_id in .codepipe/config.json or pass --cycle.',
        CliErrorCode.CONFIG_INVALID
      );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(error), null, 2));
        process.exit(error.exitCode);
        return;
      }
      Errors.error(error.message, { exit: false, code: error.code });
      process.exit(error.exitCode);
      return;
    }

    // Create marker directory for cycle command
    await fs.mkdir(path.join(settings.baseDir, '.cycle-command'), { recursive: true });

    await this.runWithTelemetry(
      {
        jsonMode: typedFlags.json,
        verbose: typedFlags.verbose,
        runDirPath: settings.baseDir,
      },
      async (ctx) => {
        const logger = ctx.logger;
        const metrics = ctx.metrics;

        // Resolve cycle ID inside telemetry context to catch API errors properly
        if (!cycleId) {
          const adapter = new LinearAdapter({ apiKey });
          const active = await adapter.fetchActiveCycle(teamId!); // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- TS can't narrow across callback for let cycleId
          if (!active) {
            throw new CliError(
              'No active cycle found for the configured team.',
              CliErrorCode.LINEAR_API_FAILED
            );
          }
          cycleId = active.id;
        }

        // Validate cycle ID for path traversal
        if (containsPathTraversal(cycleId)) {
          throw new CliError(
            'Cycle ID must not contain path traversal or path separator characters.',
            CliErrorCode.CONFIG_INVALID
          );
        }

        // Sanitize and create cycle directory
        const sanitized = sanitizeCycleId(cycleId);
        const cycleDir = path.join(settings.baseDir, `cycle-${sanitized}`);
        await fs.mkdir(cycleDir, { recursive: true });

        // Fetch cycle issues
        const adapter = new LinearAdapter({
          apiKey,
          runDir: cycleDir,
          ...(logger ? { logger } : {}),
        });
        const snapshot = await adapter.fetchCycleIssues(cycleId);
        const cycle = snapshot.cycle;

        logger?.info('Cycle fetched', {
          cycleId: cycle.id,
          cycleName: cycle.name,
          issueCount: cycle.issues.length,
        });

        // Order and cap issues
        const { ordered, hasCycle, cycleInvolvedIds } = orderCycleIssues(cycle.issues);
        const capped = ordered.slice(0, typedFlags['max-issues']);

        // Build payload
        const orderedIssues = capped.map((issue) => {
          const skipCheck = shouldSkipIssue(issue);
          const entry: CyclePayload['orderedIssues'][number] = {
            identifier: issue.identifier,
            title: issue.title,
            priority: issue.priority,
            state: issue.state.name,
            willSkip: skipCheck.skip,
          };
          if (skipCheck.reason) {
            entry.skipReason = skipCheck.reason;
          }
          return entry;
        });

        const payload: CyclePayload = {
          cycleId: cycle.id,
          cycleName: cycle.name,
          cycleNumber: cycle.number,
          orderedIssues,
          hasCycles: hasCycle,
          cycleInvolvedIds,
          totalIssues: orderedIssues.length,
          processable: orderedIssues.filter((i) => !i.willSkip).length,
          skipped: orderedIssues.filter((i) => i.willSkip).length,
        };

        const callbacks = {
          log: (msg: string) => this.log(msg),
          warn: (msg: string) => this.warn(msg),
        };

        // Dry-run mode
        if (typedFlags['dry-run']) {
          if (typedFlags.json) {
            this.log(JSON.stringify(payload, null, 2));
          } else {
            renderDryRun(payload, callbacks);
          }
          return;
        }

        // Real execution
        const repoRoot = findGitRoot();
        const processableIssues = capped.filter((i) => !shouldSkipIssue(i).skip);

        if (!typedFlags.json) {
          renderDashboardHeader(cycle.name, cycle.id, processableIssues.length, callbacks);
        }

        const orchestrator = new CycleOrchestrator({
          repoRoot,
          cycleBaseDir: cycleDir,
          cycleId: cycle.id,
          cycleName: cycle.name,
          repoConfig: config,
          logger: logger!,
          metrics: metrics!,
          failFast: typedFlags['fail-fast'],
          planOnly: typedFlags['plan-only'],
          maxIssues: typedFlags['max-issues'],
          onIssueComplete: (result) => {
            if (!typedFlags.json) {
              // Use consistent basis for both index and total (all capped issues)
              const index = capped.findIndex((i) => i.identifier === result.identifier);
              renderDashboardUpdate(
                result,
                index,
                capped.length,
                Date.now() - ctx.startTime,
                callbacks
              );
            }
          },
        });

        const result = await orchestrator.run(ordered);

        if (typedFlags.json) {
          renderCycleJson(result, callbacks);
        } else {
          renderCycleSummary(result, callbacks);
        }

        return { exitCode: result.failed > 0 ? 1 : 0 };
      }
    );
  }
}
