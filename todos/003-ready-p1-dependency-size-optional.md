---
status: ready
priority: p1
issue_id: "003"
tags: [code-review, performance, dependencies, pr-466]
dependencies: []
---

# 143.7 MB Dependency Should Be optionalDependencies

## Problem Statement

`codemachine@^0.8.0` is listed in `dependencies` but the code only uses `require.resolve()` to locate the platform-specific binary. This adds 143.7 MB to every install, even when the binary is not needed (e.g., CI environments, Docker builds without CodeMachine).

Additionally, the `codemachine` package ships `zod@^3` while the project uses `zod@^4`, creating a potential version conflict.

## Findings

- **Performance Oracle CRITICAL-1**: 143.7 MB dependency should be optionalDependencies
- **Performance Oracle CRITICAL-2**: Zod version conflict (codemachine ships zod@^3, project uses zod@^4)
- **Comment Analyzer #4**: ADR-8 says "direct dependency" but behavior matches optional pattern

## Proposed Solutions

### Option A: Move to optionalDependencies (Recommended)
- Move `codemachine` from `dependencies` to `optionalDependencies`
- The binaryResolver already handles the missing-package case gracefully (returns null)
- Add a note in ADR-8 about the optional nature
- **Pros**: Eliminates 143.7 MB install bloat, avoids zod conflict
- **Cons**: Users must explicitly install `codemachine` if they want binary resolution via npm
- **Effort**: Small
- **Risk**: Low (graceful fallback already exists)

### Option B: Move to peerDependencies with optional flag
- Use `peerDependencies` + `peerDependenciesMeta.optional: true`
- **Pros**: npm warns users about missing peer
- **Cons**: More complex, peer resolution can be finicky
- **Effort**: Small
- **Risk**: Low

## Technical Details

- **Affected files**: `package.json`
- **Components**: Dependency management, binary resolution

## Acceptance Criteria

- [ ] `codemachine` is in `optionalDependencies`, not `dependencies`
- [ ] `npm install` without `codemachine` completes without error
- [ ] Binary resolution gracefully falls back to PATH lookup
- [ ] No zod version conflict warnings

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | Same pattern as esbuild/turbo — should be optional |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- File: `package.json`
