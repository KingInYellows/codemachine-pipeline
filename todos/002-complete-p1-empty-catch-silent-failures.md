---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, error-handling, pr-466]
dependencies: []
---

# Empty Catch Blocks — Silent Failures

## Problem Statement

Multiple empty catch blocks suppress errors silently, violating the project's ESLint 10 `preserve-caught-error` rule and hiding operational issues:

1. `CodeMachineCLIAdapter.ts:310-312` — `removePidFile()` catches and discards ALL errors
2. `CodeMachineCLIAdapter.ts` — `checkLiveness()` has double empty catch blocks
3. `binaryResolver.ts` — empty catch in platform resolution

These make debugging impossible when PID file operations or liveness checks fail in production.

## Findings

- **Silent Failure Hunter CRITICAL**: Empty catch in removePidFile, double empty catch in checkLiveness
- **Silent Failure Hunter MEDIUM**: Empty catch in binaryResolver platform resolution
- **Pattern Recognition**: ESLint 10 requires `{ cause: error }` when re-throwing

## Proposed Solutions

### Option A: Log at warn level with structured context (Recommended)
- Replace empty catches with `logger?.warn()` calls including task_id and error detail
- Use `getErrorMessage(error)` per project conventions
- For binaryResolver, log at debug level since resolution failures are expected
- **Pros**: Debuggable, consistent with project patterns, non-breaking
- **Cons**: Slightly more verbose
- **Effort**: Small
- **Risk**: Low

### Option B: Propagate as non-fatal warnings
- Re-throw as wrapped errors with `{ cause: error }`
- Let callers decide how to handle
- **Pros**: Maximum information preservation
- **Cons**: May break callers expecting silent behavior
- **Effort**: Medium
- **Risk**: Medium

## Technical Details

- **Affected files**: `src/adapters/codemachine/CodeMachineCLIAdapter.ts`, `src/adapters/codemachine/binaryResolver.ts`

## Acceptance Criteria

- [ ] No empty catch blocks remain in new code
- [ ] All catches log at appropriate level (warn for unexpected, debug for expected)
- [ ] `getErrorMessage()` used consistently (not raw `error.message`)
- [ ] ESLint passes without suppressions

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | 2 CRITICAL + 1 MEDIUM silent failure findings |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- Files: `CodeMachineCLIAdapter.ts:310-312`, `binaryResolver.ts`
