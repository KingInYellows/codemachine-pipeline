---
title: Graphite restack conflicts after main advanced
category: integration-issues
symptoms:
  - Merge conflicts when running gt restack
  - Conflicts in CHANGELOG.md and shared documentation files
  - Duplicate functions appeared after resolving conflicts
  - PR could not merge due to conflicts
root_cause: PR branch was based on outdated main; main advanced with new commits, causing restack to introduce conflicts
components:
  - Graphite (gt)
  - Git rebase
  - PR workflow
date_solved: 2026-01-04
tags:
  - graphite
  - restack
  - sync
  - rebase
  - merge-conflict
---

# Graphite Restack Conflicts After Main Advanced

## Symptoms

- PR showed merge conflicts in GitHub
- Running `gt restack` reported conflicts in multiple files
- After resolving conflicts, build failed with "duplicate function" errors
- `gt state` showed branch based on old main commit

## Investigation

1. Checked branch state:

```bash
git branch --show-current
gt state
```

2. Compared commits:

```bash
git fetch origin main
git log --oneline origin/main -3
```

3. Found: Branch based on commit `3b49794`, but `origin/main` had advanced to `cce41e0`

## Root Cause

The PR branch was created from an older main commit. While the PR was open, another PR merged to main, advancing the trunk. When attempting to merge, Git detected conflicts between the branch changes and the new main changes.

**Timeline:**

```
main:     A---B (3b49794)---C (cce41e0)
                \
branch:          D---E (our changes)
```

The branch needed to be rebased onto C, but files modified in both B→C and B→E conflicted.

## Solution

### Step 1: Verify branch state

```bash
git status
gt state
```

### Step 2: Fetch latest main

```bash
git fetch origin main
git log --oneline origin/main -3
```

### Step 3: Sync Graphite trunk

```bash
gt sync --force
```

### Step 4: Restack branch on updated main

```bash
gt restack
```

### Step 5: Resolve conflicts manually

For each conflicted file, edit to combine both versions appropriately.

### Step 6: Stage resolved files

```bash
git add <resolved-files>
```

### Step 7: Continue rebase (non-interactive)

```bash
GIT_EDITOR=true git rebase --continue
```

### Step 8: Verify build

```bash
npm run build
npm test
```

### Step 9: Fix any post-rebase issues

If duplicate code or other issues appear, fix them.

### Step 10: Amend and submit

```bash
gt modify --no-edit
gt submit --no-interactive
```

## Prevention

### Pre-Submit Checklist

```bash
# ALWAYS run before gt submit
gt sync --force
gt restack
npm run build && npm test
gt submit --no-interactive
```

### Sync Frequency

| Branch Age | Action                  |
| ---------- | ----------------------- |
| < 1 day    | Sync before submit only |
| 1-3 days   | Sync daily              |
| > 3 days   | Sync twice daily        |
| > 1 week   | Split the work          |

### Post-Rebase Verification

```bash
npm run lint
npm run build
npm test
git diff main...HEAD  # Review final changes
```

## Related

- [AGENTS.md - Graphite Workflow](../../../AGENTS.md#branching-strategy-github-flow--graphite)
- [PR Playbook](../../requirements/pr_playbook.md)
- [Branch Protection Playbook](../../requirements/branch_protection_playbook.md)
