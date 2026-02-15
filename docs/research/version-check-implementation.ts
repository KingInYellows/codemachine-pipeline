/**
 * Production-Ready Version Checking Utilities
 *
 * This file contains complete TypeScript implementations for semantic version
 * compatibility checking, extracted from research on npm semver library best practices.
 *
 * Usage:
 * - Copy patterns to src/utils/version-check.ts
 * - Use in doctor.ts or CLI dependency validation
 * - Extend with project-specific requirements
 */

import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import semver from 'semver';

// ============================================================================
// PART 1: Version Extraction
// ============================================================================

/**
 * Extract semantic version from arbitrary CLI output.
 * Handles variations like "v1.2.3", "Git 2.40.0", "Docker 24.0.0, build abc123"
 *
 * @param cliName - Name of CLI (for error messages)
 * @param versionOutput - Raw output from `cli --version`
 * @returns Normalized semver string or null if extraction fails
 *
 * @example
 * extractVersionFromCli('git', 'git version 2.40.0')  // '2.40.0'
 * extractVersionFromCli('docker', 'Docker 24.0.0, build abc123')  // '24.0.0'
 * extractVersionFromCli('npm', 'v10.0.0-beta')  // '10.0.0-beta'
 */
export function extractVersionFromCli(
  cliName: string,
  versionOutput: string
): string | null {
  if (!versionOutput || typeof versionOutput !== 'string') {
    return null;
  }

  // Strategy 1: Try to clean the entire output first
  // semver.clean() handles: "v1.2.3", "  1.2.3  ", "=1.2.3", etc.
  const cleaned = semver.clean(versionOutput.trim());
  if (cleaned) {
    return cleaned;
  }

  // Strategy 2: Extract first semver-like pattern from output
  // Regex breakdown:
  // \b - word boundary
  // v? - optional 'v' prefix
  // (\d+\.\d+\.\d+) - major.minor.patch
  // (?:-[a-zA-Z0-9.]+)? - optional prerelease (e.g., -beta.1)
  // (?:\+[a-zA-Z0-9.]+)? - optional metadata (e.g., +build.123)
  // \b - word boundary
  const semverRegex =
    /\bv?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?)\b/;
  const match = versionOutput.match(semverRegex);

  if (match?.[1]) {
    const extracted = semver.clean(match[1]);
    if (extracted) {
      return extracted;
    }
  }

  // Strategy 3: Extract just major.minor.patch
  // More lenient - matches "1.2.3" anywhere in output
  const partialRegex = /(\d+)\.(\d+)\.(\d+)/;
  const partialMatch = versionOutput.match(partialRegex);

  if (partialMatch) {
    const reconstructed = `${partialMatch[1]}.${partialMatch[2]}.${partialMatch[3]}`;
    return reconstructed;
  }

  return null;
}

/**
 * Get version from external CLI with robust error handling.
 * Handles timeouts, missing CLIs, non-zero exit codes.
 *
 * @param cliName - Executable name or path
 * @param options - Configuration options
 * @returns Result object with success status, version, and error info
 *
 * @example
 * const result = getCliVersion('git');
 * if (result.success) {
 *   console.log(`Git ${result.version} installed`);
 * } else {
 *   console.error(result.error);
 * }
 */
export interface CliVersionResult {
  success: boolean;
  version: string | null;
  rawOutput?: string;
  error?: string;
  executedCommand?: string;
}

export function getCliVersion(
  cliName: string,
  options?: {
    timeout?: number;
    versionFlag?: string;
    stderr?: 'ignore' | 'capture';
  }
): CliVersionResult {
  const versionFlag = options?.versionFlag ?? '--version';
  const timeout = options?.timeout ?? 5000;
  const stderrMode = options?.stderr ?? 'capture';

  try {
    const result = spawnSync(cliName, [versionFlag], {
      encoding: 'utf-8',
      timeout,
      stdio: [
        'pipe',
        'pipe',
        stderrMode === 'ignore' ? 'ignore' : 'pipe',
      ] as any,
    });

    // Handle spawn errors (e.g., command not found)
    if (result.error) {
      return {
        success: false,
        version: null,
        error: `${cliName}: ${result.error.message}`,
        executedCommand: `${cliName} ${versionFlag}`,
      };
    }

    // Handle non-zero exit codes
    if (result.status !== 0) {
      const errorOutput = result.stderr || result.stdout || `exit code ${result.status}`;
      return {
        success: false,
        version: null,
        rawOutput: errorOutput.trim(),
        error: `${cliName} exited with code ${result.status}`,
        executedCommand: `${cliName} ${versionFlag}`,
      };
    }

    // Combine stdout and stderr (some CLIs output to stderr)
    const rawOutput = ((result.stdout || '') + (result.stderr || '')).trim();

    if (!rawOutput) {
      return {
        success: false,
        version: null,
        error: `${cliName} produced no output`,
        executedCommand: `${cliName} ${versionFlag}`,
      };
    }

    // Extract version from output
    const version = extractVersionFromCli(cliName, rawOutput);

    if (!version) {
      return {
        success: false,
        version: null,
        rawOutput,
        error: `Could not extract version from output: ${rawOutput}`,
        executedCommand: `${cliName} ${versionFlag}`,
      };
    }

    return {
      success: true,
      version,
      rawOutput,
      executedCommand: `${cliName} ${versionFlag}`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
    return {
      success: false,
      version: null,
      error: message,
      executedCommand: `${cliName} ${versionFlag}`,
    };
  }
}

// ============================================================================
// PART 2: Version Compatibility Checking
// ============================================================================

/**
 * Diagnostic result for version compatibility check
 */
export interface VersionCheckResult {
  status: 'pass' | 'fail' | 'warn';
  message: string;
  foundVersion: string | null;
  minRequired: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

/**
 * Version requirement specification
 */
export interface VersionRequirement {
  name: string;
  executable?: string;
  minVersion: string;
  recommendedVersion?: string;
  optional?: boolean;
  description?: string;
}

/**
 * Check if CLI version meets minimum requirement.
 * This is the primary function for version validation in doctor checks.
 *
 * @param foundVersion - Version string (or null if not found)
 * @param requirement - Version requirement specification
 * @returns Check result with status, message, and remediation
 *
 * @example
 * const result = checkMinimumVersion('1.2.3', {
 *   name: 'CodeMachine CLI',
 *   minVersion: '1.0.0',
 *   recommendedVersion: '1.5.0'
 * });
 *
 * if (result.status === 'fail') {
 *   console.error(`${result.message}\nFix: ${result.remediation}`);
 * }
 */
export function checkMinimumVersion(
  foundVersion: string | null,
  requirement: VersionRequirement
): VersionCheckResult {
  // Case 1: Version not found/detected
  if (!foundVersion) {
    return {
      status: requirement.optional ? 'warn' : 'fail',
      message: `${requirement.name} not found`,
      foundVersion: null,
      minRequired: requirement.minVersion,
      remediation: `Install ${requirement.name} v${requirement.minVersion} or later${
        requirement.executable ? ` (executable: ${requirement.executable})` : ''
      }`,
      details: {
        optional: requirement.optional,
        description: requirement.description,
      },
    };
  }

  // Validate that found version is valid semver
  const cleanVersion = semver.valid(foundVersion);
  if (!cleanVersion) {
    return {
      status: 'fail',
      message: `${requirement.name} version "${foundVersion}" is not valid semver`,
      foundVersion,
      minRequired: requirement.minVersion,
      remediation: `Verify ${requirement.name} is properly installed. Got: "${foundVersion}"`,
    };
  }

  // Case 2: Below minimum version
  if (semver.lt(cleanVersion, requirement.minVersion)) {
    const packageName = requirement.executable?.replace(/-/g, '.') || requirement.name;
    return {
      status: 'fail',
      message: `${requirement.name} ${cleanVersion} is below minimum v${requirement.minVersion}`,
      foundVersion: cleanVersion,
      minRequired: requirement.minVersion,
      remediation: `Upgrade ${requirement.name} to v${requirement.minVersion} or later:\nnpm install -g ${packageName}@latest`,
      details: {
        found: cleanVersion,
        required: requirement.minVersion,
        optional: requirement.optional,
      },
    };
  }

  // Case 3: Meets minimum, below recommended
  if (requirement.recommendedVersion && semver.lt(cleanVersion, requirement.recommendedVersion)) {
    return {
      status: 'warn',
      message: `${requirement.name} ${cleanVersion} is functional but outdated (recommended: v${requirement.recommendedVersion})`,
      foundVersion: cleanVersion,
      minRequired: requirement.minVersion,
      remediation: `Consider upgrading to v${requirement.recommendedVersion} for optimal features`,
      details: {
        found: cleanVersion,
        minimum: requirement.minVersion,
        recommended: requirement.recommendedVersion,
      },
    };
  }

  // Case 4: All requirements met
  return {
    status: 'pass',
    message: `${requirement.name} ${cleanVersion} meets requirements`,
    foundVersion: cleanVersion,
    minRequired: requirement.minVersion,
    details: {
      found: cleanVersion,
      minimum: requirement.minVersion,
      recommended: requirement.recommendedVersion,
    },
  };
}

/**
 * Check version against a complex semver range specification.
 * Use this when minimum version alone is insufficient (e.g., ">=1.0.0 && <2.0.0").
 *
 * @param foundVersion - Version string
 * @param rangeSpec - semver range (e.g., ">=1.0.0", "1.x || >=2.5.0")
 * @param featureName - Feature name for error messages
 * @returns Check result
 *
 * @example
 * checkVersionRange('1.2.3', '>=1.0.0 <2.0.0', 'streaming output')
 * // Returns: pass, found 1.2.3 in range
 *
 * checkVersionRange('2.5.0', '>=1.0.0 <2.0.0', 'streaming output')
 * // Returns: fail, 2.5.0 outside range
 */
export function checkVersionRange(
  foundVersion: string,
  rangeSpec: string,
  featureName?: string
): VersionCheckResult {
  const cleanVersion = semver.valid(foundVersion);
  if (!cleanVersion) {
    return {
      status: 'fail',
      message: `Invalid version format: ${foundVersion}`,
      foundVersion,
      minRequired: rangeSpec,
      remediation: 'Ensure version is in format: major.minor.patch',
    };
  }

  const compatible = semver.satisfies(cleanVersion, rangeSpec);

  if (!compatible) {
    return {
      status: 'fail',
      message: `Version ${cleanVersion} does not support ${featureName ?? 'required feature'} (requires: ${rangeSpec})`,
      foundVersion: cleanVersion,
      minRequired: rangeSpec,
      remediation: `Install compatible version matching: ${rangeSpec}`,
    };
  }

  return {
    status: 'pass',
    message: `Version ${cleanVersion} supports ${featureName ?? 'required features'}`,
    foundVersion: cleanVersion,
    minRequired: rangeSpec,
  };
}

// ============================================================================
// PART 3: Pre-Release Version Handling
// ============================================================================

/**
 * Pre-release handling policy for version checks
 */
export interface PreReleasePolicy {
  // Allow pre-release versions in production
  allowPreRelease: boolean;
  // If found is pre-release but stable exists, warn
  warnIfPreRelease: boolean;
  // Accept pre-release if explicitly required
  acceptExplicitPreRelease: boolean;
}

const DEFAULT_PRERELEASE_POLICY: PreReleasePolicy = {
  allowPreRelease: false,
  warnIfPreRelease: true,
  acceptExplicitPreRelease: true,
};

/**
 * Check version with pre-release handling.
 * Pre-releases (alpha, beta, rc) require special handling per SemVer 2.0.0 spec.
 *
 * @param foundVersion - Detected version
 * @param minVersion - Minimum required version
 * @param policy - Pre-release handling policy
 * @returns Check result
 *
 * @example
 * // Reject pre-release unless minimum is also pre-release
 * checkVersionWithPreReleasePolicy('1.0.0-beta', '1.0.0', {
 *   allowPreRelease: false,
 *   warnIfPreRelease: true
 * });
 * // Returns: warn, suggests stable version
 */
export function checkVersionWithPreReleasePolicy(
  foundVersion: string,
  minVersion: string,
  policy: PreReleasePolicy = DEFAULT_PRERELEASE_POLICY
): VersionCheckResult {
  const cleanFound = semver.valid(foundVersion);
  if (!cleanFound) {
    return {
      status: 'fail',
      message: `Invalid version: ${foundVersion}`,
      foundVersion,
      minRequired: minVersion,
    };
  }

  const isPreRelease = semver.prerelease(cleanFound) !== null;
  const minIsPreRelease = semver.prerelease(minVersion) !== null;

  // Pre-release version handling
  if (isPreRelease && !minIsPreRelease && !policy.allowPreRelease) {
    // Found is pre-release, minimum is stable, not allowed
    return {
      status: policy.warnIfPreRelease ? 'warn' : 'fail',
      message: `Version ${cleanFound} is a pre-release (not recommended for production)`,
      foundVersion: cleanFound,
      minRequired: minVersion,
      remediation: 'Use stable version instead: npm install --latest',
      details: {
        prerelease: true,
        policy: 'reject-prerelease',
      },
    };
  }

  // Now check minimum version requirement
  if (semver.lt(cleanFound, minVersion)) {
    return {
      status: 'fail',
      message: `${cleanFound} is below minimum ${minVersion}`,
      foundVersion: cleanFound,
      minRequired: minVersion,
    };
  }

  return {
    status: 'pass',
    message: `Version ${cleanFound} meets requirements`,
    foundVersion: cleanFound,
    minRequired: minVersion,
    details: { prerelease: isPreRelease },
  };
}

// ============================================================================
// PART 4: Pre-1.0 Version Handling (0.x Versions)
// ============================================================================

/**
 * For 0.x versions, minor version updates can be breaking changes.
 * This function enforces stricter compatibility checks for pre-1.0 packages.
 *
 * @param foundVersion - Detected version
 * @param minVersion - Minimum required version
 * @returns Check result
 *
 * @example
 * // 0.1.x and 0.2.x are NOT compatible (breaking changes)
 * checkZeroVersionCompatibility('0.1.5', '0.2.0')
 * // Returns: fail, minor version mismatch in pre-1.0
 *
 * // 0.2.0 >= 0.2.1 is OK (patch only)
 * checkZeroVersionCompatibility('0.2.5', '0.2.0')
 * // Returns: pass
 */
export function checkZeroVersionCompatibility(
  foundVersion: string,
  minVersion: string
): VersionCheckResult {
  const found = semver.parse(foundVersion);
  const min = semver.parse(minVersion);

  if (!found || !min) {
    return {
      status: 'fail',
      message: 'Invalid version format',
      foundVersion,
      minRequired: minVersion,
    };
  }

  // For 0.x versions, apply stricter compatibility checks
  if (min.major === 0) {
    // Major version must match (both must be 0)
    if (found.major !== min.major) {
      return {
        status: 'fail',
        message: `Major version mismatch in pre-1.0: ${found.major} vs ${min.major}`,
        foundVersion,
        minRequired: minVersion,
        remediation: `Update to 0.${min.minor}.x series for compatibility`,
        details: {
          reason: 'Pre-1.0 packages treat major as 0, minor as breaking',
          found_major: found.major,
          required_major: min.major,
        },
      };
    }

    // Minor version must also match in 0.x (potential breaking changes)
    if (found.minor !== min.minor) {
      if (found.minor < min.minor) {
        return {
          status: 'fail',
          message: `Pre-1.0 minor version mismatch: 0.${found.minor} < 0.${min.minor} (may have breaking changes)`,
          foundVersion,
          minRequired: minVersion,
          remediation: `Upgrade to 0.${min.minor}.x series: npm install package@0.${min.minor}`,
          details: {
            reason: 'Minor versions in 0.x are treated as major versions',
            found_minor: found.minor,
            required_minor: min.minor,
          },
        };
      }

      // found.minor > min.minor is OK (it's a newer, compatible pre-1.0)
    }
  }

  return {
    status: 'pass',
    message: `Version ${foundVersion} compatible with 0.x series requirement`,
    foundVersion,
    minRequired: minVersion,
    details: {
      major_zero: true,
      found_minor: found.minor,
      required_minor: min.minor,
    },
  };
}

// ============================================================================
// PART 5: Capability Detection
// ============================================================================

/**
 * Capability specification for version-based feature detection
 */
export interface CapabilitySpec {
  minVersion: string;
  availableSince: string;
  removedIn?: string;
  description: string;
}

/**
 * Capability matrix: feature names mapped to version requirements
 */
export interface CapabilityMatrix {
  [featureName: string]: CapabilitySpec;
}

/**
 * Example capability matrix for CodeMachine CLI
 */
export const codemachineCliCapabilities: CapabilityMatrix = {
  'two-way-sync': {
    minVersion: '1.0.0',
    availableSince: '1.0.0',
    description: 'Two-way synchronization with external CLI',
  },
  'ai-review': {
    minVersion: '0.8.0',
    availableSince: '0.8.0-beta',
    removedIn: '2.0.0-alpha',
    description: 'AI-powered code review features',
  },
  'streaming-output': {
    minVersion: '1.5.0',
    availableSince: '1.5.0',
    description: 'Real-time streaming output for long operations',
  },
  'llm-routing': {
    minVersion: '1.2.0',
    availableSince: '1.2.0',
    description: 'LLM model selection and routing',
  },
};

/**
 * Detect available capabilities for a given version.
 *
 * @param version - Version string to check
 * @param capabilities - Capability matrix
 * @returns Object with available, unavailable, and deprecated capabilities
 *
 * @example
 * const caps = detectCapabilities('1.5.0', codemachineCliCapabilities);
 * // {
 * //   available: ['two-way-sync', 'ai-review', 'streaming-output', 'llm-routing'],
 * //   unavailable: [],
 * //   deprecated: []
 * // }
 */
export function detectCapabilities(
  version: string,
  capabilities: CapabilityMatrix
): {
  available: string[];
  unavailable: string[];
  deprecated: string[];
} {
  const clean = semver.valid(version);
  if (!clean) {
    throw new Error(`Invalid version: ${version}`);
  }

  const result = {
    available: [] as string[],
    unavailable: [] as string[],
    deprecated: [] as string[],
  };

  for (const [feature, spec] of Object.entries(capabilities)) {
    // Check if feature was removed
    if (spec.removedIn && semver.gte(clean, spec.removedIn)) {
      result.deprecated.push(feature);
      continue;
    }

    // Check if feature is available
    if (semver.gte(clean, spec.minVersion)) {
      result.available.push(feature);
    } else {
      result.unavailable.push(feature);
    }
  }

  return result;
}

/**
 * Check if a specific feature is available in the given version.
 *
 * @param version - Version string
 * @param feature - Feature name
 * @param capabilities - Capability matrix
 * @returns Boolean indicating feature availability
 *
 * @example
 * if (supportsFeature('1.5.0', 'streaming-output')) {
 *   // Use streaming API
 * }
 */
export function supportsFeature(
  version: string,
  feature: string,
  capabilities: CapabilityMatrix = codemachineCliCapabilities
): boolean {
  const caps = detectCapabilities(version, capabilities);
  return caps.available.includes(feature);
}

// ============================================================================
// PART 6: Batch Version Checking for Multiple CLIs
// ============================================================================

/**
 * Result from batch version checking
 */
export interface BatchVersionCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

/**
 * Check versions of multiple CLIs in batch.
 * Useful for doctor commands and environment validation.
 *
 * @param requirements - Array of version requirements
 * @returns Array of check results
 *
 * @example
 * const results = await batchCheckVersions([
 *   { name: 'Git', executable: 'git', minVersion: '2.25.0' },
 *   { name: 'Docker', executable: 'docker', minVersion: '20.0.0', optional: true },
 * ]);
 *
 * const failed = results.filter(r => r.status === 'fail');
 * if (failed.length > 0) {
 *   console.error('Some checks failed:', failed);
 * }
 */
export async function batchCheckVersions(
  requirements: (VersionRequirement & { executable: string })[]
): Promise<BatchVersionCheckResult[]> {
  const results: BatchVersionCheckResult[] = [];

  for (const req of requirements) {
    try {
      const versionResult = getCliVersion(req.executable);

      if (!versionResult.success) {
        results.push({
          name: req.name,
          status: req.optional ? 'warn' : 'fail',
          message: `${req.name} not found or check failed`,
          remediation: versionResult.error,
          details: { executable: req.executable },
        });
        continue;
      }

      const check = checkMinimumVersion(versionResult.version, req);

      results.push({
        name: req.name,
        status: check.status,
        message: check.message,
        remediation: check.remediation,
        details: check.details,
      });
    } catch (error) {
      results.push({
        name: req.name,
        status: req.optional ? 'warn' : 'fail',
        message: `Error checking ${req.name}`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  return results;
}

// ============================================================================
// PART 7: Export Functions Summary
// ============================================================================

/**
 * Public API exports - all functions available for import
 *
 * Core functions:
 * - extractVersionFromCli() - Extract semver from arbitrary output
 * - getCliVersion() - Get version from external CLI with error handling
 * - checkMinimumVersion() - Validate version meets minimum
 * - checkVersionRange() - Validate version in range
 * - checkVersionWithPreReleasePolicy() - Handle pre-releases
 * - checkZeroVersionCompatibility() - Strict 0.x version checking
 * - detectCapabilities() - Feature detection by version
 * - supportsFeature() - Check if feature available
 * - batchCheckVersions() - Check multiple CLIs
 *
 * Types:
 * - CliVersionResult
 * - VersionCheckResult
 * - VersionRequirement
 * - PreReleasePolicy
 * - CapabilitySpec
 * - CapabilityMatrix
 * - BatchVersionCheckResult
 *
 * Matrices:
 * - codemachineCliCapabilities
 */

export {
  extractVersionFromCli,
  getCliVersion,
  checkMinimumVersion,
  checkVersionRange,
  checkVersionWithPreReleasePolicy,
  checkZeroVersionCompatibility,
  detectCapabilities,
  supportsFeature,
  batchCheckVersions,
  // Types
  CliVersionResult,
  VersionCheckResult,
  VersionRequirement,
  PreReleasePolicy,
  CapabilitySpec,
  CapabilityMatrix,
  BatchVersionCheckResult,
};
