# Submission Workflow

This document describes the standard workflow for submitting changes to the repository.

## Overview

All changes must go through pull requests. Direct pushes to protected branches are not allowed.

---

## Standard Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/my-feature main
```

Or with Graphite for stacked PRs:

```bash
gt create <branch-name> --message "Brief description"
```

### 2. Make Changes and Commit

```bash
git add <files>
git commit -m "feat: description of change

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 3. Push to Remote

```bash
git push -u origin feature/my-feature
```

Or with Graphite:

```bash
gt submit --no-edit
```

### 4. Create Pull Request

- Open a PR against the `main` branch
- Ensure all CI checks pass
- Request review from appropriate team members

### 5. Merge

After approval, merge via the GitHub UI using squash merge.

---

## CI Checks

All PRs must pass:

- **Type checking:** `npm run type-check` (if available)
- **Linting:** `npm run lint`
- **Unit tests:** `npm run test:unit`
- **Integration tests:** `npm run test:integration`
- **Security checks:** `npm run security:glob-guard`

---

## Recovery from Accidental Direct Push

> **WARNING:** Force-pushing to main can cause issues if others have already pulled the commit.
> Coordinate with your team before proceeding with these steps.

If you accidentally push directly to a protected branch:

### 1. Identify the Problematic Commit

```bash
git log --oneline -5
```

### 2. Create a Revert Commit (Preferred)

```bash
git revert <commit-sha>
git push origin main
```

### 3. Force Push (Last Resort)

Only if absolutely necessary and coordinated with team:

```bash
git reset --hard <previous-good-commit>
git push --force-with-lease origin main
```

### 4. Notify Team

- Post in team channel about the incident
- Ensure others pull the corrected history

---

## Branch Protection

The `main` branch has the following protections:

- Require pull request before merging
- Require status checks to pass
- Require linear history
- No force pushes (except by admins in emergencies)

---

## Graphite Integration

For stacked PRs, use Graphite commands:

| Command | Purpose |
|---------|---------|
| `gt create <name> -m "msg"` | Create new branch |
| `gt submit --no-edit` | Submit PR to Graphite |
| `gt log` | View stack status |
| `gt log --stack` | View current branch stack |
| `gh pr ready <num>` | Mark draft PR as ready |
| `gh pr view <num>` | View PR details |

---

**Related Documents:**

- [Branch Protection Playbook](../requirements/branch_protection_playbook.md)
- [GitHub Branch Protection](../requirements/github_branch_protection.md)
