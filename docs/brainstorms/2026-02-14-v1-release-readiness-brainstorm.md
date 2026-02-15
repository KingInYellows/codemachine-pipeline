# Brainstorm: v1.0.0 Release Readiness

**Date:** 2026-02-14
**Status:** Captured
**Goal:** Ship a fully functioning, published, deployed v1.0.0 with clean documentation

## What We're Building

A "real" v1.0.0 release of codemachine-pipeline that is:
- **CI-green** on main
- **Functionally verified** end-to-end (init → start → approve → resume)
- **Published** to GitHub Packages (private npm registry)
- **Deployable** via bare Node.js on homelab (`npm install -g`)
- **Accurately documented** — README, CLI help, and docs all reflect reality

## Why This Approach

The existing v1.0.0 tag (2026-02-11) was a milestone marker, not a shippable release.
CI is failing, E2E hasn't been tested recently, there's no npm publishing setup, and
documentation hasn't been audited against the current codebase (which now includes the
Cycle 9 CodeMachine-CLI integration).

We take a sequential approach because untested E2E may surface issues that change the
scope of other work. Each step validates the prior one.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Version | Re-tag as v1.0.0 | Personal project; this IS the first real release |
| Scope | Include Cycle 9 | CodeMachine-CLI integration is part of the product |
| Approach | Sequential | CI → E2E → fix → docs → npm → release |
| npm registry | GitHub Packages | Free for private, ties to repo |
| Deployment | Bare Node.js | No TUI, CLI is one-shot — Docker overkill for daily use |
| Branch model | Keep release branch | Follow documented release-branch-strategy.md |
| Stale docs | Clean during audit | Review untracked brainstorms/research/solutions |

## Work Sequence

### Step 1: Fix CI (Green Main)
- Fix 26 Prettier formatting violations (`prettier --write`)
- Fix Docker test: `doctor --json` exits code 20, CI expects 0
- Verify all CI jobs pass on main

### Step 2: E2E Functional Testing
- Run `codepipe init` in a test project
- Run `codepipe start --prompt "..."` and verify PRD generation
- Run `codepipe approve prd` and verify gate progression
- Run `codepipe resume` and verify pipeline continuation
- Run `codepipe status`, `codepipe doctor`, `codepipe health`
- Test JSON output mode (`--json`) for all commands
- Note any functional issues discovered

### Step 3: Fix Discovered Issues
- Address any bugs found during E2E testing
- Fix the known `start.ts` dangling code (line ~192-195) if still present
- Resolve any runtime errors or incorrect output

### Step 4: Documentation Audit
- **README.md**: Verify feature list, command table, installation instructions match reality
- **CLI --help**: Verify each command's help text is accurate
- **Untracked docs**: Review `docs/brainstorms/`, `docs/research/`, `docs/solutions/` — keep accurate material, remove stale/misleading content
- **CHANGELOG.md**: Update `[Unreleased]` section to reflect all post-v1.0.0 changes
- **CONTRIBUTING.md**: Verify still accurate

### Step 5: npm Publishing Setup
- Configure `package.json` for GitHub Packages (`publishConfig`, `repository`)
- Set up `.npmrc` for GitHub Packages auth
- Add or update CI workflow for automated `npm publish` on release
- Test publish manually first (`npm publish --dry-run`)

### Step 6: Cut the Release
- Sync release branch from main (per release-branch-strategy.md)
- Delete existing v1.0.0 tag (`git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0`)
- Bump version in package.json if needed (should already be 1.0.0)
- Update CHANGELOG with final v1.0.0 date
- Tag new v1.0.0 on release branch
- Create GitHub Release
- Publish to GitHub Packages
- Install on homelab via `npm install -g`
- Verify homelab deployment works

## Open Questions

- Does `codepipe start` actually produce correct output with the Cycle 9 CodeMachine-CLI engine?
- Are there API keys or environment variables needed for E2E testing that may not be documented?
- Should the GitHub Packages scope be `@kinginyellow/codemachine-pipeline` or just the package name?
- Does the release branch need CI workflows or just main?

## Success Criteria

- [ ] All CI jobs green on main
- [ ] Full E2E pipeline tested and working
- [ ] `npm install -g @scope/codemachine-pipeline` works from GitHub Packages
- [ ] README accurately describes all commands and features
- [ ] CLI `--help` matches actual behavior for every command
- [ ] `codepipe doctor` passes on homelab
- [ ] GitHub Release published with accurate release notes
