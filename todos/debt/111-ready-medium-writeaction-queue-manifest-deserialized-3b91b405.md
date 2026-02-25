# WriteAction Queue Manifest Deserialized Without Schema Validation

**ID:** 111
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.78
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/writeActionQueue.ts` lines 600-607
- `src/workflows/writeActionQueue.ts` lines 654-677
- `src/cli/utils/writeActionQueueReporter.ts` lines 120-129

## Description

The write-action queue stores actions that drive file writes and code modifications. Individual action lines are deserialized with a bare cast and the action_id is used immediately as a Map key and for downstream routing without validation. The queue manifest (which tracks counts and checksums) is similarly unvalidated. A corrupted or injected queue entry could cause write operations to be attributed to the wrong action_id or miss required fields that drive conditional logic.

## Suggested Remediation

Add Zod schemas for WriteAction and WriteActionQueueManifest. Use validateOrThrow for the manifest and validateOrResult (logging and skipping invalid entries) for individual action lines. This aligns with the existing behavior of queueValidation.ts which already validates queue entries using Zod schemas.
