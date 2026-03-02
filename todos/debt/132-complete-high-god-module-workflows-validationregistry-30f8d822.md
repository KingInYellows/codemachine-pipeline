# God Module workflows validationRegistry ts 570 Lines 19 Exports

**ID:** 132
**Status:** complete
**Severity:** high
**Category:** architecture
**Effort:** medium
**Confidence:** 0.82
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/validationRegistry.ts` lines 1-570

## Description

validationRegistry.ts is 570 lines with 19 exports. It manages validation command registration, execution, result storage, auto-fix eligibility checks, and manifest updates. The autoFixEngine.ts already exists as a sibling suggesting a prior split, but validation execution and registry management remain coupled.

## Suggested Remediation

Extract validation result persistence (read/write of validation artifacts) to src/workflows/validationStore.ts, keeping validationRegistry.ts focused on command registration and orchestration. Aim for under 300 lines per file.
