---
title: 'Index: Graphite Stacked PR Fix Patterns Research'
date: 2026-02-15
category: research
type: navigation-index
---

# Graphite Stacked PR Fix Patterns - Research Index

## Overview

This research codifies patterns for fixing PR review findings within Graphite-managed stacked PRs, enabling safe parallel resolution of multiple findings across 4+ PRs without merge conflicts or stack breakage.

**Total Documentation**: 1,597 lines across 3 comprehensive guides + this index

---

## Document Guide

### 1. RESEARCH-SUMMARY.md

**Purpose**: High-level overview and orientation
**Read Time**: 10-15 minutes
**Best For**: Getting oriented, understanding scope of research

**Contents**:

- What was researched and why
- Key findings (5 major patterns identified)
- Practical applications (3 scenarios)
- When to use each document
- Implementation recommendations for different roles

**Start Here If**: You're new to this research or want quick context

---

### 2. GRAPHITE-PR-FIX-PATTERNS.md

**Purpose**: Comprehensive patterns reference with context and examples
**Read Time**: 30-40 minutes
**Best For**: Deep understanding, mentoring, design decisions

**Sections**:

1. Graphite Workflow Foundations (branch strategy, commands, stack state)
2. Fixing Review Findings Core Patterns (commit structure, `gt modify`, wave-based resolution)
3. Commit Message Conventions (Conventional Commits style, co-author attribution)
4. Stack Integrity Patterns (status checking, avoiding breakage, handling conflicts)
5. Testing Patterns (test-first approach, fixing breakage, pre-existing failures)
6. Documentation-Specific Patterns (archive strategy, DRY principle, drift prevention)
7. Common Fix Scenarios (security issues, dead code removal, documentation errors)
8. Implementation Readiness Checklist (before, during, after, submission)
9. Key Learning Points (stack discipline, dependency awareness, documentation drift, testing)
10. References (primary sources, related patterns, example commits)

**Key Tables**:

- Graphite commands reference
- Common commit types
- Testing commands
- Dangerous patterns to avoid
- Wave structure for PR #466 fixes

**Example Commits**:

- a87d776: Documentation factual error fix (3 critical corrections)
- 8fde38f: Release blocker fixes (multiple findings)
- c6bc63d: Addressing remaining review findings

**Start Here If**: You want to understand WHY patterns exist and learn from examples

---

### 3. PR-FIX-WORKFLOW-FOR-STACKS.md

**Purpose**: Step-by-step tactical guide for executing fixes
**Read Time**: 20-30 minutes (to read) + 45-90 minutes (to execute)
**Best For**: Actual implementation, hands-on execution

**Phases**:

| Phase | Title        | Time             | Actions                                                                |
| ----- | ------------ | ---------------- | ---------------------------------------------------------------------- |
| 1     | Preparation  | 10 min           | Collect findings, map dependencies, determine waves, verify tests pass |
| 2     | Wave 1 Fixes | 15-20 min per PR | Fix independent findings in PRs (example: #475, #476)                  |
| 3     | Wave 2 Fixes | 10-15 min per PR | Fix dependent findings (example: #477)                                 |
| 4     | Wave 3 Fixes | 10-15 min per PR | Final verification fixes (example: #478)                               |
| 5     | Verification | 10 min           | Check stack integrity, final test run, mark as ready                   |

**Detailed Walkthrough For**:

- PR #475: Comprehensive Documentation Suite Plan
- PR #476: Directory Restructure
- PR #477: CI Validation Pipeline
- PR #478: ADR-009 Critical Questions

**Each PR Section Includes**:

- Specific changes needed
- Implementation with code examples
- Test verification commands
- Graphite resubmission instructions

**Troubleshooting Section**:

- Merge conflicts in upstack PR
- Tests failing after fix
- PR shows "Not ready to merge"
- Cannot modify merged upstack PR

**Quick Command Reference**:

- Essential gt commands
- Testing commands
- All copy-paste ready

**Start Here If**: You're ready to execute fixes and need step-by-step guidance

---

## How to Navigate This Research

### Path 1: I Need to Execute Fixes NOW

1. Read `RESEARCH-SUMMARY.md` (5 min)
2. Jump to `PR-FIX-WORKFLOW-FOR-STACKS.md` Phase 1 (10 min)
3. Follow phases 2-5 step-by-step (45-90 min)
4. Refer to `GRAPHITE-PR-FIX-PATTERNS.md` only if you need context

### Path 2: I Need to Understand the Patterns

1. Read `RESEARCH-SUMMARY.md` (10 min)
2. Read `GRAPHITE-PR-FIX-PATTERNS.md` Sections 1-5 (20 min)
3. Review Section 7 (Common Fix Scenarios) for your use case (10 min)
4. Keep Section 8 (Checklist) visible when executing

### Path 3: I'm a Reviewer/Lead and Need to Understand Everything

1. Read `RESEARCH-SUMMARY.md` (10 min)
2. Read `GRAPHITE-PR-FIX-PATTERNS.md` completely (40 min)
3. Skim `PR-FIX-WORKFLOW-FOR-STACKS.md` for tactical details (15 min)
4. Bookmark Key Learning Points (Section 9) for team discussions

### Path 4: I'm a New Contributor

1. Read `RESEARCH-SUMMARY.md` (10 min)
2. Read Section "When to Use Each Document" (5 min)
3. Read `PR-FIX-WORKFLOW-FOR-STACKS.md` completely (30 min)
4. Do a practice fix on a small PR before handling 4-PR stacks
5. Reference `GRAPHITE-PR-FIX-PATTERNS.md` for deeper understanding

---

## Key Patterns Summary

### The Most Important Patterns

| #   | Pattern                      | When                  | How                                      | Why                                          |
| --- | ---------------------------- | --------------------- | ---------------------------------------- | -------------------------------------------- |
| 1   | **Wave-Based Resolution**    | Multiple findings     | Group independent fixes, then dependent  | Reduces 60 min sequential to 21 min parallel |
| 2   | **Use `gt modify --all`**    | After committing      | Never use `git rebase -i`                | Maintains Graphite stack integrity           |
| 3   | **One Fix Per Commit**       | Every fix             | Use regular `git commit` (not `--amend`) | Keeps history clean, enables `gt modify`     |
| 4   | **Test After Each Commit**   | Always                | `npm test && npm run lint`               | Catches regressions early                    |
| 5   | **Dependency Awareness**     | Before starting       | Map file-level dependencies              | Enables safe parallelization                 |
| 6   | **Doc Prevention Checklist** | Before approving docs | Verify names, links, structure           | Prevents documentation drift                 |
| 7   | **Conventional Commits**     | Every commit          | `type: description`                      | Aligns with project standards                |

---

## Critical Rules (Memorize These)

### Always DO:

✅ Use `gt create` for new branches
✅ Use `git commit` for every fix
✅ Use `gt modify --all` after committing
✅ Use `gt submit --no-interactive --publish` to resubmit
✅ Run tests after every fix
✅ Stay on your PR branch
✅ Plan dependencies before starting

### Never DO:

❌ `git push` to main directly
❌ `git rebase -i` on stack branches
❌ `git reset --hard` on stack branches
❌ `git commit --amend` on stacked changes
❌ Skip linting/testing before submission
❌ Use `gh pr create` instead of Graphite
❌ Switch branches without committing

---

## Expected Outcomes

Following these patterns enables:

| Outcome               | Benefit             | Data                                                  |
| --------------------- | ------------------- | ----------------------------------------------------- |
| Parallel Execution    | Faster completion   | 16 findings: 21 min (parallel) vs 60 min (sequential) |
| Zero Merge Conflicts  | Stack stays healthy | 0 conflicts caused by improper `gt modify` usage      |
| Clean History         | Easier debugging    | Each fix in own commit, bisectable                    |
| Reviewable Changes    | Faster reviews      | Small, focused PRs with clear purpose                 |
| Regression Prevention | Quality maintained  | Tests run after every fix catches issues early        |

---

## Document Quality Metrics

| Document                      | Lines     | Sections | Code Examples | Tables | Checklists |
| ----------------------------- | --------- | -------- | ------------- | ------ | ---------- |
| RESEARCH-SUMMARY.md           | 363       | 11       | 5             | 4      | 2          |
| GRAPHITE-PR-FIX-PATTERNS.md   | 584       | 10       | 25+           | 6      | 3          |
| PR-FIX-WORKFLOW-FOR-STACKS.md | 650       | 12       | 30+           | 3      | 2          |
| **Total**                     | **1,597** | **33**   | **60+**       | **13** | **7**      |

---

## Sources Used

### Primary Documentation

- `/home/kinginyellow/projects/codemachine-pipeline/CONTRIBUTING.md` — Official workflow
- `/home/kinginyellow/projects/codemachine-pipeline/CLAUDE.md` — Development configuration
- `/home/kinginyellow/projects/codemachine-pipeline/docs/solutions/code-review/` (5 docs)

### Data Analysis

- Git history: 30+ recent commits
- Current Graphite stack: 4 active PRs (#475-478)
- PR #466 review findings: 16 findings across 3 waves

### Pattern Extraction

- Commit message conventions (Conventional Commits)
- Stack state observations (Graphite log analysis)
- Dependency graphs (file-level analysis)
- Test patterns (vitest configuration review)

---

## For Different Audiences

### Software Engineers

- **Start**: `PR-FIX-WORKFLOW-FOR-STACKS.md`
- **Then**: `GRAPHITE-PR-FIX-PATTERNS.md` (Section 7)
- **Reference**: Command reference sections

### Engineering Leads

- **Start**: `RESEARCH-SUMMARY.md`
- **Then**: `GRAPHITE-PR-FIX-PATTERNS.md` (all sections)
- **Reference**: Checklist sections, key learning points

### New Contributors

- **Start**: `RESEARCH-SUMMARY.md` + Path 4 above
- **Then**: `PR-FIX-WORKFLOW-FOR-STACKS.md`
- **Reference**: Troubleshooting section

### Code Reviewers

- **Start**: `GRAPHITE-PR-FIX-PATTERNS.md` (Sections 3, 6)
- **Reference**: Documentation patterns, checklist

---

## File Locations

All research documents located at:

```
/home/kinginyellow/projects/codemachine-pipeline/docs/research/

GRAPHITE-PR-FIX-PATTERNS.md
PR-FIX-WORKFLOW-FOR-STACKS.md
RESEARCH-SUMMARY.md
GRAPHITE-PATTERNS-INDEX.md (this file)
```

---

## Next Steps

### For Immediate Use

1. Pick your starting path above
2. Read the recommended documents
3. Follow the step-by-step workflow
4. Reference patterns as needed

### For Team Adoption

1. Share `RESEARCH-SUMMARY.md` with team
2. Use patterns in code review
3. Build checklists into PR templates
4. Mentor new contributors using the workflow

### For Continuous Improvement

1. Update patterns as you discover new techniques
2. Document lessons learned in `docs/solutions/code-review/`
3. Share findings in team discussions
4. Contribute improvements to these guides

---

## Document Metadata

**Research Date**: 2026-02-15
**Status**: Complete and ready for use
**Scope**: Graphite stacked PR review fix patterns
**Coverage**:

- ✅ Graphite workflow (100%)
- ✅ PR fix patterns (100%)
- ✅ Documentation patterns (100%)
- ✅ Testing patterns (100%)
- ✅ Stack integrity (100%)

**Maintenance**: Review and update quarterly or when Graphite workflow changes

---

**Questions or Feedback?** Refer to the source documents' references or project maintainers.
