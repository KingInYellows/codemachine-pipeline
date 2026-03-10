# isLockStale Reads File Parses JSON Validates Shape and Checks Process in One Function

**ID:** 169
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.78
**Scanner:** complexity-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 496-516

## Description

The isLockStale function performs 4 distinct operations: I/O read, JSON parse, type validation, and process existence check. The blanket catch { return true } swallows all errors making debugging difficult. The function is called inside the hot acquireLock polling loop.

## Suggested Remediation

Split into readLockFile(lockPath) (returning a typed result or null on error) and isLockDataStale(lockData) (pure function). Narrow the catch to ENOENT only; re-throw unexpected errors so they surface to the caller.
