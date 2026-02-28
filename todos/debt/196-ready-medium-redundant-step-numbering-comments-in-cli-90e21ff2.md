# Redundant Step-Numbering Comments in CLI Commands and Workflows

**ID:** 196
**Status:** pending
**Severity:** medium
**Category:** ai-patterns
**Effort:** small
**Confidence:** 0.90
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/cli/commands/init.ts` lines 118-210
- `src/workflows/specComposer.ts` lines 1-400
- `src/workflows/prdAuthoringEngine.ts` lines 1-350
- `src/workflows/branchManager.ts` lines 1-400
- `src/workflows/taskPlanner.ts` lines 1-400
- `src/workflows/contextAggregator.ts` lines 1-350

## Description

96 instances of '// Step N:' comments across 10 files create artificial procedural narration for sequential code that has no ambiguity. All 7 steps in init.ts are already named by their function calls and method names. Same pattern appears in specComposer.ts (17 instances), prdAuthoringEngine.ts (13 instances), branchManager.ts (12 instances), taskPlanner.ts (10 instances), and contextAggregator.ts (9 instances).

## Suggested Remediation

Remove all '// Step N:' comments. If execution order is non-obvious, extract the steps into a named array or state machine rather than embedding ordinal comments.
