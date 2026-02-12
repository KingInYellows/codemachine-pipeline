# Brainstorm: v1.0.0 Release Readiness

**Date:** 2026-02-10
**Status:** Ready for action
**Author:** Collaborative (human + Claude)

---

## What We're Building

A complete v1.0.0 release of codemachine-pipeline for personal homelab use, supporting all three install methods (npx, Docker, npm link) with all engineering work verified against the PRD.

## Why This Approach

The engineering work is done. All 15 roadmap issues (P0, P1, and M3) are closed. 265 tests pass, lint is clean, npm audit shows 0 vulnerabilities. What remains is:

1. **One bug fix** (Docker build broken)
2. **Four GitHub issues** to close (work already done by PR #430)
3. **Release ceremony** (tag, publish, release notes)
4. **Administrative gaps** (LICENSE file, package.json metadata)

## Key Findings

### PRD Compliance: 86% fully compliant

- **30/35 requirements**: Fully met
- **3 requirements**: Explicitly deferred per stable release definition (deploy command, export command, Node 20 support)
- **4 SHOULD-level items**: Soft gaps, acceptable for v1.0.0 (Linear SDK, agents preview isolation, security permissions guide, full diff summary in artifact bundle)
- **0 MUST-level blockers**: All mandatory requirements satisfied

### Current State

| Dimension | Status |
|-----------|--------|
| Build | PASS |
| Tests | 265 pass, 0 fail |
| Lint | 0 errors |
| npm audit | 0 vulnerabilities |
| Docker build | FAIL (fixable — missing .npmrc COPY in Dockerfile) |
| Git tag v1.0.0 | Not created |
| npm published | Not published |
| GitHub Release | Not published |
| LICENSE file | Missing (package.json says MIT) |

### Cycle 8 Issues (4 open, all work done)

PR #430 delivered all four Cycle 8 deliverables:
- #211: CLI reference auto-generation — `scripts/tooling/generate_cli_reference.js` + CI drift check
- #212: Architecture diagrams — Mermaid diagrams in `execution_flow.md` + `component_index.md`
- #215: API reference — `docs/ops/api-reference.md` with RepoConfig schema + 6 domain types
- #424: Documentation tooling decisions — brainstorm + plan docs

These issues just need to be **closed** on GitHub.

## Key Decisions

1. **Ship SHOULD-level soft gaps as-is** — fix in v1.1.0 if they become pain points
2. **Trust the test suite** — skip manual user journey verification (265 tests cover the paths)
3. **All three install methods required** — npx, Docker, npm link
4. **Manual release checklist** — no automation, appropriate for single-maintainer project
5. **Close Cycle 8 issues** — work is done, just close them

## Release Blockers (Must Fix)

### 1. Docker Build Broken
**Root cause:** Dockerfile doesn't `COPY .npmrc ./` — so `npm ci` fails on ESLint 10 peer dep conflict that `.npmrc`'s `legacy-peer-deps=true` resolves locally.
**Fix:** Add `COPY .npmrc ./` before `RUN npm ci` in both stages of Dockerfile.
**Effort:** 5 minutes.

### 2. Missing LICENSE File
**Fix:** Create MIT LICENSE file in repo root.
**Effort:** 2 minutes.

### 3. Incomplete package.json Metadata
**Missing fields:** `repository`, `bugs`, `homepage`
**Fix:** Add GitHub URLs to package.json.
**Effort:** 2 minutes.

## Release Tasks (Ordered)

### Pre-Release (code changes)

- [ ] Fix Docker build: add `COPY .npmrc ./` to Dockerfile
- [ ] Add MIT LICENSE file
- [ ] Add repository/bugs/homepage to package.json
- [ ] Verify Docker builds after fix
- [ ] Verify `npm link` works
- [ ] Close GitHub issues #211, #212, #215, #424

### Release Ceremony

- [ ] Create git tag `v1.0.0`
- [ ] Create GitHub Release with CHANGELOG content
- [ ] Publish to npm: `npm publish`
- [ ] Build and tag Docker image: `docker build -t codemachine-pipeline:1.0.0 .`
- [ ] Push Docker image (if using a registry)

### Post-Release

- [ ] Verify `npx codemachine-pipeline@1.0.0 --help` works
- [ ] Verify `docker run codemachine-pipeline:1.0.0 --help` works
- [ ] Test on a real project to validate end-to-end flow

## Open Questions

1. **Docker registry:** Are you pushing the Docker image to Docker Hub, GHCR, or just local?
2. **npm scope:** Publishing as `codemachine-pipeline` (unscoped) or `@kinginyellow/codemachine-pipeline`?
3. **v1.1.0 planning:** When to address the 4 SHOULD-level soft gaps?

## What's Not Needed

- No new features required
- No additional tests needed (265 passing)
- No documentation gaps blocking release
- No security vulnerabilities to fix
- No circular dependency regressions
