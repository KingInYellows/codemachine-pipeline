# Config Not Initialized Error Message Duplicated in start ts and approve ts

**ID:** 183
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.88
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/start.ts` lines 188-201
- `src/cli/commands/approve.ts` lines 138-144

## Description

Both start.ts and approve.ts contain the same settings validation block: 'if (settings.errors.length > 0 || !settings.config) { ... }'. The identical ternary logic for deriving the error message from settings.errors appears in both commands.

## Suggested Remediation

Add a requireConfig(settings) guard helper to src/cli/utils/runDirectory.ts that throws a CliError with the derived message if settings.config is absent or errors are present.
