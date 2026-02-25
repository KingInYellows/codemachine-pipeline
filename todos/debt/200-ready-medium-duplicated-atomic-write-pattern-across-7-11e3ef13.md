# Duplicated Atomic Write Pattern Across 7 Files No Shared Utility

**ID:** 200
**Status:** pending
**Severity:** medium
**Category:** ai-patterns
**Effort:** medium
**Confidence:** 0.87
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 745-775
- `src/workflows/queueStore.ts` lines 293-325
- `src/workflows/approvalRegistry.ts` lines 446-470
- `src/telemetry/metrics.ts` lines 519-539
- `src/workflows/queueSnapshotManager.ts` lines 1-319

## Description

The write-temp-then-rename pattern is duplicated identically across at least 7 files: runDirectoryManager.ts, queueStore.ts, approvalRegistry.ts, metrics.ts, queueSnapshotManager.ts, validationRegistry.ts, and deployment/context.ts. Each implementation follows the identical structure: write to temp, sync, rename, cleanup on error.

## Suggested Remediation

Extract a shared atomicWriteFile(filePath: string, content: string): Promise<void> utility in src/utils/ and replace all 7+ sites. Reduces ~70 lines of duplicated boilerplate to a single tested utility.
