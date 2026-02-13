---
title: "Reviewing Documentation PRs: Agent Selection and Factual Accuracy"
date: 2026-02-12
category: code-review
tags:
  - documentation
  - code-review
  - factual-accuracy
  - readme
  - drift-prevention
applies_to:
  - documentation PRs
  - README maintenance
  - docs/README.md index updates
severity: medium
pr: "#464"
---

# Reviewing Documentation PRs

## Problem

Documentation can drift from source code when README files and architecture descriptions are not validated against the live codebase during review. Standard code review agents focus on code quality, style, and logic but miss doc-specific issues — particularly factual inaccuracies in feature tables, command listings, and configuration examples.

**Example**: PR #464 slimmed README.md from 917 to 244 lines. The original README listed 6 execution engines (`claude`, `codex`, `opencode`, `cursor`, `auggie`, `ccr`), but only 3 actually exist in the source code (`claude`, `codex`, `openai`). This factual error was carried forward into the trimmed version and would have shipped without a targeted review agent cross-referencing claims against `RepoConfig.ts`, `taskMapper.ts`, and `repo_config.schema.json`.

## Solution: 5-Agent Review Team for Docs PRs

Standard review workflows use 8-12 agents. For docs-only PRs, use this specialized 5-agent team:

| Agent | Role | Value |
|-------|------|-------|
| `comment-analyzer` | Cross-reference claims against source code | Catches factual errors (P1) |
| `code-simplicity-reviewer` | Identify redundancy, YAGNI, bloat | Drives content reduction (P2) |
| `pattern-recognition-specialist` | Check formatting consistency | Catches style drift (P3) |
| `architecture-strategist` | Validate overall doc structure | Confirms hierarchy is sound |
| `security-sentinel` | Audit for information disclosure | Verifies no secrets leaked |

**Skip these for docs-only PRs**: Rails reviewers, data integrity guardian, performance oracle, migration experts, Turbo experts, DHH reviewer, deployment verification. These are irrelevant and add ~40% execution time with zero findings.

## What Each Agent Catches

### comment-analyzer (most valuable)
- Feature/engine tables listing non-existent capabilities
- CLI command tables missing or including phantom commands
- Broken relative links (verified 80+ in PR #464)
- Project structure trees that don't match the filesystem
- Code examples referencing non-existent APIs

### code-simplicity-reviewer
- Redundant quick-links tables that duplicate the docs index
- Internal-detail feature bullets that add noise (e.g., "Queue V2 Optimization" as a top-level feature)
- YAGNI documentation (advertising unimplemented commands)
- Subcommand rows that could be consolidated

### pattern-recognition-specialist
- Table formatting inconsistencies (space-padded vs compact)
- Inline separator styles (pipe delimiters vs prose)
- Label style mismatches between files (bold vs plain)
- Naming convention drift (hyphenated vs underscored filenames)

## Prevention Checklist

Before merging any documentation PR:

- [ ] All feature/engine/command names verified against source code
- [ ] All relative links resolve to existing files
- [ ] Command table matches oclif manifest or equivalent
- [ ] Project structure tree matches actual directory layout
- [ ] Example tokens use placeholder values (`ghp_xxxxx`, not real tokens)
- [ ] No redundant sections that duplicate `docs/README.md` content
- [ ] Code examples reference actual function signatures

## Archive Branch Strategy

When removing stale docs from `main`, preserve them on a named archive branch:

```bash
# 1. Create archive branch from main
git checkout main
git checkout -b archive/post-v1.0.0-stale
git push origin archive/post-v1.0.0-stale

# 2. Back on feature branch, remove stale files
git checkout feature-branch
git rm -r docs/archive/
git rm docs/audit/AUDIT_REPORT.md
# etc.
```

Multiple archive branches can coexist (e.g., `archive/pre-v1.0.0-docs`, `archive/post-v1.0.0-stale`). Reference both in `docs/README.md`.

## Related

- [Submission Workflow](../../development/submission-workflow.md) — PR creation process
- [Release Branch Strategy](../../development/release-branch-strategy.md) — What gets published vs. kept on main
- [Documentation Cleanup Plan](../../plans/2026-02-12-chore-documentation-cleanup-plan.md) — The plan that produced these learnings
