---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, security, pr-466]
dependencies: []
---

# Engine+Prompt Concatenation as Single Arg (Security)

## Problem Statement

In `codeMachineCLIStrategy.ts:79`, the engine and prompt are concatenated into a single shell-like argument string:
```ts
const args = ['run', `${engine} '${prompt.replace(/'/g, "'\\''")}'`];
```

This creates two security issues:
1. Engine value is interpolated without runtime validation against CodeMachine-CLI's supported engines
2. If `default_engine` is `openai` (a valid pipeline engine), it produces `openai '<prompt>'` which is NOT a valid CodeMachine-CLI engine

Additionally, the `openai` engine from the core `ExecutionEngineType` is absent from `CodeMachineEngineTypeSchema`, creating an undocumented gap.

## Findings

- **Security Sentinel F1**: Engine+prompt concatenated into single arg — should be separate argv elements
- **Security Sentinel F2**: No runtime assertion on engine before interpolation
- **Comment Analyzer #4**: `openai` missing from CodeMachine engine types creates undocumented gap
- **Silent Failure Hunter MEDIUM**: Engine not validated against supported CodeMachine types

## Proposed Solutions

### Option A: Split into separate argv + validate engine (Recommended)
- Split engine and prompt into separate argv elements: `['run', engine, prompt]`
- Add runtime validation: `CodeMachineEngineTypeSchema.safeParse(engine)` before building args
- Map `openai` to a supported engine or throw a clear error
- **Pros**: Eliminates concatenation entirely, clear error for invalid engines
- **Cons**: May require changes to how CodeMachine-CLI parses arguments
- **Effort**: Small
- **Risk**: Low

### Option B: Validate engine only, keep coordination syntax format
- Add `CodeMachineEngineTypeSchema.parse(engine)` guard before line 79
- Document the `openai` gap explicitly
- **Pros**: Minimal code change
- **Cons**: Still has shell-like string building in argv
- **Effort**: Small
- **Risk**: Low

## Recommended Action

_(To be filled during triage)_

## Technical Details

- **Affected files**: `src/workflows/codeMachineCLIStrategy.ts`, `src/workflows/codemachineTypes.ts`
- **Components**: ExecutionStrategy, type schemas
- **Database changes**: None

## Acceptance Criteria

- [ ] Engine is validated against CodeMachine-CLI supported types before use
- [ ] `openai` engine either maps to a supported engine or produces a clear error
- [ ] Engine and prompt are not concatenated into a single argument string
- [ ] Tests cover invalid engine type rejection

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | Multiple agents flagged this independently |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- Files: `src/workflows/codeMachineCLIStrategy.ts:79`, `src/workflows/codemachineTypes.ts:17-31`
