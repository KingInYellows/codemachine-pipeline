# resumeCoordinator Loads Queue Snapshot Without Structural Validation

**ID:** 114
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** quick
**Confidence:** 0.80
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/resumeCoordinator.ts` lines 745-768
- `src/workflows/resumeQueueRecovery.ts` lines 55-70

## Description

The queue snapshot is used for resume operations — reconstructing task state after a pipeline restart. Both files cast the parsed JSON without structural validation. The checksum field is compared for integrity, but only after trusting the parsed type (if the checksum field is missing from a malformed file, accessing rawSnapshot.checksum silently produces undefined, causing the integrity check to pass vacuously). The tasks dictionary is iterated directly from the cast object.

## Suggested Remediation

Add a lightweight Zod schema for the raw snapshot format (requiring checksum as a non-empty string, timestamp as an ISO string, and tasks as a non-null object) and validate before accessing fields. The existing QueueSnapshotSchema in queueStore.ts may be reusable or adaptable for this purpose.
