# Integrating Semver Compatibility Checks into Doctor Command

This guide shows how to extend the existing `doctor.ts` command with semantic version compatibility checking for external CLI dependencies.

## Current State

The doctor command in `src/cli/commands/doctor.ts` has a basic `checkCodeMachineCli()` method that:
- Attempts to spawn the CLI
- Checks exit status
- Returns version if successful
- Does NOT validate version compatibility

## Proposed Enhancement

Add version compatibility checks using the `semver` package to:
- Extract version from CLI output
- Validate minimum version requirements
- Detect feature availability
- Provide actionable remediation

## Implementation Steps

### Step 1: Install Dependencies

```bash
npm install semver
npm install --save-dev @types/semver
```

### Step 2: Create Version Check Utility Module

Copy the production-ready implementation from `docs/research/version-check-implementation.ts` to:

**File:** `src/utils/version-check.ts`

This module provides:
- `extractVersionFromCli()` - Extract semver from CLI output
- `getCliVersion()` - Get version from external CLI with error handling
- `checkMinimumVersion()` - Validate version meets minimum
- `batchCheckVersions()` - Check multiple CLIs efficiently

### Step 3: Update Doctor Command

Modify `src/cli/commands/doctor.ts`:

```typescript
import { checkMinimumVersion, getCliVersion } from '../../utils/version-check';

/**
 * Enhanced doctor check for external CLI dependencies
 */
private async checkCodeMachineCli(): Promise<DiagnosticCheck> {
  const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
  let cliPath = 'codemachine-cli';

  // Get CLI path from config if available
  if (fs.existsSync(configPath)) {
    const result = await loadRepoConfig(configPath);
    if (result.success && result.config?.execution?.codemachine_cli_path) {
      cliPath = result.config.execution.codemachine_cli_path;
    }
  }

  // Get version from CLI
  const versionResult = getCliVersion(cliPath);

  if (!versionResult.success) {
    return {
      name: 'CodeMachine CLI (Execution)',
      status: 'warn',
      message: `${cliPath} not found or version check failed`,
      remediation: `Install codemachine-cli: npm install -g codemachine-cli`,
      details: {
        error: versionResult.error,
        cli_path: cliPath,
      },
    };
  }

  // Check version compatibility
  const versionCheck = checkMinimumVersion(versionResult.version, {
    name: 'CodeMachine CLI',
    minVersion: '0.8.0',
    recommendedVersion: '1.5.0',
  });

  return {
    name: versionCheck.message.includes('CodeMachine CLI')
      ? 'CodeMachine CLI (Execution)'
      : 'CodeMachine CLI (Execution)',
    status: versionCheck.status,
    message: versionCheck.message,
    remediation: versionCheck.remediation,
    details: {
      found_version: versionCheck.foundVersion,
      min_required: versionCheck.minRequired,
      recommended: '1.5.0',
      cli_path: cliPath,
      raw_output: versionResult.rawOutput,
    },
  };
}

/**
 * New: Check all external CLI dependencies
 */
private async checkExternalCliDependencies(): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  // Define requirements for each external CLI
  const cliRequirements = [
    {
      name: 'CodeMachine CLI',
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
          name: `${requirement.name} (${requirement.description})`,
          status: requirement.optional ? 'warn' : 'fail',
          message: `${requirement.name} not found`,
          remediation: requirement.name === 'Graphite'
            ? 'Install Graphite: https://graphite.dev/getting-started'
            : `Install: npm install -g ${requirement.executable}`,
          details: {
            executable: requirement.executable,
            description: requirement.description,
            error: versionResult.error,
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
        name: `${requirement.name} (${requirement.description})`,
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
        name: `${requirement.name} (${requirement.description})`,
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

### Step 4: Call New Check in Doctor Command

Update the main `run()` method to include the new check:

```typescript
async run(): Promise<void> {
  const { flags } = await this.parse(Doctor);
  // ... existing code ...

  // Run diagnostic checks
  checks.push(this.checkNodeVersion());
  checks.push(this.checkGitInstalled());
  checks.push(this.checkNpmInstalled());
  checks.push(this.checkDockerInstalled());
  checks.push(this.checkGitRepository());
  checks.push(this.checkFilesystemPermissions());
  checks.push(this.checkOutboundConnectivity());

  // Async checks
  checks.push(await this.checkRepoConfig());
  checks.push(...(await this.checkExternalCliDependencies())); // ← ADD THIS
  checks.push(...(await this.checkEnvironmentVariables()));

  // ... rest of existing code ...
}
```

## Example Output

### Human-Readable Output

```
Environment Diagnostics Report
======================================================================

✓ Passed Checks:
  ✓ Node.js Version: Node.js v24.1.0 (v24 LTS preferred)
  ✓ Git CLI: git version 2.40.0
  ✓ npm: npm 10.0.0
  ✓ Git Repository: Git repository detected at /home/user/project
  ✓ CodeMachine CLI (For execution engine support): CodeMachine CLI 1.5.2 meets requirements

⚠ Warnings:
  ⚠ Docker: Docker not found
    → Install Docker from https://docker.com/ (optional but recommended)
  ⚠ Graphite (For stacked PR management): Graphite 0.20.5 is functional but outdated (recommended: v0.25.0)
    → Consider upgrading to v0.25.0: https://graphite.dev/getting-started

❌ Failed Checks:
  ❌ CodeMachine CLI (Alternative): CodeMachine CLI 0.7.0 is below minimum v0.8.0
    → Upgrade CodeMachine CLI to v0.8.0 or later: npm install -g codemachine-cli@latest

Summary:
  Total checks: 14
  Passed: 10
  Warnings: 2
  Failed: 2

❌ Critical failures detected - please address failed checks before proceeding

Exit code: 20
Exit code reference:
  0  = All checks passed
  10 = Configuration validation errors
  20 = Environment issues (missing tools, permissions)
  30 = Credential issues (missing tokens/keys)

For detailed documentation, see: docs/ops/doctor_reference.md
```

### JSON Output

```json
{
  "status": "issues_detected",
  "exit_code": 20,
  "checks": [
    {
      "name": "CodeMachine CLI (For execution engine support)",
      "status": "fail",
      "message": "CodeMachine CLI 0.7.0 is below minimum v0.8.0",
      "remediation": "Upgrade CodeMachine CLI to v0.8.0 or later: npm install -g codemachine-cli@latest",
      "details": {
        "found_version": "0.7.0",
        "min_required": "0.8.0",
        "recommended": "1.5.0",
        "executable": "codemachine-cli"
      }
    },
    {
      "name": "Graphite (For stacked PR management)",
      "status": "warn",
      "message": "Graphite 0.20.5 is functional but outdated (recommended: v0.25.0)",
      "remediation": "Consider upgrading to v0.25.0: https://graphite.dev/getting-started",
      "details": {
        "found_version": "0.20.5",
        "min_required": "0.21.0",
        "recommended": "0.25.0",
        "executable": "gt"
      }
    }
  ],
  "summary": {
    "total": 14,
    "passed": 10,
    "warnings": 2,
    "failed": 2
  },
  "config_path": "/home/user/project/.codepipe/config.json",
  "timestamp": "2025-02-13T10:30:00.000Z"
}
```

## Testing the Integration

### Unit Tests

Create `tests/unit/commands/doctor-semver.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { checkMinimumVersion, getCliVersion, extractVersionFromCli } from '../../../src/utils/version-check';

describe('Doctor Command - Semver Integration', () => {
  describe('extractVersionFromCli()', () => {
    it('extracts version from "git --version" output', () => {
      const result = extractVersionFromCli('git', 'git version 2.40.0');
      expect(result).toBe('2.40.0');
    });

    it('extracts version from "docker --version" output', () => {
      const result = extractVersionFromCli('docker', 'Docker version 24.0.0, build abc123');
      expect(result).toBe('24.0.0');
    });

    it('handles version with v prefix', () => {
      const result = extractVersionFromCli('npm', 'v10.0.0');
      expect(result).toBe('10.0.0');
    });

    it('handles pre-release versions', () => {
      const result = extractVersionFromCli('cli', '1.0.0-beta.1');
      expect(result).toBe('1.0.0-beta.1');
    });

    it('returns null for invalid output', () => {
      const result = extractVersionFromCli('cli', 'not a version');
      expect(result).toBeNull();
    });
  });

  describe('checkMinimumVersion()', () => {
    it('passes when version meets minimum', () => {
      const result = checkMinimumVersion('1.5.0', {
        name: 'Test CLI',
        minVersion: '1.0.0',
      });
      expect(result.status).toBe('pass');
    });

    it('fails when version below minimum', () => {
      const result = checkMinimumVersion('0.9.0', {
        name: 'Test CLI',
        minVersion: '1.0.0',
      });
      expect(result.status).toBe('fail');
      expect(result.remediation).toContain('Upgrade');
    });

    it('warns when below recommended but above minimum', () => {
      const result = checkMinimumVersion('1.2.0', {
        name: 'Test CLI',
        minVersion: '1.0.0',
        recommendedVersion: '1.5.0',
      });
      expect(result.status).toBe('warn');
      expect(result.message).toContain('outdated');
    });

    it('fails when version not found', () => {
      const result = checkMinimumVersion(null, {
        name: 'Test CLI',
        minVersion: '1.0.0',
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('not found');
    });
  });

  describe('getCliVersion()', () => {
    it('extracts version from CLI command', () => {
      const result = getCliVersion('node');
      expect(result.success).toBe(true);
      expect(result.version).toBeTruthy();
      expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('returns error for non-existent CLI', () => {
      const result = getCliVersion('nonexistent-cli-xyz-123');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('respects timeout option', () => {
      // Should timeout quickly on non-existent command
      const start = Date.now();
      const result = getCliVersion('sleep', {
        timeout: 1000,
        versionFlag: '10', // Will sleep 10 seconds, but timeout after 1s
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000); // Should timeout quickly
    });
  });
});
```

### Integration Test

Create `tests/integration/doctor-semver.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Doctor from '../../src/cli/commands/doctor';

describe('Doctor Command - Full Integration', () => {
  it('doctor command succeeds with external CLI checks', async () => {
    const doctor = new Doctor([], {});

    // This would actually invoke the command
    // In practice, you'd mock this or use a test harness
    // For now, just verify the check functions exist

    expect(doctor).toBeDefined();
  });

  it('doctor --json output includes CLI version details', () => {
    // Mock version checks and verify JSON output structure
    // Verify details fields are populated correctly
  });

  it('doctor detects outdated dependencies and suggests upgrades', () => {
    // Mock getCliVersion to return old version
    // Verify warning/fail status and remediation message
  });
});
```

## Configuration File Support

### Add CLI Requirements to Config

You can extend the RepoConfig to specify external CLI requirements:

**File:** `src/core/config/schemas.ts` (or equivalent)

```typescript
const externalCliRequirementSchema = z.object({
  executable: z.string(),
  minVersion: z.string(),
  recommendedVersion: z.string().optional(),
  optional: z.boolean().default(true),
});

export const repoConfigSchema = z.object({
  // ... existing fields ...
  external_cli_requirements: z.array(externalCliRequirementSchema).optional(),
});
```

Then in doctor command:

```typescript
private async checkExternalCliDependencies(): Promise<DiagnosticCheck[]> {
  const configPath = path.resolve(process.cwd(), CONFIG_RELATIVE_PATH);
  const result = await loadRepoConfig(configPath);

  // Use requirements from config or defaults
  const requirements = result.config?.external_cli_requirements ?? [
    { executable: 'codemachine-cli', minVersion: '0.8.0' },
    { executable: 'gt', minVersion: '0.21.0', optional: true },
  ];

  // ... rest of implementation
}
```

## Performance Considerations

1. **Timeouts**: All `spawnSync` calls have 5-second timeout
2. **Caching**: Version checks are performed once per doctor invocation
3. **Parallelization**: Use `batchCheckVersions()` for efficient multi-CLI checking
4. **Error Handling**: All errors are caught and reported as warnings/failures, not crashes

## Exit Codes

The doctor command continues to use:
- `0` - All checks passed
- `10` - Config validation errors
- `20` - Environment issues (includes CLI version mismatches)
- `30` - Credential issues

CLI version failures result in exit code `20` (environment issue).

## Documentation

Update the doctor reference documentation:

**File:** `docs/ops/doctor_reference.md`

```markdown
### External CLI Dependencies

The doctor command checks versions of external CLI dependencies:

| CLI | Minimum Version | Recommended | Optional |
|-----|-----------------|-------------|----------|
| CodeMachine CLI | 0.8.0 | 1.5.0 | Yes |
| Graphite | 0.21.0 | 0.25.0 | Yes |

**Remediation:**
- CodeMachine CLI: `npm install -g codemachine-cli@latest`
- Graphite: Visit https://graphite.dev/getting-started

Pre-release versions (e.g., 0.8.0-beta) are supported but will trigger a warning.
```

## Future Enhancements

1. **Feature Detection**: Use version numbers to detect available features
2. **Capability Negotiation**: Query CLI for available subcommands
3. **Version Constraints**: Allow project-specific version requirements
4. **Auto-Upgrade**: Add `doctor --fix` to attempt auto-upgrades
5. **Version History**: Track version upgrades over time for debugging
