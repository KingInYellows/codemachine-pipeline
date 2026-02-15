# Submission Workflow

## Always Use Graphite for PR Submissions

When submitting completed work, **ALWAYS** use Graphite (`gt`) commands instead of pushing directly to main.

## Proper Workflow

### 1. Start New Work

```bash
# Create a new Graphite branch from main
gt create <branch-name> --message "Brief description"
```

### 2. Make Changes

```bash
# Make your code changes
# Stage files
git add <files>

# Commit with detailed message
git commit -m "type: description

Details...

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

### 3. Submit to Graphite

```bash
# Push and create PR through Graphite
gt submit --no-edit

# Mark as ready for review (if created as draft)
gh pr ready <PR-number>

# Update PR description if needed
gh pr edit <PR-number> --body "Detailed description"
```

### 4. View Stack Status

```bash
# View your current stack
gt log

# View specific stack
gt log --stack
```

## ❌ What NOT to Do

**NEVER push directly to main:**

```bash
# ❌ DON'T DO THIS
git checkout main
git push origin main
```

**NEVER create PRs without Graphite:**

```bash
# ❌ DON'T DO THIS
gh pr create --title "..." --body "..."
```

## ✅ Correct Flow Example

```bash
# 1. Create branch
gt create fix-bug-123 --message "Fix authentication bug"

# 2. Make changes and commit
git add src/auth/handler.ts tests/auth.spec.ts
git commit -m "fix: resolve authentication token expiry issue"

# 3. Submit through Graphite
gt submit --no-edit

# 4. Mark ready if needed
gh pr ready $(gh pr list --head $(git branch --show-current) --json number -q '.[0].number')
```

## Recovery from Accidental Direct Push

If you accidentally pushed to main:

```bash
# 1. Reset main to before your commit
git checkout main
git reset --hard origin/main~1
git push origin main --force

# 2. Create proper Graphite branch
gt create <branch-name> --message "Description"

# 3. Cherry-pick your commit
git cherry-pick <commit-hash>

# 4. Submit properly
gt submit --no-edit
```

## Key Commands Reference

| Command                     | Purpose                   |
| --------------------------- | ------------------------- |
| `gt create <name> -m "msg"` | Create new branch         |
| `gt submit --no-edit`       | Submit PR to Graphite     |
| `gt log`                    | View stack status         |
| `gt log --stack`            | View current branch stack |
| `gh pr ready <num>`         | Mark draft PR as ready    |
| `gh pr view <num>`          | View PR details           |

## Integration with CI/CD

All PRs submitted through Graphite will automatically:

- ✅ Run CI tests (unit + integration)
- ✅ Run security scans
- ✅ Build Docker images
- ✅ Check code quality
- ✅ Validate with Graphite workflows

## Notes

- Graphite maintains proper branch relationships and dependencies
- Stacked PRs are easier to review
- CI runs on all branches before merge
- Main branch is protected and requires PRs
