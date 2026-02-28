# God Module workflows cliExecutionEngine ts 731 Lines

**ID:** 140
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.78
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/cliExecutionEngine.ts` lines 1-731

## Description

cliExecutionEngine.ts is 731 lines — 46% over the 500-line threshold — handling task dispatch, retry logic, dependency checking, telemetry recording, queue updates, and execution lifecycle management. The file mixes infrastructure concerns (queue I/O, telemetry) with the core execution loop algorithm.

## Suggested Remediation

Extract the retry/dependency-checking logic to src/workflows/executionDependencyResolver.ts and the telemetry-recording helper functions to src/workflows/executionTelemetryRecorder.ts. Keep cliExecutionEngine.ts as the main execution loop under 300 lines.
