# Verbose JSDoc Blocks on Interface Fields in writeActionQueueTypes ts 48 Percent

**ID:** 198
**Status:** pending
**Severity:** medium
**Category:** ai-patterns
**Effort:** small
**Confidence:** 0.90
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/workflows/writeActionQueueTypes.ts` lines 1-166

## Description

writeActionQueueTypes.ts has 79 comment lines out of 166 total (48%). Every interface field carries a single-line JSDoc comment that restates the field name in plain English with no additional information. Fields like 'owner: string', 'repo: string', 'provider: string', and 'status: WriteActionStatus' need no documentation.

## Suggested Remediation

Remove per-field JSDoc from interface definitions where the field name and type are self-explanatory. Retain JSDoc only for fields with non-obvious constraints, valid ranges, or unusual semantics (e.g., @deprecated).
