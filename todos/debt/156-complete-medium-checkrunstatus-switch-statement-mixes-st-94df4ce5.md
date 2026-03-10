# checkRunStatus Switch Statement Mixes State Machine Logic with Inline Diagnostic Mutation

**ID:** 156
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.80
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/resumeCoordinator.ts` lines 219-271

## Description

The checkRunStatus function directly mutates the 'analysis' object inside a switch statement. The 'failed' case has a nested conditional bringing the depth to 3. As more statuses are added this pattern will grow poorly.

## Suggested Remediation

Return a ResumeDiagnostic[] from the function rather than mutating the analysis object. The caller merges the returned diagnostics, keeping the switch pure and testable.
