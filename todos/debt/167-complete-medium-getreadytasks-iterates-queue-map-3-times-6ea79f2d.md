# getReadyTasks Iterates Queue Map 3 Times for Priority-Ordered Task Selection

**ID:** 167
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.82
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/cliExecutionEngine.ts` lines 661-699

## Description

The getReadyTasks method iterates the same Map 3 times to implement priority-ordered task selection. Each iteration also calls areDependenciesCompleted via consider(). With a large queue this is O(3n) with redundant dependency checks across passes.

## Suggested Remediation

Do a single pass, bucket tasks into three arrays by priority (running > pending > retryable), then concatenate and slice. This is O(n) and removes the duplicated iteration.
