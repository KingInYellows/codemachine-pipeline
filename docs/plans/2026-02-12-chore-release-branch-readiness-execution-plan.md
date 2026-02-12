---
title: "chore: Execute v1.0.0 release branch readiness (CDMCH-105 through CDMCH-117)"
type: chore
date: 2026-02-12
linear_project: v1.0.0 Release Branch Readiness
issues: CDMCH-105, CDMCH-106, CDMCH-107, CDMCH-108, CDMCH-109, CDMCH-110, CDMCH-111, CDMCH-112, CDMCH-113, CDMCH-114, CDMCH-115, CDMCH-116, CDMCH-117
---

# Execute v1.0.0 Release Branch Readiness

## Overview

Execute all 13 issues in the "v1.0.0 Release Branch Readiness" Linear project using Graphite stacked PRs. The work removes development artifacts, deduplicates files, updates ignore files, cleans documentation, and ultimately produces a pristine `release` branch.

## Current State

| Metric | Value |
|--------|-------|
| Build | PASS |
| Lint | 0 errors, 76 warnings |
| Tests | 2148 passing (all suites) |
| Git-tracked files | 381 |
| Open GitHub issues | 2 (both resolved, need closing) |
| Current branch | `fix/exec-to-execfile-migration` |
| Graphite trunk | `main` |

## Strategy: 4 Stacks + 2 Standalone

The 13 issues are organized into **4 Graphite stacks** and **2 standalone actions** based on file-level dependencies and logical grouping. Each stack is a series of PRs that build on each other. Stacks themselves are independent and can merge in any order (except Stack 4, which is last).

### Dependency Graph

```
CDMCH-114 (standalone — no PR)
     |
     v
Stack 1 ──────── Stack 2 ──────── Stack 3
(removals)       (dedup/docs)     (ignore files)
 105, 109, 111    107, 108, 106    115, 110
     |                |                |
     └────────────────┴────────────────┘
                      |
                      v
                   Stack 4
               (strategy + branch)
                  116, 117
```

---

## Stack 1: File Removals (3 PRs)

**Purpose:** Remove files/directories that should not exist in the release branch.
**Branch prefix:** `release-clean/`

### PR 1.1 — CDMCH-109: Remove legacy `tools/` directory

```bash
gt create release-clean/remove-legacy-tools -m "chore: remove legacy tools/ directory (CDMCH-109)"
```

**Changes:**
- `git rm tools/install.cjs tools/lint.cjs tools/run.cjs tools/test.cjs`
- Verify no `package.json` scripts or CI workflows reference `tools/`

**Verification:**
```bash
npm run build && npm run lint && npm test
```

**Size:** XS (~4 files deleted)

### PR 1.2 — CDMCH-105: Remove tracked development artifacts

```bash
gt create release-clean/remove-dev-artifacts -m "chore: remove tracked development artifacts from git (CDMCH-105)"
```

**Changes:**
- `git rm -r --cached .codemachine/` (26 files)
- `git rm -r --cached .serena/` (4 files)
- `git rm --cached .claude/commands/update-docs.md .claude/settings.json`
- `git rm --cached .mcp.json claude-flow.config.json`
- `git rm --cached .deps/cycles-baseline.json`
- Update `.gitignore` to add entries for all removed paths (prevents re-addition)
- Update `scripts/tooling/check_circular_deps.js` to handle missing baseline (auto-generate or skip gracefully)

**Decision point:** `.deps/cycles-baseline.json` is used by CI. Options:
1. Keep it tracked (simpler) — recommended if CI runs on release branch
2. Have the CI script regenerate if missing

**Verification:**
```bash
npm run build && npm run deps:check:ci && npm test
```

**Size:** M (~35 files removed, .gitignore updated, possibly script tweak)

### PR 1.3 — CDMCH-111: Move specification.md to docs/archive/

```bash
gt create release-clean/archive-specification -m "chore: move specification.md to docs/archive/ (CDMCH-111)"
```

**Changes:**
- `git mv specification.md docs/archive/specification.md`
- Add archival header to the file: `> **Note:** This is the original product specification from initial development. It is preserved for historical reference.`
- Update any cross-references (check README.md, docs/README.md)

**Verification:**
```bash
npm run build && npm test
```

**Size:** XS (1 file moved, minor edits)

### Stack 1 Submit

```bash
gt sync --force && gt restack
npm run build && npm run lint && npm test
gt submit --no-edit --publish
```

---

## Stack 2: Deduplication & Documentation (3 PRs)

**Purpose:** Consolidate duplicate files and clean documentation structure.
**Branch prefix:** `release-docs/`

### PR 2.1 — CDMCH-107: Deduplicate CONTRIBUTING.md

```bash
gt create release-docs/dedup-contributing -m "chore: deduplicate CONTRIBUTING.md — keep root, remove docs/ copy (CDMCH-107)"
```

**Changes:**
- `git rm docs/CONTRIBUTING.md`
- Verify root `CONTRIBUTING.md` is accurate (references vitest, ESLint 10, Graphite)
- Update `docs/README.md` to link to root `../CONTRIBUTING.md` instead of local copy

**Size:** XS (1 file deleted, 1 file updated)

### PR 2.2 — CDMCH-108: Consolidate Dockerfiles

```bash
gt create release-docs/consolidate-dockerfiles -m "chore: consolidate Dockerfiles — keep root, remove docker/ (CDMCH-108)"
```

**Changes:**
- Compare root `Dockerfile` (58 lines) vs `docker/Dockerfile` (55 lines)
- Keep the more complete version in root (standard Docker convention)
- Ensure root Dockerfile has `.npmrc` COPY fix from the brainstorm
- `git rm docker/Dockerfile`
- Check if `docker/` has other contents; if empty, remove directory
- Review `.dockerignore` for completeness
- Update `.npmignore` Dockerfile entry if needed

**Verification:**
```bash
docker build -t codepipe-test . && docker run --rm codepipe-test --version
```

**Size:** S (1-2 files changed, 1 deleted)

### PR 2.3 — CDMCH-106: Exclude CLAUDE.md from release branch

```bash
gt create release-docs/exclude-claude-md -m "chore: add CLAUDE.md to .gitignore for release branch (CDMCH-106)"
```

**Changes:**
- Add `CLAUDE.md` to `.gitignore` (will take effect on release branch where it's removed)
- Verify README.md does not reference CLAUDE.md as user documentation
- **Note:** CLAUDE.md stays tracked on main — the `.gitignore` entry prepares for the release branch where it will be `git rm`'d

**Size:** XS (1-2 lines in .gitignore)

### Stack 2 Submit

```bash
gt sync --force && gt restack
npm run build && npm run lint && npm test
gt submit --no-edit --publish
```

---

## Stack 3: Ignore Files & Docs Cleanup (4 PRs)

**Purpose:** Update all ignore files and clean the docs/ directory structure.
**Branch prefix:** `release-config/`

### PR 3.1 — CDMCH-115: Audit and update .gitignore

```bash
gt create release-config/update-gitignore -m "chore: audit and update .gitignore for release completeness (CDMCH-115)"
```

**Changes:**
- Add full ignore entries for: `.codemachine/`, `.serena/`, `.claude/`, `.mcp.json`, `claude-flow.config.json`, `.deps/`, `CLAUDE.md`, `tools/`
- Remove partial `.codemachine/` patterns (replace with blanket ignore)
- Remove `!.claude/settings.json` exception
- Organize with clear section comments
- Verify with `git status` that no currently tracked files are affected

**Size:** S (.gitignore only)

### PR 3.2 — CDMCH-110: Update .npmignore

```bash
gt create release-config/update-npmignore -m "chore: update .npmignore for current project structure (CDMCH-110)"
```

**Changes:**
- Remove stale entries: `jest.config.js`, `.eslintrc.json`, `codemachine-plan.md`
- Add missing entries: `.serena/`, `.claude/`, `.deps/`, `.mcp.json`, `claude-flow.config.json`, `CLAUDE.md`, `tools/`, `api/`, `docs/`, `vitest.config.ts`, `tsconfig.eslint.json`, `eslint.config.cjs`, `scripts/`, `.prettierrc.json`, `.npmrc`
- Organize with section comments

**Verification:**
```bash
npm pack --dry-run 2>&1 | head -30
# Expect ONLY: bin/, dist/, oclif.manifest.json, package.json, README.md, LICENSE, CHANGELOG.md
```

**Size:** S (.npmignore only)

### PR 3.3 — CDMCH-112: Reconcile READMEs

```bash
gt create release-config/reconcile-readmes -m "docs: reconcile root README.md and docs/README.md (CDMCH-112)"
```

**Changes:**
- Ensure root README is the canonical project overview (for GitHub/npm)
- Ensure `docs/README.md` is a table-of-contents index for the docs/ directory
- Remove duplicated sections between the two
- Remove references to internal development artifacts (`.codemachine/`, etc.) from root README
- Ensure both reference v1.0.0 and current tooling

**Size:** S-M (2 files edited)

### PR 3.4 — CDMCH-113: Clean docs/ directory structure

```bash
gt create release-config/clean-docs-structure -m "docs: clean docs/ directory — merge operations/ into ops/, archive stale plans (CDMCH-113)"
```

**Changes:**
- Move `docs/operations/*.md` → `docs/ops/` (3 files: log-rotation, parallel-execution, queue-v2-operations)
- `git rm -r docs/operations/` (now empty)
- Move `docs/plans/*.md` → `docs/archive/` (4 plan documents)
- Move `docs/brainstorms/*.md` → `docs/archive/` (2 brainstorm documents)
- Update `docs/README.md` to reflect final structure
- Fix any cross-references between docs files

**Final docs/ structure:**
```
docs/
  README.md          # Index
  adr/               # Architecture Decision Records (2)
  architecture/      # System architecture docs (2)
  archive/           # Historical documents (7+)
  development/       # Developer guides (3)
  diagrams/          # System diagrams (9)
  ops/               # Operational guides (19, merged with operations/)
  requirements/      # Requirements specs (24)
  security/          # Security documentation (2)
  solutions/         # Problem solutions (1+)
  templates/         # Document templates (1)
  ui/                # CLI UI patterns (1)
```

**Size:** M (multiple file moves, README update)

### Stack 3 Submit

```bash
gt sync --force && gt restack
npm run build && npm run lint && npm test
gt submit --no-edit --publish
```

---

## Standalone: CDMCH-114 — Close Stale GitHub Issues

**No PR needed.** This is an administrative action.

```bash
# Close GitHub issue #433
gh issue close 433 --comment "Resolved by PR #433 (commit 22a803c). All exec() calls migrated to execFile()."

# Close GitHub issue #436
gh issue close 436 --comment "Resolved by PR #433 (commit 22a803c). All exec() calls migrated to execFile()."

# Update Linear CDMCH-103 status
# → Mark as Done if fully addressed by PR #433

# Clean up stale branch
git branch -d fix/exec-to-execfile-migration 2>/dev/null
git push origin --delete fix/exec-to-execfile-migration 2>/dev/null
```

**Do this first** — it's zero-risk and cleans up the issue tracker.

---

## Stack 4: Strategy & Release Branch (2 PRs)

**Purpose:** Document the release branch strategy and create the branch.
**Branch prefix:** `release-final/`
**Depends on:** All stacks merged.

### PR 4.1 — CDMCH-116: Define release branch strategy

```bash
gt create release-final/release-strategy -m "docs: define and document release branch strategy (CDMCH-116)"
```

**Changes:**
- Create `docs/development/release-branch-strategy.md`
- Document include/exclude lists (as defined in Linear issue)
- Document branch sync workflow (periodic rebuild from main)
- Document hotfix workflow
- Document npm publish source decision

**Size:** S (1 new doc file)

### PR 4.2 — CDMCH-117: Create v1.0.0 release branch

**This is NOT a Graphite PR.** This is the final manual step after all PRs are merged.

```bash
# Ensure main is up-to-date
git checkout main && git pull origin main

# Create release branch
git checkout -b release

# Remove excluded files (per strategy doc)
git rm CLAUDE.md
git rm -r .codemachine/ .serena/ .claude/ .deps/ tools/ 2>/dev/null
git rm .mcp.json claude-flow.config.json 2>/dev/null
git rm specification.md 2>/dev/null

# Commit removal
git commit -m "chore: create clean release branch for v1.0.0"

# Verify
npm run build
npm run lint
npm test
npm run smoke
npm pack --dry-run
git ls-files | wc -l  # Should be significantly less than 381

# Push
git push -u origin release
```

---

## Execution Order

```
Day 1: Standalone (CDMCH-114) + Stack 1 (3 PRs) + Stack 2 (3 PRs)
        └─ Submit both stacks, close issues, request reviews

Day 2: Merge Stack 1 + Stack 2 (after CI passes)
        └─ Start Stack 3 (4 PRs) on updated main

Day 3: Merge Stack 3
        └─ Start Stack 4 PR 4.1 (strategy doc)
        └─ Merge, then execute CDMCH-117 manually

Total: ~3 working days for 13 issues
```

### Parallel Execution Notes

- Stacks 1 and 2 touch **completely different files** — can be submitted simultaneously
- Stack 3 should wait for Stack 1 to merge (PR 3.1 .gitignore extends work from PR 1.2)
- Stack 4 waits for everything else
- CDMCH-114 (close issues) can happen anytime

## Graphite Workflow Reference

### Pre-Work Sync

```bash
git checkout main && git pull origin main
gt sync --force
```

### Creating Each Stack

```bash
# Start from main
git checkout main

# Create first PR in stack
gt create <branch-name> -m "<commit message>"
# ... make changes ...
git add <files> && git commit -m "<message>"

# Create next PR in stack (automatically stacks)
gt create <next-branch> -m "<commit message>"
# ... make changes ...
git add <files> && git commit -m "<message>"

# Submit entire stack
gt submit --no-edit --publish
```

### Between Stacks (After Merge)

```bash
gt sync --force
gt restack  # If needed
npm run build && npm test  # Verify
```

### Conflict Resolution (if needed)

Per `docs/solutions/integration-issues/graphite-restack-conflicts-after-main-advanced.md`:

```bash
gt sync --force
gt restack
# Resolve conflicts if any
git add <resolved-files>
GIT_EDITOR=true git rebase --continue
npm run build && npm test
gt submit --no-edit --publish
```

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Rebase conflicts between stacks | Medium | Submit stacks 1+2 simultaneously; merge before starting stack 3 |
| `.deps/cycles-baseline.json` removal breaks CI | Low | Update `check_circular_deps.js` to handle missing baseline gracefully |
| Docker build breaks after Dockerfile consolidation | Low | Test `docker build .` in PR 2.2 before merging |
| docs/ cross-references break after reorganization | Medium | Grep for all internal links before and after moves in PR 3.4 |
| Release branch diverges from main over time | Long-term | Strategy doc (CDMCH-116) defines sync cadence |

## Success Criteria

- [ ] All 13 Linear issues (CDMCH-105 through CDMCH-117) are closed
- [ ] All corresponding GitHub issues (#437-#449) are closed
- [ ] `release` branch exists with clean root directory
- [ ] `git ls-files | wc -l` on release < 350 (down from 381 on main)
- [ ] `npm pack --dry-run` shows only `bin/`, `dist/`, `oclif.manifest.json`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`
- [ ] All CI checks pass on release branch
- [ ] No development artifacts (`.codemachine/`, `.serena/`, `.claude/`, `CLAUDE.md`, `tools/`, etc.) on release branch

## References

- [Linear Project: v1.0.0 Release Branch Readiness](https://linear.app/kinginyellow/project/v100-release-branch-readiness-408df8b4caa0)
- [Brainstorm: v1.0.0 Release Readiness](docs/brainstorms/2026-02-10-v1-release-readiness-brainstorm.md)
- [Solution: Graphite Restack Conflicts](docs/solutions/integration-issues/graphite-restack-conflicts-after-main-advanced.md)
- [CONTRIBUTING.md — Submission Workflow](CONTRIBUTING.md)
