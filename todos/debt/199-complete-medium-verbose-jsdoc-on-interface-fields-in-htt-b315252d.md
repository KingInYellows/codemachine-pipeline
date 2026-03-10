# Verbose JSDoc on Interface Fields in httpTypes ts and branchProtection ts

**ID:** 199
**Status:** complete
**Severity:** medium
**Category:** ai-patterns
**Effort:** small
**Confidence:** 0.88
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/adapters/http/httpTypes.ts` lines 1-97
- `src/adapters/github/branchProtection.ts` lines 22-230

## Description

httpTypes.ts (52% comment ratio) and branchProtection.ts (34 inline JSDoc annotations) apply per-field JSDoc uniformly to every interface field regardless of whether the field needs explanation. Fields like 'baseUrl', 'timeout', 'maxRetries', 'enabled', 'strict', and 'contexts' are self-documenting. The JSDoc adds zero information beyond what TypeScript types already express.

## Suggested Remediation

Remove per-field JSDoc where field name plus type is sufficient. Apply a team convention: JSDoc on interface fields only when clarifying units (e.g., milliseconds vs seconds), valid value constraints, or non-obvious semantics.
