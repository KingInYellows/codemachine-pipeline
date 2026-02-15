---
title: "Step-by-Step PR Fix Workflow for Graphite Stacks"
date: 2026-02-15
category: research
tags: [graphite, workflow, pr-fixes, documentation]
scope: "Tactical guide for fixing 4+ PRs in a Graphite stack based on review findings"
---

# Step-by-Step PR Fix Workflow for Graphite Stacks

## Quick Reference: 4-PR Stack Fix Scenario

This guide walks through fixing multiple PRs in a Graphite stack where review findings span documentation accuracy, architecture decisions, and content organization.

**Scenario**: 4 stacked documentation PRs with review findings to fix.

---

## Phase 1: Preparation (Before Any Changes)

### 1.1 Assess All Review Findings

**Step 1: Collect findings from all 4 PRs**

```bash
# Review findings for each PR:
# PR #478 (ADR-009): 3 critical questions need answers
# PR #477 (CI validation): Config schema drift, execution engines drift
# PR #476 (Directory restructure): Link validation, TODO follow-up
# PR #475 (Comprehensive docs): Phase 0 sequencing, DRY violations
```

**Step 2: Create centralized findings document**

```bash
# Example structure:
docs/solutions/code-review/PR-BATCH-FIX-PLAN.md
- PR #478: Q2, Q4, Q5 verification needed
- PR #477: Verify 6 execution engines vs source code
- PR #476: Fix 8+ broken relative links
- PR #475: Split Phase 0, extract config schema to template
```

### 1.2 Determine Fix Dependencies

**Step 3: Map dependencies**

```
PR #476 (directory restructure) ←dependency← PR #477 (CI validation)
  Why: PR #477 adds config validation, PR #476 reorganizes where it lives

PR #477 (CI validation) ←dependency← PR #478 (ADR-009)
  Why: PR #478 answers critical questions that PR #477 documents

PR #478 (ADR-009) ←dependency← PR #475 (Comprehensive docs)
  Why: PR #475 defines doc structure that ADR-009 references
```

**Step 4: Identify safe parallelization**

```
Wave 1 (independent): Fix PR #475, PR #476
  - 475: Verify Phase 0 sequencing, no dependency on others
  - 476: Update broken links, isolated edits

Wave 2 (after Wave 1): Fix PR #477
  - Depends on PR #475 directory structure stabilized
  - Can reference PR #476 link fixes

Wave 3 (after Wave 2): Fix PR #478
  - Depends on all doc structure stable
```

### 1.3 Test Current State

**Step 5: Verify tests pass on main**

```bash
cd /path/to/codemachine-pipeline
git checkout main
npm ci
npm test
npm run lint
```

**Output**: Baseline of passing tests before any changes.

---

## Phase 2: Fix Wave 1 (Independent Fixes)

### 2.1 Fix PR #475 (Comprehensive Documentation Suite Plan)

**Step 1: Checkout PR #475 branch**

```bash
# Find the branch
gt log --stack
# Identify: 02-15-docs_comprehensive_documentation_suite_plan

git checkout 02-15-docs_comprehensive_documentation_suite_plan
git pull origin 02-15-docs_comprehensive_documentation_suite_plan
```

**Step 2: Identify changes needed**

From architecture review findings:
1. Phase 0 sequencing: Split fact-check (PR #478) from restructuring (PR #476)
2. DRY violation: Config schema appears in guide AND reference — use template
3. Command documentation: Auto-generate from oclif manifest, don't hand-write

**Step 3: Implement fixes**

```bash
# Fix 1: Update Phase 0 structure in plan
# File: docs/plans/2026-02-15-docs-comprehensive-documentation-suite-plan.md

# Change:
# Phase 0: Architecture Foundation & Restructuring (Weeks 1-2)
#   - Restructure directory hierarchy
#   - Answer critical architecture questions
#   - Validate documentation accuracy

# To:
# Phase 0a: Critical Questions & Requirements (Week 1)
#   - Answer 15 critical architecture questions (ADR-009)
#   - Verify environment variable names
#   - Validate execution engines list
#
# Phase 0b: Directory Restructuring (Week 2)
#   - Restructure 16→7 directories
#   - Migrate content to new hierarchy
#   - Validate all relative links

git add docs/plans/2026-02-15-docs-comprehensive-documentation-suite-plan.md
git commit -m "docs: clarify Phase 0 sequencing (split fact-check from restructuring)"
```

```bash
# Fix 2: DRY violation — extract config schema to template
# Create single source of truth:

# New file: docs/templates/CONFIG_SCHEMA_TEMPLATE.md
# Contents: Auto-generated from RepoConfig.ts or schema.json

# Update reference docs to use template:
# docs/reference/schema.md → includes CONFIG_SCHEMA_TEMPLATE.md
# docs/guide/configuration.md → includes CONFIG_SCHEMA_TEMPLATE.md with examples

git add docs/templates/CONFIG_SCHEMA_TEMPLATE.md
git add docs/reference/schema.md
git add docs/guide/configuration.md
git commit -m "refactor: extract config schema to single source of truth"
```

**Step 4: Test fixes**

```bash
npm run lint
npm run format:check

# For docs, verify no new issues:
npm run docs:cli:check
```

**Step 5: Use gt modify to maintain stack**

```bash
gt modify --all
```

This rebases any upstack branches (PR #476, #477, #478) onto your changes.

**Step 6: Resubmit PR #475**

```bash
gt submit --no-interactive --publish
```

Graphite creates a new version of PR #475.

---

### 2.2 Fix PR #476 (Directory Restructure)

**Step 1: Checkout PR #476 branch**

```bash
# At this point, you're still on PR #475 branch
# Graphite automatically rebased PR #476 upstack
# Move to next branch:

git checkout 02-15-docs_restructure_docs_directory_16_7_top-level_dirs_
git pull origin
```

**Step 2: Identify changes needed**

From architecture review:
1. Broken relative links (80+ found in validation)
2. TODO items in directory structure need follow-up
3. Missing index files in new directories

**Step 3: Implement fixes**

```bash
# Fix 1: Validate and correct relative links
# Use link checker or manual grep + verify

# Find broken links:
grep -r "\[.*\](.*)" docs/ | grep -v "http" | \
  while read line; do
    # Extract link
    # Verify file exists
    # Update if broken
  done

# Example:
# OLD: [ADR Index](../adr/README.md)
# NEW: [ADR Index](../../adr/README.md)  # Adjusted for new depth

git add docs/guide/README.md
git add docs/reference/README.md
git add docs/playbooks/README.md
git commit -m "fix: correct relative links for new directory structure"
```

```bash
# Fix 2: Add missing index files
# Each top-level directory needs README.md explaining purpose

# Create: docs/guide/README.md
# Create: docs/reference/README.md
# Create: docs/playbooks/README.md
# Update: docs/solutions/README.md
# etc.

git add docs/*/README.md
git commit -m "docs: add index files to directory hierarchy"
```

**Step 4: Test**

```bash
npm run lint
npm run format:check
```

**Step 5: Modify and resubmit**

```bash
gt modify --all
gt submit --no-interactive --publish
```

---

## Phase 3: Fix Wave 2 (Dependent Fixes)

### 3.1 Fix PR #477 (CI Validation Pipeline)

**Step 1: Checkout PR #477**

```bash
git checkout 02-15-docs_add_ci_validation_pipeline_for_documentation_quality
git pull origin
```

At this point, PR #475 and #476 are committed, and your branch is rebased on those.

**Step 2: Identify changes needed**

From architecture review:
1. Config schema referenced in validation — verify it matches actual schema
2. Execution engines list in validation — verify against source code
3. Link validation pipeline — verify it catches broken links

**Step 3: Implement fixes**

```bash
# Fix 1: Verify execution engines against source
# From reviewing-documentation-prs.md pattern:
# README listed: claude, codex, opencode, cursor, auggie, ccr (6 engines)
# Actually in code: claude, codex, openai (3 engines)

# Source file: src/core/config/RepoConfig.ts (or schema.json)
grep -A 20 "ExecutionEngineType" src/core/config/RepoConfig.ts

# Update validation pipeline:
git add .github/workflows/ci-docs-validation.yml
git commit -m "fix: validate execution engines against actual source code

Update CI validation to verify against RepoConfig.ts instead of hardcoded list.
Ensures config schema stays in sync with implementation."
```

```bash
# Fix 2: Ensure config schema referenced in validation
# matches the schema in docs/reference/

# Validation script should reference:
# - docs/templates/CONFIG_SCHEMA_TEMPLATE.md (auto-generated from code)
# - NOT hand-written schema copies

git add scripts/validation/check-docs-config.js
git commit -m "chore: update validation to use generated config schema template"
```

**Step 4: Test**

```bash
npm test
npm run lint
```

**Step 5: Modify and resubmit**

```bash
gt modify --all
gt submit --no-interactive --publish
```

---

## Phase 4: Fix Wave 3 (Final Fixes)

### 4.1 Fix PR #478 (ADR-009 Critical Questions)

**Step 1: Checkout PR #478**

```bash
git checkout 02-15-docs_answer_critical_architecture_questions_for_documentation
git pull origin
```

**Step 2: Identify changes needed**

From architecture review findings:
1. Q2: Config discovery mechanism — verify documentation
2. Q4: Approval mechanics — verify 6 gates documented
3. Q5: Required fields — verify schema matches
4. Q7: Queue locking — verify thread-safety claims
5. Q9: Queue backup — verify automatic recovery documented
6. Q10: Credential precedence — verify environment variable indirection explained
7. Q11: Debug logging — verify --verbose, --json behavior documented
8. Q13: Migration from v1.0 — verify upgrade path

**Step 3: Implement fixes**

```bash
# Fix 1: Verify Config Discovery
# From queue design or config loader

# Verify:
# 1. Config at git root only (no tree walk)
# 2. Path is .codepipe/codepipe.json

# Source file: src/core/config/configLoader.ts
grep -B 5 -A 10 "configPath" src/core/config/configLoader.ts

# Update ADR if claims don't match:
git add docs/adr/ADR-009-critical-questions.md
git commit -m "docs(adr-009): verify config discovery path is fixed at git root"
```

```bash
# Fix 2-7: Verify each answer against implementation
# Create a verification checklist:

cat > /tmp/verify-questions.sh << 'EOF'
#!/bin/bash

echo "Q2: Config discovery"
grep -r "configPath" src/core/config/ | head -3

echo "Q4: Approval mechanics"
grep -r "approval\|gate" src/workflows/ | head -3

echo "Q5: Required fields"
grep -A 5 "required:" src/core/config/RepoConfig.ts | head -5

# ... repeat for Q7, Q9, Q10, Q11, Q13
EOF

bash /tmp/verify-questions.sh

# Update ADR-009 with verified answers:
git add docs/adr/ADR-009-critical-questions.md
git commit -m "docs(adr-009): verify all 15 critical questions with source code cross-references"
```

**Step 4: Test**

```bash
npm run lint
npm run format:check

# For docs changes specifically:
npm run docs:cli:check
```

**Step 5: Modify and resubmit (final)**

```bash
gt modify --all
gt submit --no-interactive --publish
```

---

## Phase 5: Verification & Stack Completion

### 5.1 Verify Stack Integrity

**Step 1: Check Graphite dashboard**

```bash
gt log --stack

# Expected output:
# ◯ 02-15-docs_answer_critical_architecture_questions_for_documentation
#   PR #478 - docs: answer 15 critical architecture questions
#
# ◯ 02-15-docs_add_ci_validation_pipeline_for_documentation_quality
#   PR #477 - docs: add CI validation pipeline
#
# ◯ 02-15-docs_restructure_docs_directory_16_7_top_level_dirs_
#   PR #476 - docs: restructure directory hierarchy
#
# ◯ 02-15-docs_comprehensive_documentation_suite_plan
#   PR #475 - docs: comprehensive documentation suite plan (corrected)
```

All PRs should show as "Ready to merge" with proper stack ordering.

### 5.2 Final Test Run

**Step 2: Run full suite on final branch**

```bash
# Go to newest (upstack) PR branch
git checkout 02-15-docs_answer_critical_architecture_questions_for_documentation

# Run full validation
npm ci
npm test
npm run lint
npm run format:check
npm run deps:check
npm run exports:check
npm run docs:cli:check

# All should pass ✅
```

### 5.3 Mark as Ready

**Step 3: Mark draft PRs as ready (if needed)**

```bash
# If any PRs were created as draft:
gh pr ready 475
gh pr ready 476
gh pr ready 477
gh pr ready 478

# Verify with:
gh pr view 478  # Should show "OPEN" not "DRAFT"
```

### 5.4 Wait for CI

**Step 4: Await GitHub Actions CI**

CI pipeline will:
- Run all tests (unit, integration, smoke)
- Run linters (ESLint, Prettier)
- Build Docker image
- Publish docs (if applicable)

All must pass before merge.

---

## Troubleshooting Common Issues

### Issue 1: Merge Conflict in Upstack PR

**Symptom**: After `gt modify`, upstack PR shows merge conflict.

**Solution**:
```bash
# This is normal and expected after large changes
# Graphite handles it automatically when you resubmit

gt submit --no-interactive --publish

# If conflict persists:
# 1. Ensure current branch is clean
git status  # Should be clean

# 2. Use gt restack to re-align all branches
gt restack

# 3. Resubmit
gt submit --no-interactive --publish
```

### Issue 2: Tests Fail After Fix

**Symptom**: `npm test` fails after committing fix.

**Solution**:
```bash
# 1. Run specific failing test to understand
npm run test:integration -- path/to/test.spec.ts

# 2. Update test OR code (don't assume code is wrong)
# Check if test expectations need updating

# 3. Commit test fix separately
git add tests/unit/...
git commit -m "test: update test expectations after code fix"

# 4. Verify full suite passes
npm test

# 5. Only then use gt modify
gt modify --all
```

### Issue 3: Graphite Shows "Not Ready to Merge"

**Symptom**: PR marked as not ready despite all changes made.

**Solution**:
```bash
# 1. Check PR version
gt log --stack

# 2. Check if there are uncommitted changes
git status  # Should be clean

# 3. Resubmit current state
gt submit --no-interactive --publish

# 4. Verify with:
gh pr view <pr-number>

# Status should show "OPEN" and "Ready to merge"
```

### Issue 4: Cannot Modify Merged Upstack PR

**Symptom**: Trying to fix merged PR that's now in main.

**Solution**:
```bash
# If PR already merged to main, can't modify its stack
# Must instead:
# 1. Create new branch from main
gt create new-fix -m "fix: additional review findings"

# 2. Apply fixes to new stack
# 3. Submit as separate PR(s)
```

---

## Quick Command Reference

### Essential gt Commands

```bash
# View current stack
gt log --stack

# View all stacks
gt log

# Create new branch
gt create <name> -m "message"

# Commit changes (use git, not gt)
git add .
git commit -m "type: message"

# Modify upstack PRs after local change
gt modify --all

# Resubmit to Graphite
gt submit --no-interactive --publish

# Jump to next branch upstack
gt up

# Jump to previous branch downstack
gt down

# Sync with main (before new work)
gt sync
```

### Testing Commands

```bash
# Full test suite
npm test

# Lint check
npm run lint

# Format check
npm run format:check

# Linting + format in one
npm run format:check && npm run lint

# Circular dependency check
npm run deps:check

# Unused exports check
npm run exports:check

# CLI reference drift (for docs)
npm run docs:cli:check
```

---

## Key Takeaways

1. **Plan dependencies before starting** — avoid rework by understanding fix order
2. **Use waves** — parallelize independent fixes, sequence dependent ones
3. **One fix per commit** — keep history clean and reversible
4. **Always use `gt modify`** — never `git rebase -i` or `git reset --hard`
5. **Test after each fix** — don't batch testing to the end
6. **Stay on your branch** — don't switch branches unnecessarily
7. **Verify with `gt log --stack`** — ensures stack integrity before submission

---

## Document Metadata

**Date**: 2026-02-15
**Type**: Tactical Guide
**Scope**: 4-PR Graphite stack fix workflow
**Status**: Ready for implementation
**Completeness**: ✅ Full step-by-step workflow

