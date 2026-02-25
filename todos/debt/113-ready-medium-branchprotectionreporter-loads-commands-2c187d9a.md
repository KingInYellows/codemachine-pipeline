# branchProtectionReporter Loads commands json Without Schema Validation

**ID:** 113
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.77
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/branchProtectionReporter.ts` lines 240-249

## Description

Validation command types from commands.json are mapped to GitHub check context names by string concatenation. If commands.json contains a crafted type value containing path-separator characters or special characters (e.g. '../../secrets' or a value with GitHub check context injection patterns), the resulting context string could match unintended branch protection rules. No schema validation or sanitization of the type field is performed before string construction.

## Suggested Remediation

Validate commandsData using validateOrThrow with a Zod schema that constrains cmd.type to a safe character allowlist (e.g. /^[a-zA-Z0-9_-]+$/) before using it in string concatenation.
