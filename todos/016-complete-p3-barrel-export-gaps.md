---
status: complete
priority: p3
issue_id: "016"
tags: [code-review, architecture, pr-466]
dependencies: []
---

# Barrel Export Gaps and Doctor Logic Locked in Oclif

## Problem Statement

1. `CodeMachineCLIStrategy` not exported through any barrel
2. `WorkflowTemplateMapper` not exported through any barrel (if kept)
3. `WorkflowDefinition`/`WorkflowStep` missing from top-level `src/adapters/index.ts`
4. `checkCodeMachineCli()` diagnostic logic is locked inside the oclif Command class — not reusable programmatically

## Findings

- **Agent-Native Reviewer**: Multiple export gaps, doctor logic inaccessible

## Proposed Solutions

### Option A: Fix exports, extract doctor logic (Recommended)
- Add missing re-exports to barrel files
- Extract `checkCodeMachineCli()` as a standalone function
- **Effort**: Small
- **Risk**: Low

## Technical Details

- **Affected files**: `src/adapters/codemachine/index.ts`, `src/adapters/index.ts`, `src/cli/commands/doctor.ts`

## Acceptance Criteria

- [ ] All public APIs accessible through barrel exports
- [ ] Doctor diagnostic logic callable from non-oclif context

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
