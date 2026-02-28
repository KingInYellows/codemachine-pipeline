# God Function Doctor run 158 Lines Deeply Nested Telemetry Conditionals

**ID:** 149
**Status:** pending
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.90
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/commands/doctor.ts` lines 110-268

## Description

The run() method in Doctor (~158 lines) has a double-nested try structure for optional telemetry, 9 synchronous diagnostic check calls plus 3 async check calls, metric recording, span management, and a manual process.exit() call. Cyclomatic complexity is estimated at 18-22 due to the telemetry optional branches plus per-check status conditions.

## Suggested Remediation

Extract telemetry initialization into a helper that returns optional telemetry handles (matching the pattern in start.ts). Move diagnostic check orchestration into a private runDiagnosticChecks() method. Use flushTelemetryError from telemetryLifecycle.ts instead of manual span teardown in the catch block.
