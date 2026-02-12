---
title: "chore: Clean and organize documentation"
type: chore
date: 2026-02-12
---

# Clean and Organize Documentation

## Overview

The root README.md is 917 lines and covers everything from feature lists to full command references to configuration examples. It should be trimmed to a moderate ~200-400 line overview that links to `docs/` for details. Stale/aspirational requirements docs should be archived to an `archive` branch. The `docs/README.md` index should be expanded as the primary navigation hub, and all cross-references should be verified for accuracy.

## Problem Statement

1. **README.md is too long** (917 lines / 27KB) — buries the quick start under walls of command reference and config examples
2. **Stale requirements** — some docs describe unimplemented features (deploy, export commands) or aspirational environment variables
3. **Broken links** — README references `docs/architecture/execution-engine.md` which doesn't exist
4. **docs/README.md** missing entries — `development/release-branch-strategy.md` and `solutions/linting/` not listed
5. **Archive material still on main** — `docs/archive/` has 9 files + subdirectory that belong on an archive branch

## Proposed Solution

Three phases: (1) slim the README, (2) archive stale docs, (3) verify accuracy and expand the index.

---

## Phase 1: Slim the Root README.md (target: ~300 lines)

### What to keep (with trimming)

| Section | Current Lines | Target | Action |
|---------|--------------|--------|--------|
| Overview + Features | ~55 | ~30 | Keep feature bullet list, drop sub-feature bullets. Link to ops guides instead. |
| Installation | ~40 | ~25 | Keep npm/source/Docker. Trim Docker example to 3 lines with "see docs" link. |
| Prerequisites | ~20 | ~10 | Keep as-is, drop "Verifying Prerequisites" code block. |
| Quick Start | ~35 | ~30 | Keep — this is the most useful section. |
| Available Commands | ~355 | ~50 | Keep a **summary table** with command name, one-liner, and link to CLI Reference. Remove all option details, examples, and exit codes. |
| Development | ~115 | ~30 | Keep setup/build/test/lint. Drop Git Hooks section, JSON Output section, and smoke test details (link to docs/development/). |
| Project Structure | ~55 | ~40 | Trim to top 2 levels only (drop file-level entries). |
| CI/CD | ~10 | ~10 | Keep as-is. |
| Updating Fixtures | ~10 | 0 | Move to docs/development/ or link there. |
| Architecture | ~10 | ~10 | Keep brief description, fix broken link. |
| Execution Engine | ~50 | ~15 | Keep engine table + "see guide" link. Remove setup/config/selection examples. |
| Configuration | ~90 | ~15 | Keep one-liner description + link to RepoConfig schema. Remove full JSON examples. |
| Environment Variables | ~15 | ~10 | Keep the 3 env var exports. Remove override pattern (link to docs). |
| License + Contributing + Support | ~15 | ~15 | Keep as-is. |

### README sections to add
- **Documentation** section (2-3 lines): "Full documentation is in [`docs/README.md`](docs/README.md)" with quick links table (Getting Started, CLI Reference, Troubleshooting, Configuration)

### Specific fixes
- [x] Fix broken link: `docs/architecture/execution-engine.md` → `docs/architecture/execution_flow.md`
- [x] Remove the 4 "See [X Guide]" sub-feature link duplications (lines 24, 32, 40, 48) — these become redundant when features section is trimmed
- [x] Update bottom note about implemented commands to remove redundancy

---

## Phase 2: Archive Stale Docs to `archive` Branch

### Files to archive (push to `archive/post-v1.0.0-stale` branch, then remove from main)

#### `docs/archive/` (entire directory — 9 files + issue-tracking/)
Already identified as historical. Push to archive branch and remove from main.

| File | Reason |
|------|--------|
| `2025-12-31-alpha-release-readiness.md` | Pre-v1.0.0 historical |
| `2026-02-10-chore-v1-release-ceremony-plan.md` | Completed plan |
| `2026-02-10-documentation-tooling-decisions-brainstorm.md` | Completed brainstorm |
| `2026-02-10-feat-documentation-tooling-cycle6-plan.md` | Completed plan |
| `2026-02-10-v1-release-readiness-brainstorm.md` | Completed brainstorm |
| `2026-02-11-chore-post-release-docs-cleanup-plan.md` | Completed plan (this task supersedes it) |
| `2026-02-11-chore-post-v1-remaining-work-plan.md` | Completed plan |
| `specification.md` (31KB) | Original spec, superseded by requirements/ docs |
| `issue-tracking/ISSUE_RESOLUTION_PLAN.md` | Historical issue tracking |

#### Stale requirements (describe unimplemented/deprecated features)

Review these for archival — check if they describe features that exist in v1.0.0:

| File | Lines | Assessment Needed |
|------|-------|-------------------|
| `requirements/deployment_playbook.md` | 680 | `deploy` command is listed as "planned for future releases" — archive if entirely aspirational |
| `docs/audit/AUDIT_REPORT.md` | ~600 | One-time audit report, completed — archive |
| `docs/security/SECURITY-FIX-CVE-HIGH-1.md` | 319 | Remediation complete — archive |
| `docs/security/SECURITY-FIX-SUMMARY.md` | 237 | Remediation complete — archive |

#### Completed plan to archive

| File | Reason |
|------|--------|
| `docs/plans/2026-02-12-chore-release-branch-readiness-execution-plan.md` | If completed, archive |

### Archive workflow

```bash
# 1. Create archive branch from main
git checkout main
git checkout -b archive/post-v1.0.0-stale

# 2. This branch preserves the files as-is (they're already on main)
git push origin archive/post-v1.0.0-stale

# 3. Back on main, remove archived files
git checkout main
git rm -r docs/archive/
git rm docs/audit/AUDIT_REPORT.md
git rm docs/security/SECURITY-FIX-CVE-HIGH-1.md
git rm docs/security/SECURITY-FIX-SUMMARY.md
# (Only rm deployment_playbook.md if confirmed aspirational)

# 4. Commit the removal
git commit -m "chore: archive stale docs to archive/post-v1.0.0-stale branch"
```

---

## Phase 3: Verify Accuracy & Expand docs/README.md Index

### Fix broken/missing references in docs/README.md

- [x] Add `development/release-branch-strategy.md` to Development Guides table
- [x] Add `solutions/linting/eslint-no-restricted-types-index-signature-evasion.md` to Solutions section
- [x] Verify `docs/ci-stability.md` link works (currently listed under "CI & Operations" — file exists but is at `docs/ci-stability.md`, not in a subdirectory)
- [x] Remove entries for any docs archived in Phase 2 (audit report, security fixes)
- [x] Add note about the `archive/post-v1.0.0-stale` branch alongside existing `archive/pre-v1.0.0-docs` note
- [x] Remove the `docs/archive/` directory tree entry and Plans section references to archived files

### Accuracy checks across all active docs

- [x] Verify `docs/ops/parallel-execution.md` env var note: confirm `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` is the correct name (not `CODEPIPE_MAX_PARALLEL_TASKS`)
- [x] Verify `docs/ops/log-rotation.md` note about `CODEPIPE_LOG_ROTATION_*` env vars not being implemented is still accurate
- [x] Confirm all command references in `docs/ops/cli-reference.md` match the actual oclif manifest
- [x] Check that `docs/requirements/` playbooks reference actual function signatures and types (spot-check 2-3 key docs)

### Expand docs/README.md as primary navigation hub

- [x] ~~Add a "What's New in v1.0.0" or "Highlights" section~~ — skipped, Quick Links table serves this purpose
- [x] Ensure every file in `docs/` subdirectories has a corresponding entry in the index
- [x] ~~Group the Quick Links table by persona~~ — kept flat table for simplicity (7 entries, grouping adds noise)

---

## Acceptance Criteria

- [x] Root README.md is 200-400 lines with clear sections and links to docs/ (263 lines)
- [x] No broken links in README.md or docs/README.md
- [x] `docs/archive/` directory removed from main (files preserved on archive branch)
- [x] Stale security/audit docs archived
- [x] `docs/README.md` lists every active doc file with accurate descriptions
- [x] `development/release-branch-strategy.md` appears in the index
- [x] The archive branch note in `docs/README.md` references both archive branches

## References

- Existing archive branch: `archive/pre-v1.0.0-docs`
- Broken link: README.md lines 24, 32, 40, 48 reference non-existent `execution-engine.md`
- PR #462: Recent docs reconciliation (Feb 12, 2026)
- PR #463: Release branch strategy documentation
