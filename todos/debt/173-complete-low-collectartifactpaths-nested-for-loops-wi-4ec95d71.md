# collectArtifactPaths Nested For Loops with Swallowed Catch in Async Context

**ID:** 173
**Status:** complete
**Severity:** low
**Category:** complexity
**Effort:** quick
**Confidence:** 0.70
**Scanner:** complexity-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 1026-1055

## Description

The collectArtifactPaths function has a blanket catch inside a for-await loop, silently swallowing all errors including potential permission errors. The nesting depth reaches 3 (for loop -> try -> for loop).

## Suggested Remediation

Narrow the catch to ENOENT only (isFileNotFound(error)). Use Promise.allSettled over the subdirectory array to process all in parallel and surface non-ENOENT failures as warnings rather than silently swallowing them.
