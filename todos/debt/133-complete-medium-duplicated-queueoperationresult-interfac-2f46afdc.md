# Duplicated QueueOperationResult Interface Across Two Files

**ID:** 133
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.95
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/queueTypes.ts` lines 45-50
- `src/workflows/writeActionQueueTypes.ts` lines 156-161

## Description

The interface QueueOperationResult is defined independently in two files: queueTypes.ts (with field tasksAffected) and writeActionQueueTypes.ts (with field actionsAffected). Both have identical success, message, and errors fields. This near-duplicate leads to confusion about which type to use and makes future changes require updates in two places.

## Suggested Remediation

Define a single shared base interface (e.g., OperationResult) in a common types file and have each queue type extend or alias it with its specific optional count field. Alternatively, rename the writeActionQueueTypes version to WriteActionOperationResult to avoid the naming collision.
