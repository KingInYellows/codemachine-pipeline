# acquireLock Combines Polling Loop Stale-Lock Detection and Error Classification

**ID:** 159
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.77
**Scanner:** complexity-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 383-424

## Description

The acquireLock function uses a while (Date.now() - startTime < timeout) spin-poll loop with a try-catch inside, error-code inspection inside the catch, and async stale-lock removal mid-loop. Cyclomatic complexity is approximately 7, but this is a critical path function called before every manifest update.

## Suggested Remediation

Extract the loop body logic into a private attemptLockAcquire(lockPath) that returns a discriminated union (acquired | stale | contended). The while loop then maps the result to continue/break/throw, making the polling strategy and error classification independently readable.
