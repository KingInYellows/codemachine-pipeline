# specComposer Loads Spec Index JSON Without Structural Validation

**ID:** 117
**Status:** pending
**Severity:** low
**Category:** security
**Effort:** quick
**Confidence:** 0.72
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 830-835

## Description

Line 833 in specComposer.ts loads an existing spec index via JSON.parse without applying a Zod schema, while the adjacent calls at lines 755 and 877 correctly use validateOrThrow. The inconsistency means the spec index (which drives section inclusion/exclusion decisions in PRD authoring) can contain unexpected structure that propagates into the authoring engine.

## Suggested Remediation

Define or reuse a Zod schema for the spec index format and apply validateOrThrow consistently at line 833, matching the pattern already used at lines 755 and 877 in the same file.
