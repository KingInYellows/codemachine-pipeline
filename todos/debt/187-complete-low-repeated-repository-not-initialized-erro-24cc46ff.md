# Repeated Repository Not Initialized Error String Literal Across Multiple Files

**ID:** 187
**Status:** complete
**Severity:** low
**Category:** duplication
**Effort:** quick
**Confidence:** 0.95
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/approve.ts` lines 138-144
- `src/cli/commands/start.ts` lines 188-202

## Description

The string 'Repository not initialized. Run "codepipe init" first.' (or close variations) appears as a bare literal in approve.ts, start.ts, and validate.ts. This error message should be a named constant to avoid drift between instances and to allow easy global updates.

## Suggested Remediation

Define ERROR_MESSAGES.REPO_NOT_INITIALIZED = 'Repository not initialized. Run "codepipe init" first.' in src/cli/utils/cliErrors.ts and reference it in all call sites.
