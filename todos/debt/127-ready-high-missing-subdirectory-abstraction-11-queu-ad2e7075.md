# Missing Subdirectory Abstraction 11 Queue Files Scattered in workflows Root

**ID:** 127
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** large
**Confidence:** 0.92
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/queueStore.ts` lines 1-455
- `src/workflows/queueTaskManager.ts` lines 1-304
- `src/workflows/queueTypes.ts` lines 1-347
- `src/workflows/queueCache.ts` lines 1-151
- `src/workflows/queueCompactionEngine.ts` lines 1-334
- `src/workflows/queueIntegrity.ts` lines 1-220
- `src/workflows/queueMemoryIndex.ts` lines 1-505
- `src/workflows/queueOperationsLog.ts` lines 1-534
- `src/workflows/queueSnapshotManager.ts` lines 1-319
- `src/workflows/queueV2Api.ts` lines 1-103
- `src/workflows/queueValidation.ts` lines 1-138

## Description

The queue subsystem consists of 11 separate files totalling 3410 lines, all living at the root of src/workflows/. The deployment subsystem already received the same treatment and was correctly placed in src/workflows/deployment/. The queue files have no namespace separation from the 30+ other workflow files, making the directory hard to navigate and increasing the likelihood of inappropriate cross-queue-subsystem coupling.

## Suggested Remediation

Create src/workflows/queue/ subdirectory and move all 11 queue files into it, following the same pattern as src/workflows/deployment/. Add a src/workflows/queue/index.ts barrel that re-exports the public API. Create a backward-compat re-export at src/workflows/queueStore.ts pointing to the new location.
