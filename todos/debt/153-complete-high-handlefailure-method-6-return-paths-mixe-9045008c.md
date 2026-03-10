# handleFailure Method 6 Return Paths Mixed Retry Artifact Metric Concerns

**ID:** 153
**Status:** complete
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.85
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/cliExecutionEngine.ts` lines 551-647

## Description

The handleFailure private method in CLIExecutionEngine (~97 lines) mixes retry decision logic, conditional telemetry calls, artifact capture with its own try-catch, queue updates, and has 2 explicit return paths. The optional chaining for telemetry?.metrics? appears 4 times inside the method, spreading the concern.

## Suggested Remediation

Extract telemetry recording into a single recordTaskFailureTelemetry(strategy, updatedTask, canRetry, durationMs) helper. Split the canRetry branch into requeueForRetry() and markPermanentlyFailed() methods. This reduces the method to ~20 lines of coordination logic.
