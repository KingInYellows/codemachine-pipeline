# Boundary Violation resume ts Imports Business Logic from start ts

**ID:** 126
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** small
**Confidence:** 0.95
**Scanner:** architecture-scanner

## Affected Files

- `src/cli/commands/resume.ts` line 12
- `src/cli/commands/start.ts` lines 782-797

## Description

resume.ts imports the exported function buildExecutionStrategies from start.ts (line 12). Commands should not import implementation logic from sibling commands; this creates tight coupling between two CLI entry points and means start.ts is both a command definition and a library of shared logic. If start.ts is refactored, resume.ts breaks.

## Suggested Remediation

Move buildExecutionStrategies to src/workflows/executionStrategyBuilder.ts (or into src/workflows/executionStrategy.ts). Both start.ts and resume.ts import from the workflow layer, keeping command files as thin orchestration shells with no cross-command imports.
