---
title: Resolving Stacked PR Comments with Parallel Agents
date: 2026-02-16
category: code-review
tags:
  - graphite
  - stacked-prs
  - parallel-agents
  - git-race-conditions
  - bot-reviews
  - pr-workflow
  - credential-detection
severity: high
components:
  - git-workflow
  - agent-coordination
  - pr-automation
  - graphite-cli
related_issues:
  - PR-475
  - PR-476
  - PR-477
  - PR-478
  - PR-479
---

# Resolving Stacked PR Comments with Parallel Agents

## Problem

Resolving review comments across multiple stacked Graphite PRs using parallel agents
causes git race conditions when agents share the same working directory. Additionally,
automated bot reviewers (DeepSource, Devin, Greptile, ChatGPT Codex) generate new
comments after each push, requiring multiple resolution rounds.

**Observed in**: 5 stacked documentation PRs (#475-#479) with 132 total review threads
resolved across 3 rounds.

## Root Cause

### Git Race Condition

Multiple `pr-comment-resolver` agents spawned in parallel all execute `git checkout`
on different branches in the **same working directory**. Git's working directory is a
singleton resource — checkout changes HEAD and working tree globally:

1. Agent A checks out `branch-1`
2. Agent B checks out `branch-2` before Agent A commits
3. Agent A's commit lands on `branch-2` instead of `branch-1`

### Multi-Round Bot Comments

CI bots re-analyze code on every push. After fixing human review comments and pushing,
bots generate new comments on the updated code. This creates an iterative cycle:

```
Fix human comments -> Push -> Bots review -> Fix valid bot comments -> Push -> More bot comments -> ...
```

Expect **2-3 rounds** until all comments are resolved.

## Solution

### 1. Process Stacked PRs Sequentially

When fixing comments across stacked branches, process them **one at a time**:

```bash
# Fix each PR sequentially
gt checkout branch-1
# ... make fixes ...
git add <files>
git commit -m "fix: resolve PR #475 review comments"

gt checkout branch-2
# ... make fixes ...
git add <files>
git commit -m "fix: resolve PR #476 review comments"

# Continue for remaining branches...
```

### 2. Restack and Submit from Top of Stack

After all fixes are committed:

```bash
# Navigate to top of stack
gt checkout top-branch-name

# Rebase entire stack
gt restack

# Push all branches (--force is REQUIRED after restack)
gt submit --no-edit --publish --force
```

`--force` is required because `gt restack` rebases branches, rewriting commit history.
This divergence from remote is **expected behavior**.

### 3. Triage Bot Comments

Not all bot comments are valid. Categorize before fixing:

| Bot        | Common False Positives                                 | Action                                                       |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| DeepSource | `console.log` in Node.js CLI scripts (assumes browser) | Ignore — add `/* eslint-disable no-console -- CLI script */` |
| Greptile   | Duplicate of already-fixed issues                      | Resolve as addressed                                         |
| Devin      | Informational observations (not bugs)                  | Resolve if no action needed                                  |
| Codex      | Overly broad regex suggestions                         | Evaluate case-by-case                                        |

### 4. Recover from Race Condition

If parallel agents put commits on wrong branches:

```bash
# Move commit to correct branch
git checkout correct-branch
git cherry-pick <commit-hash>

# Remove from wrong branch
git checkout wrong-branch
git reset --hard HEAD~1
```

### 5. Credential Detection Patterns

Key regex improvements discovered during bot review resolution:

```javascript
// Negative lookahead RIGHT AFTER prefix (not at end)
/sk-(?!ant-)[A-Za-z0-9]{32,}/        // Excludes Anthropic keys

// Per-line placeholder bypass (not per-block)
const lines = code.split('\n');
for (const line of lines) {
  if (hasPlaceholderMarker(line)) continue;  // Only skip THIS line
  // ... check credential patterns on this line ...
}

// AWS STS temporary credentials (not just long-term)
/(AKIA|ASIA)[0-9A-Z]{16}/

// GitHub fine-grained tokens
/github_pat_[A-Za-z0-9_]{82}/

// Narrower OpenAI pattern (avoids false positives)
/sk-(proj|svcacct)-[A-Za-z0-9_-]{32,}/
```

### 6. ESM vs CJS in Scripts

All scripts in `scripts/` must use CommonJS to match the project convention
(`package.json` lacks `"type": "module"`):

```javascript
// CORRECT (CJS)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Use Node 24 built-in glob (no external dependency)
const files = fs.globSync('docs/**/*.md', { cwd: rootDir });
```

## Prevention

### Sequential Git Operations for Stacked PRs

- **Never** spawn parallel agents that share a git working directory
- Process stacked PRs sequentially: checkout -> fix -> commit -> next branch
- Alternative: use `git worktree` for true parallel isolation

### Local Validation Before Push

Run validation locally before pushing to reduce bot comment rounds:

```bash
npm run docs:validate    # Link check + command validation + security scan
npm run lint             # ESLint checks
npm run build            # Verify TypeScript compiles
```

### Graphite Workflow Conventions

- Always `gt restack` from the **top** of the stack
- Always `gt submit --force` after `gt restack`
- Use `gt log short` to verify stack structure after changes

### CJS Convention Enforcement

- All `scripts/*.js` files use `require()` (not `import`)
- Use `node:` prefix for built-in modules
- Use `fs.globSync()` (Node 24+) instead of `glob` package

## Complete Workflow

```bash
# === ROUND 1: Fix Review Comments ===
# Fetch unresolved threads
bash scripts/get-pr-comments <PR_NUMBER>

# Fix each PR sequentially
for branch in $(gt log short | tac); do
  gt checkout "$branch"
  # Apply fixes for this PR's comments
  git add <files>
  git commit -m "fix: resolve PR review comments"
done

# Restack and push
gt checkout top-branch
gt restack
gt submit --no-edit --publish --force

# Resolve threads via GraphQL
bash scripts/resolve-pr-thread <THREAD_ID>

# === ROUND 2+: Bot Comment Triage ===
# Re-fetch comments (bots will have added new ones)
bash scripts/get-pr-comments <PR_NUMBER>

# Triage: valid fix vs false positive
# Fix valid issues, resolve all threads
# Repeat until all PRs show 0 unresolved threads
```

## Related Documentation

- [Reviewing Documentation PRs](reviewing-documentation-prs.md) — 5-agent review pattern for docs PRs
- [Wave-Based Parallel Resolution](multi-agent-wave-resolution-pr-findings.md) — dependency-aware multi-wave execution
- [Graphite Restack Conflicts](../integration-issues/graphite-restack-conflicts-after-main-advanced.md) — recovery from restack merge conflicts
- [Self-Hosted Runner Known Issues](../ci-issues/self-hosted-runner-known-issues.md) — CI timing/race condition patterns

## Key Metrics

| Metric                     | Value |
| -------------------------- | ----- |
| Total threads resolved     | 132   |
| PRs in stack               | 5     |
| Resolution rounds          | 3     |
| Human review threads       | 74    |
| Bot review threads         | 58    |
| False positive bot threads | ~12   |
