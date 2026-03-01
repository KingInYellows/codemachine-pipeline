# Redundant Clean Up Temp File Comments in Atomic Write Pattern

**ID:** 202
**Status:** complete
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.88
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 748-775
- `src/workflows/queueStore.ts` lines 294-325
- `src/workflows/approvalRegistry.ts` lines 449-470
- `src/telemetry/metrics.ts` lines 525-538
- `src/workflows/validationRegistry.ts` lines 1-200

## Description

8 instances across 7 files use an inline comment '// Clean up temp file on error' or '// Atomic rename' immediately before boilerplate try/catch cleanup blocks. The atomic write-temp-then-rename pattern is a well-known idiom.

## Suggested Remediation

Remove inline comments from the cleanup catch block. Consider extracting atomicWriteFile(path, content) as a shared utility to eliminate the 7-site duplication of the identical 10-line pattern.
