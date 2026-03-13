# Feature: Public Repository Transition

## Problem Statement

The codemachine-pipeline repository is private on GitHub. Transitioning it to
public unlocks free-tier tooling (Dependabot alerts, secret scanning, CodeQL)
and makes the project accessible for potential contributors. The primary risk is
exposing secrets in git history or allowing external actors to execute code on
self-hosted CI runners.

## Current State

- MIT license, README, and CONTRIBUTING.md already exist
- All 5 CI workflows run on self-hosted Linux runners with no actor restrictions
- Secrets are handled via env vars with a redaction utility — never hardcoded in source
- Git history has not been audited for leaked secrets
- Publishes to GitHub Packages (`@kinginyellows` scope); deployment starts with `npm link`
- `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `CLAUDE.md`, `.claude/`, `.codemachine/`, `.serena/`, `.ruvector/`, `thoughts/`, `tools/` — but `.env` patterns are overly specific (missing `.env.production`, `.env.staging`, etc.)
- `package.json` has no `"private": true` field — an accidental `npm publish` without `--registry` could attempt to publish to npmjs.com
- `codemachine` is an optional dependency that degrades gracefully when absent

<!-- deepen-plan: codebase -->
> **Codebase:** All 5 workflow files, job names, runner configs, triggers, and
> timeout gaps validated against the actual files. Every claim in this plan is
> confirmed accurate. `.npmrc` contains `legacy-peer-deps=true` in addition to
> the registry URL (minor omission, not a risk). `SECURITY.md`,
> `CODE_OF_CONDUCT.md`, and `.github/CODEOWNERS` confirmed absent.
<!-- /deepen-plan -->

## Proposed Solution

Sequential security-first checklist: audit git history, harden CI, add public
repo files, configure GitHub settings, flip visibility, verify. Each phase gates
the next.

**Key decision:** Use per-job `if` actor guards (version-controlled, auditable)
as defense-in-depth, with the GitHub "Require approval for all outside
collaborators" setting as the primary security boundary.

<!-- deepen-plan: external -->
> **Research:** GitHub's self-hosted runner security docs explicitly warn: *"We
> recommend that you only use self-hosted runners with private repositories."*
> For public repos, the recommended defense is three layers:
>
> 1. **"Require approval for all outside collaborators"** — the primary gate;
>    fork PRs literally do not start until a maintainer approves
> 2. **Runner group restrictions** — place self-hosted runners in a dedicated
>    group restricted to specific repos (forks are separate repos, excluded)
> 3. **Per-job `if` guards** — defense-in-depth; `github.actor` cannot be
>    spoofed by fork authors but is fragile if collaborators are added later
>
> GitHub Environments with required reviewers protect secrets but do **not**
> prevent job scheduling on the runner — the job starts, hits the gate, and
> waits. For preventing code execution, environments alone are insufficient.
>
> As of the Dec 2025 GitHub changelog, `pull_request_target` was hardened:
> workflow files are always taken from the default branch regardless of the
> PR's base, closing a class of fork injection attacks.
>
> Sources: [GitHub Docs — Security hardening for Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions), [GitHub Docs — Managing access to self-hosted runners using groups](https://docs.github.com/actions/hosting-your-own-runners/managing-self-hosted-runners/managing-access-to-self-hosted-runners-using-groups)
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Git History Secret Audit

Must complete before any visibility change. If secrets are found, rotate
immediately and scrub history before proceeding.

- [ ] 1.1: Install `gitleaks` (simpler local setup) or `trufflehog`
  ```bash
  # gitleaks
  brew install gitleaks  # or download from GitHub releases
  gitleaks detect --source . --verbose --report-path gitleaks-report.json
  ```
- [ ] 1.2: Review results — distinguish real secrets from test fixtures and example placeholders
- [ ] 1.3: If real secrets found: rotate them, then scrub history with `git filter-repo` or BFG Repo-Cleaner
- [ ] 1.4: Audit `.npmrc` in git history for leaked auth tokens (gap identified by spec analysis)
  ```bash
  git log --all -p -- .npmrc | grep -i '_authToken\|//npm.pkg.github.com/:'
  ```
- [ ] 1.5: Grep for internal infrastructure references with expanded scope (root, `.github/`, `bin/` included)
  ```bash
  grep -rn '192\.168\.\|10\.[0-9]\|172\.\(1[6-9]\|2[0-9]\|3[01]\)\.\|\.internal\.\|\.corp\.\|\.local\.\|\.home\.' \
    src/ docs/ scripts/ config/ tests/ bin/ .github/ *.md *.json Dockerfile .npmrc
  ```
- [ ] 1.6: Grep for email addresses, Slack webhooks, org-specific URLs
  ```bash
  grep -rn 'slack\.com/services\|hooks\.slack\.com\|@[a-zA-Z0-9.-]*\.\(com\|org\|io\)' \
    src/ docs/ scripts/ config/ tests/ .github/
  ```
- [ ] 1.7: Review "homelab" references in `docs/` for specificity (current findings: generic)
- [ ] 1.8: Fix `.gitignore` `.env` patterns — replace the specific `.env`, `.env.local`, `.env.*.local` entries with a single `.env*` glob to catch all variants (`.env.production`, `.env.staging`, `.env.test`, etc.)
- [ ] 1.9: Verify remaining `.gitignore` entries cover all local-only files — `CLAUDE.md`, `.claude/`, `.codemachine/`, `.serena/`, `.ruvector/`, `thoughts/`, `tools/`
- [ ] 1.10: Check `.env.example` or similar template files contain only placeholders, not real values

<!-- deepen-plan: codebase -->
> **Codebase:** The existing `scripts/security-scan-docs.sh` already scans
> `docs/` and `README.md` for leaked credentials (GitHub tokens,
> Anthropic/OpenAI API keys, Linear keys, AWS keys, emails, internal IPs) and
> redacts matches in output. Consider running this script as part of Phase 1
> in addition to gitleaks — it catches domain-specific patterns that generic
> tools may miss.
<!-- /deepen-plan -->

**Gate:** All findings reviewed and resolved before proceeding.

### Phase 2: CI Workflow Hardening

Lock down self-hosted runner workflows so only the repo owner triggers execution.

- [ ] 2.1: Add actor guard to CI jobs in `.github/workflows/ci.yml` (4 jobs: `optimize_ci`, `workflow_lint`, `test`, `docker`)
  ```yaml
  if: >-
    github.event_name == 'push' ||
    (github.event_name == 'pull_request' && github.actor == 'KingInYellows') ||
    (github.event_name == 'workflow_dispatch' && github.actor == 'KingInYellows') ||
    github.event_name == 'schedule'
  ```
  Note: `workflow_dispatch` is restricted to users with write access by GitHub, but adding the actor check provides defense-in-depth if collaborators are added later.

<!-- deepen-plan: external -->
> **Research:** Consider also adding `if: github.repository == 'KingInYellows/codemachine-pipeline'`
> as an alternative or supplement to actor-based guards. This prevents fork
> repositories from running the workflow at all (forks have a different
> `github.repository` value), regardless of who the actor is. This is a
> stronger defense-in-depth pattern recommended by GitHub's security hardening
> guide because it cannot be bypassed by adding collaborators.
<!-- /deepen-plan -->

- [ ] 2.2: Add actor guard to `.github/workflows/publish.yml` (1 job: `publish`, triggers: `release`, `workflow_dispatch`)

- [ ] 2.3: Add actor guard to `.github/workflows/docs-validation.yml` (8 jobs, all self-hosted). Also add `timeout-minutes: 15` to all 8 jobs — they currently have no timeout, which is a resource exhaustion risk on self-hosted runners.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `docs-validation.yml` has 8 jobs (link-check,
> command-validation, factual-accuracy, security-scan, code-examples,
> spell-check, structure-validation, summary) — none specify
> `timeout-minutes`. By contrast, `ci.yml` sets timeouts on all jobs (5, 10,
> 45, 30 min respectively) and `security-scan.yml` sets 20 min. The GitHub
> Actions default is 360 minutes (6 hours) if unset.
<!-- /deepen-plan -->

- [ ] 2.4: Add actor guard to `.github/workflows/dependabot-auto-merge.yml` (1 job). Consider switching this to `ubuntu-latest` since it only makes GitHub API calls and does not need a self-hosted runner.

- [ ] 2.5: `.github/workflows/security-scan.yml` — **no actor guard needed**. It only triggers on `schedule` and `workflow_dispatch` (no `pull_request`). Schedule always runs as the repo owner on the default branch. `workflow_dispatch` is restricted to write-access users.

- [ ] 2.6: Verify no workflows use `pull_request_target` trigger (confirmed: none do)

<!-- deepen-plan: external -->
> **Research:** Also consider placing self-hosted runners in a **runner group**
> restricted to only this repository. Runner groups prevent forks (which are
> separate repositories) from targeting your runners entirely, adding a
> security layer that operates at the infrastructure level rather than the
> workflow level. Configure via: Settings > Actions > Runner groups > New
> runner group > restrict to selected repositories.
<!-- /deepen-plan -->

- [ ] 2.7: Test by pushing a commit to a branch and confirming CI still runs for the owner

**Gate:** All workflows updated, CI passes on an owner-triggered push.

### Phase 3: Public Repository Standard Files

- [ ] 3.1: Create `SECURITY.md` at repo root
  - Supported versions (v1.x)
  - How to report vulnerabilities (GitHub Security Advisories preferred)
  - Expected response time (best-effort for a personal project)
  - Scope (what counts as a security issue vs. a bug)

<!-- deepen-plan: external -->
> **Research:** The OpenSSF OSPS Baseline (v2026-02-19) requires at minimum:
> (1) a means for private vulnerability reporting, and (2) supported versions.
> GitHub's built-in "Private vulnerability reporting" feature (enabled in
> Settings > Code security and analysis) is the modern recommended approach —
> it creates a private advisory draft directly in the repo, eliminating the
> need for a separate email address. Recommended template:
>
> ```markdown
> # Security Policy
>
> ## Reporting a Vulnerability
>
> Please report vulnerabilities through
> [GitHub Security Advisories](https://github.com/OWNER/REPO/security/advisories/new).
> **Do not open a public issue.** I will acknowledge receipt within 72 hours.
>
> ## Supported Versions
>
> | Version | Supported |
> | ------- | --------- |
> | 1.x     | Yes       |
> | < 1.0   | No        |
> ```
<!-- /deepen-plan -->

- [ ] 3.2: Update `CONTRIBUTING.md`
  - Add note that external contributors should use standard `git` + `gh pr create` (Graphite is optional, owner's workflow)
  - Add note that CI will not auto-run on external PRs — owner must approve
  - Clarify that `codemachine` optional dependency degrades gracefully and is not required for development

<!-- deepen-plan: codebase -->
> **Codebase:** `CONTRIBUTING.md` line 77 currently states: *"Never push
> directly to `main` or create PRs with `gh pr create`."* This needs to be
> softened for external contributors. The entire contribution workflow
> (lines 47-77) is Graphite-specific and assumes push access to the repo.
> A fork-based contribution section should be added.
<!-- /deepen-plan -->

- [ ] 3.3: Review `README.md` installation section
  - Confirm `YOUR_GITHUB_PAT` is clearly example text
  - "From source" section is clean
  - Add note that GitHub Packages requires a PAT even for public repos (GitHub limitation)

- [ ] 3.4: Skip `CODE_OF_CONDUCT.md` for now — add later if community grows

- [ ] 3.5: Add `"private": true` to `package.json` to prevent accidental `npm publish` to npmjs.com (publishing to GitHub Packages via the `publish.yml` workflow uses `--registry` explicitly, so this field won't interfere)

<!-- deepen-plan: external -->
> **Research:** WARNING: `"private": true` in `package.json` blocks publishing
> to **all** registries, including GitHub Packages. The npm client checks this
> field before making any network request and refuses to publish regardless of
> `--registry`. If you want to keep publishing to GitHub Packages, do **not**
> add `"private": true`. The existing `publishConfig.registry` pointing to
> `npm.pkg.github.com` already locks the publish target. To guard against
> accidental npmjs.com publish, the `publishConfig` is sufficient.
<!-- /deepen-plan -->

- [ ] 3.6: (Optional) Add `.github/CODEOWNERS` to protect sensitive paths (`.github/workflows/`, `scripts/security-*`) with required owner review

**Gate:** Files created/updated and committed.

### Phase 4: GitHub Repository Settings

Order matters: configure protections before flipping visibility.

- [ ] 4.1: Settings > Branches > Branch protection rules for `main`
  - Require status checks to pass before merging
  - (Optional) Require pull request reviews

- [ ] 4.2: Settings > Actions > General
  - Fork pull request workflows: **"Require approval for all outside collaborators"** — this is the primary security control, not the actor guards
  - Workflow permissions: "Read repository contents and packages permissions" (least privilege)

- [ ] 4.3: Settings > General > Danger Zone > **Change repository visibility to Public**

- [ ] 4.4: Settings > Code security and analysis (free for public repos)
  - Enable Dependabot alerts
  - Enable Dependabot security updates
  - Enable secret scanning
  - Enable secret scanning push protection
  - Enable CodeQL analysis (optional)

- [ ] 4.5: Verify GitHub Packages publishing config is correct (`publishConfig.access` is already `"public"` in package.json)

**Gate:** Repo is public with all protections active.

### Phase 5: Post-Transition Verification

- [ ] 5.1: Confirm repo is accessible at `https://github.com/KingInYellows/codemachine-pipeline` without authentication
- [ ] 5.2: Confirm CI runs on a push to main (owner-triggered)
- [ ] 5.3: Verify the "Require approval" setting is active via GitHub API:
  ```bash
  gh api repos/KingInYellows/codemachine-pipeline --jq '.visibility'
  ```
- [ ] 5.4: Open a test PR from a secondary account or ask someone to fork — confirm CI does NOT auto-run for external actors
- [ ] 5.5: Run `npm link` locally and verify `codepipe --version` works
- [ ] 5.6: Verify Dependabot alerts and secret scanning are active in the Security tab
- [ ] 5.7: Verify coverage upload (Codecov) still works on the first public CI run

## Technical Details

### Files to Modify

- `.github/workflows/ci.yml` — Add actor guards to 4 jobs
- `.github/workflows/publish.yml` — Add actor guard to publish job
- `.github/workflows/docs-validation.yml` — Add actor guards + `timeout-minutes: 15` to all 8 jobs
- `.github/workflows/dependabot-auto-merge.yml` — Add actor guard, consider switching to `ubuntu-latest`
- `CONTRIBUTING.md` — Add external contributor notes, CI approval note
- `README.md` — Add GitHub Packages PAT note

### Files to Create

- `SECURITY.md` — Security policy for public repo

### Files Unchanged

- `.github/workflows/security-scan.yml` — No PR trigger, no actor guard needed
- `.npmrc` — Contains no secrets (registry URL and `legacy-peer-deps=true` only)
- `Dockerfile` — Bind-mounts `.npmrc` safely (no COPY, no layer leak)

## Acceptance Criteria

1. `gitleaks detect` reports zero real secrets in full git history
2. All self-hosted runner CI jobs have actor guards (except security-scan.yml)
3. `docs-validation.yml` jobs all have `timeout-minutes` set
4. `SECURITY.md` exists at repo root
5. `CONTRIBUTING.md` documents external contributor workflow and CI approval
6. GitHub "Require approval for all outside collaborators" is active
7. Repo is public and accessible without authentication
8. CI runs successfully on an owner push after the visibility flip
9. Secret scanning and Dependabot alerts are enabled

## Edge Cases

- **Fork PR modifies workflow YAML to remove actor guards:** Mitigated by "Require approval for all outside collaborators" setting — this is the load-bearing control, actor guards are defense-in-depth only
- **`codemachine` optional dependency unavailable for external contributors:** Degrades gracefully per CLAUDE.md; document in CONTRIBUTING.md
- **Graphite CI optimization (`GRAPHITE_TOKEN`) unavailable in public context:** Step has `continue-on-error: true`, silently skips; harmless but add a YAML comment explaining it is optional
- **GitHub Packages requires PAT even for public repos:** Document in README installation section

## Rollback Plan

If a critical issue is discovered after flipping visibility:

1. Immediately re-privatize: Settings > Danger Zone > Change visibility to Private
2. Rotate any potentially exposed secrets
3. Note: public forks and clones created during the public window cannot be recalled — this is why the secret audit in Phase 1 is critical
4. Investigate and remediate, then re-attempt the transition

<!-- deepen-plan: external -->
> **Research:** On re-privatization: public forks are **detached** into an
> independent fork network and remain public permanently. Stars and watchers
> from users who lose access are **permanently removed** and cannot be restored
> even if the repo is made public again. GitHub Packages versions are **not
> deleted** but access changes to require repo-level permissions. GitHub Pages
> is automatically unpublished.
<!-- /deepen-plan -->

## References

- Brainstorm: `docs/brainstorms/2026-03-13-public-repository-transition-brainstorm.md`
- CI workflows: `.github/workflows/ci.yml`, `publish.yml`, `docs-validation.yml`, `dependabot-auto-merge.yml`, `security-scan.yml`
- GitHub docs: [Managing fork PR workflows](https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks)
- GitHub docs: [Self-hosted runner security](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security)
- GitHub docs: [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- GitHub docs: [Managing access to self-hosted runners using groups](https://docs.github.com/actions/hosting-your-own-runners/managing-self-hosted-runners/managing-access-to-self-hosted-runners-using-groups)
- GitHub docs: [Repository visibility changes](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- OpenSSF OSPS Baseline: [Security policy requirements](https://baseline.openssf.org/versions/2026-02-19.html)
