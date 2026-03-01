# validatePrerequisites CLIExecutionEngine Mixes CLI Path Workspace and Queue Checks

**ID:** 163
**Status:** pending
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.78
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/cliExecutionEngine.ts` lines 202-254

## Description

The validatePrerequisites method (~53 lines) performs 4 distinct checks across different concerns: binary availability, workspace filesystem, strategy registration, and queue state. The CLI availability check further has an inner strategies.some() branch. Each check returns different types of results but they are all funneled through errors/warnings arrays.

## Suggested Remediation

Extract each concern into a private checkXxx(): { errors: string[], warnings: string[] } helper. The validatePrerequisites body merges the arrays from each helper, becoming a straightforward aggregation.
