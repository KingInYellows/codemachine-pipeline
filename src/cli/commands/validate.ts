import { Flags } from '@oclif/core';
import { getRunDirectoryPath } from '../../persistence/runDirectoryManager';
import { StandardMetrics } from '../../telemetry/metrics';
import { createExecutionTelemetry } from '../../telemetry/executionTelemetry';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  requireFeatureId,
} from '../utils/runDirectory';
import { loadRepoConfig } from '../../core/config/RepoConfig';
import {
  initializeValidationRegistry,
  loadValidationRegistry,
  getValidationSummary,
  type ValidationCommandType,
  type ValidationLedger,
  type ValidationResult,
} from '../../workflows/validationRegistry';
import {
  executeAllValidations,
  executeValidationWithAutoFix,
  type AutoFixOptions,
  type AutoFixResult,
} from '../../workflows/autoFixEngine';
import { setJsonOutputMode } from '../utils/cliErrors';
import { TelemetryCommand } from './base';

/**
 * Validate command - Execute validation commands (lint/test/typecheck/build)
 *
 * Supports manual re-runs and provides detailed exit codes for automation
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: General error (config/setup issues)
 * - 10: Validation failed (one or more commands failed)
 * - 11: Retry limit exceeded (cannot proceed without manual intervention)
 */
export default class Validate extends TelemetryCommand {
  protected get commandName(): string {
    return 'validate';
  }

  static description =
    'Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --feature feature-auth-123',
    '<%= config.bin %> <%= command.id %> --command lint',
    '<%= config.bin %> <%= command.id %> --command test --no-auto-fix',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --max-retries 5',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to validate (defaults to current/latest)',
    }),
    command: Flags.string({
      char: 'c',
      description: 'Specific validation command to run (lint, test, typecheck, build)',
      options: ['lint', 'test', 'typecheck', 'build'],
    }),
    'auto-fix': Flags.boolean({
      description: 'Enable auto-fix for supported commands (e.g., lint --fix)',
      default: true,
      allowNo: true,
    }),
    'max-retries': Flags.integer({
      description: 'Override maximum retry attempts (ignores configured limits)',
      min: 0,
      max: 20,
    }),
    timeout: Flags.integer({
      description: 'Override command timeout in seconds',
      min: 10,
      max: 600,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed execution logs',
      default: false,
    }),
    init: Flags.boolean({
      description: 'Initialize validation registry from config (run this first)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Validate);

    if (flags.json) {
      setJsonOutputMode();
    }

    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, flags.feature);
    requireFeatureId(featureId, flags.feature);
    const runDirPath = getRunDirectoryPath(settings.baseDir, featureId);

    await this.runWithTelemetry(
      {
        runDirPath,
        featureId,
        jsonMode: flags.json,
        verbose: flags.verbose,
        spanAttributes: { auto_fix_enabled: flags['auto-fix'] },
      },
      async (ctx) => {
        if (!ctx.metrics || !ctx.logger) {
          throw new Error('Telemetry initialization failed for validate command');
        }

        const executionTelemetry = createExecutionTelemetry({
          logger: ctx.logger,
          metrics: ctx.metrics,
          runDir: runDirPath,
          runId: featureId,
          ...(ctx.traceManager ? { traceManager: ctx.traceManager } : {}),
          component: 'validation',
        });

        ctx.logger.info('Validate command invoked', {
          feature_id: featureId,
          command: flags.command ?? 'all',
          auto_fix: flags['auto-fix'],
          init_mode: flags.init,
        });

        // Handle --init flag
        if (flags.init) {
          await this.handleInit(runDirPath, settings.configPath, ctx.logger, ctx.metrics);
          return;
        }

        // Check if registry is initialized
        const registry = await loadValidationRegistry(runDirPath);
        if (!registry) {
          ctx.logger.error('Validation registry not initialized');
          this.error(
            'Validation registry not found. Run "codepipe validate --init" to initialize from config.',
            { exit: 1 }
          );
        }

        // Build execution options
        const options: AutoFixOptions = {
          enableAutoFix: flags['auto-fix'],
          respectRetryLimits: typeof flags['max-retries'] !== 'number',
        };

        if (typeof flags['max-retries'] === 'number') {
          options.maxRetriesOverride = flags['max-retries'];
        }

        if (typeof flags.timeout === 'number') {
          options.timeoutOverride = flags.timeout * 1000;
        }

        // Execute validation(s)
        let result: AutoFixResult;

        if (flags.command) {
          // Single command execution
          const commandType = flags.command as ValidationCommandType;
          const validationResult = await executeValidationWithAutoFix(
            runDirPath,
            commandType,
            options,
            ctx.logger,
            ctx.metrics,
            executionTelemetry
          );

          result = {
            success: validationResult.success,
            results: new Map([[commandType, validationResult]]),
            totalAttempts: validationResult.attempt.attempt_number,
            autoFixSuccesses:
              validationResult.attempt.auto_fix_attempted && validationResult.success ? 1 : 0,
            exceededRetryLimits: [],
            summary: buildSingleCommandSummary(validationResult),
          };
        } else {
          // All validations
          result = await executeAllValidations(
            runDirPath,
            undefined,
            options,
            ctx.logger,
            ctx.metrics,
            executionTelemetry
          );
        }

        // Load validation summary for JSON output
        const validationSummary = await getValidationSummary(runDirPath);

        // Output results
        if (flags.json) {
          this.outputJson(featureId, result, validationSummary);
        } else {
          this.outputHuman(result);
        }

        // Record success metrics
        if (ctx.commandSpan) {
          ctx.commandSpan.setAttribute('exit_code', result.success ? 0 : 10);
          ctx.commandSpan.setAttribute('validation_success', result.success);
          ctx.commandSpan.setAttribute('total_attempts', result.totalAttempts);
        }

        if (!result.success) {
          const exitCode = result.exceededRetryLimits.length > 0 ? 11 : 10;
          return {
            exitCode,
            extraLogFields: { success: result.success, total_attempts: result.totalAttempts },
          };
        }

        return {
          extraLogFields: { success: result.success, total_attempts: result.totalAttempts },
        };
      },
    );
  }

  private async handleInit(
    runDirPath: string,
    configPath: string,
    logger: StructuredLogger,
    metrics: MetricsCollector
  ): Promise<void> {
    logger.info('Initializing validation registry from config');

    // Load repo config
    const configResult = await loadRepoConfig(configPath);
    if (!configResult.success || !configResult.config) {
      logger.error('Failed to load repo config', { errors: configResult.errors });
      this.error(
        'Config validation failed. Fix configuration errors before initializing validation registry.',
        {
          exit: 1,
        }
      );
    }

    // Initialize registry
    const registry = await initializeValidationRegistry(runDirPath, configResult.config, logger);

    logger.info('Validation registry initialized successfully', {
      command_count: registry.commands.length,
    });

    this.log('');
    this.log('✓ Validation registry initialized successfully');
    this.log('');
    this.log('Registered commands:');
    for (const cmd of registry.commands) {
      const required = cmd.required ? '[required]' : '[optional]';
      const autoFix = cmd.supports_auto_fix ? '[auto-fix]' : '';
      this.log(`  • ${cmd.type} ${required} ${autoFix}`);
      this.log(`    Command: ${cmd.command}`);
      this.log(`    Max retries: ${cmd.max_retries}, Timeout: ${cmd.timeout_ms}ms`);
    }
    this.log('');
    this.log('Run "codepipe validate" to execute validation commands.');
    this.log('');

    metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
      command: 'validate.init',
      exit_code: '0',
    });
    await metrics.flush();
    await logger.flush();
  }

  private outputJson(
    featureId: string,
    result: AutoFixResult,
    validationSummary: ValidationLedger['summary'] | undefined
  ): void {
    const resultsArray = Array.from(result.results.entries()).map(
      ([commandType, validationResult]) => ({
        command_type: commandType,
        success: validationResult.success,
        exit_code: validationResult.exitCode,
        duration_ms: validationResult.durationMs,
        attempt_number: validationResult.attempt.attempt_number,
        auto_fix_attempted: validationResult.attempt.auto_fix_attempted,
        stdout_path: validationResult.attempt.stdout_path,
        stderr_path: validationResult.attempt.stderr_path,
        error_summary: validationResult.errorSummary,
      })
    );

    const output = {
      feature_id: featureId,
      success: result.success,
      total_attempts: result.totalAttempts,
      auto_fix_successes: result.autoFixSuccesses,
      exceeded_retry_limits: result.exceededRetryLimits,
      results: resultsArray,
      validation_summary: validationSummary,
      exit_code: result.success ? 0 : result.exceededRetryLimits.length > 0 ? 11 : 10,
    };

    this.log(JSON.stringify(output, null, 2));
  }

  private outputHuman(result: AutoFixResult): void {
    this.log('');
    this.log(result.summary);
    this.log('');

    if (result.success) {
      this.log('✓ All validations passed');
    } else {
      this.warn('✗ Validation failures detected');

      if (result.exceededRetryLimits.length > 0) {
        this.warn('');
        this.warn('Some commands exceeded retry limits and require manual intervention.');
        this.warn('Review error logs and fix issues before retrying.');
      }
    }

    this.log('');
  }
}

function buildSingleCommandSummary(result: ValidationResult): string {
  const lines: string[] = [];
  const status = result.success ? '✓ PASS' : '✗ FAIL';
  const attempts =
    result.attempt.attempt_number > 1 ? ` (${result.attempt.attempt_number} attempts)` : '';
  const autoFix = result.attempt.auto_fix_attempted && result.success ? ' [auto-fixed]' : '';

  lines.push(`Validation Result:`);
  lines.push('');
  lines.push(`  ${status} ${result.commandType}${attempts}${autoFix}`);

  if (!result.success && result.errorSummary) {
    lines.push('');
    lines.push('Error Summary:');
    const errorLines = result.errorSummary.split('\n');
    for (const line of errorLines.slice(0, 10)) {
      lines.push(`  ${line}`);
    }
    if (errorLines.length > 10) {
      lines.push(`  ... (${errorLines.length - 10} more lines)`);
    }
  }

  return lines.join('\n');
}
