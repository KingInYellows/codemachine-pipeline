# Hardcoded tmp Path Without Platform Abstraction in patchManager

**ID:** 120
**Status:** pending
**Severity:** low
**Category:** security
**Effort:** quick
**Confidence:** 0.82
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/patchManager.ts` line 424
- `src/workflows/patchManager.ts` line 641

## Description

The path /tmp is hardcoded in two locations. On Windows (which is a supported platform per package.json), /tmp may not exist. The correct cross-platform API is os.tmpdir(). Using os.tmpdir() also ensures the temp directory respects OS-level security settings and is on the same filesystem as the patch content, reducing symlink attack risk.

## Suggested Remediation

Replace path.join('/tmp', ...) with path.join(os.tmpdir(), ...) and add import \* as os from 'node:os' at the top of patchManager.ts. This is already the pattern used in the test files.
