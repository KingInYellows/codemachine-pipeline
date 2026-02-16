---
title: 'Graphite Stacked PR Review Fix Patterns'
date: 2026-02-15
category: research
tags: [graphite, pr-workflow, code-review, fix-patterns, documentation]
scope: 'Understanding how to fix PR review findings while maintaining Graphite stack integrity'
status: documented
---

# Graphite Stacked PR Review Fix Patterns

## Research Summary

This document codifies patterns observed in the codemachine-pipeline project for fixing PR review findings within a Graphite-managed stack. The patterns emphasize dependency-aware parallel resolution, atomic fixes per commit, and stack maintenance discipline.

---

## 1. Graphite Workflow Foundations

### 1.1 Branch & Stack Structure

**Key Graphite Commands** (from CONTRIBUTING.md):

```bash
gt create <name> -m "msg"             # Create branch from main
gt submit --no-interactive --publish  # Submit PR(s) through Graphite
gt log                                # View all stacks
gt log --stack                        # View current branch stack
gh pr ready <num>                     # Mark draft PR as ready
gh pr view <num>                      # View PR details
```

**Branch Naming Convention** (observed):

- Format: `02-15-docs_<description>_<variation>`
- Example: `02-15-docs_add_ci_validation_pipeline_for_documentation_quality`
- Pattern: `MM-DD-<type>_<description>_<optional_variation>`

**Stack State** (observed in current repo):

```
PR #478 ← docs: answer 15 critical architecture questions (ADR-009)
PR #477 ← docs: add CI validation pipeline for documentation quality
PR #476 ← docs: restructure directory hierarchy (16→7 top-level dirs)
```

All PRs in sequence, each with parent dependency on predecessor.

### 1.2 Never Use Direct Git Push

**Critical Rule** (from CONTRIBUTING.md):

- Never push directly to `main` or create PRs with `gh pr create`
- Main branch is protected
- Only path: create Graphite branch → make changes → `gt submit --no-interactive --publish`

---

## 2. Fixing Review Findings: Core Patterns

### 2.1 Pattern: Commit-Per-Logical-Fix

**Observed Pattern** (from git history):

```bash
# One logical fix per commit
a87d776 docs: correct critical factual errors in documentation plan
8fde38f fix: resolve release blockers from final review
c6bc63d chore: address remaining review findings
8ce7d1f fix: address review findings in documentation
```

**Rule**: Each commit addresses ONE review finding category or ONE file's worth of changes.

**Rationale**:

- Keeps history clean and bisectable
- Makes it easy to revert individual fixes if needed
- Aligns with Conventional Commits standard
- Enables `gt restack` to resolve conflicts safely

### 2.2 Pattern: Use `gt modify` for Stack Fixes

**Workflow** (from CONTRIBUTING.md):

```bash
# 1. Check current stack
gt log --stack

# 2. Make changes to current branch
git add src/file.ts docs/file.md
git commit -m "fix: address review finding #X"

# 3. Amend with gt modify (not git commit --amend)
gt modify --all  # Rebases upstack automatically

# 4. Resubmit the stack
gt submit --no-interactive --publish
```

**Why `gt modify` instead of `git commit --amend`**:

- Automatically rebases any upstack PRs to maintain dependency order
- Prevents merge conflicts in stacked branches
- Graphite tracks amendment history in PR version control

### 2.3 Pattern: Dependency-Aware Wave Resolution

**Observed in PR #466 Review Fixes** (from multi-agent-wave-resolution-pr-findings.md):

When multiple findings exist, determine safe parallelization:

**Wave 1** (independent fixes):

- 9 agents in parallel
- Each agent fixes 1-2 findings in separate files
- No cross-file dependencies within wave
- Duration: ~12 minutes

**Wave 2** (depends on Wave 1):

- 3 agents in parallel
- Fixes that depend on Wave 1 completions
- Example: Strategy registration docs (needs core adapter fixes first)
- Duration: ~5 minutes

**Wave 3** (depends on Wave 2):

- 1 agent
- Test coverage additions (needs code stable)
- Duration: ~4 minutes

**Critical Exception**: If multiple findings touch the same file, batch them into one commit:

```
Same file (CodeMachineCLIAdapter.ts) touches:
  - 002: Silent error handling
  - 004: Credential stdin ignored
  - 007: Env filter duplication
  - 009: Buffer bounds

→ Batch into single agent/commit to avoid conflicts
```

### 2.4 Pattern: Documentation Fix Structure

**Observed Pattern** (from reviewing-documentation-prs.md):

For documentation PRs with review findings:

**Agent Selection** (5-agent team for docs, not full 8-12):

- `comment-analyzer` — Cross-reference claims against source
- `code-simplicity-reviewer` — Identify redundancy/bloat
- `pattern-recognition-specialist` — Check consistency
- `architecture-strategist` — Validate doc structure
- `security-sentinel` — Audit for info disclosure

**Prevention Checklist** (before submitting fixes):

```markdown
- [ ] All feature/engine/command names verified vs. source code
- [ ] All relative links resolve to existing files
- [ ] Command tables match oclif manifest or equivalent
- [ ] Project structure trees match actual directories
- [ ] Example tokens use placeholder values (no real secrets)
- [ ] No redundant sections duplicating docs/README.md
- [ ] Code examples reference actual function signatures
```

**Example Fix Structure** (commit a87d776):

```
docs: correct critical factual errors in documentation plan

Fix three critical errors in the comprehensive documentation suite plan:

1. Environment variable correction:
   - Replace CODEMACHINE_CLI_PATH → CODEMACHINE_BIN_PATH

2. Remove non-existent variable:
   - Remove CODEMACHINE_LOG_LEVEL

3. Config schema structure fix:
   - Replace flat structure with correct nested format
   - Matches actual Zod schema in RepoConfig.ts

These corrections prevent documentation drift and ensure accuracy.
```

---

## 3. Commit Message Conventions

### 3.1 Conventional Commits Style (from CONTRIBUTING.md)

**Format**:

```
type: short description

Optional longer body explaining context or rationale.
```

**Common Types for Review Fixes**:

- `fix:` — Bug fix from review (most common)
- `docs:` — Documentation corrections
- `chore:` — Tooling, cleanup from review
- `refactor:` — Code restructuring (remove dead code, etc.)
- `test:` — Adding/updating tests to address coverage gaps

**Examples from History**:

```bash
fix: resolve release blockers from final review
chore: address remaining review findings
docs: correct critical factual errors in documentation plan
```

### 3.2 Co-Author Attribution

**Pattern** (observed in commit a87d776):

```
Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>
```

Used when AI agents or tools assist in creating the fix.

---

## 4. Stack Integrity Patterns

### 4.1 Pattern: Stack Status Before/After

**Before Fixing** (use `gt log --stack`):

```
◯ 02-15-docs_restructure_docs_directory_16_7_top-level_dirs_
│ PR #476 (Ready to merge as stack)
│ 54e93ec - style: format code...
│ 478de2c - docs: restructure directory hierarchy
│
◯ 02-15-docs_add_ci_validation_pipeline...
│ PR #477
│ 47f10e2 - docs: add CI validation pipeline
```

**After Making Fixes**:

1. **Don't create new branches** — stay on same branch
2. **Make changes** — `git add . && git commit -m "fix: ..."`
3. **Run `gt modify`** — rebases upstack branches if needed
4. **Check status again** — `gt log --stack` to verify stack integrity

### 4.2 Pattern: Avoiding Stack Breakage

**Safe Pattern**:

```bash
# 1. Ensure on correct branch
git branch --show-current  # Should be your PR branch

# 2. Make changes
git add ...
git commit -m "fix: ..."

# 3. Check stack before resubmitting
gt log --stack

# 4. Use gt modify (NEVER git rebase -i or git reset --hard)
gt modify --all

# 5. Resubmit
gt submit --no-interactive --publish
```

**Dangerous Patterns to Avoid**:

- `git rebase -i main` — breaks Graphite tracking
- `git reset --hard HEAD~1` — loses amendment history
- Creating new branch from stack branch — orphans PR
- Direct `git push` — bypasses Graphite PR creation

### 4.3 Pattern: Handling Upstack Conflicts

**If Upstack PR Conflicts**:

```bash
# Graphite auto-handles on gt submit:
# 1. Detects conflict in upstack PR
# 2. Rebases upstack branch onto your fixed branch
# 3. Maintains parent-child dependency

# You just resubmit normally:
gt submit --no-interactive --publish

# Graphite creates new PR versions with conflict resolution
```

---

## 5. Testing Patterns for Review Fixes

### 5.1 Pattern: Test-First Before Commit

**Observed in PR #466 fixes**:

```bash
# After fixes, always run full suite
npm test                    # All tests
npm run lint               # ESLint check
npm run format:check       # Prettier check
npm run deps:check         # Circular deps
npm run exports:check      # Unused exports
```

**For Documentation Changes**:

```bash
# Verify all links
npm run docs:cli:check     # CLI reference drift check

# If adding/modifying commands
npm run docs:cli           # Regenerate CLI reference
```

### 5.2 Pattern: Fixing Test Breakage from Code Changes

**Common Pattern** (observed in PR #466):

```typescript
// Test expected prompt at index 1 (old concatenated format)
expect(commandArgs[1]).toContain('Custom prompt from config');

// Fixed to index 2 (new separate argv format)
expect(commandArgs[2]).toContain('Custom prompt from config');
```

**Pattern**:

1. Fix the code (argument splitting)
2. Run tests → see failures
3. Update test assertions to match new code behavior
4. Commit together: `git add -A && git commit -m "fix: update tests for new arg format"`

### 5.3 Pattern: Pre-existing Failure Detection

**Important**: Distinguish between:

- **Failures caused by your fixes** → must fix
- **Pre-existing failures** → document, note in PR description

**Detection**:

```bash
# Stash all changes
git stash

# Run tests on original code
npm test

# If failures already exist, note in PR:
# "cliExecutionEngine.spec.ts 'validate prerequisites' test was
#  already failing before review fixes. Root cause: codemachine
#  binary not available in test environment."
```

---

## 6. Documentation-Specific Fix Patterns

### 6.1 Archive Branch Strategy (from reviewing-documentation-prs.md)

When removing stale docs:

```bash
# 1. Create archive branch from main
git checkout main
git checkout -b archive/post-v1.0.0-stale
git push origin archive/post-v1.0.0-stale

# 2. Back on feature branch, remove stale files
git checkout feature-branch
git rm -r docs/archive/
git rm docs/audit/AUDIT_REPORT.md
git commit -m "chore: remove stale docs from main"
```

**Reference in docs/README.md**:

```markdown
## Archived Documentation

- [Pre-v1.0.0 docs](../archive/pre-v1.0.0-docs)
- [Post-v1.0.0 stale docs](../archive/post-v1.0.0-stale)
```

### 6.2 DRY Principle for Config Documentation

**Pattern** (from architecture findings):

Don't write config schemas twice:

```markdown
# WRONG: Duplicated config structure in two docs

# guide/configuration.md defines one schema

# reference/config-schema.md defines another (drifts over time)

# RIGHT: Single source of truth

# reference/config-schema.md generated from code

# guide/configuration.md references with examples
```

### 6.3 Documentation Drift Prevention

**Pattern** (commit a87d776 demonstrates this):

Before approving docs PRs:

1. Verify feature names exist in source (check `RepoConfig.ts`, `.schema.json`)
2. Verify commands exist (check oclif manifest or `src/cli/commands/`)
3. Verify config structure matches actual implementation
4. Verify links resolve (80+ checked in PR #464)

---

## 7. Common Fix Scenarios

### 7.1 Scenario: Fixing Security Issues

**Pattern** (from PR #466 fixes):

```bash
# 1. Fix the vulnerability (e.g., argument injection)
git add src/adapters/codemachine/codeKachineCliAdapter.ts
git commit -m "fix: prevent argument injection by splitting argv"

# 2. Add test coverage for the fix
git add tests/unit/adapters/codemachine.spec.ts
git commit -m "test: add argument injection prevention test"

# 3. Document the fix (why it's needed)
git add docs/solutions/security/argument-injection.md
git commit -m "docs: document argument injection fix"

# 4. Use gt modify to maintain stack
gt modify --all
gt submit --no-interactive --publish
```

### 7.2 Scenario: Removing Dead Code

**Pattern** (from PR #466 fixes):

```bash
# 1. Identify unused code
npm run exports:check  # Shows unused exports
grep -r "WorkflowTemplateMapper" src/  # Verify no imports

# 2. Remove with context
git rm src/workflows/WorkflowTemplateMapper.ts
git rm tests/unit/workflows/WorkflowTemplateMapper.spec.ts
git commit -m "refactor: remove unused WorkflowTemplateMapper (335 LOC)"

# 3. Optional: Explain in extended commit body
git commit --amend  # Add rationale
```

### 7.3 Scenario: Fixing Documentation Factual Errors

**Pattern** (from commit a87d776):

```bash
# 1. Identify error (e.g., wrong env var name)
# OLD: CODEMACHINE_CLI_PATH
# NEW: CODEMACHINE_BIN_PATH (from binaryResolver.ts)

# 2. Fix all occurrences across docs
grep -r "CODEMACHINE_CLI_PATH" docs/ | xargs sed -i 's/CODEMACHINE_CLI_PATH/CODEMACHINE_BIN_PATH/g'

# 3. Verify against source
grep "CODEMACHINE_BIN_PATH" src/adapters/codemachine/binaryResolver.ts

# 4. Commit with rationale
git add docs/
git commit -m "docs: correct environment variable names

Fix three critical errors:
1. Replace CODEMACHINE_CLI_PATH → CODEMACHINE_BIN_PATH (verified in binaryResolver.ts)
2. Remove CODEMACHINE_LOG_LEVEL (does not exist in codebase)
3. Update config schema structure (matches RepoConfig.ts)"
```

---

## 8. Implementation Readiness Checklist

### 8.1 Before Starting Review Fixes

- [ ] All review findings documented in a single source (comment thread, issues, solution doc)
- [ ] Findings prioritized by severity/dependency
- [ ] Wave structure planned (independent → dependent → tests)
- [ ] Each wave reviewed for file-level conflicts
- [ ] Test suite runs cleanly on main branch

### 8.2 During Fix Implementation

- [ ] Stay on correct Graphite branch
- [ ] One logical fix per commit (Conventional Commits)
- [ ] Tests run and pass after each commit
- [ ] Use `git add -A && git commit -m "..."` (not `--amend`)
- [ ] Use `gt modify --all` before resubmitting (not `git rebase`)
- [ ] Verify stack status with `gt log --stack`

### 8.3 Before Resubmitting PR

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] `npm run deps:check` passes
- [ ] For docs: `npm run docs:cli:check` passes
- [ ] All commits follow Conventional Commits
- [ ] Commit messages reference review finding IDs
- [ ] No merge conflicts in upstack PRs

### 8.4 Submitting to Graphite

- [ ] Run `gt log --stack` to verify integrity
- [ ] Run `gt submit --no-interactive --publish`
- [ ] Verify PR links on Graphite dashboard
- [ ] Mark as ready if created as draft: `gh pr ready <num>`

---

## 9. Key Learning Points

### 9.1 Stack Discipline is Critical

**Most Common Mistakes**:

1. Using `git rebase -i` instead of `gt modify` → breaks Graphite tracking
2. Using `git reset --hard` → loses PR version history
3. Creating new branches from stack branches → orphans PRs
4. Directly pushing to main → branch protection blocks it

**Safe Pattern**: Always use `gt` commands for branch management; always use `git commit` (never `--amend`) for stacked changes.

### 9.2 Dependency Awareness Prevents Rework

Before fixing, ask:

- "Does this fix depend on another fix?" → defer to Wave 2+
- "Does this file touch 3+ other review findings?" → batch them
- "Does this remove code another fix depends on?" → reorder fixes

Example: Don't remove unused code (finding #6) before documenting strategy registration (finding #5), because #5 needs the code to document.

### 9.3 Documentation Drift is Preventable

Patterns that work:

- Single source of truth (generated schema docs, not hand-written)
- Cross-reference checklist in PR template
- Link validation in CI
- Command table verification (oclif manifest drift detection)

### 9.4 Testing Prevents Regressions

After each fix, run full suite:

```bash
npm test && npm run lint && npm run format:check
```

Don't skip lint/format — they catch subtle issues before merging.

---

## 10. References

**Primary Sources**:

- `/home/kinginyellow/projects/codemachine-pipeline/CONTRIBUTING.md` — Graphite workflow
- `/home/kinginyellow/projects/codemachine-pipeline/docs/solutions/code-review/reviewing-documentation-prs.md` — Doc review patterns
- `/home/kinginyellow/projects/codemachine-pipeline/docs/solutions/code-review/multi-agent-wave-resolution-pr-findings.md` — Dependency-aware parallel resolution

**Related Patterns**:

- [Submission Workflow](../../development/submission-workflow.md)
- [Release Branch Strategy](../../development/release-branch-strategy.md)
- [Conventional Commits](https://www.conventionalcommits.org/)

**Example Commits**:

- `a87d776` — Documentation factual error fix (3 critical corrections)
- `8fde38f` — Release blocker fixes (multiple findings)
- `c6bc63d` — Addressing remaining review findings

---

## Document Metadata

**Date**: 2026-02-15
**Status**: Documented
**Scope**: Graphite stacked PR review fix patterns
**Audience**: Contributors, reviewers, automation specialists
**Completeness**: ✅ Full patterns documented with examples
