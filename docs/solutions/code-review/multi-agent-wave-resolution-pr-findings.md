---
title: Wave-Based Parallel Resolution of PR Review Findings
date: 2026-02-13
category: code-review
tags: [security, reliability, dead-code, test-coverage, architecture, dependency-management, parallel-execution]
severity: p1
component: adapters/codemachine, workflows, cli/commands
symptom: "16 code review findings across security, reliability, dead code, documentation drift, config duplication, and test coverage gaps"
root_cause: "New feature PR introduced argument injection risk, silent error handling, speculative dead code, aspirational documentation, and insufficient test coverage"
resolution: "Dependency-aware wave-based parallel agent resolution: 12 agents across 3 waves"
time_to_resolve: "~30 minutes across 3 waves with up to 9-agent concurrency"
related_issues: ["PR #466"]
---

# Wave-Based Parallel Resolution of PR Review Findings

## Problem

PR #466 "feat: integrate CodeMachine-CLI as two-way execution engine (Cycle 9)" introduced a new execution engine with adapter, strategy, binary resolver, types, and CLI doctor integration. A 9-agent code review found 16 issues spanning 6 categories.

### Symptoms

- Engine + prompt concatenated into single shell argument — injection risk
- Empty catch blocks silently swallowing errors in adapter
- 143.7 MB dependency (`codemachine`) added as hard requirement despite runtime fallback
- Unbounded stdout/stderr accumulation could OOM on large outputs
- WorkflowTemplateMapper (335 LOC + tests) unused by any code path
- ADR-8 claimed strategy "is registered" but registration was not implemented
- Default execution config duplicated in 3 files
- No tests for error events, timeout escalation, credential failures, or PATH fallback

### Review Agents Used

| Agent | Key Findings |
|-------|-------------|
| security-sentinel | Argument injection, credential handling |
| silent-failure-hunter | Empty catches, credential stdin ignored |
| performance-oracle | 143.7 MB dep, unbounded buffer |
| code-simplicity-reviewer | Dead code, config triplication, YAGNI |
| pattern-recognition-specialist | getErrorMessage violations, env filter duplication |
| architecture-strategist | Strategy not registered, barrel export gaps |
| agent-native-reviewer | Barrel exports, doctor logic locked in oclif |
| comment-analyzer | ADR-8 inaccuracies, aspirational JSDoc |
| test-analyzer | 5 critical coverage gaps |

## Root Cause

The PR was a large feature addition (~6,400 lines) that included speculative code for future phases alongside the core implementation. Specific issues:

1. **Security**: `['run', \`${engine} '${prompt}'\`]` passed engine and prompt as a single concatenated string
2. **Reliability**: Catch blocks left empty, no buffer caps, credential failures silently ignored
3. **Dead code**: WorkflowTemplateMapper, 5 unsupported engine types, CoordinationSyntax branded type, ~50 LOC PID tracking — none referenced by production paths
4. **Documentation drift**: ADR-8 and JSDoc written aspirationally rather than reflecting actual implementation state
5. **Duplication**: DEFAULT_EXECUTION_CONFIG in 3 files, env filtering in 2 files
6. **Test gaps**: Error handlers, timeout escalation, and credential paths had zero coverage

## Solution

### Dependency Analysis

The 16 findings were analyzed for file-level dependencies to determine safe parallelization:

```
Wave 1 (independent) ─┬─ 001: Engine validation + arg splitting
                       ├─ 002+004+007+009: Adapter fixes (batched, same file)
                       ├─ 003: optionalDependencies
                       ├─ 006: Dead code removal
                       ├─ 008: ADR-8 corrections
                       ├─ 010: Doctor config load
                       ├─ 011: Binary cache fix
                       ├─ 012: Env filter extraction
                       └─ 013: DEFAULT_CONFIG extraction
                              │
Wave 2 (depends on W1) ┬─ 005: Strategy registration docs (needs 001, 013)
                        ├─ 015: Unused engine types (needs 001, 006)
                        └─ 016: Barrel exports (needs 005, 006)
                              │
Wave 3 (depends on W2) └─ 014: Test coverage (needs all code stable)
```

Key decision: Todos 002, 004, 007, 009 all edited `CodeMachineCLIAdapter.ts`, so they were batched into a single agent to avoid conflicts.

### Critical Fix: Argument Injection

```typescript
// BEFORE (injection risk — single concatenated arg):
const args = ['run', `${engine} '${prompt}'`];

// AFTER (safe — separate argv elements with Zod validation):
const engineCheck = CodeMachineEngineTypeSchema.safeParse(engine);
if (!engineCheck.success) {
  return {
    success: false,
    status: 'failed',
    errorMessage: `Unsupported engine: '${engine}'. Supported: ${CodeMachineEngineTypeSchema.options.join(', ')}`,
    recoverable: false,
    durationMs: 0,
    artifacts: [],
  };
}
const args = ['run', engine, prompt];
```

### Execution Results

| Wave | Agents | Duration | Changes |
|------|--------|----------|---------|
| Wave 1 | 9 parallel | ~12 min | Core fixes across 16 files |
| Wave 2 | 3 parallel | ~5 min | Docs, cleanup, exports |
| Wave 3 | 1 | ~4 min | 14 new tests across 3 files |
| Verify | — | ~2 min | Build, 36 tests, lint |

**Final stats**: 20 files changed, 695 additions, 717 deletions (net -22 LOC), 36 tests passing, 0 new lint errors.

### Test Fix Required

After Wave 1 split the args, a strategy test broke:

```typescript
// Test expected prompt at index 1 (old concatenated format)
expect(commandArgs[1]).toContain('Custom prompt from config');

// Fixed to index 2 (new separate argv format)
expect(commandArgs[2]).toContain('Custom prompt from config');
```

### Pre-existing Failure Detected

The `cliExecutionEngine.spec.ts` "validate prerequisites" test was already failing before our changes (verified by stashing all changes and running). Root cause: codemachine binary not available in test environment. Not caused by review fixes.

## Prevention Strategies

### For Future Engine Integrations

1. **Argument injection**: Always pass CLI arguments as separate array elements. Validate enum-constrained values with Zod before passing to `spawn()`.

2. **Catch block policy**: No empty catches in adapter code. Minimum: `logger.debug()` with the error. ESLint's `no-empty` + `preserve-caught-error` enforce this.

3. **Dependency size**: Check bundle size before adding dependencies. Use `optionalDependencies` for heavy binaries that have runtime fallbacks (PATH resolution).

4. **Buffer bounds**: Any code accumulating subprocess output must have a configurable max buffer (default 10MB). Truncate with a warning when exceeded.

5. **Documentation-as-code**: Write ADR and JSDoc claims in the tense that matches implementation. If deferred, say "will be" not "is". Review agents catch this effectively.

6. **DRY config**: Default configuration objects need a single source of truth. Extract to a named export when the same values appear in 2+ locations.

7. **Error path testing**: Every catch block, timeout handler, and failure callback should have a corresponding test. Run the test-analyzer agent proactively during PR creation.

8. **Dead code prevention**: Run `npm run exports:check` (ts-unused-exports) and `npm run deps:check` (madge) before merging feature PRs.

### Engine Integration Checklist (Abbreviated)

- [ ] Zod schema for engine config with enum-constrained values
- [ ] Adapter with array-based spawn args (no concatenation)
- [ ] Bounded buffer config (10MB default)
- [ ] Logger calls in every catch block
- [ ] Tests for every error path (spawn error, timeout, credentials, fallback)
- [ ] Single DEFAULT_CONFIG export imported everywhere
- [ ] ADR with accurate registration claims (verified against imports)
- [ ] Barrel exports for all public types
- [ ] `npm run exports:check` and `npm run deps:check` pass

## Cross-References

- [Reviewing Documentation PRs](./reviewing-documentation-prs.md) — Related 5-agent review pattern for docs-only PRs
- [ADR-8: CodeMachine-CLI Integration](../../adr/ADR-8-codemachine-cli-integration.md) — Architecture decision (corrected in this fix)
- [Cycle 9 Feature Plan](../../plans/2026-02-12-feat-codemachine-cli-two-way-integration-plan.md) — Original implementation plan
- PR #466 — The reviewed PR
