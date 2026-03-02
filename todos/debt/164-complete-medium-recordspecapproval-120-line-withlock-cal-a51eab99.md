# recordSpecApproval 120-Line withLock Callback with 5 IO Operations

**ID:** 164
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.80
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 731-864

## Description

The recordSpecApproval function (~134 lines) has all substantive logic inside a withLock callback. The callback itself performs 5 separate I/O operations (2 reads, 3 writes), error handling for missing index files, and metrics recording. The withLock callback is too large to be an anonymous function.

## Suggested Remediation

Extract the withLock callback body into a named private async function performSpecApprovalUnderLock(runDir, featureId, options, logger, metrics). This makes the lock scope explicit and the function independently testable.
