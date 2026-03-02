/**
 * Standalone diagnostic check functions extracted from the oclif Doctor command.
 *
 * These can be called programmatically without going through the oclif CLI framework,
 * enabling use in integration tests, CI scripts, and other tooling.
 */

import { spawnSync } from 'node:child_process';
import * as semver from 'semver';
import { resolveBinary } from '../adapters/codemachine/binaryResolver.js';

/**
 * Result of a single diagnostic check.
 */
export interface DiagnosticCheck {
  name: string;
  category: 'credential' | 'environment' | 'config' | 'general';
  status: 'pass' | 'fail' | 'warn';
  message: string;
  remediation?: string;
  /** Details vary per diagnostic check type (version, path, counts, etc.) */
  details?: Record<string, unknown>;
}

/**
 * Check whether the CodeMachine-CLI binary is available and meets
 * the optional minimum version requirement from the repo config.
 *
 * This is a standalone equivalent of the Doctor command's private
 * `checkCodeMachineCli()` method, accepting the same config shape.
 *
 * @param config - Loaded repo config (or `undefined` if config is unavailable).
 *   Only `execution.codemachine_cli_version` is read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config used for minimal property extraction only
export async function checkCodeMachineCli(config?: any): Promise<DiagnosticCheck> {
  // Get minimum version from config if available
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Config type not fully specified for this usage
  const minVersion = config?.execution?.codemachine_cli_version as string | undefined;

  // Use binary resolver for consistent resolution
  const resolution = await resolveBinary();

  if (!resolution.resolved || !resolution.binaryPath) {
    return {
      name: 'CodeMachine CLI (Execution)',
      category: 'environment',
      status: 'warn',
      message: 'CodeMachine CLI not found',
      remediation:
        'Install codemachine: npm install codemachine@^0.8.0 (optional for execution engine)',
      details: { error: resolution.error },
    };
  }

  // Get version from binary
  try {
    const result = spawnSync(resolution.binaryPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (result.status !== 0) {
      return {
        name: 'CodeMachine CLI (Execution)',
        category: 'environment',
        status: 'warn',
        message: `CodeMachine CLI found but --version failed`,
        remediation: 'Check the binary at: ' + resolution.binaryPath,
        details: { cli_path: resolution.binaryPath, source: resolution.source },
      };
    }

    const versionRaw = result.stdout.trim().split('\n')[0]?.trim() ?? '';
    const version = semver.coerce(versionRaw)?.version ?? versionRaw;

    // Check minimum version if configured
    if (minVersion && version) {
      const parsed = semver.valid(version);
      if (parsed && !semver.satisfies(parsed, `>=${minVersion}`)) {
        return {
          name: 'CodeMachine CLI (Execution)',
          category: 'environment',
          status: 'warn',
          message: `CodeMachine CLI v${version} below minimum v${minVersion}`,
          remediation: `Upgrade: npm install codemachine@^${minVersion}`,
          details: {
            version,
            min_version: minVersion,
            cli_path: resolution.binaryPath,
            source: resolution.source,
          },
        };
      }
    }

    return {
      name: 'CodeMachine CLI (Execution)',
      category: 'environment',
      status: 'pass',
      message: `CodeMachine CLI v${version} (${resolution.source})`,
      details: { version, cli_path: resolution.binaryPath, source: resolution.source },
    };
  } catch {
    return {
      name: 'CodeMachine CLI (Execution)',
      category: 'environment',
      status: 'warn',
      message: 'CodeMachine CLI found but version check failed',
      remediation: 'Check the binary at: ' + resolution.binaryPath,
      details: { cli_path: resolution.binaryPath, source: resolution.source },
    };
  }
}
