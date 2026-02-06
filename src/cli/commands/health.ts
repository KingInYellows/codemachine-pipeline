import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRepoConfig } from '../../core/config/repo_config';

const CONFIG_RELATIVE_PATH = path.join('.codepipe', 'config.json');
const MIN_FREE_DISK_MB = 100;

/**
 * Health check result
 */
interface HealthCheck {
  name: string;
  status: 'pass' | 'fail';
  message: string;
}

/**
 * Health command payload for JSON output
 */
interface HealthPayload {
  healthy: boolean;
  exit_code: number;
  checks: HealthCheck[];
  timestamp: string;
}

/**
 * Health command - Quick runtime health checks
 * Implements CDMCH-77: lightweight health probe (<1s target)
 *
 * Checks:
 * - Configuration file validity
 * - Run directory is writable
 * - Disk space is available
 *
 * Exit codes:
 * - 0: Healthy
 * - 1: Unhealthy
 */
export default class Health extends Command {
  static description = 'Quick runtime health check (config, disk, writable run dir)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Health);
    const checks: HealthCheck[] = [];

    // Check 1: Config validity
    checks.push(await this.checkConfig());

    // Check 2: Run directory writable
    checks.push(this.checkRunDirWritable());

    // Check 3: Disk space
    checks.push(this.checkDiskSpace());

    const healthy = checks.every((c) => c.status === 'pass');
    const exitCode = healthy ? 0 : 1;

    if (flags.json) {
      const payload: HealthPayload = {
        healthy,
        exit_code: exitCode,
        checks,
        timestamp: new Date().toISOString(),
      };
      this.log(JSON.stringify(payload, null, 2));
    } else {
      for (const check of checks) {
        const icon = check.status === 'pass' ? '✓' : '✗';
        this.log(`${icon} ${check.name}: ${check.message}`);
      }
      this.log('');
      this.log(healthy ? 'Status: healthy' : 'Status: unhealthy');
    }

    if (!healthy) {
      this.exit(1);
    }
  }

  private async checkConfig(): Promise<HealthCheck> {
    const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);

    try {
      if (!fs.existsSync(configPath)) {
        return {
          name: 'config',
          status: 'fail',
          message: `Config not found at ${CONFIG_RELATIVE_PATH}`,
        };
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      JSON.parse(content);

      // Attempt full config validation
      await loadRepoConfig(configPath);

      return {
        name: 'config',
        status: 'pass',
        message: 'Configuration is valid',
      };
    } catch (error) {
      return {
        name: 'config',
        status: 'fail',
        message: `Invalid config: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private checkRunDirWritable(): HealthCheck {
    const runsDir = path.resolve(process.cwd(), '.codepipe', 'runs');

    try {
      // Ensure directory exists
      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
      }

      // Probe writability with a temp file
      const probePath = path.join(runsDir, `.health_probe_${process.pid}`);
      try {
        fs.writeFileSync(probePath, 'probe', 'utf-8');
      } finally {
        try {
          fs.unlinkSync(probePath);
        } catch {
          /* probe may not exist */
        }
      }

      return {
        name: 'run_dir',
        status: 'pass',
        message: 'Run directory is writable',
      };
    } catch (error) {
      return {
        name: 'run_dir',
        status: 'fail',
        message: `Run directory not writable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private checkDiskSpace(): HealthCheck {
    try {
      const stats = fs.statfsSync(process.cwd());
      const freeBytes = stats.bavail * stats.bsize;
      const freeMB = Math.round(freeBytes / (1024 * 1024));

      if (freeMB < MIN_FREE_DISK_MB) {
        return {
          name: 'disk_space',
          status: 'fail',
          message: `Low disk space: ${freeMB}MB free (minimum ${MIN_FREE_DISK_MB}MB)`,
        };
      }

      return {
        name: 'disk_space',
        status: 'pass',
        message: `${freeMB}MB free`,
      };
    } catch (error) {
      return {
        name: 'disk_space',
        status: 'fail',
        message: `Cannot check disk space: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
