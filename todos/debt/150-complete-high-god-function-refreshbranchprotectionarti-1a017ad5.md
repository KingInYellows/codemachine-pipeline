# God Function refreshBranchProtectionArtifact 140 Lines 8 Early Returns

**ID:** 150
**Status:** pending
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.87
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/status/data.ts` lines 776-920

## Description

The function at lines 776-920 in data.ts has 8 guard-return paths before its main logic, then delegates to an inline async closure 'executeRefresh' of 50 lines, then wraps the call in a tracing conditional. The combination makes the actual flow non-obvious and the function exceeds 100 lines while mixing concerns (PR metadata loading, adapter construction, report building, mismatch detection, tracing).

## Suggested Remediation

Extract 'executeRefresh' as a named module-level async function. Move guard validation into a single validateBranchProtectionPreconditions() helper that returns a result object rather than relying on multiple early returns. The tracing wrapper can be applied at the call site.
