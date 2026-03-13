---
title: Self-Hosted Runner Fork PR Hardening
date: 2026-03-13
category: security-issues
tags: [ci, github-actions, self-hosted-runners, fork-security, public-repo]
components: [.github/workflows/ci.yml, .github/workflows/publish.yml, .github/workflows/docs-validation.yml, .github/workflows/dependabot-auto-merge.yml, .gitignore]
---

# Self-Hosted Runner Fork PR Hardening

## Problem

When transitioning a private GitHub repository to public, self-hosted CI runners
become vulnerable to abuse from fork pull requests. GitHub Actions will run
workflow jobs triggered by `pull_request` events from any fork by default. Without
explicit guards, a malicious contributor can open a fork PR containing arbitrary
code that executes on the repository's self-hosted infrastructure -- gaining
access to the runner's filesystem, network, credentials, and any secrets
available to the workflow.

### Symptoms

- Self-hosted runners exposed to arbitrary code execution from fork PRs
- No `if:` guards on workflow jobs to restrict execution to the trusted repository
- Jobs in `docs-validation.yml` lacking explicit `timeout-minutes`, defaulting to
  GitHub's 6-hour maximum -- creating a resource exhaustion vector
- `.gitignore` using narrow `.env` / `.env.local` / `.env.*.local` patterns that
  miss variants like `.env.production`, `.env.staging`, `.env.test`
- No documented workflow for external contributors (fork-based PRs)

## Root Cause

Private repositories have an implicit trust boundary: only collaborators with
push access can trigger CI. When the repository goes public, that boundary
disappears. The existing CI configuration assumed a trusted-contributor model and
had no defense-in-depth guards against untrusted fork PRs.

Specifically:

1. **No repository guard** -- Workflow jobs ran unconditionally on any
   `pull_request` event, regardless of the source repository.
2. **No timeout cap** -- 8 of 8 jobs in `docs-validation.yml` relied on GitHub's
   default 6-hour timeout, allowing a fork PR to occupy a self-hosted runner for
   hours.
3. **Wrong runner tier** -- `dependabot-auto-merge.yml` ran on self-hosted
   infrastructure despite only needing GitHub API access (no build, no tests).
4. **Narrow secret patterns** -- `.gitignore` entries did not cover all `.env`
   variants that might contain secrets.

## Fix

### 1. Combined Guard on Every Job

Add an `if` condition to every job across all 4 workflow files. The guard
combines two checks that defend against different threats:

```yaml
jobs:
  build:
    runs-on: self-hosted
    if: >-
      github.repository == 'KingInYellows/codemachine-pipeline' &&
      (github.event_name != 'pull_request' || !github.event.pull_request.head.repo.fork)
    steps:
      # ...
```

**Why two clauses:**

- **`github.repository == '...'`** -- Blocks execution when workflows are
  copied to and triggered on a fork (push/dispatch events on the fork). On a
  fork, `github.repository` evaluates to `fork-owner/codemachine-pipeline`.
  However, for `pull_request` events targeting the upstream repo,
  `github.repository` is always the **base** (upstream) repository, so this
  check alone does **not** block fork PRs.

- **`!github.event.pull_request.head.repo.fork`** -- The load-bearing check
  for fork PRs. When a PR's head branch lives in a fork, this field is `true`,
  and the negation blocks the job. For non-PR events (push, workflow_dispatch),
  the `github.event_name != 'pull_request'` short-circuit ensures the guard
  evaluates to `true`.

**Applied to:**
- `ci.yml` -- all 4 jobs (optimize_ci, workflow_lint, test, docker)
- `publish.yml` -- publish job
- `docs-validation.yml` -- all 8 jobs
- `dependabot-auto-merge.yml` -- auto-merge job

### 2. Timeout Enforcement

Added `timeout-minutes: 15` to all 8 jobs in `docs-validation.yml` that
previously lacked explicit timeouts:

```yaml
jobs:
  validate-links:
    runs-on: self-hosted
    if: >-
      github.repository == 'KingInYellows/codemachine-pipeline' &&
      (github.event_name != 'pull_request' || !github.event.pull_request.head.repo.fork)
    timeout-minutes: 15
    steps:
      # ...
```

Without this, a stalled or malicious job defaults to GitHub's 6-hour maximum,
tying up a self-hosted runner.

### 3. Runner Tier Selection

Moved `dependabot-auto-merge.yml` from `self-hosted` to `ubuntu-latest`. This
workflow only calls the GitHub API (`gh pr merge`) and does not need self-hosted
infrastructure. Running it on GitHub-hosted runners eliminates the attack surface
entirely for that workflow:

```yaml
jobs:
  auto-merge:
    runs-on: ubuntu-latest  # was: self-hosted
    if: >-
      github.repository == 'KingInYellows/codemachine-pipeline' &&
      github.actor == 'dependabot[bot]'
```

### 4. Defense in Depth

The repository guard is one layer of a defense-in-depth strategy:

| Layer | Control | Bypass Risk |
|-------|---------|-------------|
| Primary | "Require approval for all outside collaborators" repo setting | None -- GitHub enforces before job execution |
| Secondary | Combined `github.repository` + fork PR check on every job | Defense-in-depth against misconfigured primary control; for `pull_request` events, workflow YAML always comes from the base branch so fork PRs cannot modify guards |
| Tertiary | Explicit `timeout-minutes` on all jobs | None -- enforced by GitHub runner |

The primary control (approval requirement) prevents fork PR workflows from
executing at all without owner approval. The repository guard and timeouts are
defense-in-depth for cases where the primary control is misconfigured or
disabled.

### 5. Secret Pattern Broadening

Replaced narrow `.gitignore` patterns with a single glob:

```gitignore
# Before:
.env
.env.local
.env.*.local

# After:
.env*
```

This catches `.env.production`, `.env.staging`, `.env.test`, and any other
variant before they can be accidentally committed to a public repository.

## Prevention

### Checklist for Public Repository Transitions

- [ ] Audit every workflow file for the combined guard (`github.repository` + fork PR check) on every job
- [ ] Verify every job has an explicit `timeout-minutes` (never rely on 6-hour default)
- [ ] Move bot-actor workflows to GitHub-hosted runners when they do not need
      self-hosted infrastructure
- [ ] Enable "Require approval for all outside collaborators" in repo settings
- [ ] Broaden `.gitignore` to use `.env*` glob before going public
- [ ] Run a secret scanner (e.g., gitleaks) across full commit history
- [ ] Create `SECURITY.md` with vulnerability reporting instructions
- [ ] Document external contributor workflow in `CONTRIBUTING.md`

### Checklist for New Workflow Files

When adding any new GitHub Actions workflow:

- [ ] Include the combined guard on every job:
      ```yaml
      if: >-
        github.repository == 'KingInYellows/codemachine-pipeline' &&
        (github.event_name != 'pull_request' || !github.event.pull_request.head.repo.fork)
      ```
- [ ] Set explicit `timeout-minutes` on every job
- [ ] Use `ubuntu-latest` unless the job specifically requires self-hosted
      infrastructure

### Detection

After adding or modifying any workflow file, verify guards are present:

```bash
# Find jobs missing the combined guard (both repository check AND fork check)
grep -n 'runs-on:' .github/workflows/*.yml | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  # Check if the preceding 8 lines contain both guard clauses
  context=$(head -n "$lineno" "$file" | tail -8)
  echo "$context" | grep -q 'github.repository' || \
    echo "MISSING REPO GUARD: $file:$lineno"
  echo "$context" | grep -q 'head.repo.fork' || \
    echo "MISSING FORK GUARD: $file:$lineno"
done

# Find jobs missing timeout
for f in .github/workflows/*.yml; do
  # Jobs on self-hosted runners must have timeout-minutes
  grep -A2 'runs-on: self-hosted' "$f" | grep -q 'timeout-minutes' || \
    echo "MISSING TIMEOUT: $f"
done
```

## Related Documentation

- `docs/solutions/ci-issues/self-hosted-runner-known-issues.md` -- operational
  issues with self-hosted runners (flaky tests, Docker exit codes)
- `SECURITY.md` -- vulnerability reporting policy (created as part of this
  transition)
- `CONTRIBUTING.md` -- external contributor fork-based workflow documentation
- GitHub Docs: [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
