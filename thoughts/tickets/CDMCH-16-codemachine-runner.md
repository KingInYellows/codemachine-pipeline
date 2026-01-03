# CDMCH-16: CodeMachineRunner utility

## Summary

Implement CLI spawn utility with timeout, log streaming, validation, and safe env handling.

## Scope

- Spawn codemachine with args (no shell).
- Validate CLI path and availability.
- Stream logs to file and capture output buffers.
- Enforce timeouts and SIGTERM/SIGKILL escalation.

## Steps

1. Implement runner interface and execution function.
2. Add CLI availability check.
3. Add path validation and env allowlist.
4. Add logging and timeout handling.

## Acceptance Criteria

- Reliable CLI invocation with safe env handling.
- Timeout and kill behavior consistent with requirements.

## Dependencies

- CDMCH-15 (execution config).

## Estimate

- M (5)
