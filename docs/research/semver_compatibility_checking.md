# Semantic Version Compatibility Checking in Node.js TypeScript

## Executive Summary

This document provides comprehensive research on best practices for enforcing minimum version requirements on external CLI dependencies in Node.js TypeScript projects. It covers the `semver` npm package (the standard used by npm itself), version extraction patterns, and real-world implementation strategies.

**Key Findings:**
- **Standard Library**: `semver` package by npm organization (actively maintained, battle-tested)
- **Version Detection**: Extract semver from CLI output using `semver.clean()` + regex fallback
- **Compatibility Strategy**: Use `semver.gte()` for minimum enforcement, `satisfies()` for ranges
- **Pre-release Handling**: Pre-releases require matching major.minor.patch tuple
- **0.x Versions**: Treat minor versions as breaking changes per SemVer 2.0.0 specification
- **Doctor Integration**: Report version compatibility with clear remediation steps

---

## Part 1: Semver Libraries in Node.js

### The npm Semver Package (Recommended)

The [`semver` npm package](https://www.npmjs.com/package/semver) is the official semantic versioning implementation used by npm itself. It's maintained by the npm organization and is the industry standard.

**Advantages:**
- Battle-tested in npm ecosystem (billions of installations)
- Actively maintained with regular updates
- Zero dependencies
- Small footprint (~50KB uncompressed)
- Full SemVer 2.0.0 compliance
- Pre-release and metadata support

**Installation:**
```bash
npm install semver
npm install --save-dev @types/semver  # For TypeScript
```

### Alternative Libraries

| Package | Use Case | Pros | Cons |
|---------|----------|------|------|
| `semver` | General semver tasks | Standard, well-tested | More functions than needed for simple checks |
| `compare-versions` | Simple version comparison | Lightweight, focused | Limited to comparison, no ranges |
| `semver-regex` | Extracting semver from text | Fast regex matching | Only extracts, doesn't validate ranges |
| `is-semver` | Validation only | Minimal overhead | Limited functionality |

**Recommendation:** Use `semver` for comprehensive features, but if you only need to compare two versions, `compare-versions` is adequate.

---

## Part 2: Core Semver API Reference

### Version Comparison Functions

```typescript
import semver from 'semver';

// Basic comparisons (all return boolean)
semver.gt('1.2.3', '1.2.2')      // true - greater than
semver.gte('1.2.3', '1.2.3')     // true - greater than or equal
semver.lt('1.2.2', '1.2.3')      // true - less than
semver.lte('1.2.3', '1.2.3')     // true - less than or equal
semver.eq('1.2.3', '1.2.3')      // true - equal

// Comparison for sorting
semver.compare('1.2.3', '1.2.4') // -1 (first < second)
semver.compare('1.2.4', '1.2.3') // 1 (first > second)
semver.compare('1.2.3', '1.2.3') // 0 (equal)
```

### Version Validation and Cleaning

```typescript
// Validate if string is valid semver
semver.valid('1.2.3')              // '1.2.3' (returns normalized)
semver.valid('v1.2.3')             // '1.2.3' (strips 'v' prefix)
semver.valid('1.2.3-beta')         // '1.2.3-beta'
semver.valid('1.2')                // null (invalid - missing patch)
semver.valid('not-a-version')      // null

// Clean a version string (normalize variations)
semver.clean('v1.2.3')             // '1.2.3'
semver.clean('  =  1.2.3  ')       // '1.2.3'
semver.clean('1.2.3.4')            // null (too many parts)

// Parse into SemVer object
const v = semver.parse('1.2.3-beta.1+build.123');
// {
//   major: 1,
//   minor: 2,
//   patch: 3,
//   prerelease: ['beta', '1'],
//   metadata: ['build', '123'],
//   version: '1.2.3-beta.1+build.123',
//   build: ['build', '123'],
//   ...
// }
```

### Range Matching (Critical for Compatibility)

```typescript
// Satisfies - most common for minimum version enforcement
semver.satisfies('1.5.0', '>=1.0.0')              // true
semver.satisfies('0.9.0', '>=1.0.0')              // false
semver.satisfies('1.2.3-alpha', '>=1.2.3')       // false (prerelease)
semver.satisfies('1.2.3', '1.x || >=2.5.0')      // true (complex range)

// Max/Min in a range
semver.maxSatisfying(['1.2.3', '1.2.4', '1.3.0'], '^1.2') // '1.2.4'
semver.minSatisfying(['1.2.3', '1.2.4', '1.3.0'], '^1.2') // '1.2.3'

// Check if version is outside range
semver.outside('1.2.3', '1.4.x', '>')  // true (1.2.3 > 1.4.x range)
```

---

## Part 3: Version Detection from CLI Output

### The Challenge

CLI `--version` output varies widely:
```
git --version
→ "git version 2.40.0"

docker --version
→ "Docker version 24.0.0, build abc123"

codemachine-cli --version
→ "codemachine-cli v1.5.2 (Nova BETA)"

npm --version
→ "10.0.0"
```

### Strategy: semver.clean() + Regex Fallback

```typescript
import { spawnSync } from 'node:child_process';
import semver from 'semver';

/**
 * Extract version from CLI --version output
 * Tries multiple strategies to handle varied output formats
 */
export function extractVersionFromCli(
  cliName: string,
  versionOutput: string,
  options?: { timeout?: number }
): string | null {
  if (!versionOutput || typeof versionOutput !== 'string') {
    return null;
  }

  // Strategy 1: Try to clean the entire output first
  const cleaned = semver.clean(versionOutput.trim());
  if (cleaned) {
    return cleaned;
  }

  // Strategy 2: Extract first semver pattern from output
  // Matches: v1.2.3, 1.2.3, 1.2.3-beta, 1.2.3-beta.1+build
  const semverRegex = /\bv?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?)\b/;
  const match = versionOutput.match(semverRegex);

  if (match?.[1]) {
    const extracted = semver.clean(match[1]);
    if (extracted) {
      return extracted;
    }
  }

  // Strategy 3: Extract major.minor.patch from anywhere in output
  // Matches partial versions and tries to normalize them
  const partialRegex = /(\d+)\.(\d+)\.(\d+)/;
  const partialMatch = versionOutput.match(partialRegex);

  if (partialMatch) {
    const reconstructed = `${partialMatch[1]}.${partialMatch[2]}.${partialMatch[3]}`;
    return reconstructed;
  }

  return null;
}

/**
 * Get version from external CLI with timeout and error handling
 */
export function getCliVersion(
  cliName: string,
  options?: { timeout?: number; versionFlag?: string }
): {
  success: boolean;
  version: string | null;
  rawOutput?: string;
  error?: string;
} {
  const versionFlag = options?.versionFlag ?? '--version';
  const timeout = options?.timeout ?? 5000;

  try {
    const result = spawnSync(cliName, [versionFlag], {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      return {
        success: false,
        version: null,
        error: `Command failed: ${result.error.message}`,
      };
    }

    if (result.status !== 0) {
      return {
        success: false,
        version: null,
        rawOutput: result.stderr || result.stdout,
        error: `${cliName} ${versionFlag} exited with code ${result.status}`,
      };
    }

    const rawOutput = (result.stdout || result.stderr || '').trim();
    const version = extractVersionFromCli(cliName, rawOutput);

    if (!version) {
      return {
        success: false,
        version: null,
        rawOutput,
        error: `Could not extract version from: ${rawOutput}`,
      };
    }

    return {
      success: true,
      version,
      rawOutput,
    };
  } catch (error) {
    return {
      success: false,
      version: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Testing the extraction:**

```typescript
// Test cases for version extraction
const testCases = [
  { input: 'git version 2.40.0', expected: '2.40.0' },
  { input: 'Docker version 24.0.0, build abc123', expected: '24.0.0' },
  { input: 'v1.5.2 (Nova BETA)', expected: '1.5.2' },
  { input: '10.0.0', expected: '10.0.0' },
  { input: 'codemachine-cli 0.8.0-beta.1', expected: '0.8.0-beta.1' },
  { input: 'v1.2.3+build.123', expected: '1.2.3' },
];

for (const { input, expected } of testCases) {
  const result = extractVersionFromCli('test', input);
  console.assert(result === expected, `Failed: "${input}" -> got "${result}", expected "${expected}"`);
}
```

---

## Part 4: Compatibility Enforcement Strategies

### Strategy 1: Minimum Version Enforcement (Most Common)

```typescript
import semver from 'semver';

interface VersionRequirement {
  name: string;
  minVersion: string;
  recommendedVersion?: string;
}

interface VersionCheckResult {
  status: 'pass' | 'fail' | 'warn';
  message: string;
  foundVersion: string | null;
  minRequired: string;
  remediation?: string;
}

/**
 * Check if CLI version meets minimum requirement
 */
export function checkMinimumVersion(
  foundVersion: string | null,
  requirement: VersionRequirement
): VersionCheckResult {
  // Case 1: Version not found
  if (!foundVersion) {
    return {
      status: 'fail',
      message: `${requirement.name} not found`,
      foundVersion: null,
      minRequired: requirement.minVersion,
      remediation: `Install ${requirement.name} v${requirement.minVersion} or later`,
    };
  }

  // Validate that found version is actually valid semver
  const cleanVersion = semver.valid(foundVersion);
  if (!cleanVersion) {
    return {
      status: 'fail',
      message: `${requirement.name} version "${foundVersion}" is not valid semver`,
      foundVersion,
      minRequired: requirement.minVersion,
      remediation: `Verify ${requirement.name} is properly installed`,
    };
  }

  // Case 2: Below minimum
  if (semver.lt(cleanVersion, requirement.minVersion)) {
    return {
      status: 'fail',
      message: `${requirement.name} ${cleanVersion} is below minimum v${requirement.minVersion}`,
      foundVersion: cleanVersion,
      minRequired: requirement.minVersion,
      remediation: `Upgrade ${requirement.name} to v${requirement.minVersion} or later: npm install -g ${requirement.name}@latest`,
    };
  }

  // Case 3: Meets minimum, below recommended
  if (requirement.recommendedVersion && semver.lt(cleanVersion, requirement.recommendedVersion)) {
    return {
      status: 'warn',
      message: `${requirement.name} ${cleanVersion} is functional but outdated (recommended: v${requirement.recommendedVersion})`,
      foundVersion: cleanVersion,
      minRequired: requirement.minVersion,
      remediation: `Consider upgrading to v${requirement.recommendedVersion}: npm install -g ${requirement.name}@latest`,
    };
  }

  // Case 4: All good
  return {
    status: 'pass',
    message: `${requirement.name} ${cleanVersion} meets requirements`,
    foundVersion: cleanVersion,
    minRequired: requirement.minVersion,
  };
}
```

### Strategy 2: Range-Based Compatibility

```typescript
/**
 * Check version against a complex range specification
 * Useful for enforcing specific feature availability
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
    };
  }

  const compatible = semver.satisfies(cleanVersion, rangeSpec);

  if (!compatible) {
    return {
      status: 'fail',
      message: `Version ${cleanVersion} does not support ${featureName ?? 'required feature'} (requires: ${rangeSpec})`,
      foundVersion: cleanVersion,
      minRequired: rangeSpec,
      remediation: `Install a compatible version: npm install --save-dev somepackage@"${rangeSpec}"`,
    };
  }

  return {
    status: 'pass',
    message: `Version ${cleanVersion} supports ${featureName ?? 'required features'} (${rangeSpec})`,
    foundVersion: cleanVersion,
    minRequired: rangeSpec,
  };
}
```

### Strategy 3: Pre-Release Version Handling

Pre-releases (alpha, beta, rc) require special handling per SemVer 2.0.0:

```typescript
/**
 * Determine how to treat pre-release versions
 */
export interface PreReleasePolicy {
  // Allow pre-release versions in production?
  allowPreRelease: boolean;
  // If found version is pre-release but stable is available, warn?
  warnIfPreRelease: boolean;
  // Accept pre-release if requested explicitly
  acceptExplicitPreRelease: boolean;
}

export function checkVersionWithPreReleasePolicy(
  foundVersion: string,
  minVersion: string,
  policy: PreReleasePolicy = {
    allowPreRelease: false,
    warnIfPreRelease: true,
    acceptExplicitPreRelease: true,
  }
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

  // Pre-release only satisfies ranges if they have matching major.minor.patch
  // or if the range also contains a pre-release
  if (isPreRelease && !minIsPreRelease && !policy.allowPreRelease) {
    return {
      status: 'warn',
      message: `Version ${cleanFound} is a pre-release (not recommended for production)`,
      foundVersion: cleanFound,
      minRequired: minVersion,
      remediation: `Switch to stable version: npm install -g somepackage@latest`,
    };
  }

  // Now check minimum version
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
  };
}
```

### Strategy 4: 0.x Version Handling

Packages versioned as 0.x are pre-1.0 and treat minor versions as potentially breaking:

```typescript
/**
 * For 0.x versions, minor version updates can be breaking changes
 * Strategy: Treat 0.x.y like major.minor.patch where x=major, y=minor
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

  // For 0.x versions, check x.y versions are compatible
  if (min.major === 0) {
    // If major versions differ in 0.x, definitely incompatible
    if (found.major !== min.major) {
      return {
        status: 'fail',
        message: `Major version mismatch in pre-1.0: ${found.major} vs ${min.major}`,
        foundVersion,
        minRequired: minVersion,
        remediation: `Update to 0.${min.minor}.x series for compatibility`,
      };
    }

    // If minor versions differ in 0.x.y, likely incompatible
    if (found.minor !== min.minor && found.minor < min.minor) {
      return {
        status: 'fail',
        message: `Pre-1.0 minor version mismatch (may have breaking changes): 0.${found.minor} < 0.${min.minor}`,
        foundVersion,
        minRequired: minVersion,
        remediation: `Upgrade to 0.${min.minor}.x: npm install somepackage@0.${min.minor}`,
      };
    }
  }

  return {
    status: 'pass',
    message: `Version ${foundVersion} compatible with 0.x series`,
    foundVersion,
    minRequired: minVersion,
  };
}
```

---

## Part 5: Feature Flag and Capability Detection

Beyond version checking, detect specific capabilities:

```typescript
/**
 * Capability detection based on version ranges
 * Maps feature names to the version ranges that support them
 */
interface CapabilityMatrix {
  [featureName: string]: {
    minVersion: string;
    availableSince: string;
    removedIn?: string;
    description: string;
  };
}

export const codemachineCliCapabilities: CapabilityMatrix = {
  'two-way-sync': {
    minVersion: '1.0.0',
    availableSince: '1.0.0',
    description: 'Two-way synchronization with external CLI',
  },
  'ai-review': {
    minVersion: '0.8.0',
    availableSince: '0.8.0-beta',
    removedIn: '2.0.0-alpha', // Will be removed
    description: 'AI-powered code review features',
  },
  'streaming-output': {
    minVersion: '1.5.0',
    availableSince: '1.5.0',
    description: 'Real-time streaming output for long operations',
  },
};

/**
 * Detect which capabilities are available for a given version
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
  if (!clean) throw new Error(`Invalid version: ${version}`);

  const result = {
    available: [] as string[],
    unavailable: [] as string[],
    deprecated: [] as string[],
  };

  for (const [feature, spec] of Object.entries(capabilities)) {
    // Check if removed
    if (spec.removedIn && semver.gte(clean, spec.removedIn)) {
      result.deprecated.push(feature);
      continue;
    }

    // Check if available
    if (semver.gte(clean, spec.minVersion)) {
      result.available.push(feature);
    } else {
      result.unavailable.push(feature);
    }
  }

  return result;
}

/**
 * Example: Check if version supports a specific feature
 */
function supportsFeature(version: string, feature: string): boolean {
  const capabilities = detectCapabilities(version, codemachineCliCapabilities);
  return capabilities.available.includes(feature);
}

// Usage
if (supportsFeature('1.5.0', 'streaming-output')) {
  // Use streaming API
}
```

---

## Part 6: Integration with Doctor Command

Extend the existing doctor.ts to use semver checking:

```typescript
import semver from 'semver';
import { getCliVersion, checkMinimumVersion } from '../utils/version-check';

/**
 * Enhanced doctor check for external CLI dependencies with semver validation
 */
private async checkExternalCliDependencies(): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  // Define requirements for each external CLI
  const cliRequirements = [
    {
      name: 'CodeMachine CLI (Execution)',
      executable: 'codemachine-cli',
      minVersion: '0.8.0',
      recommendedVersion: '1.5.0',
      optional: true,
      description: 'For execution engine support',
    },
    {
      name: 'Graphite',
      executable: 'gt',
      minVersion: '0.21.0',
      recommendedVersion: '0.25.0',
      optional: true,
      description: 'For stacked PR management',
    },
  ];

  for (const requirement of cliRequirements) {
    try {
      const versionResult = getCliVersion(requirement.executable);

      if (!versionResult.success) {
        checks.push({
          name: requirement.name,
          status: requirement.optional ? 'warn' : 'fail',
          message: `${requirement.name} not found or version check failed`,
          remediation: `Install ${requirement.name} v${requirement.minVersion}+: ${
            requirement.name === 'CodeMachine CLI (Execution)'
              ? 'npm install -g codemachine-cli'
              : 'Install from: https://graphite.dev/'
          }`,
          details: {
            executable: requirement.executable,
            description: requirement.description,
          },
        });
        continue;
      }

      // Check version compatibility
      const versionCheck = checkMinimumVersion(versionResult.version, {
        name: requirement.name,
        minVersion: requirement.minVersion,
        recommendedVersion: requirement.recommendedVersion,
      });

      checks.push({
        name: requirement.name,
        status: versionCheck.status,
        message: versionCheck.message,
        remediation: versionCheck.remediation,
        details: {
          found_version: versionCheck.foundVersion,
          min_required: versionCheck.minRequired,
          recommended: requirement.recommendedVersion,
          executable: requirement.executable,
        },
      });
    } catch (error) {
      checks.push({
        name: requirement.name,
        status: requirement.optional ? 'warn' : 'fail',
        message: `Error checking ${requirement.name}`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  return checks;
}
```

---

## Part 7: Best Practices Summary

### 1. **Always Validate Before Comparing**

```typescript
// ✗ DON'T: Assume version is valid
const valid = semver.gt(userInput, minVersion);

// ✓ DO: Validate first
const clean = semver.valid(userInput);
if (!clean) return handleInvalidVersion();
const valid = semver.gt(clean, minVersion);
```

### 2. **Use `gte` for Minimum Enforcement**

```typescript
// ✓ Best practice for minimum version checks
if (semver.gte(foundVersion, minVersion)) {
  // Version acceptable
}

// ✗ Avoid: Complex range when simple comparison works
if (semver.satisfies(foundVersion, `>=${minVersion}`)) {
  // Same logic, more overhead
}
```

### 3. **Handle Pre-Releases Explicitly**

```typescript
// ✓ DO: Check for pre-release
const parsed = semver.parse(version);
if (parsed?.prerelease?.length > 0) {
  // Handle pre-release version
}

// ✗ DON'T: Ignore pre-release indicators
const isStable = semver.satisfies(version, '>=1.0.0'); // May include pre-releases
```

### 4. **Provide Clear Remediation**

```typescript
// ✓ Specific and actionable
message: 'Git 2.25.0 required, found 2.20.0',
remediation: 'Upgrade Git: brew upgrade git (macOS) or visit https://git-scm.com/',

// ✗ Vague
message: 'Version mismatch',
```

### 5. **Handle 0.x Versions Carefully**

```typescript
// ✓ Treat 0.x.y like major.minor.patch
const min = semver.parse('0.2.0');
const found = semver.parse('0.1.5');
if (min?.minor !== found?.minor) {
  // Warn: potential breaking changes in pre-1.0
}
```

### 6. **Use Timeout for CLI Calls**

```typescript
// ✓ Always set timeout to prevent hanging
const result = spawnSync('cli', ['--version'], {
  timeout: 5000, // 5 seconds max
  encoding: 'utf-8',
});

// ✗ DON'T: No timeout (can hang indefinitely)
const result = spawnSync('cli', ['--version']);
```

---

## Part 8: Real-World Examples

### Example 1: Docker Version Check in Doctor Command

```typescript
private checkDockerVersion(): DiagnosticCheck {
  const result = getCliVersion('docker');

  if (!result.success) {
    return {
      name: 'Docker',
      status: 'warn',
      message: 'Docker not installed (optional)',
      remediation: 'Install Docker: https://docker.com/',
    };
  }

  // Docker 20.0.0+ required for specific features
  if (semver.lt(result.version!, '20.0.0')) {
    return {
      name: 'Docker',
      status: 'warn',
      message: `Docker ${result.version} found, v20+ recommended for best compatibility`,
      remediation: 'Update Docker: docker update or https://docker.com/products/docker-desktop',
      details: { version: result.version },
    };
  }

  return {
    name: 'Docker',
    status: 'pass',
    message: `Docker ${result.version} installed`,
    details: { version: result.version },
  };
}
```

### Example 2: Complex Range Checking for Multi-Version Support

```typescript
// Support two major versions during transition period
const supportedVersions = '>=1.0.0 || >=0.8.0-beta <1.0.0';

const check = checkVersionRange('0.8.5', supportedVersions, 'AI review features');
// status: 'pass', message includes both versions supported
```

### Example 3: Reporting to Doctor Command (JSON Output)

```json
{
  "name": "CodeMachine CLI (Execution)",
  "status": "warn",
  "message": "CodeMachine CLI 0.7.0 is below recommended v1.5.0",
  "remediation": "Upgrade: npm install -g codemachine-cli@latest",
  "details": {
    "found_version": "0.7.0",
    "min_required": "0.8.0",
    "recommended": "1.5.0",
    "executable": "codemachine-cli"
  }
}
```

---

## References

- [npm semver package](https://www.npmjs.com/package/semver)
- [GitHub npm/node-semver repository](https://github.com/npm/node-semver)
- [Semantic Versioning 2.0.0 specification](https://semver.org/)
- [npm Semantic Versioning docs](https://docs.npmjs.com/cli/v6/using-npm/semver/)
- [semver-regex package](https://www.npmjs.com/package/semver-regex)
- [Sindre Sorhus semver-regex on GitHub](https://github.com/sindresorhus/semver-regex)
- [compare-versions package](https://www.npmjs.com/package/compare-versions)
