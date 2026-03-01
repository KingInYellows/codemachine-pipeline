# isProcessRunning Uses Kill Signal Sentinel with Tri-State Boolean Null Return

**ID:** 170
**Status:** complete
**Severity:** low
**Category:** complexity
**Effort:** quick
**Confidence:** 0.72
**Scanner:** complexity-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 478-494

## Description

The isProcessRunning function uses the process.kill(pid, 0) sentinel pattern which relies on throw-for-control-flow. The cast (error as NodeJS.ErrnoException) after the 'code' in error guard is redundant. The tri-state boolean | null return type adds cognitive load for callers.

## Suggested Remediation

Return 'running' | 'stopped' | 'unknown' as a string union rather than boolean | null. Wrap the kill-0 pattern with a comment referencing the POSIX spec section. The redundant cast can be removed since 'code' in error already narrows the type.
