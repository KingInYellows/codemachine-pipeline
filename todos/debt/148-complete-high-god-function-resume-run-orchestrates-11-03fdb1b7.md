# God Function Resume run Orchestrates 11 Distinct Concerns

**ID:** 148
**Status:** pending
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.92
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/commands/resume.ts` lines 183-463

## Description

The run() method in the Resume command (~280 lines) conflates telemetry lifecycle, state analysis, execution engine wiring, output rendering, and error recovery into a single function body. It has more than 5 distinct return paths and manually re-implements telemetry flushing in both the happy path and three catch branches.

## Suggested Remediation

Extract telemetry lifecycle into a shared wrapper (already partially done in telemetryLifecycle.ts). Move execution engine wiring into a dedicated private method mirroring the pattern in start.ts runTaskExecution. Consolidate the catch block telemetry flush with flushTelemetryError (already used in start.ts).
