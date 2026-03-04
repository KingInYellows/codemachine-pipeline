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
} from '../../core/config/RepoConfig';
import type { ZodIssue } from 'zod';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import { formatErrorMessage, setJsonOutputMode } from '../utils/cliErrors';

interface CommandTelemetryContext {
  startTime: number;
  metrics?: MetricsCollector;
  commandSpan?: ActiveSpan;
  traceManager?: TraceManager;
  logger?: StructuredLogger;
}

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

interface ProjectPaths {
  gitRoot: string;
  pipelineDir: string;
  configPath: string;
  logsDir: string;
}

interface InitResultPayload {
  status: string;
  config_path: string;
  exit_code: number;
  config: RepoConfig | undefined;
  warnings: string[];
  manifest_schema_doc: string;
  readiness_checklist: string;
  next_steps: string[];
}

/**
 * Init command - Initialize codemachine-pipeline in the current repository
 *
 * Exit codes:
 * - 0: Success
 * - 10: Validation error (config schema, missing required fields)
 * - 20: Environment issue (missing tools, filesystem permissions)
 * - 30: Credential issue (missing tokens, invalid scopes)
 */
export default class Init extends Command {
  static description = 'Initialize codemachine-pipeline with schema-validated configuration';

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

    if (flags.json) {
      setJsonOutputMode();
    }

    const ctx: CommandTelemetryContext = { startTime: Date.now() };

    try {
      const paths = this.resolveProjectPaths();
      this.initializeTelemetry(paths, flags, ctx);

      if (flags['validate-only']) {
        await this.handleValidateOnlyMode(paths.configPath, flags, ctx);
        return;
      }

      if (!flags.json && !flags['dry-run']) {
        this.log(`✓ Git repository detected at: ${paths.gitRoot}`);
      }

      if (await this.handleAlreadyInitialized(paths.configPath, flags, ctx)) {
        return;
      }

      if (await this.shouldAbortFromPrompt(paths.pipelineDir, flags)) {
        if (!flags.json) {
          this.warn('Initialization cancelled by user input.');
        }
        await this.finalizeTelemetry(0, ctx);
        return;
      }

      const config = this.scaffoldConfiguration(paths, flags);
      const validationResult = await this.validateNewConfiguration(paths.configPath, config, flags);

      if (!validationResult.success) {
        this.renderValidationFailure(paths.configPath, validationResult, flags);
        await this.exitCommand(10, ctx);
      }

      this.renderInitResult(
        flags,
        this.buildResultPayload(paths.configPath, validationResult, flags)
      );
      await this.finalizeTelemetry(0, ctx);
    } catch (error) {
      await this.handleRunError(error, ctx);
    }
  }

  // ── Step extraction methods ───────────────────────────────────────────

  /**
   * Resolve all project paths from the git root.
   */
  private resolveProjectPaths(): ProjectPaths {
    const gitRoot = this.findGitRoot();
    const pipelineDir = path.join(gitRoot, '.codepipe');
    return {
      gitRoot,
      pipelineDir,
      configPath: path.join(pipelineDir, 'config.json'),
      logsDir: path.join(pipelineDir, 'logs'),
    };
  }

  /**
   * Bootstrap telemetry (logger, metrics, traces) unless dry-run.
   */
  private initializeTelemetry(
    paths: ProjectPaths,
    flags: {
      'dry-run': boolean;
      json: boolean;
      yes: boolean;
      force: boolean;
      'validate-only': boolean;
    },
    ctx: CommandTelemetryContext
  ): void {
    if (flags['dry-run']) {
      return;
    }

    if (!fs.existsSync(paths.logsDir)) {
      fs.mkdirSync(paths.logsDir, { recursive: true });
    }

    const logger = createCliLogger('init', 'bootstrap', paths.logsDir, {
      minLevel: LogLevel.INFO,
      mirrorToStderr: !flags.json,
    });
    const metrics = createRunMetricsCollector(paths.pipelineDir, 'bootstrap');
    const traceManager = createRunTraceManager(paths.pipelineDir, 'bootstrap', logger);
    const commandSpan = traceManager.startSpan('cli.init');

    ctx.logger = logger;
    ctx.metrics = metrics;
    ctx.traceManager = traceManager;
    ctx.commandSpan = commandSpan;

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

  /**
   * Prompt the user for confirmation when running interactively.
   * Returns true if the user declined (command should abort).
   */
  private async shouldAbortFromPrompt(
    pipelineDir: string,
    flags: { 'dry-run': boolean; yes: boolean; json: boolean; force: boolean }
  ): Promise<boolean> {
    if (
      flags['dry-run'] ||
      flags.yes ||
      flags.json ||
      !process.stdin.isTTY ||
      !process.stdout.isTTY
    ) {
      return false;
    }

    const promptMessage = flags.force
      ? 'This will overwrite existing .codepipe/config.json. Continue?'
      : `Proceed with creating .codepipe scaffolding at ${pipelineDir}?`;
    const confirmed = await this.promptForConfirmation(promptMessage);
    return !confirmed;
  }

  /**
   * Create directory structure, generate default config, and write to disk.
   */
  private scaffoldConfiguration(
    paths: ProjectPaths,
    flags: { 'dry-run': boolean; json: boolean; force: boolean }
  ): RepoConfig {
    if (!flags['dry-run']) {
      this.createDirectoryStructure(paths.pipelineDir, flags.json);
    }

    const repoUrl = this.getRepositoryUrl(paths.gitRoot);
    const config = createDefaultConfig(repoUrl);

    if (!flags['dry-run']) {
      this.writeConfiguration(paths.configPath, config, flags.force, flags.json);
    }

    return config;
  }

  /**
   * Validate newly created (or in-memory) configuration.
   */
  private async validateNewConfiguration(
    configPath: string,
    config: RepoConfig,
    flags: { 'dry-run': boolean }
  ): Promise<ValidationResult> {
    return flags['dry-run'] ? this.validateInMemoryConfig(config) : loadRepoConfig(configPath);
  }

  /**
   * Render validation failure output (JSON or human-readable).
   */
  private renderValidationFailure(
    configPath: string,
    validationResult: ValidationResult,
    flags: { json: boolean }
  ): void {
    if (flags.json) {
      const errorPayload: ConfigValidationPayload = {
        status: 'validation_error',
        config_path: configPath,
        exit_code: 10,
        ...(validationResult.errors !== undefined && { errors: validationResult.errors }),
      };
      this.log(JSON.stringify(errorPayload, null, 2));
    } else {
      this.log('\n❌ Configuration validation failed after creation:\n');
      this.log(formatValidationErrors(validationResult.errors!));
    }
  }

  /**
   * Build the structured result payload for a successful init.
   */
  private buildResultPayload(
    configPath: string,
    validationResult: ValidationResult,
    flags: { 'dry-run': boolean }
  ): InitResultPayload {
    return {
      status: flags['dry-run'] ? 'dry_run_success' : 'initialized',
      config_path: configPath,
      exit_code: 0,
      config: validationResult.config,
      warnings: validationResult.warnings || [],
      manifest_schema_doc: 'docs/reference/run_directory_schema.md',
      readiness_checklist: 'plan/readiness_checklist.md',
      next_steps: [
        'Review and edit: .codepipe/config.json',
        'Enable integrations and set credentials (GITHUB_TOKEN, LINEAR_API_KEY, AGENT_ENDPOINT)',
        'Validate configuration: codepipe init --validate-only',
        'Check environment: codepipe doctor',
        'Start a feature: codepipe start --prompt "your feature description"',
      ],
    };
  }

  /**
   * Determine error exit code, finalize telemetry, and re-throw.
   */
  private async handleRunError(error: unknown, ctx: CommandTelemetryContext): Promise<never> {
    const exitCode = this.determineErrorExitCode(error);
    await this.finalizeTelemetry(exitCode, ctx, error);

    if (error && typeof error === 'object' && 'oclif' in error) {
      throw error as Error;
    }

    if (error instanceof Error) {
      this.error(`Initialization failed: ${error.message}`, { exit: exitCode });
    } else {
      this.error('Initialization failed with an unknown error', { exit: exitCode });
    }
    // Safety: should never be reached if this.error() is typed `never`
    throw new Error('handleRunError: unreachable');
  }

  /**
   * Map error types to structured exit codes.
   */
  private determineErrorExitCode(error: unknown): number {
    if (!(error instanceof Error)) {
      return 1;
    }
    if (error.message.includes('Not a git repository')) {
      return 20;
    }
    if (error.message.includes('permission denied') || error.message.includes('EACCES')) {
      return 20;
    }
    return 1;
  }

  // ── Delegate methods ──────────────────────────────────────────────────

  /**
   * Handle --validate-only mode: validate existing config and exit.
   */
  private async handleValidateOnlyMode(
    configPath: string,
    flags: { json: boolean; 'validate-only': boolean },
    ctx: CommandTelemetryContext
  ): Promise<void> {
    if (!flags.json) {
      this.log('Validating existing configuration...');
    }
    const validationPayload = await this.validateExistingConfig(configPath, flags.json);
    const exitCode = validationPayload.exit_code;

    if (flags.json) {
      this.log(JSON.stringify(validationPayload, null, 2));
    }

    if (exitCode !== 0) {
      await this.exitCommand(exitCode, ctx);
    }

    await this.finalizeTelemetry(exitCode, ctx);
  }

  /**
   * Render the final success output for the init command (json or human-readable).
   */
  private renderInitResult(
    flags: { json: boolean; 'dry-run': boolean },
    resultPayload: InitResultPayload
  ): void {
    if (flags.json) {
      this.log(JSON.stringify(resultPayload, null, 2));
      return;
    }

    if (resultPayload.warnings.length > 0) {
      this.log('\n⚠ Configuration created with warnings:');
      for (const warning of resultPayload.warnings) {
        this.warn(warning);
      }
      this.log('');
    }

    this.log('');
    if (flags['dry-run']) {
      this.log('✓ Dry run completed successfully (no files written)');
    } else {
      this.log('✓ codemachine-pipeline initialized successfully!');
    }
    this.log('');
    this.log('Configuration file: ' + resultPayload.config_path);
    this.log('');
    this.log('Next steps:');
    for (const step of resultPayload.next_steps) {
      this.log(`  • ${step}`);
    }
    this.log('');
  }

  /**
   * Flush telemetry artifacts consistently for all exit paths.
   */
  private async finalizeTelemetry(
    exitCode: number,
    ctx: CommandTelemetryContext,
    error?: unknown
  ): Promise<void> {
    const { startTime, metrics, commandSpan, traceManager, logger } = ctx;

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
          error: formatErrorMessage(error),
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
    ctx: CommandTelemetryContext,
    error?: unknown
  ): Promise<never> {
    await this.finalizeTelemetry(exitCode, ctx, error);
    process.exit(exitCode);
  }

  /**
   * Handle the case where config already exists (no --force, no --dry-run).
   * Returns true if the command should return early (already initialized path handled).
   */
  private async handleAlreadyInitialized(
    configPath: string,
    flags: { json: boolean; force: boolean; 'dry-run': boolean },
    ctx: CommandTelemetryContext
  ): Promise<boolean> {
    if (!fs.existsSync(configPath) || flags.force || flags['dry-run']) {
      return false;
    }

    const result = await loadRepoConfig(configPath);

    if (!flags.json) {
      this.warn(`Configuration already exists at: ${configPath}`);
      this.warn('Use --force to re-initialize or --validate-only to check configuration');
    }

    if (!result.success) {
      const exitCode = 10;
      if (flags.json) {
        const errorPayload: ConfigValidationPayload = {
          status: 'validation_error',
          config_path: configPath,
          exit_code: exitCode,
          ...(result.errors !== undefined && { errors: result.errors }),
        };
        this.log(JSON.stringify(errorPayload, null, 2));
      } else {
        this.log('\nExisting configuration has validation errors:');
        this.log(formatValidationErrors(result.errors!));
      }
      await this.exitCommand(exitCode, ctx);
    }

    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            status: 'already_initialized',
            config_path: configPath,
            exit_code: 0,
            warnings: result.warnings ?? [],
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
    await this.finalizeTelemetry(0, ctx);
    return true;
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
  private async validateExistingConfig(
    configPath: string,
    jsonMode: boolean
  ): Promise<ConfigValidationPayload> {
    if (!fs.existsSync(configPath)) {
      const payload: ConfigValidationPayload = {
        status: 'not_found',
        config_path: configPath,
        exit_code: 10,
        message: `Configuration file not found: ${configPath}`,
        suggestion: 'Run "codepipe init" first to create configuration.',
      };

      if (!jsonMode) {
        this.log(`\n❌ Configuration file not found: ${configPath}\n`);
        this.log('Run "codepipe init" first to create configuration.\n');
      }

      return payload;
    }

    const result = await loadRepoConfig(configPath);

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
