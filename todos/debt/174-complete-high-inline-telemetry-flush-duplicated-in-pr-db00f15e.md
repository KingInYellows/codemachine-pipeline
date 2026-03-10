# Inline Telemetry Flush Duplicated in pr status ts Not Using Shared Helper

**ID:** 174
**Status:** complete
**Severity:** high
**Category:** duplication
**Effort:** medium
**Confidence:** 0.97
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/pr/status.ts` lines 226-289
- `src/cli/utils/telemetryLifecycle.ts` lines 36-128

## Description

The PR Status command contains a ~30-line inline success/error telemetry flush block that duplicates the logic already extracted into flushTelemetrySuccess/flushTelemetryError in telemetryLifecycle.ts. The sibling pr/create.ts and pr/reviewers.ts and pr/disable-auto-merge.ts all use the shared helpers correctly. The pr/status.ts command is the outlier that was not migrated.

## Suggested Remediation

Replace the inline success/error flush blocks in pr/status.ts with calls to flushTelemetrySuccess and flushTelemetryError from cli/utils/telemetryLifecycle, matching the pattern used in pr/create.ts, pr/reviewers.ts, and pr/disable-auto-merge.ts.
