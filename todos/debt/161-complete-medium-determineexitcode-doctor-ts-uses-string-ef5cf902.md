# determineExitCode doctor ts Uses String Includes on Check Names

**ID:** 161
**Status:** pending
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.85
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/commands/doctor.ts` lines 50-77

## Description

The determineExitCode function derives exit-code priority by matching check names using String.includes(). Adding a new check category requires updating this function's string patterns rather than a type on the check itself. The function has 5 conditional branches.

## Suggested Remediation

Add a 'category: credential | environment | config | general' field to the DiagnosticCheck interface. The exit-code mapping becomes a simple Map<category, exitCode> lookup, eliminating the string-pattern matching entirely.
