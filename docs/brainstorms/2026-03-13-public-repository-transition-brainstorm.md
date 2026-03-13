# Brainstorm: Public Repository Transition

**Date:** 2026-03-13
**Approach:** Sequential Security-First Checklist

## What We're Building

A step-by-step transition of the codemachine-pipeline repository from private to public on GitHub. The transition prioritizes security (secret audit, CI hardening) before visibility changes. The repo is primarily for personal use with `npm link` deployment, but should be safe for public exposure and potential future contributors.

### Context

- The repo already has an MIT license, a comprehensive README, and a CONTRIBUTING.md
- All CI workflows (5 total) run on self-hosted Linux runners with no actor restrictions
- Secrets are handled via environment variables, never hardcoded, with a redaction utility in place
- Git history has not been audited for leaked secrets
- Publishing stays on GitHub Packages (`@kinginyellows` scope), starting with `npm link`
- The goal is to unlock free-tier tooling for public repos while keeping self-hosted runners locked to the owner

### Transition Checklist

The checklist is ordered by dependency -- each phase must pass before proceeding to the next.

#### Phase 1: Git History Secret Audit

Run before any visibility change. If secrets are found, they must be rotated and removed before proceeding.

- [ ] Install and run `trufflehog` or `gitleaks` against the full git history
  ```bash
  # Option A: trufflehog
  trufflehog git file://. --only-verified --fail

  # Option B: gitleaks
  gitleaks detect --source . --verbose
  ```
- [ ] Review results -- distinguish real secrets from test fixtures and example placeholders
- [ ] If real secrets found: rotate them immediately, then use `git filter-repo` or `BFG Repo-Cleaner` to remove from history
- [ ] If no secrets found: proceed
- [ ] Grep for internal infrastructure references (IPs, hostnames, internal URLs)
  ```bash
  grep -rn '192\.168\.\|10\.\d\|172\.\(1[6-9]\|2[0-9]\|3[01]\)\.\|\.internal\.\|\.corp\.' src/ docs/ scripts/ config/ tests/
  ```
- [ ] Review any "homelab" references in `docs/` for specificity (current findings: generic, no real hostnames)
- [ ] Verify `.gitignore` covers all local-only files: `.env*`, `CLAUDE.md`, `.claude/`, `.codemachine/`, `.serena/`, `.ruvector/`, `thoughts/`, `tools/`

#### Phase 2: CI Workflow Hardening

Lock down all self-hosted runner workflows so only the repo owner can trigger execution.

- [ ] Add actor guard to all CI jobs that use self-hosted runners. For each workflow, add an `if` condition or use GitHub Environments:

  **Option A -- Actor guard on each job (simpler):**
  ```yaml
  jobs:
    test:
      if: >-
        github.event_name == 'push' ||
        (github.event_name == 'pull_request' && github.actor == 'KingInYellows') ||
        github.event_name == 'workflow_dispatch' ||
        github.event_name == 'schedule'
      runs-on: [self-hosted, linux]
  ```

  **Option B -- GitHub Environment protection (more robust):**
  - Create a GitHub Environment named `self-hosted-ci`
  - Restrict deployment to `KingInYellows` only
  - Reference `environment: self-hosted-ci` in each job

- [ ] Apply to all 5 workflow files:
  - `.github/workflows/ci.yml` (4 jobs: optimize_ci, workflow_lint, test, docker)
  - `.github/workflows/publish.yml` (1 job: publish)
  - `.github/workflows/security-scan.yml` (1 job: security_scan)
  - `.github/workflows/docs-validation.yml` (8 jobs -- all use self-hosted)
  - `.github/workflows/dependabot-auto-merge.yml` (1 job -- already has `github.actor == 'dependabot[bot]'` guard, but runs on self-hosted)

- [ ] Configure GitHub repo setting: Settings > Actions > General > Fork pull request workflows > **"Require approval for all outside collaborators"**
- [ ] Verify no workflows use `pull_request_target` trigger (confirmed: none do)
- [ ] Test by pushing a commit to a branch and confirming CI still runs for the owner

#### Phase 3: Add Public Repository Standard Files

- [ ] Add `SECURITY.md` at repo root with:
  - Supported versions (currently v1.x)
  - How to report vulnerabilities (email or GitHub Security Advisories)
  - Expected response time
  - Scope (what counts as a security issue)
- [ ] Decide on `CODE_OF_CONDUCT.md` -- optional for a personal project, can add later if community grows
- [ ] Review and update `CONTRIBUTING.md`:
  - Currently references Graphite CLI as required -- decide if external contributors should use plain `git` + `gh pr create` instead
  - Add note about CI restrictions for external PRs (CI won't auto-run; owner must approve)
- [ ] Review `README.md` installation section:
  - GitHub Packages install instructions reference `YOUR_GITHUB_PAT` -- confirm this is intentional example text (it is)
  - "From source" section is clean

#### Phase 4: GitHub Repository Settings

Configure settings in the GitHub UI before or immediately after flipping visibility.

- [ ] Settings > General > Danger Zone > **Change repository visibility to Public**
- [ ] Settings > Branches > Branch protection rules for `main`:
  - Require pull request reviews (optional for solo dev, but prevents accidental pushes)
  - Require status checks to pass (already in place if CI is configured)
- [ ] Settings > Actions > General:
  - Fork pull request workflows: "Require approval for all outside collaborators"
  - Workflow permissions: "Read repository contents and packages permissions" (least privilege)
- [ ] Settings > Code security and analysis:
  - Enable Dependabot alerts (free for public repos)
  - Enable Dependabot security updates
  - Enable secret scanning (free for public repos -- catches any future accidental commits)
  - Enable secret scanning push protection (blocks pushes containing secrets)
  - Enable CodeQL analysis (optional, free for public repos)
- [ ] Verify GitHub Packages publishing still works after visibility change (it should -- `publishConfig.access` is already `"public"`)

#### Phase 5: Post-Transition Verification

- [ ] Confirm the repo is accessible at `https://github.com/KingInYellows/codemachine-pipeline` without authentication
- [ ] Confirm CI runs on a push to main (owner-triggered)
- [ ] Open a test PR from a secondary account or ask someone to fork -- confirm CI does NOT auto-run for external actors
- [ ] Run `npm link` locally and verify `codepipe --version` works
- [ ] Verify Dependabot alerts and secret scanning are active in the Security tab

## Why This Approach

The sequential checklist works because this is a one-time transition where security is the primary risk. Auditing secrets before any visibility change ensures nothing is exposed. Hardening CI before flipping public prevents external actors from executing code on self-hosted runners. The ordering is strict: each phase depends on the prior one passing.

The approach avoids over-engineering (no new tooling, no fresh repo, no complex branching) while covering the real risks: secret exposure in git history, arbitrary code execution via CI, and missing security policies.

## Key Decisions

1. **Keep self-hosted runners** rather than switching to GitHub-hosted. Lock down via actor guards and/or GitHub Environments. This preserves the existing CI setup and avoids migration work.

2. **Actor guard approach for CI**: Either per-job `if` conditions (simpler, all-in-code) or GitHub Environment protection rules (more robust, UI-managed). Recommend starting with per-job `if` conditions since they are version-controlled and auditable.

3. **Git history audit tool**: Use `gitleaks` or `trufflehog` -- both are mature and support full-history scanning. If secrets are found, rotate first, then clean history with `git filter-repo`.

4. **Skip CODE_OF_CONDUCT.md for now** -- this is a personal project. Can be added later if community interest grows. YAGNI.

5. **Keep CONTRIBUTING.md mostly as-is** -- the Graphite workflow is the actual development process. Add a note that external contributors should use standard `git`/`gh` and that CI requires owner approval.

6. **Enable GitHub secret scanning and push protection** -- free for public repos and provides ongoing protection against accidental secret commits.

## Open Questions

1. **Which secret scanning tool to use?** `gitleaks` is simpler to run locally; `trufflehog` has better verified-secret detection but requires more setup. Either works -- pick based on what is already installed or easier to install.

2. **GitHub Environment vs. per-job actor guards?** Per-job `if` conditions are simpler and version-controlled. GitHub Environments offer a stronger security boundary (cannot be bypassed by workflow file changes in a fork PR). For a personal project, per-job guards are likely sufficient.

3. **Should the Graphite CI optimization (`GRAPHITE_TOKEN`) be removed?** It is a paid/private integration. If the token is not available in the public repo's secrets, the step will silently skip (it has `continue-on-error: true`). Keeping it is harmless but may confuse external contributors reading the workflow.

4. **Dependabot auto-merge on self-hosted runner** -- the `dependabot-auto-merge.yml` workflow runs on self-hosted and is triggered by `pull_request`. The `github.actor == 'dependabot[bot]'` guard limits the job, but the runner still spins up to evaluate the condition. Consider adding the owner actor guard as well, or switching this single workflow to `ubuntu-latest` since it only runs lightweight GitHub API calls.
