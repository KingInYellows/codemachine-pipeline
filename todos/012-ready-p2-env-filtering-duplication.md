---
status: ready
priority: p2
issue_id: "012"
tags: [code-review, duplication, pr-466]
dependencies: []
---

# Environment Filtering Duplicated Between Runner and Adapter

## Problem Statement

Both `codeMachineRunner.ts:200-226` and `CodeMachineCLIAdapter.ts:345-365` implement environment variable filtering with slightly different allowlists. The adapter intentionally excludes `DEBUG` while the runner includes it. This duplication risks drift.

## Findings

- **Pattern Recognition**: Environment filtering duplicated between modules
- **Comment Analyzer**: DEBUG exclusion difference is intentional but undocumented

## Proposed Solutions

### Option A: Extract shared utility with configurable exclusions (Recommended)
- Create `filterEnvironment(allowlist, exclude?)` in a shared location
- Runner calls with defaults, adapter calls with `exclude: ['DEBUG']`
- **Effort**: Small
- **Risk**: Low

### Option B: Document the intentional difference
- Add cross-reference comments in both files
- **Effort**: Small
- **Risk**: Low (duplication remains)

## Technical Details

- **Affected files**: `src/workflows/codeMachineRunner.ts`, `src/adapters/codemachine/CodeMachineCLIAdapter.ts`

## Acceptance Criteria

- [ ] Single source of truth for base environment allowlist
- [ ] Intentional differences (DEBUG) are documented or parameterized

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
