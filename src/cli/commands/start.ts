import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  type StartFlags,
  resolveFeatureTitle,
  resolveSourceDescriptor,
  generateFeatureId,
  findGitRoot,
  fetchLinearIssue,
  formatLinearContext,
} from '../startHelpers.js';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import { createExecutionTelemetry } from '../../telemetry/executionTelemetry';
import { setLastError } from '../../persistence/manifestManager';
import { createRunDirectory } from '../../persistence/runLifecycle';
import {
  resolveRunDirectorySettings,
  ensureTelemetryReferences,
  requireConfig,
} from '../utils/runDirectory';
import {
  CliError,
  CliErrorCode,
  formatErrorMessage,
  formatErrorJson,
  setJsonOutputMode,
} from '../utils/cliErrors';
import { flushTelemetryError } from '../utils/telemetryLifecycle';
import { PipelineOrchestrator, PrerequisiteError } from '../../workflows/pipelineOrchestrator';
import { emitStartSummary, outputDryRunPlan, type StartResultPayload } from '../startOutput.js';
import type { RepoConfig } from '../../core/config/RepoConfig';

type StartExitCodeInput = {
  approvalRequired: boolean;
  execution?:
    | {
        failedTasks: number;
        permanentlyFailedTasks: number;
      }
    | undefined;
};

export function getStartExitCode(result: StartExitCodeInput): number {
  if (result.approvalRequired) {
    return 30;
  }

  return result.execution &&
    (result.execution.failedTasks > 0 || result.execution.permanentlyFailedTasks > 0)
    ? 1
    : 0;
}

export default class Start extends Command {
  static description = 'Start a new feature development pipeline';

  static examples = [
    '<%= config.bin %> <%= command.id %> --prompt "Add user authentication"',
    '<%= config.bin %> <%= command.id %> --linear ISSUE-123',
    '<%= config.bin %> <%= command.id %> --spec ./specs/feature.md',
    '<%= config.bin %> <%= command.id %> --prompt "OAuth integration" --json',
  ];

  static flags = {
    prompt: Flags.string({
      char: 'p',
      description: 'Feature description prompt',
      exclusive: ['linear', 'spec'],
    }),
    linear: Flags.string({
      char: 'l',
      description: 'Linear issue ID to import as feature specification',
      exclusive: ['prompt', 'spec'],
    }),
    spec: Flags.file({
      char: 's',
      description: 'Path to existing specification file',
      exclusive: ['prompt', 'linear'],
      exists: true,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Simulate execution without making changes',
      default: false,
    }),
    'max-parallel': Flags.integer({
      description: 'Maximum parallel tasks during execution (1-10)',
      default: 1,
      min: 1,
      max: 10,
    }),
    'skip-execution': Flags.boolean({
      description: 'Skip task execution phase (stop after PRD)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);
    const typedFlags = flags as StartFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    if (!typedFlags.prompt && !typedFlags.linear && !typedFlags.spec) {
      const cliErr = new CliError(
        'Must provide one of: --prompt, --linear, or --spec',
        CliErrorCode.CONFIG_INVALID,
        {
          remediation:
            'Provide an input source: --prompt "description", --linear ISSUE-ID, or --spec path/to/spec.md',
        }
      );
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
        this.exit(cliErr.exitCode);
      }
      this.error(cliErr.message, { exit: cliErr.exitCode });
    }

    if (typedFlags['dry-run']) {
      outputDryRunPlan(typedFlags, typedFlags.json, (msg) => this.log(msg));
      return;
    }

    const settings = await resolveRunDirectorySettings();
    let repoConfig: RepoConfig;
    try {
      repoConfig = requireConfig(settings);
    } catch (error) {
      if (error instanceof CliError) {
        if (typedFlags.json) {
          this.log(JSON.stringify(formatErrorJson(error), null, 2));
          this.exit(error.exitCode);
        }
        this.error(error.message, { exit: error.exitCode });
      }
      throw error;
    }

    const startTime = Date.now();
    const repoRoot = findGitRoot();
    await fs.mkdir(settings.baseDir, { recursive: true });

    const featureId = generateFeatureId();
    const featureTitle = resolveFeatureTitle(typedFlags);
    const featureSource = resolveSourceDescriptor(typedFlags);
    const resolvedSpecPath = typedFlags.spec ? path.resolve(typedFlags.spec) : undefined;
    const runDir = await createRunDirectory(settings.baseDir, featureId, {
      title: featureTitle,
      source: featureSource,
      repoUrl: repoConfig.project.repo_url,
      defaultBranch: repoConfig.project.default_branch,
      metadata: {
        input: {
          prompt: typedFlags.prompt,
          linear: typedFlags.linear,
          specPath: resolvedSpecPath,
        },
      },
    });

    await ensureTelemetryReferences(runDir);

    const logger = createCliLogger('start', featureId, runDir, {
      minLevel: typedFlags.json ? LogLevel.WARN : LogLevel.INFO,
      mirrorToStderr: !typedFlags.json,
    });
    const metrics = createRunMetricsCollector(runDir, featureId);
    const traceManager = createRunTraceManager(runDir, featureId, logger);
    const executionTelemetry = createExecutionTelemetry({
      logger,
      metrics,
      runDir,
      runId: featureId,
      traceManager,
      component: 'execution_engine',
    });
    const commandSpan = traceManager.startSpan('cli.start');
    commandSpan.setAttribute('feature_id', featureId);
    commandSpan.setAttribute('input_source', featureSource);

    let orchestrator: PipelineOrchestrator | undefined;

    try {
      orchestrator = new PipelineOrchestrator({
        repoRoot,
        runDir,
        featureId,
        featureTitle,
        featureSource,
        repoConfig,
        logger,
        metrics,
        telemetry: executionTelemetry,
      });

      const specText = resolvedSpecPath ? await fs.readFile(resolvedSpecPath, 'utf-8') : undefined;

      let linearContextText: string | undefined;
      if (typedFlags.linear) {
        const snapshot = await fetchLinearIssue(typedFlags.linear, runDir, logger);
        linearContextText = formatLinearContext(snapshot);
      }

      const result = await orchestrator.execute({
        promptText: typedFlags.prompt,
        specText,
        linearContextText,
        maxParallel: typedFlags['max-parallel'] ?? 1,
        skipExecution: typedFlags['skip-execution'],
      });

      const payload: StartResultPayload = {
        feature_id: featureId,
        run_dir: runDir,
        source: featureSource,
        status: result.approvalRequired
          ? 'awaiting_prd_approval'
          : result.execution
            ? 'execution_complete'
            : 'completed',
        context: {
          files: result.context.files,
          total_tokens: result.context.totalTokens,
          warnings: result.context.warnings,
        },
        research: {
          tasks_detected: result.research.tasksDetected,
          pending: result.research.pending,
        },
        prd: result.prd,
        approvals: {
          required: result.approvalRequired,
          pending: result.approvalRequired ? ['prd'] : [],
        },
      };

      if (result.execution) {
        payload.execution = {
          total_tasks: result.execution.totalTasks,
          completed: result.execution.completedTasks,
          failed: result.execution.failedTasks,
          duration_ms: Date.now() - startTime,
        };
      }

      emitStartSummary(
        payload,
        typedFlags.json,
        (msg) => this.log(msg),
        (msg) => this.warn(msg)
      );

      const exitCode = getStartExitCode(result);
      const duration = Date.now() - startTime;
      metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
        command: 'start',
      });
      metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: 'start',
        exit_code: exitCode.toString(),
      });
      await metrics.flush();
      commandSpan.end({ code: SpanStatusCode.OK });

      if (exitCode !== 0) {
        this.exit(exitCode);
      }
    } catch (error) {
      await flushTelemetryError(
        { commandName: 'start', startTime, logger, metrics, traceManager, commandSpan },
        error
      );

      await setLastError(
        runDir,
        orchestrator?.currentStep ?? 'start',
        formatErrorMessage(error),
        true
      );

      let cliErr: CliError;
      if (error instanceof CliError) {
        cliErr = error;
      } else if (error instanceof PrerequisiteError) {
        cliErr = new CliError(error.message, CliErrorCode.CONFIG_INVALID, {
          remediation: 'Fix the prerequisite issues and retry.',
          howToFix: 'Review the errors above and ensure all required tools are installed.',
          commonFixes: error.errors,
        });
      } else {
        cliErr = new CliError(
          `Start command failed: ${formatErrorMessage(error)}`,
          CliErrorCode.GENERAL,
          error instanceof Error ? { cause: error } : {}
        );
      }
      if (typedFlags.json) {
        this.log(JSON.stringify(formatErrorJson(cliErr), null, 2));
        this.exit(cliErr.exitCode);
      }
      this.error(cliErr.message, { exit: cliErr.exitCode });
    }
  }
}
