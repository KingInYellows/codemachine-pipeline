import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { loadRepoConfig } from '../../core/config/RepoConfig';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector } from '../../telemetry/metrics';
import { createRunTraceManager } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';
import { checkCodeMachineCli } from '../diagnostics';
import { setJsonOutputMode, rethrowIfOclifError } from '../utils/cliErrors';
import { CONFIG_RELATIVE_PATH } from '../utils/runDirectory';
import { flushTelemetryError, flushTelemetrySuccess } from '../utils/telemetryLifecycle';

/**
 * Diagnostic check result
 */
interface DiagnosticCheck {
  name: string;
  category: 'credential' | 'environment' | 'config' | 'general';
  status: 'pass' | 'fail' | 'warn';
  message: string;
  remediation?: string;
  /** Intentional: details vary per diagnostic check type (version, path, counts, etc.) */
  details?: Record<string, unknown>;
}

/**
 * Doctor command payload for JSON output
 */
interface DoctorPayload {
  status: 'healthy' | 'issues_detected' | 'critical_failures';
  exit_code: number;
  checks: DiagnosticCheck[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  config_path: string;
  timestamp: string;
}

type EnvCheckDetails = Record<string, string | number>;

interface EnvCheckDescriptor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config type not fully specified for this usage
  enabled: (c: any) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config type not fully specified for this usage
  envVar: (c: any) => string;
  label: string;
  displayName?: (varName: string) => string;
  failStatus: 'fail' | 'warn';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config type not fully specified for this usage
  failRemediation: (c: any, varName: string) => string;
  passMessage: string;
  failMessage: string;
  showValueInPass?: boolean;
  /** Produce details for a passing check. Defaults to `{ length: value.length }` if omitted. */
  passDetails?: (value: string) => EnvCheckDetails;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config type not fully specified for this usage
  resolveValue?: (c: any, varName: string) => string | undefined;
}

/**
 * Determine exit code and status from diagnostic check results.
 * Priority: credential failures (30) > environment failures (20) > config failures (10) > generic (1).
 */
function determineExitCode(checks: DiagnosticCheck[]): {
  exitCode: number;
  status: DoctorPayload['status'];
} {
  const failed = checks.filter((c) => c.status === 'fail');
  const hasWarnings = checks.some((c) => c.status === 'warn');

  if (failed.length === 0) {
    return { exitCode: 0, status: hasWarnings ? 'issues_detected' : 'healthy' };
  }

  const hasCredentialFailure = failed.some((c) => c.category === 'credential');
  const hasEnvironmentFailure = failed.some((c) => c.category === 'environment');
  const hasConfigFailure = failed.some((c) => c.category === 'config');

  if (hasCredentialFailure) return { exitCode: 30, status: 'critical_failures' };
  if (hasEnvironmentFailure) return { exitCode: 20, status: 'critical_failures' };
  if (hasConfigFailure) return { exitCode: 10, status: 'critical_failures' };
  return { exitCode: 1, status: 'critical_failures' };
}

/**
 * Doctor command - Environment diagnostics and readiness checks
 * Implements I1.T8: System environment validation
 *
 * Exit codes:
 * - 0: All checks passed (warnings allowed)
 * - 10: Validation error (config issues)
 * - 20: Environment issue (missing tools, version mismatches, filesystem)
 * - 30: Credential issue (missing tokens, invalid scopes)
 */
export default class Doctor extends Command {
  static description = 'Run environment diagnostics and readiness checks';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --verbose',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed diagnostic information',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const startTime = Date.now();

    // Set JSON output mode environment variable
    if (flags.json) {
      setJsonOutputMode();
    }

    // Initialize telemetry (logger, metrics, traces)
    let logger: StructuredLogger | undefined;
    let metrics: MetricsCollector | undefined;
    let traceManager: TraceManager | undefined;
    let commandSpan: ActiveSpan | undefined;

    const checks: DiagnosticCheck[] = [];

    try {
      // Try to initialize telemetry. Create local directories if missing.
      const pipelineDir = path.join(process.cwd(), '.codepipe');
      const logsDir = path.join(pipelineDir, 'logs');
      let telemetryReady = false;

      try {
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        telemetryReady = true;
      } catch {
        telemetryReady = false;
      }

      if (telemetryReady) {
        logger = createCliLogger('doctor', 'diagnostics', logsDir, {
          minLevel: flags.verbose ? LogLevel.DEBUG : LogLevel.INFO,
          mirrorToStderr: !flags.json,
        });
        metrics = createRunMetricsCollector(pipelineDir, 'diagnostics');
        traceManager = createRunTraceManager(pipelineDir, 'diagnostics', logger);
        commandSpan = traceManager.startSpan('cli.doctor');
        commandSpan.setAttribute('json_mode', flags.json);
        commandSpan.setAttribute('verbose', flags.verbose);

        logger.info('Doctor command invoked', {
          json_mode: flags.json,
          verbose: flags.verbose,
        });
      }

      // Run diagnostic checks (sync checks first, then async)
      checks.push(this.checkNodeVersion());
      checks.push(this.checkGitInstalled());
      checks.push(this.checkNpmInstalled());
      checks.push(this.checkDockerInstalled());
      checks.push(this.checkGitRepository());
      checks.push(this.checkFilesystemPermissions());
      checks.push(this.checkOutboundConnectivity());

      // Pre-load config once for checks that need it
      const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config used for minimal property extraction only
      let loadedConfig: any;
      if (fs.existsSync(configPath)) {
        const configResult = await loadRepoConfig(configPath);
        if (configResult.success && configResult.config) {
          loadedConfig = configResult.config;
        }
      }

      // Async checks
      checks.push(await this.checkRepoConfig());
      checks.push(await this.checkCodeMachineCli(loadedConfig));
      checks.push(...this.checkEnvironmentVariables(loadedConfig));

      // Compute summary
      const summary = {
        total: checks.length,
        passed: checks.filter((c) => c.status === 'pass').length,
        warnings: checks.filter((c) => c.status === 'warn').length,
        failed: checks.filter((c) => c.status === 'fail').length,
      };

      // Determine exit code and status
      const { exitCode, status } = determineExitCode(checks);

      // Build payload
      const payload: DoctorPayload = {
        status,
        exit_code: exitCode,
        checks,
        summary,
        config_path: path.resolve(process.cwd(), CONFIG_RELATIVE_PATH),
        timestamp: new Date().toISOString(),
      };

      // Output results
      if (flags.json) {
        this.log(JSON.stringify(payload, null, 2));
      } else {
        this.printHumanReadable(payload, flags.verbose);
      }

      if (commandSpan) {
        commandSpan.setAttribute('checks_total', summary.total);
        commandSpan.setAttribute('checks_passed', summary.passed);
        commandSpan.setAttribute('checks_failed', summary.failed);
      }

      await flushTelemetrySuccess(
        { commandName: 'doctor', startTime, logger, metrics, traceManager, commandSpan },
        {
          exit_code: exitCode,
          checks_total: summary.total,
          checks_passed: summary.passed,
          checks_failed: summary.failed,
        },
        exitCode
      );

      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      await flushTelemetryError(
        { commandName: 'doctor', startTime, logger, metrics, traceManager, commandSpan },
        error
      );

      rethrowIfOclifError(error);

      if (error instanceof Error) {
        this.error(`Doctor command failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Doctor command failed with an unknown error', { exit: 1 });
      }
    }
  }

  /**
   * Check Node.js version against requirements (v20 or v24 LTS)
   */
  private checkNodeVersion(): DiagnosticCheck {
    try {
      const versionOutput = process.version; // e.g., "v24.1.0"
      const majorVersion = parseInt(versionOutput.slice(1).split('.')[0], 10);

      if (majorVersion >= 24) {
        return {
          name: 'Node.js Version',
          category: 'environment',
          status: 'pass',
          message: `Node.js ${versionOutput} (v24 LTS preferred)`,
          details: { version: versionOutput, major: majorVersion },
        };
      } else if (majorVersion >= 20) {
        return {
          name: 'Node.js Version',
          category: 'environment',
          status: 'warn',
          message: `Node.js ${versionOutput} (v20 acceptable, v24 recommended)`,
          remediation: 'Upgrade to Node.js v24 LTS for optimal performance',
          details: { version: versionOutput, major: majorVersion },
        };
      } else {
        return {
          name: 'Node.js Version',
          category: 'environment',
          status: 'fail',
          message: `Node.js ${versionOutput} is below minimum required version`,
          remediation: 'Install Node.js v20 or v24 LTS from https://nodejs.org/',
          details: { version: versionOutput, major: majorVersion },
        };
      }
    } catch {
      return {
        name: 'Node.js Version',
        category: 'environment',
        status: 'fail',
        message: 'Unable to determine Node.js version',
        remediation: 'Ensure Node.js is properly installed',
      };
    }
  }

  private checkToolVersion(options: {
    name: string;
    category: DiagnosticCheck['category'];
    command: string;
    failStatus: 'fail' | 'warn';
    failRemediation: string;
    messageFormatter?: (version: string) => string;
  }): DiagnosticCheck {
    const { name, category, command, failStatus, failRemediation, messageFormatter } = options;
    try {
      const result = spawnSync(command, ['--version'], { encoding: 'utf-8', timeout: 5000 });
      if (result.status === 0) {
        const version = result.stdout.trim();
        return {
          name,
          category,
          status: 'pass',
          message: messageFormatter ? messageFormatter(version) : version,
          details: { version },
        };
      }
      return {
        name,
        category,
        status: failStatus,
        message: `${name} command failed`,
        remediation: failRemediation,
      };
    } catch {
      return {
        name,
        category,
        status: failStatus,
        message: `${name} not found`,
        remediation: failRemediation,
      };
    }
  }

  private checkGitInstalled(): DiagnosticCheck {
    return this.checkToolVersion({
      name: 'Git CLI',
      category: 'environment',
      command: 'git',
      failStatus: 'fail',
      failRemediation: 'Install git from https://git-scm.com/',
    });
  }

  private checkNpmInstalled(): DiagnosticCheck {
    return this.checkToolVersion({
      name: 'npm',
      category: 'environment',
      command: 'npm',
      failStatus: 'fail',
      failRemediation: 'npm should be installed with Node.js',
      messageFormatter: (v) => `npm ${v}`,
    });
  }

  private checkDockerInstalled(): DiagnosticCheck {
    return this.checkToolVersion({
      name: 'Docker',
      category: 'environment',
      command: 'docker',
      failStatus: 'warn',
      failRemediation: 'Install Docker from https://docker.com/ (optional but recommended)',
    });
  }

  /**
   * Check if current directory is a git repository
   */
  private checkGitRepository(): DiagnosticCheck {
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (gitRoot) {
        return {
          name: 'Git Repository',
          category: 'environment',
          status: 'pass',
          message: `Git repository detected at ${gitRoot}`,
          details: { git_root: gitRoot },
        };
      } else {
        return {
          name: 'Git Repository',
          category: 'environment',
          status: 'fail',
          message: 'Not in a git repository',
          remediation: 'Run "git init" or navigate to a git repository',
        };
      }
    } catch {
      return {
        name: 'Git Repository',
        category: 'environment',
        status: 'fail',
        message: 'Not in a git repository',
        remediation: 'Run "git init" or navigate to a git repository',
      };
    }
  }

  /**
   * Check filesystem write permissions
   */
  private checkFilesystemPermissions(): DiagnosticCheck {
    try {
      const testDir = path.join(process.cwd(), '.codepipe', '.doctor-test');
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, 'test.txt');
      fs.writeFileSync(testFile, 'test', 'utf-8');
      fs.unlinkSync(testFile);
      fs.rmdirSync(testDir);

      return {
        name: 'Filesystem Permissions',
        category: 'environment',
        status: 'pass',
        message: 'Write permissions verified',
      };
    } catch {
      return {
        name: 'Filesystem Permissions',
        category: 'environment',
        status: 'fail',
        message: 'Unable to write to .codepipe directory',
        remediation: 'Check directory permissions and ensure write access',
      };
    }
  }

  /**
   * Check outbound HTTPS connectivity
   */
  private checkOutboundConnectivity(): DiagnosticCheck {
    try {
      // Use curl or wget to check connectivity
      const curlResult = spawnSync(
        'curl',
        ['-Is', '--connect-timeout', '5', 'https://api.github.com'],
        {
          encoding: 'utf-8',
          timeout: 10000,
        }
      );

      if (curlResult.status === 0) {
        return {
          name: 'Outbound HTTPS',
          category: 'environment',
          status: 'pass',
          message: 'Connectivity verified (https://api.github.com)',
        };
      }

      // Fallback: try wget
      const wgetResult = spawnSync('wget', ['--spider', '--timeout=5', 'https://api.github.com'], {
        encoding: 'utf-8',
        timeout: 10000,
      });

      if (wgetResult.status === 0) {
        return {
          name: 'Outbound HTTPS',
          category: 'environment',
          status: 'pass',
          message: 'Connectivity verified (https://api.github.com)',
        };
      }

      return {
        name: 'Outbound HTTPS',
        category: 'environment',
        status: 'warn',
        message: 'Unable to verify outbound HTTPS connectivity',
        remediation: 'Check network settings and firewall rules',
      };
    } catch {
      return {
        name: 'Outbound HTTPS',
        category: 'environment',
        status: 'warn',
        message: 'Unable to verify connectivity (curl/wget not found)',
        remediation: 'Manually verify network access to https://api.github.com',
      };
    }
  }

  /**
   * Check RepoConfig validity
   */
  private async checkRepoConfig(): Promise<DiagnosticCheck> {
    const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);

    if (!fs.existsSync(configPath)) {
      return {
        name: 'RepoConfig',
        category: 'config',
        status: 'warn',
        message: 'Configuration file not found',
        remediation: 'Run "codepipe init" to create configuration',
        details: { config_path: configPath },
      };
    }

    const result = await loadRepoConfig(configPath);

    if (!result.success) {
      return {
        name: 'RepoConfig',
        category: 'config',
        status: 'fail',
        message: 'Configuration validation failed',
        remediation: 'Run "codepipe init --validate-only" for details',
        details: {
          config_path: configPath,
          error_count: result.errors?.length || 0,
        },
      };
    }

    if (result.warnings && result.warnings.length > 0) {
      return {
        name: 'RepoConfig',
        category: 'config',
        status: 'warn',
        message: `Configuration valid with ${result.warnings.length} warning(s)`,
        remediation: 'Review warnings with "codepipe init --validate-only"',
        details: {
          config_path: configPath,
          warning_count: result.warnings.length,
        },
      };
    }

    return {
      name: 'RepoConfig',
      category: 'config',
      status: 'pass',
      message: 'Configuration valid',
      details: { config_path: configPath },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config used for minimal property extraction only
  private async checkCodeMachineCli(config?: any): Promise<DiagnosticCheck> {
    return checkCodeMachineCli(config);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config used for minimal property extraction only
  private checkEnvironmentVariables(config?: any): DiagnosticCheck[] {
    if (!config) {
      return [
        {
          name: 'Environment Variables',
          category: 'credential',
          status: 'warn',
          message: 'Cannot check environment variables (config not found or invalid)',
          remediation: 'Run "codepipe init" first',
        },
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified for this usage
    const envChecks: EnvCheckDescriptor[] = [
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified
        enabled: (c) => Boolean(c.github?.enabled && c.github?.token_env_var),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Config type not fully specified
        envVar: (c) => c.github.token_env_var,
        label: 'GitHub',
        failStatus: 'fail',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified
        failRemediation: (c, v) =>
          `Set ${v} with scopes: ${((c.github?.required_scopes ?? []) as string[]).join(', ')}`,
        passMessage: 'Token present',
        failMessage: 'Token not set',
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified
        enabled: (c) => Boolean(c.linear?.enabled && c.linear?.api_key_env_var),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Config type not fully specified
        envVar: (c) => c.linear.api_key_env_var,
        label: 'Linear',
        failStatus: 'fail',
        failRemediation: (_c, v) => `Set ${v} with a valid Linear API key`,
        passMessage: 'API key present',
        failMessage: 'API key not set',
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified
        enabled: (c) => Boolean(c.runtime?.agent_endpoint_env_var),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Config type not fully specified
        envVar: (c) => c.runtime.agent_endpoint_env_var,
        label: 'Agent',
        failStatus: 'warn',
        failRemediation: (_c, v) => `Set ${v} or add runtime.agent_endpoint to config`,
        passMessage: 'Configured',
        failMessage: 'Agent endpoint not configured',
        displayName: () => 'Agent Endpoint',
        showValueInPass: true,
        passDetails: (value) => ({ endpoint: value }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified
        resolveValue: (c, v) => (c.runtime?.agent_endpoint as string | undefined) ?? process.env[v],
      },
    ];

    const checks: DiagnosticCheck[] = [];

    for (const check of envChecks) {
      if (!check.enabled(config)) continue;

      const varName = check.envVar(config);
      const value = check.resolveValue ? check.resolveValue(config, varName) : process.env[varName];
      const checkName = check.displayName
        ? check.displayName(varName)
        : `${varName} (${check.label})`;

      if (value) {
        checks.push({
          name: checkName,
          category: 'credential',
          status: 'pass',
          message: check.showValueInPass ? `${check.passMessage}: ${value}` : check.passMessage,
          details: check.passDetails ? check.passDetails(value) : { length: value.length },
        });
      } else {
        checks.push({
          name: checkName,
          category: 'credential',
          status: check.failStatus,
          message: check.failMessage,
          remediation: check.failRemediation(config, varName),
        });
      }
    }

    return checks;
  }

  /**
   * Print human-readable output
   */
  private printHumanReadable(payload: DoctorPayload, verbose: boolean): void {
    this.log('');
    this.log('Environment Diagnostics Report');
    this.log('='.repeat(70));
    this.log('');

    // Group checks by status
    const passed = payload.checks.filter((c) => c.status === 'pass');
    const warnings = payload.checks.filter((c) => c.status === 'warn');
    const failed = payload.checks.filter((c) => c.status === 'fail');

    // Display passed checks
    if (passed.length > 0) {
      this.log('✓ Passed Checks:');
      for (const check of passed) {
        this.log(`  ✓ ${check.name}: ${check.message}`);
        if (verbose && check.details) {
          this.log(`    Details: ${JSON.stringify(check.details)}`);
        }
      }
      this.log('');
    }

    // Display warnings
    if (warnings.length > 0) {
      this.log('⚠ Warnings:');
      for (const check of warnings) {
        this.warn(`  ⚠ ${check.name}: ${check.message}`);
        if (check.remediation) {
          this.log(`    → ${check.remediation}`);
        }
        if (verbose && check.details) {
          this.log(`    Details: ${JSON.stringify(check.details)}`);
        }
      }
      this.log('');
    }

    // Display failures
    if (failed.length > 0) {
      this.log('❌ Failed Checks:');
      for (const check of failed) {
        this.error(`  ❌ ${check.name}: ${check.message}`, { exit: false });
        if (check.remediation) {
          this.log(`    → ${check.remediation}`);
        }
        if (verbose && check.details) {
          this.log(`    Details: ${JSON.stringify(check.details)}`);
        }
      }
      this.log('');
    }

    // Summary
    this.log('Summary:');
    this.log(`  Total checks: ${payload.summary.total}`);
    this.log(`  Passed: ${payload.summary.passed}`);
    this.log(`  Warnings: ${payload.summary.warnings}`);
    this.log(`  Failed: ${payload.summary.failed}`);
    this.log('');

    // Overall status
    if (payload.status === 'healthy') {
      this.log('✓ System is ready for codemachine-pipeline operations');
    } else if (payload.status === 'issues_detected') {
      this.log('⚠ System is operational but has warnings that should be addressed');
    } else {
      this.log('❌ Critical failures detected - please address failed checks before proceeding');
    }
    this.log('');

    // Exit code reference
    if (payload.exit_code !== 0) {
      this.log(`Exit code: ${payload.exit_code}`);
      this.log('Exit code reference:');
      this.log('  0  = All checks passed');
      this.log('  10 = Configuration validation errors');
      this.log('  20 = Environment issues (missing tools, permissions)');
      this.log('  30 = Credential issues (missing tokens/keys)');
      this.log('');
    }

    this.log('For detailed documentation, see: docs/reference/cli/doctor_reference.md');
    this.log('');
  }
}
