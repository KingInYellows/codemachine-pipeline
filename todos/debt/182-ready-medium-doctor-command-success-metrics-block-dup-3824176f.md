# Doctor Command Success Metrics Block Duplicated Instead of Using flushTelemetrySuccess

**ID:** 182
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.90
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/doctor.ts` lines 212-246
- `src/cli/utils/telemetryLifecycle.ts` lines 36-74

## Description

The doctor.ts success path manually replicates the full telemetry flush sequence (~30 lines) rather than calling flushTelemetrySuccess. The flushTelemetryError is already used by doctor.ts in its catch block, making the inconsistency more apparent.

## Suggested Remediation

Replace the inline success flush block in doctor.ts with a call to flushTelemetrySuccess, passing the non-zero exitCode as context. Note: the success helper uses exit_code '0' but doctor can succeed with exit_code != 0, so the helper may need an optional exitCode parameter or the attribution remains manual.
