# God Module workflows resumeCoordinator ts 816 Lines

**ID:** 130
**Status:** complete
**Severity:** high
**Category:** architecture
**Effort:** medium
**Confidence:** 0.82
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/resumeCoordinator.ts` lines 1-816

## Description

resumeCoordinator.ts is 816 lines. It orchestrates queue validation, run state restoration, hash manifest verification, and the full resume decision logic. The module crosses persistence, telemetry, and queue subsystem boundaries while also containing the core resume algorithm. Its high line count and multi-concern responsibility make it difficult to unit-test in isolation.

## Suggested Remediation

Extract queue validation coordination to src/workflows/resumeQueueRecovery.ts (verify it is fully used), and run-state verification (hash manifest checks) to src/workflows/runStateVerifier.ts. Keep resumeCoordinator.ts as a thin orchestrator under 200 lines that delegates to these focused modules.
