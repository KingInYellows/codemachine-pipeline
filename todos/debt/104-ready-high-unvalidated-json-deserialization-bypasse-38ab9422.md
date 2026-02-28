# Unvalidated JSON Deserialization Bypasses Schema Across 10 Sites

**ID:** 104
**Status:** pending
**Severity:** high
**Category:** security
**Effort:** medium
**Confidence:** 0.88
**Scanner:** security-debt-scanner

## Affected Files

- `src/telemetry/rateLimitLedger.ts` line 130
- `src/telemetry/costTracker.ts` line 533
- `src/cli/utils/writeActionQueueReporter.ts` line 122
- `src/workflows/writeActionQueue.ts` line 657
- `src/workflows/contextSummarizer.ts` line 357
- `src/workflows/deployment/context.ts` line 87
- `src/workflows/resumeCoordinator.ts` lines 747-756
- `src/workflows/resumeQueueRecovery.ts` lines 58-65
- `src/workflows/branchProtectionReporter.ts` lines 241-242
- `src/workflows/approvalRegistry.ts` line 420

## Description

These call sites load JSON from run-directory files using TypeScript 'as' casts instead of Zod schema validation. The cast is a compile-time fiction: at runtime the parsed value is unknown and receives no structural validation. If a run-directory file is corrupted, externally modified, or injected by a TOCTOU attack, downstream code will process malformed data as if it were the expected type. This can cause undefined property accesses, incorrect business logic, or silent data corruption in telemetry and cost tracking.

## Suggested Remediation

For each affected site, define a Zod schema (or reuse an existing one) and replace JSON.parse(content) as Type with validateOrThrow(Schema, JSON.parse(content), 'boundary-label'). The validateOrThrow helper already exists in src/validation/helpers.ts. Prioritize files that affect financial data (costTracker), authorization decisions (approvalRegistry), and PR metadata (deployment/context.ts).
