---
title: 'Skip Legacy CLI Check When CodeMachine-CLI Strategy Is Available'
date: 2026-02-13
category: integration-issues
tags:
  - prerequisite-validation
  - execution-strategy
  - cli-binary-resolution
  - strategy-pattern
  - fallback-handling
severity: high
components:
  - src/workflows/cliExecutionEngine.ts
  - src/workflows/codeMachineCLIStrategy.ts
  - src/cli/commands/start.ts
  - src/cli/commands/resume.ts
  - tests/integration/cliExecutionEngine.spec.ts
symptoms:
  - Execution blocked despite CodeMachine-CLI binary being available via binaryResolver
  - validatePrerequisites() fails when legacy CLI path is missing, even though new strategy resolved a binary
  - start/resume commands fail in environments where binary is available through optionalDeps but not in PATH
issue_reference: 'PR #466'
fix_commit: cd48113
---

# Skip Legacy CLI Check When CodeMachine-CLI Strategy Is Available

## Problem

After introducing `CodeMachineCLIStrategy` (which resolves binaries via `binaryResolver` -- env vars, npm optionalDeps, PATH chain), `CLIExecutionEngine.validatePrerequisites()` still always required the legacy `codemachine_cli_path` to be valid. This blocked execution in the primary deployment scenario where the binary is available via optionalDeps but not as a bare `codemachine` command in PATH.

**Observed behavior:**

1. `cliStrategy.checkAvailability()` succeeds (binary found via optionalDep)
2. `executionEngine.validatePrerequisites()` fails (legacy `codemachine --version` check fails)
3. Both `start.ts` and `resume.ts` throw on prerequisite failure, blocking all execution

## Root Cause

`validatePrerequisites()` was written before `CodeMachineCLIStrategy` existed. It hardcoded a single CLI availability check against `config.execution.codemachine_cli_path` (default: `'codemachine'`). When the new strategy was added with its own binary resolution path, the prerequisite check was never updated to account for it.

This is a **validation coupling** bug: the engine's prerequisite logic was tightly coupled to one resolution path and didn't delegate to or consult the registered strategies.

## Solution

In `validatePrerequisites()`, when the legacy CLI check fails, check if a registered `codemachine-cli` strategy is available. If so, downgrade the error to a warning.

### Before

```typescript
// src/workflows/cliExecutionEngine.ts
const cliPath = executionConfig.codemachine_cli_path;
const cliCheck = await validateCliAvailability(cliPath);
if (!cliCheck.available) {
  errors.push(
    `CodeMachine CLI not available at '${cliPath}': ${cliCheck.error ?? 'unknown error'}`
  );
}
```

### After

```typescript
const cliPath = executionConfig.codemachine_cli_path;
const cliCheck = await validateCliAvailability(cliPath);
if (!cliCheck.available) {
  // When the codemachine-cli strategy resolved a binary via binaryResolver
  // (e.g. optionalDep), the legacy CLI path is not required for execution.
  const cliStrategyAvailable = this.strategies.some(
    (s) => s.name === 'codemachine-cli' && s.canHandle({} as ExecutionTask)
  );
  if (cliStrategyAvailable) {
    warnings.push(`Legacy CLI not found at '${cliPath}'; using codemachine-cli strategy`);
  } else {
    errors.push(
      `CodeMachine CLI not available at '${cliPath}': ${cliCheck.error ?? 'unknown error'}`
    );
  }
}
```

### Why It Works

`CodeMachineCLIStrategy.canHandle()` returns `this.isAvailable`, a cached flag set by `checkAvailability()` at registration time. Both `start.ts` and `resume.ts` call `checkAvailability()` before constructing the engine, so the flag is already set when `validatePrerequisites()` runs. If the binary was resolved via `binaryResolver`, the strategy reports available and the legacy check is safely downgraded to a warning.

## Tests Added

Two new integration tests in `tests/integration/cliExecutionEngine.spec.ts`:

1. **Positive case**: Legacy CLI missing, `codemachine-cli` strategy available -- validation passes with warning
2. **Negative case**: Strategy registered but not available (binary not resolved) -- validation still fails with error

Also fixed a pre-existing environment-dependent test that assumed the legacy CLI was in PATH.

## Prevention Strategies

### When adding a new strategy to a strategy-pattern engine:

- [ ] Audit all prerequisite/validation code paths for hardcoded assumptions
- [ ] Test the matrix: old available + new unavailable, old unavailable + new available, both unavailable
- [ ] Consider delegating prerequisite checks to strategies themselves (each strategy owns its own availability logic)
- [ ] Consider adding `isAvailable()` to the strategy interface for engine-level aggregation

### General principle

Prerequisite validation should be **strategy-aware**, not hardcoded to one resolution path. When strategies have different binary resolution mechanisms, the engine should aggregate their availability rather than checking a single path.

## Cross-References

- [ADR-8: CodeMachine-CLI Integration](../../adr/ADR-8-codemachine-cli-integration.md) -- architecture decision for the strategy pattern
- [PR #466](https://github.com/KingInYellows/codemachine-pipeline/pull/466) -- feature PR that introduced the integration
- [docs/solutions/code-review/multi-agent-wave-resolution-pr-findings.md](../code-review/multi-agent-wave-resolution-pr-findings.md) -- related PR review findings
- [Integration plan](../../plans/2026-02-12-feat-codemachine-cli-two-way-integration-plan.md) -- original implementation plan
- [Engine schema & canHandle overreach](../logic-errors/engine-schema-canhandle-overreach-codeMachineCLI-20260213.md) -- follow-up fixes from PR review
