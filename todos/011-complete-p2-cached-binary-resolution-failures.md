---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, reliability, pr-466]
dependencies: []
---

# Failed Binary Resolutions Cached Permanently

## Problem Statement

`binaryResolver.ts` caches `null` results from failed resolution attempts with no TTL. Once binary resolution fails (e.g., package not yet installed), it never retries — even if the binary becomes available later in the same process lifetime.

## Findings

- **Silent Failure Hunter**: Cached error states never expire
- **Comment Analyzer**: Binary cache never invalidated in prod

## Proposed Solutions

### Option A: Don't cache null results (Recommended)
- Only cache successful resolutions
- Failed lookups retry on next call
- **Effort**: Small
- **Risk**: Low (slightly more I/O on repeated failures, but these are rare)

### Option B: Add TTL-based cache expiry
- Cache failures for 30-60 seconds, then retry
- **Effort**: Medium
- **Risk**: Low

## Technical Details

- **Affected files**: `src/adapters/codemachine/binaryResolver.ts`

## Acceptance Criteria

- [ ] Failed resolution does not prevent future successful resolution
- [ ] Test verifies retry after initial failure

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- File: `binaryResolver.ts`
