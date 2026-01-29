import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  createDefaultConfig,
  loadRepoConfig,
  formatValidationErrors,
  RepoConfigSchema,
  type RepoConfig,
  type ValidationResult,
  type ValidationError,
} from '../../core/config/repo_config';
import type { ZodIssue } from 'zod';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';

interface ConfigValidationPayload {
  status: 'not_found' | 'validation_error' | 'valid';
  config_path: string;
  exit_code: number;
  message?: string;
  suggestion?: string;
  errors?: ValidationError[];
  warnings?: string[];
  config?: RepoConfig;
  summary?: {
    schema_version: string;
    project_id: string;
    default_branch: string;
    github_enabled: boolean;
    linear_enabled: boolean;
    context_token_budget: number;
    max_concurrent_tasks: number;
  };
}

/**
 * Init command - Initialize ai-feature-pipeline in the current repository
 * Implements FR-1: Initialize RepoConfig with git detection and directory setup
 * Implements FR-17: Schema-backed configuration with credentials validation
 *
 * Exit codes:
 * - 0: Success
 * - 10: Validation error (config schema, missing required fields)
 * - 20: Environment issue (missing tools, filesystem permissions)
 * - 30: Credential issue (missing tokens, invalid scopes)
 */
export default class Init extends Command {
  static description = 'Initialize ai-feature-pipeline with schema-validated configuration';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --validate-only',
    '<%= config.bin %> <%= command.id %> --dry-run --json',
    '<%= config.bin %> <%= command.id %> --yes',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force re-initialization even if config already exists',
      default: false,
    }),
    'validate-only': Flags.boolean({
      description: 'Only validate existing config without creating new files',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Compute config and validation without creating files',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip interactive confirmations (assume yes)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    const startTime = Date.now();

    // Set JSON output mode environment variable
    if (flags.json) {
      process.env.JSON_OUTPUT = '1';
    }

    // Initialize telemetry (logger, metrics, traces)
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;
    let exitCode = 0;

    try {
      // Step 1: Detect git repository root
      const gitRoot = this.findGitRoot();
      const pipelineDir = path.join(gitRoot, '.ai-feature-pipeline');
      const configPath = path.join(pipelineDir, 'config.json');
      const logsDir = path.join(pipelineDir, 'logs');
      const telemetryEnabled = !flags['dry-run'];

      if (telemetryEnabled) {
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        logger = createCliLogger('init', 'bootstrap', logsDir, {
          minLevel: LogLevel.INFO,
          mirrorToStderr: !flags.json,
        });
        metrics = createRunMetricsCollector(pipelineDir, 'bootstrap');
        traceManager = createRunTraceManager(pipelineDir, 'bootstrap', logger);
        commandSpan = traceManager.startSpan('cli.init');
        commandSpan.setAttribute('dry_run', flags['dry-run']);
        commandSpan.setAttribute('json_mode', flags.json);
        commandSpan.setAttribute('yes_mode', flags.yes);
        commandSpan.setAttribute('force', flags.force);
        commandSpan.setAttribute('validate_only', flags['validate-only']);

        logger.info('Init command invoked', {
          dry_run: flags['dry-run'],
          json_mode: flags.json,
          yes_mode: flags.yes,
          force: flags.force,
          validate_only: flags['validate-only'],
        });
      }

      // Validate-only mode
      if (flags['validate-only']) {
        if (!flags.json) {
          this.log('Validating existing configuration...');
        }
        const validationPayload = this.validateExistingConfig(configPath, flags.json);
        exitCode = validationPayload.exit_code;

        if (flags.json) {
          this.log(JSON.stringify(validationPayload, null, 2));
        }

        if (exitCode !== 0) {
          await this.exitCommand(exitCode, startTime, metrics, commandSpan, traceManager, logger);
        }

        await this.finalizeTelemetry(
          exitCode,
          startTime,
          metrics,
          commandSpan,
          traceManager,
          logger
        );
        return;
      }

      if (!flags.json && !flags['dry-run']) {
        this.log(`✓ Git repository detected at: ${gitRoot}`);
      }

      // Step 2: Check if already initialized
      if (fs.existsSync(configPath) && !flags.force && !flags['dry-run']) {
        const result = loadRepoConfig(configPath);

        if (!flags.json) {
          this.warn(`Configuration already exists at: ${configPath}`);
          this.warn('Use --force to re-initialize or --validate-only to check configuration');
        }

        if (!result.success) {
          exitCode = 10;
          if (flags.json) {
            this.log(
              JSON.stringify(
                {
                  status: 'validation_error',
                  config_path: configPath,
                  exit_code: exitCode,
                  errors: result.errors,
                },
                null,
                2
              )
            );
          } else {
            this.log('\nExisting configuration has validation errors:');
            this.log(formatValidationErrors(result.errors!));
          }
          await this.exitCommand(exitCode, startTime, metrics, commandSpan, traceManager, logger);
        }

        if (flags.json) {
          this.log(
            JSON.stringify(
              {
                status: 'already_initialized',
                config_path: configPath,
                exit_code: 0,
                warnings: result.warnings || [],
                config: result.config,
              },
              null,
              2
            )
          );
        } else {
          if (result.warnings && result.warnings.length > 0) {
            this.log('\nWarnings:');
            for (const warning of result.warnings) {
              this.warn(warning);
            }
          }
          this.log('\n✓ Configuration is valid');
        }
        await this.finalizeTelemetry(
          exitCode,
          startTime,
          metrics,
          commandSpan,
          traceManager,
          logger
        );
        return;
      }

      // Step 2b: Confirm initialization when interactive
      if (
        !flags['dry-run'] &&
        !flags.yes &&
        !flags.json &&
        process.stdin.isTTY &&
        process.stdout.isTTY
      ) {
        const promptMessage = flags.force
          ? 'This will overwrite existing .ai-feature-pipeline/config.json. Continue?'
          : `Proceed with creating .ai-feature-pipeline scaffolding at ${pipelineDir}?`;
        const confirmed = await this.promptForConfirmation(promptMessage);

        if (!confirmed) {
          if (!flags.json) {
            this.warn('Initialization cancelled by user input.');
          }
          await this.finalizeTelemetry(
            exitCode,
            startTime,
            metrics,
            commandSpan,
            traceManager,
            logger
          );
          return;
        }
      }

      // Step 3: Create directory structure (skip in dry-run)
      if (!flags['dry-run']) {
        this.createDirectoryStructure(pipelineDir, flags.json);
      }

      // Step 4: Get repository URL for config
      const repoUrl = this.getRepositoryUrl(gitRoot);

      // Step 5: Create schema-backed configuration
      const config = createDefaultConfig(repoUrl);

      // Step 6: Write configuration (skip in dry-run)
      if (!flags['dry-run']) {
        this.writeConfiguration(configPath, config, flags.force, flags.json);
      }

      // Step 7: Validate the created/computed configuration
      const validationResult = flags['dry-run']
        ? this.validateInMemoryConfig(config)
        : loadRepoConfig(configPath);

      if (!validationResult.success) {
        exitCode = 10;
        if (flags.json) {
          this.log(
            JSON.stringify(
              {
                status: 'validation_error',
                config_path: configPath,
                exit_code: exitCode,
                errors: validationResult.errors,
              },
              null,
              2
            )
          );
        } else {
          this.log('\n❌ Configuration validation failed after creation:\n');
          this.log(formatValidationErrors(validationResult.errors!));
        }
        await this.exitCommand(exitCode, startTime, metrics, commandSpan, traceManager, logger);
      }

      // Build result payload
      const resultPayload = {
        status: flags['dry-run'] ? 'dry_run_success' : 'initialized',
        config_path: configPath,
        exit_code: 0,
        config: validationResult.config,
        warnings: validationResult.warnings || [],
        manifest_schema_doc: 'docs/requirements/run_directory_schema.md',
        readiness_checklist: 'plan/readiness_checklist.md',
        next_steps: [
          'Review and edit: .ai-feature-pipeline/config.json',
          'Enable integrations and set credentials (GITHUB_TOKEN, LINEAR_API_KEY, AGENT_ENDPOINT)',
          'Validate configuration: ai-feature init --validate-only',
          'Check environment: ai-feature doctor',
          'Start a feature: ai-feature start --prompt "your feature description"',
        ],
      };

      // Output results
      if (flags.json) {
        this.log(JSON.stringify(resultPayload, null, 2));
      } else {
        // Display warnings about missing credentials
        if (validationResult.warnings && validationResult.warnings.length > 0) {
          this.log('\n⚠ Configuration created with warnings:');
          for (const warning of validationResult.warnings) {
            this.warn(warning);
          }
          this.log('');
        }

        // Success message
        this.log('');
        if (flags['dry-run']) {
          this.log('✓ Dry run completed successfully (no files written)');
        } else {
          this.log('✓ ai-feature-pipeline initialized successfully!');
        }
        this.log('');
        this.log('Configuration file: ' + configPath);
        this.log('');
        this.log('Next steps:');
        for (const step of resultPayload.next_steps) {
          this.log(`  • ${step}`);
        }
        this.log('');
      }

      await this.finalizeTelemetry(exitCode, startTime, metrics, commandSpan, traceManager, logger);
    } catch (error) {
      // Determine exit code based on error type
      let errorExitCode = 1;
      if (error instanceof Error) {
        if (error.message.includes('Not a git repository')) {
          errorExitCode = 20;
        } else if (
          error.message.includes('permission denied') ||
          error.message.includes('EACCES')
        ) {
          errorExitCode = 20;
        }
      }

      await this.finalizeTelemetry(
        errorExitCode,
        startTime,
        metrics,
        commandSpan,
        traceManager,
        logger,
        error
      );

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Initialization failed: ${error.message}`, { exit: errorExitCode });
      } else {
        this.error('Initialization failed with an unknown error', { exit: errorExitCode });
      }
    }
  }

  /**
   * Flush telemetry artifacts consistently for all exit paths.
   */
  private async finalizeTelemetry(
    exitCode: number,
    startTime: number,
    metrics?: MetricsCollector,
    commandSpan?: ActiveSpan,
    traceManager?: TraceManager,
    logger?: StructuredLogger,
    error?: unknown
  ): Promise<void> {
    if (metrics) {
      const duration = Date.now() - startTime;
      metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, { command: 'init' });
      metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
        command: 'init',
        exit_code: String(exitCode),
      });
      await metrics.flush();
    }

    if (commandSpan) {
      commandSpan.setAttribute('exit_code', exitCode);
      const spanErrored = exitCode !== 0 || Boolean(error);
      if (spanErrored) {
        commandSpan.setAttribute('error', true);
        if (error instanceof Error) {
          commandSpan.setAttribute('error.message', error.message);
          commandSpan.setAttribute('error.name', error.name);
        }
      }
      const spanStatus = exitCode === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR;
      if (error instanceof Error) {
        commandSpan.end({ code: spanStatus, message: error.message });
      } else {
        commandSpan.end({ code: spanStatus });
      }
    }

    if (traceManager) {
      await traceManager.flush();
    }

    if (logger) {
      const duration = Date.now() - startTime;
      if (error !== undefined) {
        logger.error('Init command failed', {
          exit_code: exitCode,
          duration_ms: duration,
          error: this.formatUnknownError(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } else if (exitCode !== 0) {
        logger.warn('Init command completed with warnings/issues', {
          exit_code: exitCode,
          duration_ms: duration,
        });
      } else {
        logger.info('Init command completed', { exit_code: exitCode, duration_ms: duration });
      }
      await logger.flush();
    }
  }

  private async exitCommand(
    exitCode: number,
    startTime: number,
    metrics?: MetricsCollector,
    commandSpan?: ActiveSpan,
    traceManager?: TraceManager,
    logger?: StructuredLogger,
    error?: unknown
  ): Promise<never> {
    await this.finalizeTelemetry(
      exitCode,
      startTime,
      metrics,
      commandSpan,
      traceManager,
      logger,
      error
    );
    process.exit(exitCode);
  }

  /**
   * Prompt operator for confirmation when running interactively.
   */
  private async promptForConfirmation(message: string): Promise<boolean> {
    const rl = createInterface({ input, output });
    try {
      const response = await rl.question(`${message} (y/n) `);
      const normalized = response.trim().toLowerCase();
      return normalized === 'y' || normalized === 'yes';
    } finally {
      rl.close();
    }
  }

  private formatUnknownError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }

  /**
   * Find git repository root by walking up directory tree
   * @returns Absolute path to git repository root
   * @throws Error if not in a git repository
   */
  private findGitRoot(): string {
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (!gitRoot) {
        throw new Error('Could not determine git repository root');
      }

      return gitRoot;
    } catch {
      throw new Error(
        'Not a git repository. Please run this command from within a git repository.'
      );
    }
  }

  /**
   * Get repository URL from git config
   * @param gitRoot Git repository root path
   * @returns Repository URL or placeholder
   */
  private getRepositoryUrl(gitRoot: string): string {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      return remoteUrl || 'https://github.com/org/repo.git';
    } catch {
      // No remote configured, use placeholder
      return 'https://github.com/org/repo.git';
    }
  }

  /**
   * Create directory structure for pipeline
   * @param pipelineDir Base pipeline directory path
   */
  private createDirectoryStructure(pipelineDir: string, silent = false): void {
    const directories = [
      pipelineDir,
      path.join(pipelineDir, 'runs'),
      path.join(pipelineDir, 'logs'),
      path.join(pipelineDir, 'artifacts'),
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        if (!silent) {
          this.log(`✓ Created directory: ${dir}`);
        }
      }
    }
  }

  /**
   * Write configuration to file with schema validation
   * @param configPath Path to config.json
   * @param config Configuration object
   * @param force Whether to overwrite existing config
   * @param silent Suppress log output for JSON mode
   */
  private writeConfiguration(
    configPath: string,
    config: RepoConfig,
    force: boolean,
    silent = false
  ): void {
    if (fs.existsSync(configPath) && !force) {
      throw new Error('Configuration file already exists. Use --force to overwrite.');
    }

    // Write with pretty formatting
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    if (!silent) {
      this.log(`✓ Created configuration file: ${configPath}`);
    }
  }

  /**
   * Validate configuration in memory (for dry-run mode)
   * @param config Configuration object
   * @returns Validation result
   */
  private validateInMemoryConfig(config: RepoConfig): ValidationResult {
    // Use the schema to validate, then apply environment checks
    const parseResult = RepoConfigSchema.safeParse(config);

    if (!parseResult.success) {
      const errors: ValidationError[] = parseResult.error.issues.map((issue: ZodIssue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      }));

      return {
        success: false,
        errors,
      };
    }

    // Check environment variables for credentials
    const warnings: string[] = [];

    if (config.github.enabled) {
      const githubToken = process.env[config.github.token_env_var];
      if (!githubToken) {
        warnings.push(
          `GitHub integration enabled but ${config.github.token_env_var} not set. ` +
            `Set ${config.github.token_env_var} with scopes: ${config.github.required_scopes.join(', ')}`
        );
      }
    }

    if (config.linear.enabled) {
      const linearKey = process.env[config.linear.api_key_env_var];
      if (!linearKey) {
        warnings.push(`Linear integration enabled but ${config.linear.api_key_env_var} not set`);
      }
    }

    if (!config.runtime.agent_endpoint) {
      const agentEndpoint = process.env[config.runtime.agent_endpoint_env_var];
      if (!agentEndpoint) {
        warnings.push(
          `Agent endpoint not configured. Set ${config.runtime.agent_endpoint_env_var} or add runtime.agent_endpoint to config`
        );
      }
    }

    const validationResult: ValidationResult = {
      success: true,
      config: parseResult.data,
    };

    if (warnings.length > 0) {
      validationResult.warnings = warnings;
    }

    return validationResult;
  }

  /**
   * Validate existing configuration and display results
   * @param configPath Path to config.json
   * @param jsonMode Whether to output JSON or display human-readable results
   * @returns Validation payload with exit code
   */
  private validateExistingConfig(configPath: string, jsonMode: boolean): ConfigValidationPayload {
    if (!fs.existsSync(configPath)) {
      const payload: ConfigValidationPayload = {
        status: 'not_found',
        config_path: configPath,
        exit_code: 10,
        message: `Configuration file not found: ${configPath}`,
        suggestion: 'Run "ai-feature init" first to create configuration.',
      };

      if (!jsonMode) {
        this.log(`\n❌ Configuration file not found: ${configPath}\n`);
        this.log('Run "ai-feature init" first to create configuration.\n');
      }

      return payload;
    }

    const result = loadRepoConfig(configPath);

    if (!result.success) {
      const payload: ConfigValidationPayload = {
        status: 'validation_error',
        config_path: configPath,
        exit_code: 10,
      };

      if (result.errors) {
        payload.errors = result.errors;
      }

      if (!jsonMode) {
        this.log('\n❌ Configuration validation failed:\n');
        this.log(formatValidationErrors(result.errors!));
      }

      return payload;
    }

    const payload: ConfigValidationPayload = {
      status: 'valid',
      config_path: configPath,
      exit_code: 0,
      warnings: result.warnings || [],
    };

    if (result.config) {
      payload.config = result.config;
      payload.summary = {
        schema_version: result.config.schema_version,
        project_id: result.config.project.id,
        default_branch: result.config.project.default_branch,
        github_enabled: result.config.github.enabled,
        linear_enabled: result.config.linear.enabled,
        context_token_budget: result.config.runtime.context_token_budget,
        max_concurrent_tasks: result.config.runtime.max_concurrent_tasks,
      };
    }

    if (!jsonMode) {
      this.log('✓ Configuration is valid');

      if (result.warnings && result.warnings.length > 0) {
        this.log('\n⚠ Warnings:');
        for (const warning of result.warnings) {
          this.warn(warning);
        }
        this.log('\nNote: Warnings do not prevent operation but may affect functionality.');
      }

      // Display configuration summary
      if (result.config) {
        this.log('\nConfiguration Summary:');
        this.log(`  Schema Version: ${result.config.schema_version}`);
        this.log(`  Project ID: ${result.config.project.id}`);
        this.log(`  Default Branch: ${result.config.project.default_branch}`);
        this.log(`  GitHub Integration: ${result.config.github.enabled ? 'enabled' : 'disabled'}`);
        this.log(`  Linear Integration: ${result.config.linear.enabled ? 'enabled' : 'disabled'}`);
        this.log(`  Context Token Budget: ${result.config.runtime.context_token_budget}`);
        this.log(`  Max Concurrent Tasks: ${result.config.runtime.max_concurrent_tasks}`);
        this.log('');
      }
    }

    return payload;
  }
}
