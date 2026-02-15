---
module: Workflow
date: 2026-02-13
problem_type: logic_error
component: tooling
symptoms:
  - "openai engine passes CodeMachineEngineTypeSchema validation but fails at CLI binary level"
  - "CodeMachineCLIStrategy.canHandle() claims to handle testing/deployment task types that require native engines"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [engine-validation, strategy-pattern, canhandle, schema, zod]
issue_reference: "PR #466 review"
fix_commit: 9e7bb08
---

# Engine Schema Validation Bypass and canHandle Task Type Overreach

## Problem

Two related validation gaps in `CodeMachineCLIStrategy` allowed invalid configurations to pass the pipeline's validation layer and fail at the CLI binary level with confusing errors. Both were caught during PR #466 code review.

## Environment
- Module: Workflow (execution strategies)
- Affected Components: `src/workflows/codemachineTypes.ts`, `src/workflows/codeMachineCLIStrategy.ts`
- Date: 2026-02-13

## Symptoms
- When `default_engine` is configured as `'openai'`, the engine validation at `codeMachineCLIStrategy.ts:80` passes (schema allows it), but the CLI binary rejects it with an opaque "unknown engine" error
- When the CLI binary is available, `canHandle()` returns `true` for ALL task types including `testing` and `deployment`, which should use native engine handling — silently changing execution behavior vs the old `CodeMachineStrategy`

## What Didn't Work

**Direct solution:** Both problems were identified during code review and fixed on the first attempt.

## Solution

### Fix 1: Remove `openai` from CLI engine schema

`openai` is a valid pipeline engine (`ExecutionEngineType` in `RepoConfig.ts`) but NOT a CodeMachine-CLI engine. The `CodeMachineEngineTypeSchema` should only include engines the CLI binary supports.

```typescript
// Before (broken) — src/workflows/codemachineTypes.ts:
export const CodeMachineEngineTypeSchema = z.enum([
  'claude',
  'codex',
  'openai',  // ← passes validation but binary rejects it
]);

// After (fixed):
export const CodeMachineEngineTypeSchema = z.enum([
  'claude',
  'codex',
]);
```

### Fix 2: Add `shouldUseNativeEngine()` guard to `canHandle()`

The old `CodeMachineStrategy.canHandle()` filtered out native-engine task types via `shouldUseNativeEngine()`. The new CLI strategy omitted this filter.

```typescript
// Before (broken) — src/workflows/codeMachineCLIStrategy.ts:
canHandle(_task: ExecutionTask): boolean {
  return this.isAvailable;  // ← intercepts ALL task types
}

// After (fixed):
canHandle(task: ExecutionTask): boolean {
  // Must be available AND the task type must not require native engine handling.
  return this.isAvailable && !shouldUseNativeEngine(task.task_type);
}
```

## Why This Works

1. **Engine schema**: `openai` now fails `CodeMachineEngineTypeSchema.safeParse()` at line 80-91, producing a clear error message (`Unsupported engine: 'openai'. Supported: claude, codex`) instead of a confusing binary-level failure. The pipeline's `ExecutionEngineType` is unchanged — `openai` is still valid for pipeline routing, just not for the CLI strategy.

2. **canHandle filter**: Task types with `useNativeEngine: true` (`testing`, `deployment`) now return `false` from `canHandle()`, matching the old `CodeMachineStrategy` behavior. Since `CodeMachineCLIStrategy` is registered first in the strategies array, without this filter it would intercept tasks it shouldn't handle.

## Tests Added

3 new tests in `tests/unit/codeMachineCLIStrategy.test.ts` (15 total):

1. `rejects openai engine as unsupported by CodeMachine-CLI` — verifies clear error message
2. `returns false for native-engine task types even when available` — `testing`, `deployment` → `false`
3. `returns true for non-native task types when available` — `code_generation`, `pr_creation`, `review` → `true`

## Prevention

### When adding a new schema that mirrors an existing one:
- Audit whether the schemas serve different validation purposes (pipeline vs binary)
- Name schemas to clarify their scope (e.g., `CodeMachineEngineTypeSchema` vs `ExecutionEngineType`)
- Add a comment explaining why they differ

### When implementing `canHandle()` in a new strategy:
- Check the old strategy's `canHandle()` logic — it may have intentional filters
- If the new strategy is registered with higher priority, it must not widen the acceptance criteria
- Test with all task types, not just the happy path

### General principle
When two schemas or interfaces represent the same concept at different layers (pipeline vs binary, config vs runtime), keep them separate and document why they differ.

## Related Issues

- See also: [codemachine-cli-strategy-prerequisite-validation.md](../integration-issues/codemachine-cli-strategy-prerequisite-validation.md) — related prerequisite validation fix in the same PR
- See also: [multi-agent-wave-resolution-pr-findings.md](../code-review/multi-agent-wave-resolution-pr-findings.md) — wave-based PR review process used to find these
- [PR #466](https://github.com/KingInYellows/codemachine-pipeline/pull/466) — feature PR
