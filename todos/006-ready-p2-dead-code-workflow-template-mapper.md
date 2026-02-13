---
status: ready
priority: p2
issue_id: "006"
tags: [code-review, dead-code, simplicity, pr-466]
dependencies: []
---

# Dead Code: WorkflowTemplateMapper (~335 LOC + 14 Tests)

## Problem Statement

`workflowTemplateMapper.ts` (154 lines) is not imported or used by any production code. It has 14 tests in `workflowTemplateMapper.test.ts` (181 lines) testing entirely dead code. Additionally, `WorkflowDefinition` and `WorkflowStep` schemas in `codemachineTypes.ts` are only used by this dead mapper.

Total removable: ~335 LOC of source + ~181 LOC of tests = ~516 LOC.

## Findings

- **Code Simplicity**: WorkflowTemplateMapper entirely dead code (335 LOC)
- **Code Simplicity**: WorkflowDefinition/WorkflowStep schemas unused (~20 LOC)
- **Agent-Native Reviewer**: WorkflowTemplateMapper not exported through any barrel

## Proposed Solutions

### Option A: Remove entirely (Recommended)
- Delete `workflowTemplateMapper.ts` and its test file
- Remove `WorkflowDefinition` and `WorkflowStep` from `codemachineTypes.ts`
- Remove any barrel re-exports
- **Pros**: Eliminates ~516 LOC of dead code, simplifies maintenance
- **Cons**: If feature is needed later, must re-implement (but code is in git history)
- **Effort**: Small
- **Risk**: Low (code is unused)

### Option B: Keep but document as planned feature
- Add prominent "NOT YET INTEGRATED" comment
- Create tracking issue for integration
- **Pros**: Preserves implementation work
- **Cons**: Dead code accumulates maintenance burden
- **Effort**: Small
- **Risk**: Low

## Technical Details

- **Affected files**: `src/workflows/workflowTemplateMapper.ts`, `tests/unit/workflowTemplateMapper.test.ts`, `src/workflows/codemachineTypes.ts`

## Acceptance Criteria

- [ ] No dead code remains (or is clearly marked with tracking issue)
- [ ] Build and tests pass after removal
- [ ] No dangling imports

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | YAGNI — remove or explicitly defer |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
