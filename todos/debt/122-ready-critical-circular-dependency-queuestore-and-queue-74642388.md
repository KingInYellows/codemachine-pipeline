# Circular Dependency queueStore and queueTaskManager

**ID:** 122
**Status:** pending
**Severity:** critical
**Category:** architecture
**Effort:** medium
**Confidence:** 1.0
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/queueStore.ts` line 447
- `src/workflows/queueTaskManager.ts` line 34

## Description

workflows/queueStore.ts imports updateTaskInQueue and related functions from queueTaskManager.ts (line 447), while queueTaskManager.ts imports loadQueue from queueStore.ts (line 34). madge confirms this cycle. The comment in queueTaskManager acknowledges the issue ('still from queueStore for now'). loadQueue is used as a helper within filter functions in queueTaskManager.

## Suggested Remediation

Move the loadQueue logic that queueTaskManager depends on into queueCache.ts or a new queueLoader.ts module. Both queueStore and queueTaskManager can then import from that shared module without creating a cycle. Alternatively, pass loadQueue as an injected dependency to the filter functions in queueTaskManager.
