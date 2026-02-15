---
title: "chore: v1.0.0 release readiness — CI, E2E, docs, publish, deploy"
type: chore
date: 2026-02-14
brainstorm: docs/brainstorms/2026-02-14-v1-release-readiness-brainstorm.md
---

# chore: v1.0.0 Release Readiness

## Overview

Ship a fully functioning, published, deployed v1.0.0 of codemachine-pipeline. The existing
v1.0.0 tag (2026-02-11) was a milestone marker — this plan makes it a real, shippable release
with green CI, verified E2E functionality, accurate documentation, and GitHub Packages publishing
for homelab deployment via `npm install -g`.

Sequential approach: each phase validates the prior one. E2E testing may surface issues that
change downstream scope.

## Problem Statement

The v1.0.0 tag exists but the release isn't truly shippable:

1. **CI is failing** — 26 Prettier formatting violations + potential Docker `doctor --json` exit code issue
2. **E2E untested** — full pipeline (init → start → approve → resume) hasn't been verified after Cycle 9
3. **Not published** — no npm publishing infrastructure (no `publishConfig`, no scoped name, no workflow)
4. **Documentation drift** — README says "when published", CHANGELOG missing Cycles 6-9, stale doc artifacts
5. **Release branch stale** — `release` branch hasn't been synced with current main

## Proposed Solution

Six sequential phases, each producing a verifiable checkpoint before moving to the next.

---

## Phase 1: Fix CI (Green Main)

**Goal:** All CI jobs pass on main.

### 1.1 Fix Prettier Formatting (26 files)

```bash
npx prettier --write "src/**/*.ts" "tests/**/*.ts"
```

Key files identified in CI failure:
- `src/adapters/codemachine/binaryResolver.ts`
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts`
- `src/workflows/cliExecutionEngine.ts`
- `src/workflows/codeMachineCLIStrategy.ts`
- `tests/unit/codeMachineCLIAdapter.test.ts`
- `tests/unit/queueStore.v2.spec.ts`
- ~20 more files

Verify: `npm run format:check` exits 0.

### 1.2 Verify Docker CI Step

The Docker CI step runs `doctor --json` with `set -o pipefail` but no `|| true` fallback.
Research indicates this should exit 0 in a bare Docker container (only warnings, no failures),
but verify by:

1. Build Docker image locally: `docker build -t codepipe-test .`
2. Run: `docker run --rm codepipe-test doctor --json`
3. Check exit code: `echo $?`

If exit code is non-zero, fix the CI step by adding `|| true` (matching the pattern used
for `--version` on the adjacent line), OR fix the `doctor` command to exit 0 when only
warnings exist.

### 1.3 Clean Up Stale .dockerignore References

Remove references to files that don't exist (harmless but messy):
- `.eslintrc.json` → project uses `eslint.config.cjs`
- `jest.config.js` → project uses vitest

### 1.4 Commit and Verify

- [ ] Commit formatting fixes: `chore: fix Prettier formatting violations`
- [ ] Commit Docker/dockerignore fixes if needed
- [ ] Push to main, verify all CI jobs pass
- [ ] **Checkpoint:** CI dashboard shows green on main

---

## Phase 2: E2E Functional Testing

**Goal:** Verify the full pipeline works end-to-end after Cycle 9 changes.

### 2.1 Prepare Test Environment

Create a temporary test project directory (outside the repo) to test `codepipe` as an end user would:

```bash
mkdir /tmp/codepipe-e2e-test && cd /tmp/codepipe-e2e-test
git init && git commit --allow-empty -m "init"
```

Ensure `codepipe` is available via `npm link` from the repo.

### 2.2 Test Core Pipeline Flow

| Step | Command | Expected |
|------|---------|----------|
| Init | `codepipe init --yes` | Creates `.codepipe/` scaffolding, exits 0 |
| Doctor | `codepipe doctor` | Reports environment health, exits 0 |
| Health | `codepipe health` | Quick health check, exits 0 |
| Start | `codepipe start --prompt "Add a hello world endpoint"` | Creates run dir, generates PRD, exits 0 |
| Status | `codepipe status` | Shows current pipeline state |
| Approve | `codepipe approve prd --feature <id> --signer "test"` | Advances gate, exits 0 |
| Resume | `codepipe resume --feature <id>` | Continues pipeline |
| Plan | `codepipe plan --feature <id>` | Shows execution DAG |

### 2.3 Test JSON Output Mode

Re-run key commands with `--json` flag and verify valid JSON output:
- `codepipe status --json`
- `codepipe doctor --json`
- `codepipe start --prompt "test" --json`

### 2.4 Test Error Paths

- Run `codepipe start` without `init` → should give clear error with remediation
- Run `codepipe approve` with invalid feature ID → should error gracefully
- Run `codepipe resume` with no active run → should error gracefully

### 2.5 Document Findings

- [ ] Record any bugs, incorrect output, or unexpected behavior
- [ ] Note any missing environment variables or undocumented prerequisites
- [ ] **Checkpoint:** E2E test report with pass/fail for each command

---

## Phase 3: Fix Discovered Issues

**Goal:** Address bugs found during E2E testing.

Scope is TBD based on Phase 2 findings. Known candidates:

- Any runtime errors in the CodeMachine-CLI adapter (Cycle 9 code)
- Missing or incorrect error messages
- JSON output schema inconsistencies
- Environment variable documentation gaps

- [ ] Fix each discovered issue
- [ ] Re-run E2E tests to verify fixes
- [ ] Commit fixes with descriptive messages
- [ ] **Checkpoint:** All E2E tests pass cleanly

---

## Phase 4: Documentation Audit

**Goal:** README, CLI help, CHANGELOG, and docs all accurately reflect the current product.

### 4.1 README.md

File: `README.md`

- [ ] Update line 33: change "From npm (when published)" to actual install command with GitHub Packages scope
- [ ] Verify command table matches all 12+ current commands
- [ ] Verify feature list reflects Cycle 9 CodeMachine-CLI integration
- [ ] Verify prerequisites (Node v24+, Git)
- [ ] Verify project structure tree matches actual layout

### 4.2 CHANGELOG.md

File: `CHANGELOG.md`

The `[Unreleased]` section is nearly empty but 11 commits of significant work landed after
the v1.0.0 tag date (2026-02-05). Update `[Unreleased]` to document:

- **Cycle 6**: Logger unification, error message consolidation, Record audit, circular dep guardrail, V1 queue removal, unused export pruning, schema validation
- **Cycle 7**: CLI integration tests (45 tests), CONTRIBUTING.md update, JSDoc
- **Cycle 8**: Documentation tooling decisions (deferred items)
- **Cycle 9**: CodeMachine-CLI two-way execution engine integration
- **Housekeeping**: ESLint 10 compat, docs cleanup, Dockerfile consolidation, release branch strategy

Since we're re-tagging as v1.0.0, this content will be folded into the v1.0.0 entry
(replacing the current 2026-02-05 date with the actual release date).

### 4.3 CLI --help Text

For each command, run `codepipe <command> --help` and verify:
- Description matches actual behavior
- All flags are documented
- Examples work as shown

Commands to verify: `init`, `start`, `status`, `resume`, `approve`, `doctor`, `health`,
`plan`, `validate`, `rate-limits`, `context summarize`, `research`, `pr`.

### 4.4 Untracked Docs Cleanup

Review and decide on untracked directories:
- `docs/brainstorms/` — keep this plan's brainstorm, review others
- `docs/research/` — review for accuracy, remove stale content
- `docs/solutions/` — keep accurate solutions, remove outdated ones

### 4.5 CONTRIBUTING.md

File: `CONTRIBUTING.md`

- [ ] Verify development setup instructions still work
- [ ] Verify testing instructions match vitest (not jest)
- [ ] Verify branch/PR workflow matches current Graphite-based process

### 4.6 Commit Documentation Changes

- [ ] Commit all doc updates: `docs: audit and update documentation for v1.0.0 release`
- [ ] **Checkpoint:** All docs accurately reflect the current codebase

---

## Phase 5: npm Publishing Setup (GitHub Packages)

**Goal:** Package is publishable to GitHub Packages and installable via `npm install -g`.

### 5.1 Scope the Package Name

GitHub Packages requires scoped packages. Update `package.json`:

```json
{
  "name": "@kinginyellows/codemachine-pipeline",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

**Impact of name change:**
- The `bin` entry (`codepipe`) is unaffected — the CLI command name stays the same
- Internal imports don't reference the package name
- No downstream consumers exist (first real publish)

### 5.2 Configure .npmrc for Publishing

Add GitHub Packages registry to `.npmrc`:

```
legacy-peer-deps=true
@kinginyellows:registry=https://npm.pkg.github.com
```

### 5.3 Test Package Contents

```bash
npm pack --dry-run
```

Verify output contains only:
- `bin/run.js`, `bin/run.cmd`, `bin/dev.js`, `bin/dev.cmd`
- `dist/**` (compiled TypeScript)
- `oclif.manifest.json`
- `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`

### 5.4 Add GitHub Actions Publish Workflow

Create `.github/workflows/publish.yml`:
- Trigger: on GitHub Release published
- Steps: checkout, setup Node 24, `npm ci`, `npm run build`, `npm publish`
- Auth: `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`

### 5.5 Test Publish (Dry Run)

```bash
npm publish --dry-run
```

Verify no errors. Do NOT actually publish yet — that happens in Phase 6.

### 5.6 Commit Publishing Setup

- [ ] Commit: `chore: configure GitHub Packages publishing`
- [ ] Push and verify CI passes with the scoped name
- [ ] **Checkpoint:** `npm pack --dry-run` and `npm publish --dry-run` both succeed

---

## Phase 6: Cut the Release

**Goal:** Tag, publish, and deploy v1.0.0.

### 6.1 Update CHANGELOG Date

Change the v1.0.0 date in CHANGELOG.md to the actual release date (today or when cutting).
Fold `[Unreleased]` content into the v1.0.0 entry.

### 6.2 Sync Release Branch

Follow the documented strategy in `docs/development/release-branch-strategy.md`:

```bash
# Delete and recreate release branch from main
git checkout main && git pull
git branch -D release
git checkout -b release

# Remove development artifacts
git rm -r CLAUDE.md .codemachine/ .serena/ .claude/ .deps/ .mcp.json \
  claude-flow.config.json specification.md 2>/dev/null
git commit -m "chore: prepare release branch — remove dev artifacts"

# Verify
npm run build && npm run lint && npm test && npm run smoke
npm pack --dry-run
```

### 6.3 Re-tag v1.0.0

```bash
# Delete old tag locally and remotely
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0

# Create new annotated tag on release branch
git tag -a v1.0.0 -m "v1.0.0: Initial stable release"
git push origin release --tags
```

### 6.4 Create GitHub Release

```bash
gh release delete v1.0.0 --yes 2>/dev/null
gh release create v1.0.0 --title "v1.0.0: Initial Stable Release" \
  --notes-file CHANGELOG.md --target release
```

### 6.5 Publish to GitHub Packages

The publish workflow should trigger automatically on the GitHub Release. If manual:

```bash
npm publish
```

### 6.6 Install on Homelab

```bash
# On homelab server, configure npm for GitHub Packages
echo "@kinginyellows:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=<GITHUB_PAT>" >> ~/.npmrc

# Install globally
npm install -g @kinginyellows/codemachine-pipeline

# Verify
codepipe --version
codepipe doctor
```

### 6.7 Post-Release Verification

- [ ] `codepipe --version` shows 1.0.0
- [ ] `codepipe doctor` passes
- [ ] `codepipe init --yes` works in a fresh project
- [ ] GitHub Release page shows correct release notes
- [ ] GitHub Packages page shows the published package

---

## Technical Considerations

- **Package name change**: Renaming from `codemachine-pipeline` to `@kinginyellows/codemachine-pipeline` has no downstream impact (no existing consumers)
- **Re-tagging v1.0.0**: Destructive operation — deletes a published tag. Acceptable for a personal project with no external dependents
- **Node 24+ requirement**: `engines` field enforces this; homelab must have Node 24+
- **GitHub PAT for npm install**: Homelab needs a GitHub Personal Access Token with `read:packages` scope
- **`codemachine` optional dependency**: The CodeMachine-CLI adapter (Cycle 9) depends on `codemachine ^0.8.0` — verify it's installable or that the optional fallback works correctly

## Acceptance Criteria

- [ ] All CI jobs green on main
- [ ] E2E pipeline tested: init → start → approve → resume
- [ ] JSON output mode works for all applicable commands
- [ ] Error paths produce clear messages with remediation
- [ ] README accurately describes installation, commands, and features
- [ ] CHANGELOG reflects all work through v1.0.0 (including Cycles 6-9)
- [ ] CLI `--help` matches actual behavior for every command
- [ ] `npm pack --dry-run` shows correct package contents
- [ ] Package published to GitHub Packages
- [ ] `npm install -g @kinginyellows/codemachine-pipeline` works on homelab
- [ ] `codepipe doctor` passes on homelab
- [ ] GitHub Release published with accurate release notes

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| E2E testing reveals major bugs | Medium | High | Phase 3 is a buffer; scope may expand |
| CodeMachine-CLI adapter fails without `codemachine` binary | Medium | Medium | Verify optional dependency behavior; document prerequisites |
| GitHub Packages auth issues on homelab | Low | Low | Well-documented process; test with `npm whoami --registry` |
| Re-tagging causes GitHub Release confusion | Low | Low | Delete old release first, then re-create |
| Node 24 not available on homelab | Low | High | Check before starting; upgrade if needed |

## References

### Internal
- Release branch strategy: `docs/development/release-branch-strategy.md`
- Brainstorm: `docs/brainstorms/2026-02-14-v1-release-readiness-brainstorm.md`
- CI workflow: `.github/workflows/ci.yml`
- Package config: `package.json` (lines 1-96)
- Docker setup: `Dockerfile`
- Changelog: `CHANGELOG.md`

### External
- GitHub Packages npm docs: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- oclif publishing guide: https://oclif.io/docs/releasing
