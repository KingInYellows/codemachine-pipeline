---
status: complete
priority: p3
issue_id: "015"
tags: [code-review, dead-code, simplicity, pr-466]
dependencies: []
---

# Unused Engines, Branded Type, and PID Tracking Code

## Problem Statement

Several pieces of code are unused by any production path:
1. 5 engines in `CodeMachineEngineTypeSchema` (opencode, cursor, mistral, auggie, ccr) — not referenced
2. `CoordinationSyntax` branded type — not used by any production code
3. PID tracking in adapter (~50 LOC) — speculative, not integrated
4. 0.x minor version check in doctor (~12 LOC) — over-engineered

Total: ~80+ LOC of YAGNI.

## Findings

- **Code Simplicity**: Unused engines, branded type, PID tracking, version check
- **Agent-Native Reviewer**: Related barrel export gaps

## Proposed Solutions

### Option A: Remove unused code (Recommended)
- Strip unused engine types (keep only those that map to core engines)
- Remove CoordinationSyntax if not used
- Remove or gate PID tracking behind a feature flag
- Simplify version check
- **Effort**: Small
- **Risk**: Low

### Option B: Keep with documentation for future use
- **Effort**: Small
- **Risk**: Low (but accumulates dead code)

## Technical Details

- **Affected files**: `src/workflows/codemachineTypes.ts`, `src/adapters/codemachine/CodeMachineCLIAdapter.ts`, `src/cli/commands/doctor.ts`

## Acceptance Criteria

- [ ] No unreferenced types or schemas remain (or are documented as planned)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
