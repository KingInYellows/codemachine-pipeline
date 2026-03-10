# Inconsistent Error Hierarchy ErrorType and Provider Enums Have Two Homes

**ID:** 147
**Status:** complete
**Severity:** low
**Category:** architecture
**Effort:** quick
**Confidence:** 0.72
**Scanner:** architecture-scanner

## Affected Files

- `src/adapters/http/httpTypes.ts` line 1
- `src/core/sharedTypes.ts` lines 53-79

## Description

ErrorType and Provider enums are defined in src/adapters/http/httpTypes.ts and re-exported via adapters/http/client.ts, but also referenced in src/core/sharedTypes.ts. Callers of sharedTypes get the enums from core, while HTTP adapter callers get them from adapters/http/client — two paths to what should be the same canonical types.

## Suggested Remediation

Consolidate ErrorType and Provider into src/core/sharedTypes.ts as the single canonical definition. Remove the duplicate definitions from adapters/http/httpTypes.ts and have the adapter re-export from core. This establishes core as the authoritative source for cross-layer enum types.
