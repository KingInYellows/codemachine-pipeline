# generateRiskAssessments Regex String-Matching on Freeform Text for Severity

**ID:** 171
**Status:** pending
**Severity:** low
**Category:** complexity
**Effort:** quick
**Confidence:** 0.73
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 184-238

## Description

The generateRiskAssessments function classifies risk severity by running regex matches against freeform PRD text. This is inherently fragile — a PRD saying 'not a blocker' would trigger the critical pattern. The function is in the spec generation critical path.

## Suggested Remediation

Define risk severity as a structured field in the PRD schema rather than inferring it from text. If text-based inference must remain, use a scoring system that weights positive evidence against negative context, or tag the function as a heuristic with a confidence annotation on the RiskAssessment object.
