# loadValidationStatus Duplicates Identical Error-Logging Pattern 3 Times

**ID:** 162
**Status:** pending
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.88
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/status/data.ts` lines 247-327

## Description

The loadValidationStatus function contains two structurally identical try-catch blocks that differ only in path name, file label, and error_code string. The pattern 'if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')' appears 9 times across the data.ts file.

## Suggested Remediation

Consolidate the non-ENOENT check into a shared isUnexpectedFsError(error) predicate (one already exists: isFileNotFound in safeJson.ts). Extract a readJsonFile<T>(filePath, logger, errorCode) helper that handles the read + warn + return-undefined pattern used across all loaders.
