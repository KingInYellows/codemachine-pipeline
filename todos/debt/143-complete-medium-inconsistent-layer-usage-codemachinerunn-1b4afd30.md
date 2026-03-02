# Inconsistent Layer Usage codeMachineRunner Imports Concrete Adapter Utility

**ID:** 143
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.75
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/codeMachineRunner.ts` line 9
- `src/adapters/codemachine/types.ts` line 1

## Description

src/workflows/codeMachineRunner.ts imports validateCliPath directly from src/adapters/codemachine/types.ts (a value import, not type-only). Workflows depending on concrete adapter utilities (not just their interfaces) creates tight coupling to the adapter implementation. The validator function from types.ts should be either moved to a shared utilities location or inlined in the adapter.

## Suggested Remediation

Move validateCliPath to src/utils/ or src/validation/ so it is a shared utility accessible without coupling workflows to the codemachine adapter's types file. Alternatively, if it is truly adapter-internal, stop exporting it and inline the validation in the adapter itself.
