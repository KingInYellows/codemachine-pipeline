# Init run 4-Level Nesting in Telemetry Initialization Conditional Branch

**ID:** 165
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.78
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/commands/init.ts` lines 100-280

## Description

The Init.run() method (~180 lines) contains 7 separate top-level conditional branches and a compound 5-condition TTY guard for interactive mode. The nesting depth in the telemetry init section reaches 4. The run method handles validate-only, dry-run, and normal initialization modes, which are conceptually different execution paths.

## Suggested Remediation

Refactor to a mode-dispatch pattern: parse flags, determine mode (validate-only, dry-run, or normal), and call a dedicated private method per mode. The run() method becomes a dispatcher of ~20 lines. This mirrors the approach used in approve.ts which delegates immediately.
