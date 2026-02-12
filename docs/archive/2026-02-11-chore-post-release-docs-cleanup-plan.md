---
title: "chore: post-v1.0.0 documentation cleanup"
type: chore
date: 2026-02-11
audit: docs audit from 2026-02-10 conversation
---

# Post-v1.0.0 Documentation Cleanup

## Overview

Resolve all issues found in the documentation audit. Archive 25+ stale files to a separate `docs/archive` branch (not kept on main), fix 2 critical README inaccuracies, and fix 1 broken link.

## Strategy: Archive Branch

Instead of keeping archived docs in `docs/archive/` on main, push stale content to a branch `archive/pre-v1.0.0-docs` and then delete the files from main. This keeps main clean while preserving history.

## Phase 1: Fix Critical Inaccuracies (on main)

These are real bugs in published docs — fix first.

### 1.1 Fix README.md GitHub URL (line ~882)

**File:** `README.md`

Change the support URL from `github.com/codemachine/codemachine-pipeline` to `github.com/KingInYellows/codemachine-pipeline`. Also remove the TODO comment on line 881.

### 1.2 Fix README.md version header (line ~18)

**File:** `README.md`

Change `## New Features (v3.0)` to `## New Features (v1.0.0)` or simply `## Features`.

### 1.3 Fix broken link in docs/README.md (line ~226)

**File:** `docs/README.md`

Remove the broken link to `plans/2025-12-31-alpha-release-readiness.md` (file doesn't exist).

### 1.4 Add root CONTRIBUTING.md

Copy `docs/CONTRIBUTING.md` to repo root as `CONTRIBUTING.md` (GitHub convention — GitHub looks for this at root for the "Contributing" tab).

## Phase 2: Create Archive Branch

### 2.1 Create branch from main

```bash
git checkout -b archive/pre-v1.0.0-docs main
```

### 2.2 Move stale files into archive structure on that branch

Create `docs/archive/` directory structure and move files:

```
docs/archive/
├── v1.0-release/
│   ├── stable-release-definition.md
│   ├── stable-release-roadmap.md
│   ├── stable-release-audit.md
│   ├── PHASE1_VERIFICATION_REPORT.md
│   ├── PHASE2_IMPLEMENTATION_PLAN.md
│   ├── PHASE3_IMPLEMENTATION_PLAN.md
│   └── IMPLEMENTATION_SUMMARY.md
├── pr-certifications/
│   ├── CERTIFICATION_COMMENT_149.md
│   ├── CERTIFICATION_COMMENT_150.md
│   ├── CERTIFICATION_COMMENT_151.md
│   ├── CERTIFICATION_COMMENT_156.md
│   └── CERTIFICATION_COMMENT_157.md
├── issue-tracking/
│   ├── GITHUB_ISSUE_CLOSURES.md
│   ├── ISSUE_CLOSURES.md
│   ├── ISSUE_RESOLUTION_PLAN.md
│   ├── PR_REVIEW_PLAN.md
│   └── ORCHESTRATION_FINAL_SUMMARY.md
└── historical/
    ├── SECURITY-FIX-CVE-HIGH-1.md
    └── SECURITY-FIX-SUMMARY.md
```

Also move root-level stale files:

```
docs/archive/historical/
├── DOCUMENTATION_AUDIT.md        (from root)
├── AGENTS.md                     (from root)
├── CYCLE_PLAN.md                 (from root)
├── DOCUMENTATION_INVENTORY.md    (from root)
```

And relocate root planning directories:

```
docs/archive/planning/
├── plans/feat_codemachine_integration.md         (from plans/)
├── plan/milestone_notes.md                       (from plan/)
├── plan/readiness_checklist.md                   (from plan/)
├── research/2026-01-02-codemachine-cli-adapter.md       (from research/)
└── research/2026-01-02-codemachine-execution-engine.md  (from research/)
```

### 2.3 Commit and push archive branch

```bash
git add docs/archive/
git commit -m "archive: preserve pre-v1.0.0 docs for historical reference"
git push origin archive/pre-v1.0.0-docs
```

### 2.4 Switch back to main

```bash
git checkout main
```

## Phase 3: Delete Stale Files from Main

### 3.1 Delete docs/ stale files (14 files)

```
docs/CERTIFICATION_COMMENT_149.md
docs/CERTIFICATION_COMMENT_150.md
docs/CERTIFICATION_COMMENT_151.md
docs/CERTIFICATION_COMMENT_156.md
docs/CERTIFICATION_COMMENT_157.md
docs/ORCHESTRATION_FINAL_SUMMARY.md
docs/IMPLEMENTATION_SUMMARY.md
docs/ISSUE_RESOLUTION_PLAN.md
docs/GITHUB_ISSUE_CLOSURES.md
docs/ISSUE_CLOSURES.md
docs/PR_REVIEW_PLAN.md
docs/PHASE1_VERIFICATION_REPORT.md
docs/PHASE2_IMPLEMENTATION_PLAN.md
docs/PHASE3_IMPLEMENTATION_PLAN.md
```

### 3.2 Delete root-level stale files (4 files)

```
DOCUMENTATION_AUDIT.md
AGENTS.md
CYCLE_PLAN.md
DOCUMENTATION_INVENTORY.md
```

### 3.3 Delete root-level planning directories (3 dirs)

```
plans/              (1 file)
plan/               (2 files)
research/           (2 files)
```

### 3.4 Move release planning docs to docs/archive reference

The stable-release-*.md files are useful historical reference but no longer active planning docs. Delete from main (they're on the archive branch).

```
docs/stable-release-definition.md
docs/stable-release-roadmap.md
docs/stable-release-audit.md
```

### 3.5 Move security fix docs

Keep these on main but relocate to `docs/security/`:

```
docs/SECURITY-FIX-CVE-HIGH-1.md  →  docs/security/SECURITY-FIX-CVE-HIGH-1.md
docs/SECURITY-FIX-SUMMARY.md     →  docs/security/SECURITY-FIX-SUMMARY.md
```

### 3.6 Update docs/README.md

Remove links to deleted files. Update navigation hub to reflect new structure. Add a note about the archive branch.

### 3.7 Add thoughts/ to .gitignore

The `thoughts/` directory is a working scratchpad — should not be in the repo.

```
# Working notes (not tracked)
thoughts/
```

Then `git rm -r --cached thoughts/` to remove from tracking.

## Phase 4: Commit and Push

Single commit on main:

```bash
git add -A
git commit -m "chore: post-v1.0.0 docs cleanup — archive stale files, fix README

- Fix README.md GitHub support URL (was pointing to wrong org)
- Fix README.md version header (v3.0 → v1.0.0)
- Fix broken link in docs/README.md
- Add root CONTRIBUTING.md (GitHub convention)
- Delete 25 stale/orphaned docs (archived on branch archive/pre-v1.0.0-docs)
- Move security fix docs to docs/security/
- Add thoughts/ to .gitignore
- Update docs/README.md navigation hub"
```

## Acceptance Criteria

- [ ] README.md line ~882 uses correct GitHub URL (KingInYellows)
- [ ] README.md version header says v1.0.0 (not v3.0)
- [ ] docs/README.md has no broken links
- [ ] Root CONTRIBUTING.md exists
- [ ] 25 stale files deleted from main
- [ ] Archive branch `archive/pre-v1.0.0-docs` exists with all archived files
- [ ] Security docs moved to `docs/security/`
- [ ] `thoughts/` in `.gitignore` and removed from tracking
- [ ] Root `plans/`, `plan/`, `research/` directories deleted from main
- [ ] docs/README.md updated to reflect new structure
- [ ] All tests still pass after changes (no code changes, just docs)
- [ ] `npm run docs:cli:check` still passes

## Files Summary

| Action | Count | What |
|--------|-------|------|
| Fix in place | 3 | README.md, docs/README.md |
| Copy to root | 1 | CONTRIBUTING.md |
| Move on main | 2 | Security docs → docs/security/ |
| Delete from main | 25+ | Stale docs, root planning dirs |
| Archive to branch | 25+ | Same files preserved on archive branch |
| Add to .gitignore | 1 | thoughts/ |
| New directory | 1 | docs/security/ |

## References

- Documentation audit: conversation from 2026-02-10
- v1.0.0 release: commit `1cbd24f`, tag `v1.0.0`
