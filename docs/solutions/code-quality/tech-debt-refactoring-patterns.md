---
title: Tech Debt Refactoring Patterns from PRs 661-663
date: 2026-03-01
category: code-quality
tags: [refactoring, factories, naming, dead-code, config-dedup, retry, spread-pattern, tech-debt]
severity: p2
component: cli/commands, adapters, workflows, persistence
symptom: "Trivial factories, name shadowing, dead code, repeated config fallbacks, unbounded retry, conditional mutation"
root_cause: "Accumulated tech debt patterns across multiple modules during feature development"
resolution: "Systematic refactoring guided by multi-agent code review findings"
related_issues: ["PR #661", "PR #662", "PR #663"]
---

# Tech Debt Refactoring Patterns from PRs #661-663

## Problem

A multi-agent code review of three stacked tech debt PRs (#661-663) identified
8 P2 and 4 P3 patterns across the codebase. Each pattern individually is minor,
but together they compound into maintenance burden, test fragility, and
readability issues.

This document catalogs the recurring patterns and their canonical fixes so
future refactoring sessions can apply them systematically.

## Pattern 1: Factory Removal Requires Test Updates

**Severity:** P2
**Symptom:** Trivial factory functions (`createAgentAdapter()`, `createManifestLoader()`)
that wrap a single constructor call with no additional logic.

**Root Cause:** Factories were introduced speculatively (YAGNI violation) during
initial development, anticipating future complexity that never materialized.

**Fix:**

```typescript
// Before: trivial factory
export function createAgentAdapter(config: AgentConfig): AgentAdapter {
  return new AgentAdapter(config);
}

// After: remove factory, use constructor directly
const adapter = new AgentAdapter(config);
```

**Critical gotcha:** Tests that import and call the factory will break. Always
grep test files before removing a factory:

```bash
grep -rn 'createAgentAdapter\|createManifestLoader' tests/
```

Update tests to use the constructor directly and remove any test files that
existed solely to test the factory wrapper (e.g., `manifestLoader.spec.ts`
testing only that the factory calls `new`).

## Pattern 2: Name Shadowing Between Imports and Private Methods

**Severity:** P2
**Symptom:** A class has a private method with the same name as an imported
function (e.g., private `validateCliAvailability()` shadows the imported
`validateCliAvailability` from `validation/cliPath.js`).

**Root Cause:** The private method was added later without checking for existing
imports with the same name.

**Fix:** Rename the private method to a semantically distinct name:

```typescript
// Before: shadows import
import { validateCliAvailability } from '../validation/cliPath.js';
class BinaryResolver {
  private validateCliAvailability() { ... }  // shadows!
}

// After: distinct name
import { validateCliPath } from '../validation/cliPath.js';
class BinaryResolver {
  private checkCliAvailability() { ... }
}
```

**Detection:**

```bash
# Find classes with methods that share names with imports in the same file
grep -rn "private.*validate\|private.*create\|private.*get" src/ | \
  while read -r line; do
    method=$(echo "$line" | grep -oP 'private \w+')
    file=$(echo "$line" | cut -d: -f1)
    grep -q "import.*${method#private }" "$file" && echo "SHADOW: $file $method"
  done
```

## Pattern 3: Dead Code — Unreachable Guards and Unused Parameters

**Severity:** P2
**Symptom:** Null guards that can never trigger (e.g., guarding a value that was
already validated upstream), unused parameters passed through call chains.

**Root Cause:** Defensive coding that was not revisited after upstream validation
was added, or parameters that survived a refactor where their consumer was
removed.

**Fix:**

```typescript
// Before: _featureId is passed but never used
async function analyzeAndDisplayResumeState(
  _featureId: string,   // unused
  runDir: string,
): Promise<void> { ... }

// After: remove unused param
async function analyzeAndDisplayResumeState(
  runDir: string,
): Promise<void> { ... }
```

```typescript
// Before: dead null guard (config is always set by this point)
if (!config) {
  throw new Error('Config not initialized');  // unreachable
}

// After: remove the guard entirely
```

**Detection:** TypeScript compiler with `noUnusedParameters` catches unused
params. For dead guards, look for null checks on values that are validated
earlier in the same call chain.

## Pattern 4: Repeated Config Fallbacks — Resolve Once in Constructor

**Severity:** P3
**Symptom:** Multiple private methods in a class repeat the same fallback
pattern: `this.config.executionConfig ?? DEFAULT_EXECUTION_CONFIG`.

**Root Cause:** Each method independently resolves the fallback because no
single resolution point was established.

**Fix:** Resolve once as a readonly field in the constructor:

```typescript
class CliExecutionEngine {
  private readonly resolvedConfig: ExecutionConfig;

  constructor(config: EngineConfig) {
    this.resolvedConfig = config.executionConfig ?? DEFAULT_EXECUTION_CONFIG;
  }

  private executeTask(): void {
    // Before: this.config.executionConfig ?? DEFAULT_EXECUTION_CONFIG
    // After:
    const timeout = this.resolvedConfig.timeout;
  }
}
```

## Pattern 5: Unbounded Retry Delay — Cap External Values

**Severity:** P3 (but P1 potential in production)
**Symptom:** `retryAfterSeconds` from an external API response is used directly
as a delay without an upper bound, allowing an adversarial or buggy server to
impose arbitrarily long waits.

**Root Cause:** The retry-after header value was trusted without validation.

**Fix:**

```typescript
const MAX_RETRY_SECONDS = 300;

// Before:
const delay = retryAfterSeconds * 1000;

// After:
const delay = Math.min(retryAfterSeconds, MAX_RETRY_SECONDS) * 1000;
```

**Prevention:** Any value from an external source that controls timing (delays,
timeouts, intervals) must be capped. Add a lint rule or code review checklist
item: "Are all externally-sourced timing values bounded?"

## Pattern 6: Conditional Field Mutation — Use Object Spread

**Severity:** P3
**Symptom:** An object is constructed, then fields are conditionally assigned
via `if` statements:

```typescript
const data: BranchData = { repo, branch };
if (protectionEnabled) {
  data.protection = protectionDetails;
}
```

**Fix:** Use a spread pattern for cleaner, immutable-style construction:

```typescript
const optionalFields = protectionEnabled
  ? { protection: protectionDetails }
  : {};

const data: BranchData = { repo, branch, ...optionalFields };
```

## Pattern 7: Simplify Return Types When Callers Ignore the Value

**Severity:** P3
**Symptom:** A function returns `Promise<string>` (e.g., a file path) but no
caller uses the return value.

**Fix:** Change to `Promise<void>`. Check both production callers and test
assertions:

```bash
grep -rn 'persistReport\|await.*persistReport' src/ tests/
```

## Prevention Checklist

For future tech debt refactoring sessions:

- [ ] Before removing any exported function, grep all of `src/` AND `tests/` for usages
- [ ] After renaming, run the full test suite (`npm test`) before committing
- [ ] When removing parameters, check all callers in the call chain
- [ ] When capping external values, document the cap constant with a rationale comment
- [ ] When changing return types, check test assertions that may `expect()` the old return value
- [ ] Run `npm run deps:check` after any cross-layer import changes

## Related Documentation

- `docs/solutions/integration-issues/layer-inversion-fix-via-type-extraction.md` --
  the P1 layer inversion finding from the same review session
- MEMORY.md entries on base-class migration and metric key constants --
  related architecture discipline patterns
