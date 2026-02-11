---
title: "chore: v1.0.0 release ceremony"
type: chore
date: 2026-02-10
brainstorm: docs/brainstorms/2026-02-10-v1-release-readiness-brainstorm.md
---

# v1.0.0 Release Ceremony

## Overview

All engineering work for v1.0.0 is complete (265 tests, 0 lint errors, 0 vulnerabilities, all 15 roadmap issues closed). This plan covers the remaining release ceremony: 3 small fixes, issue closure, git tag, GitHub Release, and local Docker/npm-link validation.

**Scope:** Local-only release. No npm registry publish or Docker registry push.

## Problem Statement

The codebase is v1.0.0-ready but the release was never executed:
- No git tag
- No GitHub Release
- Docker build broken (missing `.npmrc` COPY)
- No LICENSE file
- Incomplete package.json metadata
- 4 GitHub issues open whose work is already merged (PR #430)

## Phase 1: Pre-Release Fixes (one commit)

All changes go into a single commit: `chore(release): prepare v1.0.0 release`

### 1.1 Fix Docker Build

**File:** `Dockerfile`
**Change:** Add `COPY .npmrc ./` before each `RUN npm ci` line (both builder and production stages).

`.npmrc` contains `legacy-peer-deps=true` which resolves the `@typescript-eslint/eslint-plugin` peer dep conflict with ESLint 10. File is already tracked in git and not in `.dockerignore`.

```dockerfile
# In builder stage (before RUN npm ci):
COPY .npmrc ./

# In production stage (before RUN npm ci --omit=dev --ignore-scripts):
COPY .npmrc ./
```

### 1.2 Add LICENSE File

**File:** `LICENSE` (repo root)
**Content:** Standard MIT license text with "CodeMachine Team" as copyright holder, year 2026.

### 1.3 Update package.json Metadata

**File:** `package.json`
**Changes:** Add three fields:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/KingInYellows/codemachine-pipeline.git"
  },
  "bugs": {
    "url": "https://github.com/KingInYellows/codemachine-pipeline/issues"
  },
  "homepage": "https://github.com/KingInYellows/codemachine-pipeline#readme"
}
```

**Note:** `version` field is already `"1.0.0"` — no change needed.

### 1.4 Validate Before Committing

Run in sequence:

```bash
npm run lint          # Must pass (0 errors)
npm test              # Must pass (265 tests)
npm run build         # Must succeed
docker build -t codemachine-pipeline:test .   # Must succeed
docker run --rm codemachine-pipeline:test --help  # Must print help
```

### 1.5 Commit

```bash
git add Dockerfile LICENSE package.json
git commit -m "chore(release): prepare v1.0.0 release"
git push origin main
```

## Phase 2: Close Cycle 8 Issues

All 4 issues had their work delivered by PR #430. Close with explanatory comment.

```bash
gh issue close 211 --comment "Delivered by PR #430: CLI reference auto-gen script + CI drift check."
gh issue close 212 --comment "Delivered by PR #430: Mermaid diagrams in execution_flow.md and component_index.md."
gh issue close 215 --comment "Delivered by PR #430: API reference at docs/ops/api-reference.md with RepoConfig schema + 6 domain types."
gh issue close 424 --comment "Delivered by PR #430: Documentation tooling decisions captured in brainstorm + plan docs."
```

## Phase 3: Tag and Release

### 3.1 Create Annotated Tag

```bash
git tag -a v1.0.0 -m "v1.0.0: Initial stable release for homelab use"
git push origin v1.0.0
```

### 3.2 Create GitHub Release

Use the v1.0.0 section of CHANGELOG.md as release notes body.

```bash
gh release create v1.0.0 \
  --title "v1.0.0: Initial Stable Release" \
  --notes-file CHANGELOG.md \
  --target main
```

## Phase 4: Build and Validate Locally

### 4.1 Docker Image

```bash
docker build -t codemachine-pipeline:1.0.0 .
docker tag codemachine-pipeline:1.0.0 codemachine-pipeline:latest
docker run --rm codemachine-pipeline:1.0.0 --version
docker run --rm codemachine-pipeline:1.0.0 --help
```

### 4.2 npm link

```bash
npm run build
npm link
codepipe --version    # Should print 1.0.0
codepipe --help       # Should print help text
codepipe init --help  # Should print init help
npm unlink -g codemachine-pipeline
```

### 4.3 npx from Git

```bash
npx github:KingInYellows/codemachine-pipeline#v1.0.0 --help
```

**Note:** This requires the repo to be public. If private, npx from git won't work — document as a known limitation.

## Acceptance Criteria

- [ ] Docker builds successfully from clean state
- [ ] `docker run codemachine-pipeline:1.0.0 --help` prints CLI help
- [ ] `npm link` + `codepipe --version` shows `1.0.0`
- [ ] `codepipe --help` lists all commands
- [ ] Git tag `v1.0.0` exists on GitHub
- [ ] GitHub Release page shows v1.0.0 with changelog
- [ ] Issues #211, #212, #215, #424 are closed
- [ ] LICENSE file exists in repo root
- [ ] `npm audit` shows 0 vulnerabilities
- [ ] All 265 tests pass after changes

## Rollback Plan

If issues are discovered after tagging:

```bash
# Delete GitHub Release
gh release delete v1.0.0 --yes

# Delete remote and local tag
git push --delete origin v1.0.0
git tag -d v1.0.0

# Fix issues, then re-run from Phase 1
```

## References

- Stable release definition: `docs/stable-release-definition.md`
- Stable release roadmap: `docs/stable-release-roadmap.md`
- Brainstorm: `docs/brainstorms/2026-02-10-v1-release-readiness-brainstorm.md`
- CHANGELOG: `CHANGELOG.md` (v1.0.0 section dated 2026-02-05)
- PRD/Specification: `specification.md`
