# Semantic Version Compatibility Checking - Quick Reference

## Installation

```bash
npm install semver
npm install --save-dev @types/semver  # TypeScript
```

## Key Functions (Cheat Sheet)

### Version Comparison
```typescript
import semver from 'semver';

// Simple comparisons
semver.gt('1.2.3', '1.2.2')       // true
semver.gte('1.2.3', '1.2.3')      // true
semver.lt('1.2.2', '1.2.3')       // true
semver.lte('1.2.3', '1.2.3')      // true
semver.eq('1.2.3', '1.2.3')       // true

// Minimum version enforcement (MOST COMMON)
if (semver.gte(foundVersion, '1.0.0')) {
  // Version OK
}
```

### Version Validation
```typescript
semver.valid('1.2.3')             // '1.2.3' (valid, normalized)
semver.valid('v1.2.3')            // '1.2.3' (strips v prefix)
semver.valid('1.2')               // null (invalid)

semver.clean('v1.2.3')            // '1.2.3'
semver.clean('  1.2.3  ')         // '1.2.3'
```

### Range Matching
```typescript
// Most flexible - test against range specification
semver.satisfies('1.5.0', '>=1.0.0')         // true
semver.satisfies('1.5.0', '1.x')             // true
semver.satisfies('1.5.0', '>=1.0.0 <2.0.0') // true
semver.satisfies('2.5.0', '>=1.0.0 <2.0.0') // false
```

### Extract Version from Text
```typescript
const regex = /\bv?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?)\b/;
const match = 'Docker 24.0.0, build abc123'.match(regex);
// match[1] = '24.0.0'

// Then normalize
const clean = semver.clean(match[1]); // '24.0.0'
```

### Pre-release Handling
```typescript
semver.prerelease('1.2.3-beta.1')  // ['beta', '1']
semver.prerelease('1.2.3')         // null

// Pre-releases require matching major.minor.patch in range
semver.satisfies('1.2.3-beta', '>=1.2.3')  // false (different tuple)
semver.satisfies('1.2.3-beta', '>=1.2.3-alpha')  // true (same tuple)
```

### Parse Version
```typescript
const v = semver.parse('1.2.3-beta+build');
// {
//   major: 1,
//   minor: 2,
//   patch: 3,
//   prerelease: ['beta'],
//   metadata: ['build'],
//   version: '1.2.3-beta+build'
// }

// Check if pre-release
if (v?.prerelease?.length > 0) {
  // Is pre-release
}
```

## Common Patterns

### Pattern 1: Check Minimum Version
```typescript
const minVersion = '1.0.0';
const foundVersion = '0.9.5';

if (!foundVersion) {
  console.error('CLI not found');
} else if (!semver.valid(foundVersion)) {
  console.error(`Invalid version: ${foundVersion}`);
} else if (semver.lt(foundVersion, minVersion)) {
  console.error(`Version too old. Found: ${foundVersion}, need: ${minVersion}`);
} else {
  console.log('OK');
}
```

### Pattern 2: Get Version from CLI
```typescript
import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['--version'], {
  encoding: 'utf-8',
  timeout: 5000, // Always set timeout!
});

if (result.status === 0) {
  const version = semver.clean(result.stdout);
  // version = '2.40.0'
}
```

### Pattern 3: Extract from Messy Output
```typescript
const output = 'Docker version 24.0.0, build abc123';

// Try to clean directly first
let version = semver.clean(output);

// Fallback: extract pattern
if (!version) {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  if (match) {
    version = match[1]; // '24.0.0'
  }
}
```

### Pattern 4: Handle Pre-releases
```typescript
const version = '1.0.0-beta.1';
const minVersion = '1.0.0';

// Pre-release is below 1.0.0 for matching
if (semver.prerelease(version)) {
  console.warn('Pre-release version - may be unstable');
}

// Check if it satisfies minimum
const ok = semver.satisfies(version, `>=${minVersion}`);
// false - pre-release doesn't match stable minimum
```

### Pattern 5: Complex Range
```typescript
// Support multiple versions or ranges
const supported = '>=1.0.0 || 0.8.x';
const version = '0.8.5';

if (semver.satisfies(version, supported)) {
  console.log('Version supported');
}
```

### Pattern 6: 0.x Version Strictness
```typescript
// For 0.x versions, minor version changes are breaking
const found = semver.parse('0.1.5');
const min = semver.parse('0.2.0');

if (found?.major === 0 && min?.major === 0) {
  if (found.minor !== min.minor) {
    console.warn('Minor version mismatch in pre-1.0 (breaking changes likely)');
  }
}
```

## Error Handling Template

```typescript
export function getCliVersion(cliName: string): string | null {
  try {
    const result = spawnSync(cliName, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle command not found
    if (result.error) {
      console.error(`${cliName} not found: ${result.error.message}`);
      return null;
    }

    // Handle non-zero exit
    if (result.status !== 0) {
      console.error(`${cliName} exited with code ${result.status}`);
      return null;
    }

    // Extract and clean version
    const output = (result.stdout || result.stderr || '').trim();
    const version = semver.clean(output) || extractRegex(output);

    if (!version) {
      console.error(`Could not extract version from: ${output}`);
      return null;
    }

    return version;
  } catch (error) {
    console.error(`Error checking ${cliName}:`, error);
    return null;
  }
}
```

## Doctor Command Integration

```typescript
// In your doctor.ts check method
private checkExternalDependency(name: string, exe: string, min: string): DiagnosticCheck {
  const version = getCliVersion(exe);

  if (!version) {
    return {
      name,
      status: 'fail',
      message: `${name} not found`,
      remediation: `Install ${name} v${min}+`,
    };
  }

  if (semver.lt(version, min)) {
    return {
      name,
      status: 'fail',
      message: `${name} ${version} < ${min}`,
      remediation: `Upgrade: npm install -g ${exe}@latest`,
      details: { version, min },
    };
  }

  return {
    name,
    status: 'pass',
    message: `${name} ${version} OK`,
    details: { version },
  };
}
```

## Testing Your Version Checks

```typescript
import { describe, it, expect } from 'vitest';
import semver from 'semver';

describe('Version checking', () => {
  it('extracts version from CLI output', () => {
    expect(semver.clean('git version 2.40.0')).toBe('2.40.0');
    expect(semver.clean('Docker 24.0.0, build abc')).toBe(null);

    // Use regex for Docker
    const match = 'Docker 24.0.0, build abc'.match(/(\d+\.\d+\.\d+)/);
    expect(semver.clean(match![1])).toBe('24.0.0');
  });

  it('enforces minimum version', () => {
    expect(semver.gte('2.0.0', '1.5.0')).toBe(true);
    expect(semver.gte('1.5.0', '1.5.0')).toBe(true);
    expect(semver.gte('1.0.0', '1.5.0')).toBe(false);
  });

  it('handles pre-releases', () => {
    expect(semver.satisfies('1.0.0-beta', '>=1.0.0')).toBe(false);
    expect(semver.satisfies('1.0.0-beta', '>=1.0.0-alpha')).toBe(true);
  });

  it('handles 0.x versions strictly', () => {
    const v1 = semver.parse('0.1.5')!;
    const v2 = semver.parse('0.2.0')!;
    expect(v1.minor).not.toBe(v2.minor); // Breaking in 0.x
  });
});
```

## When to Use Each Function

| Function | Use Case | Example |
|----------|----------|---------|
| `gte()`, `gt()`, `lt()` | Simple comparison | `semver.gte(found, min)` |
| `satisfies()` | Complex ranges | `semver.satisfies(v, '>=1.0.0 <2.0.0')` |
| `valid()` | Validate input | `if (!semver.valid(input)) error()` |
| `clean()` | Normalize output | `semver.clean('v1.2.3')` → `'1.2.3'` |
| `parse()` | Inspect components | `parse(v).prerelease` |
| `prerelease()` | Check if pre-release | `if (semver.prerelease(v)) warn()` |

## Performance Considerations

- `semver.valid()` and `semver.clean()` are fast (< 1ms)
- `spawnSync` timeout should be 5 seconds max
- For batch checks of 10+ CLIs, consider parallelizing with `Promise.all()`
- Cache version checks in doctor command (within same invocation)

## Common Mistakes

```typescript
// ✗ DON'T - assumes input is valid
const ok = semver.gt(userInput, minVersion);

// ✓ DO - validate first
const clean = semver.valid(userInput);
if (!clean) throw new Error('Invalid version');
const ok = semver.gt(clean, minVersion);

// ✗ DON'T - spawns forever
const result = spawnSync('cli', ['--version']);

// ✓ DO - always set timeout
const result = spawnSync('cli', ['--version'], { timeout: 5000 });

// ✗ DON'T - pre-release satisfies stable range
semver.satisfies('1.2.3-beta', '>=1.2.3') // false!

// ✓ DO - pre-release needs matching range
semver.satisfies('1.2.3-beta', '>=1.2.3-alpha') // true
```

## References

- **npm semver package**: https://www.npmjs.com/package/semver
- **Full API docs**: https://github.com/npm/node-semver
- **SemVer spec**: https://semver.org/
- **Implementation code**: See `version-check-implementation.ts` in this directory
