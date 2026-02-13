---
status: ready
priority: p2
issue_id: "010"
tags: [code-review, performance, pr-466]
dependencies: []
---

# Doctor Command Loads Config 3 Times

## Problem Statement

`doctor.ts` calls `checkRepoConfig()`, `checkCodeMachineCli()`, and `checkEnvironmentVariables()` which each independently load and parse the config file. This is redundant I/O.

## Findings

- **Performance Oracle CRITICAL-3**: Doctor loads config 3 times

## Proposed Solutions

### Option A: Load once, pass to check functions (Recommended)
- Load config once at the start of the `run()` method
- Pass the loaded config to each check function
- **Effort**: Medium
- **Risk**: Low

## Technical Details

- **Affected files**: `src/cli/commands/doctor.ts`

## Acceptance Criteria

- [ ] Config loaded exactly once during doctor run
- [ ] All check functions receive pre-loaded config

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- File: `src/cli/commands/doctor.ts`
