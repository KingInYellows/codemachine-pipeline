---
status: ready
priority: p2
issue_id: "008"
tags: [code-review, documentation, pr-466]
dependencies: []
---

# ADR-8 Incorrect Binary Resolution Path Description

## Problem Statement

ADR-8 line 34 states tier 2 resolves from `node_modules/.bin/codemachine` or `codemachine-linux-x64/bin/codemachine`. Neither path matches the actual code. The real resolution in `binaryResolver.ts:74-77` uses `require.resolve('codemachine-<platform>-<arch>/package.json')` to find the package directory, then joins with `platformEntry.bin` which is `'codemachine'` (in package root, not `bin/`). The `node_modules/.bin/` path is never checked.

ADR-8 line 94 also says "direct dependency" when the behavior matches an optional pattern.

## Findings

- **Comment Analyzer #1**: ADR-8 binary resolution paths don't match code
- **Comment Analyzer #4**: ADR-8 "direct dependency" phrasing is misleading

## Proposed Solutions

### Option A: Correct the ADR (Recommended)
- Rewrite tier 2 description to match actual `require.resolve()` behavior
- Fix dependency characterization
- **Effort**: Small
- **Risk**: Low

## Technical Details

- **Affected files**: `docs/adr/ADR-8-codemachine-cli-integration.md`

## Acceptance Criteria

- [ ] ADR binary resolution description matches `binaryResolver.ts` implementation
- [ ] Dependency characterization is accurate

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | Always verify ADR claims against code |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- Files: `docs/adr/ADR-8-codemachine-cli-integration.md:34,94`, `src/adapters/codemachine/binaryResolver.ts:74-77`
