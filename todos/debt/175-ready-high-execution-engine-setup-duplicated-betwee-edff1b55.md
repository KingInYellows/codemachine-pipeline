# Execution Engine Setup Duplicated Between start ts and resume ts

**ID:** 175
**Status:** complete
**Severity:** high
**Category:** duplication
**Effort:** medium
**Confidence:** 0.95
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/start.ts` lines 610-679
- `src/cli/commands/resume.ts` lines 315-375

## Description

The block that builds the mergedConfig, validates execution config existence, calls buildExecutionStrategies, constructs CLIExecutionEngine, and validates prerequisites is copy-pasted nearly identically in start.ts (runTaskExecution) and resume.ts. The only differences are error type and the max_parallel_tasks merge logic. This ~30-line block should be a shared function.

## Suggested Remediation

Extract a shared buildAndValidateExecutionEngine helper (or extend buildExecutionStrategies) into a shared module (e.g., src/cli/utils/executionEngine.ts) that accepts runDir, mergedConfig, telemetry, and logger, and returns both the engine instance and validated strategies. Both start.ts and resume.ts call this helper.
