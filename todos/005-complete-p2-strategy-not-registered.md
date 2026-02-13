---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, architecture, dead-code, pr-466]
dependencies: []
---

# CodeMachineCLIStrategy Not Registered in CLI Commands

## Problem Statement

`CodeMachineCLIStrategy` is never imported or instantiated in `start.ts` or `resume.ts`. Both commands only use the old `createCodeMachineStrategy()`. The strategy exists as a module but is dead code from the CLI perspective.

The JSDoc (line 20-21) and ADR-8 (line 50) claim the strategy "is registered before" the old one, written in present tense, but this is aspirational — not implemented.

## Findings

- **Test Analyzer**: Strategy NOT registered in start.ts/resume.ts
- **Comment Analyzer #2,#3**: Registration claims are aspirational, not actual
- **Agent-Native Reviewer**: Not exported through any barrel

## Proposed Solutions

### Option A: Wire up registration + fix comments (Recommended)
- Import and register `CodeMachineCLIStrategy` in `start.ts` and `resume.ts`
- Register BEFORE old strategy (first-match-wins per Array.find)
- Fix JSDoc and ADR to accurately reflect implementation status
- **Pros**: Makes the feature actually work, documentation matches reality
- **Cons**: Requires testing strategy selection logic
- **Effort**: Medium
- **Risk**: Medium (changes execution path)

### Option B: Mark as intentionally deferred + fix comments
- Update JSDoc and ADR to future tense ("will be registered")
- Add TODO comment with tracking issue
- **Pros**: Minimal code change, honest documentation
- **Cons**: Feature remains non-functional
- **Effort**: Small
- **Risk**: Low

## Technical Details

- **Affected files**: `src/cli/commands/start.ts`, `src/cli/commands/resume.ts`, `src/workflows/codeMachineCLIStrategy.ts`, `docs/adr/ADR-8-codemachine-cli-integration.md`

## Acceptance Criteria

- [ ] Documentation matches implementation reality (either wired up or marked as deferred)
- [ ] If wired up: integration test covers strategy selection
- [ ] If deferred: tracking issue created

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | 3 agents independently flagged this |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- Files: `codeMachineCLIStrategy.ts:20-21`, `ADR-8:50`, `start.ts`, `resume.ts`
