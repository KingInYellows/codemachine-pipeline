import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { loadRepoConfig } from '../../core/config/repo_config';
import { createCliLogger, LogLevel } from '../../telemetry/logger';
import { createRunMetricsCollector, StandardMetrics } from '../../telemetry/metrics';
import { createRunTraceManager, SpanStatusCode } from '../../telemetry/traces';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';

const CONFIG_RELATIVE_PATH = path.join('.codepipe', 'config.json');

/**
 * Diagnostic check result
 */
interface DiagnosticCheck {
  name: string;
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
      process.env.JSON_OUTPUT = '1';
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

      // Async checks
      checks.push(await this.checkRepoConfig());
      checks.push(await this.checkCodeMachineCli());
      checks.push(...(await this.checkEnvironmentVariables()));

      // Compute summary
      const summary = {
        total: checks.length,
        passed: checks.filter((c) => c.status === 'pass').length,
        warnings: checks.filter((c) => c.status === 'warn').length,
        failed: checks.filter((c) => c.status === 'fail').length,
      };

      // Determine exit code and status
      let exitCode = 0;
      let status: DoctorPayload['status'] = 'healthy';

      if (summary.failed > 0) {
        // Determine exit code based on failure types
        const hasCredentialFailure = checks.some(
          (c) =>
            c.status === 'fail' &&
            (c.name.includes('Token') ||
              c.name.includes('API Key') ||
              c.name.includes('Credential'))
        );
        const hasEnvironmentFailure = checks.some(
          (c) =>
            c.status === 'fail' &&
            (c.name.includes('Node') ||
              c.name.includes('Git') ||
              c.name.includes('Docker') ||
              c.name.includes('Filesystem'))
        );
        const hasConfigFailure = checks.some(
          (c) => c.status === 'fail' && c.name.includes('Config')
        );

        if (hasCredentialFailure) {
          exitCode = 30;
          status = 'critical_failures';
        } else if (hasEnvironmentFailure) {
          exitCode = 20;
          status = 'critical_failures';
        } else if (hasConfigFailure) {
          exitCode = 10;
          status = 'critical_failures';
        } else {
          exitCode = 1;
          status = 'critical_failures';
        }
      } else if (summary.warnings > 0) {
        status = 'issues_detected';
      }

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

      // Record success metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'doctor',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'doctor',
          exit_code: String(exitCode),
        });
        await metrics.flush();
      }

      if (commandSpan) {
        commandSpan.setAttribute('exit_code', exitCode);
        commandSpan.setAttribute('checks_total', summary.total);
        commandSpan.setAttribute('checks_passed', summary.passed);
        commandSpan.setAttribute('checks_failed', summary.failed);
        commandSpan.end({ code: exitCode === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR });
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (logger) {
        logger.info('Doctor command completed', {
          duration_ms: Date.now() - startTime,
          exit_code: exitCode,
          checks_total: summary.total,
          checks_passed: summary.passed,
          checks_failed: summary.failed,
        });
        await logger.flush();
      }

      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      // Record error metrics
      if (metrics) {
        const duration = Date.now() - startTime;
        metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
          command: 'doctor',
        });
        metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
          command: 'doctor',
          exit_code: '1',
        });
        await metrics.flush();
      }

      if (commandSpan) {
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
      }

      if (traceManager) {
        await traceManager.flush();
      }

      if (logger) {
        if (error instanceof Error) {
          logger.error('Doctor command failed', {
            error: error.message,
            stack: error.stack,
            duration_ms: Date.now() - startTime,
          });
        }
        await logger.flush();
      }

      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

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
          status: 'pass',
          message: `Node.js ${versionOutput} (v24 LTS preferred)`,
          details: { version: versionOutput, major: majorVersion },
        };
      } else if (majorVersion >= 20) {
        return {
          name: 'Node.js Version',
          status: 'warn',
          message: `Node.js ${versionOutput} (v20 acceptable, v24 recommended)`,
          remediation: 'Upgrade to Node.js v24 LTS for optimal performance',
          details: { version: versionOutput, major: majorVersion },
        };
      } else {
        return {
          name: 'Node.js Version',
          status: 'fail',
          message: `Node.js ${versionOutput} is below minimum required version`,
          remediation: 'Install Node.js v20 or v24 LTS from https://nodejs.org/',
          details: { version: versionOutput, major: majorVersion },
        };
      }
    } catch {
      return {
        name: 'Node.js Version',
        status: 'fail',
        message: 'Unable to determine Node.js version',
        remediation: 'Ensure Node.js is properly installed',
      };
    }
  }

  /**
   * Check if git CLI is installed and accessible
   */
  private checkGitInstalled(): DiagnosticCheck {
    try {
      const result = spawnSync('git', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (result.status === 0) {
        const version = result.stdout.trim();
        return {
          name: 'Git CLI',
          status: 'pass',
          message: version,
          details: { version },
        };
      } else {
        return {
          name: 'Git CLI',
          status: 'fail',
          message: 'Git command failed',
          remediation: 'Install git from https://git-scm.com/',
        };
      }
    } catch {
      return {
        name: 'Git CLI',
        status: 'fail',
        message: 'Git not found',
        remediation: 'Install git from https://git-scm.com/',
      };
    }
  }

  /**
   * Check if npm is installed
   */
  private checkNpmInstalled(): DiagnosticCheck {
    try {
      const result = spawnSync('npm', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (result.status === 0) {
        const version = result.stdout.trim();
        return {
          name: 'npm',
          status: 'pass',
          message: `npm ${version}`,
          details: { version },
        };
      } else {
        return {
          name: 'npm',
          status: 'fail',
          message: 'npm command failed',
          remediation: 'npm should be installed with Node.js',
        };
      }
    } catch {
      return {
        name: 'npm',
        status: 'fail',
        message: 'npm not found',
        remediation: 'npm should be installed with Node.js',
      };
    }
  }

  /**
   * Check if Docker is installed and accessible
   */
  private checkDockerInstalled(): DiagnosticCheck {
    try {
      const result = spawnSync('docker', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (result.status === 0) {
        const version = result.stdout.trim();
        return {
          name: 'Docker',
          status: 'pass',
          message: version,
          details: { version },
        };
      } else {
        return {
          name: 'Docker',
          status: 'warn',
          message: 'Docker command failed',
          remediation: 'Install Docker from https://docker.com/ (optional but recommended)',
        };
      }
    } catch {
      return {
        name: 'Docker',
        status: 'warn',
        message: 'Docker not found',
        remediation: 'Install Docker from https://docker.com/ (optional but recommended)',
      };
    }
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
          status: 'pass',
          message: `Git repository detected at ${gitRoot}`,
          details: { git_root: gitRoot },
        };
      } else {
        return {
          name: 'Git Repository',
          status: 'fail',
          message: 'Not in a git repository',
          remediation: 'Run "git init" or navigate to a git repository',
        };
      }
    } catch {
      return {
        name: 'Git Repository',
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
        status: 'pass',
        message: 'Write permissions verified',
      };
    } catch {
      return {
        name: 'Filesystem Permissions',
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
          status: 'pass',
          message: 'Connectivity verified (https://api.github.com)',
        };
      }

      return {
        name: 'Outbound HTTPS',
        status: 'warn',
        message: 'Unable to verify outbound HTTPS connectivity',
        remediation: 'Check network settings and firewall rules',
      };
    } catch {
      return {
        name: 'Outbound HTTPS',
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
      status: 'pass',
      message: 'Configuration valid',
      details: { config_path: configPath },
    };
  }

  private async checkCodeMachineCli(): Promise<DiagnosticCheck> {
    const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
    let cliPath = 'codemachine-cli';

    if (fs.existsSync(configPath)) {
      const result = await loadRepoConfig(configPath);
      if (result.success && result.config?.execution?.codemachine_cli_path) {
        cliPath = result.config.execution.codemachine_cli_path;
      }
    }

    try {
      const result = spawnSync(cliPath, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (result.status === 0) {
        const version = result.stdout.trim();
        return {
          name: 'CodeMachine CLI (Execution)',
          status: 'pass',
          message: `${cliPath} ${version}`,
          details: { version, cli_path: cliPath },
        };
      }

      return {
        name: 'CodeMachine CLI (Execution)',
        status: 'warn',
        message: `${cliPath} command failed`,
        remediation:
          'Install codemachine-cli: npm install -g codemachine-cli (optional for execution engine)',
        details: { cli_path: cliPath },
      };
    } catch {
      return {
        name: 'CodeMachine CLI (Execution)',
        status: 'warn',
        message: 'CodeMachine CLI not found',
        remediation:
          'Install codemachine-cli: npm install -g codemachine-cli (optional for execution engine)',
        details: { cli_path: cliPath },
      };
    }
  }

  private async checkEnvironmentVariables(): Promise<DiagnosticCheck[]> {
    const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
    const checks: DiagnosticCheck[] = [];

    // Try to load config to determine which env vars are needed
    if (!fs.existsSync(configPath)) {
      checks.push({
        name: 'Environment Variables',
        status: 'warn',
        message: 'Cannot check environment variables (config not found)',
        remediation: 'Run "codepipe init" first',
      });
      return checks;
    }

    const result = await loadRepoConfig(configPath);
    if (!result.success || !result.config) {
      checks.push({
        name: 'Environment Variables',
        status: 'warn',
        message: 'Cannot check environment variables (config invalid)',
        remediation: 'Fix configuration first',
      });
      return checks;
    }

    const config = result.config;

    // Check GitHub token
    if (config.github.enabled) {
      const tokenVar = config.github.token_env_var;
      const token = process.env[tokenVar];

      if (token) {
        checks.push({
          name: `${tokenVar} (GitHub)`,
          status: 'pass',
          message: 'Token present',
          details: { length: token.length },
        });
      } else {
        checks.push({
          name: `${tokenVar} (GitHub)`,
          status: 'fail',
          message: 'Token not set',
          remediation: `Set ${tokenVar} with scopes: ${config.github.required_scopes.join(', ')}`,
        });
      }
    }

    // Check Linear API key
    if (config.linear.enabled) {
      const keyVar = config.linear.api_key_env_var;
      const key = process.env[keyVar];

      if (key) {
        checks.push({
          name: `${keyVar} (Linear)`,
          status: 'pass',
          message: 'API key present',
          details: { length: key.length },
        });
      } else {
        checks.push({
          name: `${keyVar} (Linear)`,
          status: 'fail',
          message: 'API key not set',
          remediation: `Set ${keyVar} with a valid Linear API key`,
        });
      }
    }

    // Check agent endpoint
    const agentEndpoint =
      config.runtime.agent_endpoint || process.env[config.runtime.agent_endpoint_env_var];
    if (!agentEndpoint) {
      checks.push({
        name: `${config.runtime.agent_endpoint_env_var} (Agent)`,
        status: 'warn',
        message: 'Agent endpoint not configured',
        remediation: `Set ${config.runtime.agent_endpoint_env_var} or add runtime.agent_endpoint to config`,
      });
    } else {
      checks.push({
        name: `Agent Endpoint`,
        status: 'pass',
        message: `Configured: ${agentEndpoint}`,
        details: { endpoint: agentEndpoint },
      });
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

    this.log('For detailed documentation, see: docs/ops/doctor_reference.md');
    this.log('');
  }
}
