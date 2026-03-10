# composeSpecification God Function 180 Lines 12 Numbered Sequential Steps

**ID:** 157
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** medium
**Confidence:** 0.82
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 535-722

## Description

The composeSpecification function (~188 lines) performs 12 self-annotated steps, acquiring the filesystem lock twice separately (steps 8 and 10), and touching 6 distinct I/O paths. The step commentary reveals it has outgrown its abstraction level.

## Suggested Remediation

Extract steps 1-4 into prepareSpecificationInputs(), steps 5-6 into buildSpecificationDocument(), steps 7-10 into persistSpecification(), and steps 11-12 into diagnoseSpecification(). The orchestrator becomes a 30-line sequential composition of these helpers.
