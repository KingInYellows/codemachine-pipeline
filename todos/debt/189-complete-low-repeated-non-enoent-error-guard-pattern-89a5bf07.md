# Repeated Non-ENOENT Error Guard Pattern 8 Times in status data ts

**ID:** 189
**Status:** complete
**Severity:** low
**Category:** duplication
**Effort:** quick
**Confidence:** 0.93
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/status/data.ts` lines 177-183
- `src/cli/status/data.ts` lines 231-240
- `src/cli/status/data.ts` lines 271-280
- `src/cli/status/data.ts` lines 293-301
- `src/cli/status/data.ts` lines 351-361
- `src/cli/status/data.ts` lines 551-558
- `src/cli/status/data.ts` lines 576-585

## Description

The guard that logs unexpected (non-ENOENT) file read errors appears identically at least 8 times in status/data.ts. The pattern 'if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')' with the same logger.warn shape repeats in loadValidationStatus, loadPlanStatus, loadTraceabilityStatus, loadBranchProtectionStatus, loadRateLimitsStatus, and loadResearchStatus.

## Suggested Remediation

Extract a logIfUnexpectedFileError(error: unknown, logger, context: LogContext) helper locally in data.ts that performs the ENOENT guard and logs. All catch blocks in the file call this helper.
