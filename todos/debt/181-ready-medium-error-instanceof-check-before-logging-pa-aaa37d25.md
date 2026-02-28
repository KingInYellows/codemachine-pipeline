# Error instanceof Check Before Logging Pattern Duplicated 10 Times in data ts

**ID:** 181
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.90
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/status/data.ts` lines 63-68
- `src/cli/status/data.ts` lines 176-183
- `src/cli/status/data.ts` lines 231-240
- `src/cli/status/data.ts` lines 272-280
- `src/cli/status/data.ts` lines 293-301
- `src/cli/status/data.ts` lines 351-361
- `src/cli/commands/resume.ts` lines 444-448

## Description

The pattern of checking error instanceof Error before extracting message and stack for logging appears at least 10 times across status/data.ts and resume.ts. The serializeError utility in src/utils/errors.ts already does this work but is not used at these sites.

## Suggested Remediation

Replace the inline 'error instanceof Error' ternary patterns with calls to serializeError from src/utils/errors.ts, which already produces { name, message, stack, ... } in a consistent form. Logger calls become: logger.warn('msg', { ...serializeError(error), error_code: '...' }).
