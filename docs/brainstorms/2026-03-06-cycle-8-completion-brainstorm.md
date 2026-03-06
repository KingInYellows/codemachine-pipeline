# Cycle 8 Completion Brainstorm

**Date:** 2026-03-06
**Cycle:** 8 (Feb 27 – Mar 13, 8 days remaining)
**Goal:** 100% completion

## Current State After Closures

| Metric                            | Count                  |
| --------------------------------- | ---------------------- |
| Total issues                      | 45                     |
| Just closed (code already merged) | 13                     |
| New completed total               | 37 (82%)               |
| Remaining                         | 8 In Progress + 5 Todo |

### Issues Closed This Session

CDMCH-119, -118, -135, -126, -216, -148, -149, -168, -159, -209 (code in recent
commits), CDMCH-201, -196, -161 (merged branches found during gt sync).

## Remaining Work

### Track 1: Bug/CI Fixes (blocks PR merges)

| ID        | Title                                                  | Root Cause                                     |
| --------- | ------------------------------------------------------ | ---------------------------------------------- |
| CDMCH-223 | RunManifest Zod validation breaks PR integration tests | Test fixtures have outdated manifest structure |
| CDMCH-226 | LinearAdapter snapshot caching tests failing           | Tests may need mock updates or live API guard  |
| CDMCH-228 | README doc links point to non-existent files           | Missing docs referenced in README              |

**Impact:** Both CDMCH-127 (PR #764) and CDMCH-122 (PR #763) are blocked by the
same smoke test failures (doctor command ENOENT manifest.json, exit code
assertions). Fixing CDMCH-223 likely unblocks both.

### Track 2: Existing PRs (need CI green)

| ID        | PR   | Title                                      | Status                           |
| --------- | ---- | ------------------------------------------ | -------------------------------- |
| CDMCH-127 | #764 | TelemetryCommand base class                | CI red (pre-existing test issue) |
| CDMCH-122 | #763 | eslint-disable for Record<string, unknown> | CI red (same)                    |

### Track 3: Security Debt (implement directly)

| ID        | Title                                        | Effort |
| --------- | -------------------------------------------- | ------ |
| CDMCH-215 | Template substitution no escaping            | S      |
| CDMCH-214 | Config env var fields accept arbitrary names | S      |

### Track 4: God Module Refactors (delegate to Devin)

| ID        | Title                | LOC | Effort |
| --------- | -------------------- | --- | ------ |
| CDMCH-160 | Init.run() 300 lines | 300 | L      |
| CDMCH-210 | taskPlanner.ts       | 890 | M      |
| CDMCH-211 | autoFixEngine.ts     | 836 | M      |
| CDMCH-213 | RepoConfig.ts        | 805 | M      |
| CDMCH-203 | LinearAdapter.ts     | 906 | M      |

### Track 5: Small Refactors (batch or delegate)

| ID        | Title                                      | Effort |
| --------- | ------------------------------------------ | ------ |
| CDMCH-152 | Logger factory repetitive pattern          | S      |
| CDMCH-219 | CLI commands directly instantiate adapters | S      |
| CDMCH-221 | Workflows widespread persistence imports   | S      |
| CDMCH-157 | Workflows barrel minimal                   | S      |

## Execution Plan

```
Phase 1: Fix bug/CI issues (CDMCH-223, -226, -228)     → unblocks PRs
Phase 2: Merge CDMCH-127 (#764) and CDMCH-122 (#763)   → after CI green
Phase 3: Implement security fixes (CDMCH-215, -214)    → direct
Phase 4: Delegate god modules to Devin (5 issues)      → parallel
Phase 5: Batch small refactors (4 issues)               → direct or Devin
```

## Approach Decision

- God module refactors → Devin (well-defined extraction patterns, mechanical)
- Bug/CI and security → Claude Code session (investigation-heavy, needs context)
- Small refactors → evaluate case-by-case; batch if mechanical, Devin if tedious
