# Inline Telemetry Variable Declarations Duplicated Across 8 Command Files

**ID:** 179
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.85
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/plan.ts` lines 107-112
- `src/cli/commands/rate-limits.ts` lines 83-88
- `src/cli/commands/validate.ts` lines 102-108
- `src/cli/commands/status/index.ts` lines 101-106
- `src/cli/commands/resume.ts` lines 192-198
- `src/cli/commands/context/summarize.ts` lines 122-126
- `src/cli/commands/doctor.ts` lines 120-124

## Description

Eight command files declare the same five or six telemetry variable block at the top of run(): let logger, let metrics, let traceManager, let commandSpan, let runDirPath, const startTime. This variable declaration block is a prerequisite to using flushTelemetrySuccess/flushTelemetryError but is not part of any shared abstraction.

## Suggested Remediation

Consider a createCommandTelemetry() factory function that returns { logger, metrics, traceManager, commandSpan, runDirPath, startTime } as a mutable container. Commands would call this once and mutate its fields rather than declaring individual variables.
