# Oclif Error Re-Throw Guard Copy-Pasted in 12 Command Catch Blocks

**ID:** 178
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.98
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/plan.ts` lines 199-201
- `src/cli/commands/doctor.ts` lines 258-260
- `src/cli/commands/pr/create.ts` lines 352-354
- `src/cli/commands/pr/reviewers.ts` lines 225-227
- `src/cli/commands/pr/disable-auto-merge.ts` lines 206-208
- `src/cli/commands/pr/status.ts` lines 294-296
- `src/cli/commands/status/index.ts` lines 249-251
- `src/cli/commands/validate.ts` lines 271-273
- `src/cli/commands/rate-limits.ts` lines 195-197
- `src/cli/commands/resume.ts` lines 453-455
- `src/cli/commands/context/summarize.ts` lines 282-284

## Description

The pattern for re-throwing oclif errors to preserve exit codes appears in 12 command files: 'if (error && typeof error === 'object' && 'oclif' in error) { throw error; }'. This guard belongs in a shared rethrowIfOclifError utility or as part of the flushTelemetryError helper itself.

## Suggested Remediation

Export a rethrowIfOclifError(error: unknown): void function from src/cli/utils/cliErrors.ts. All command catch blocks call this at the top, then proceed with their specific error handling.
