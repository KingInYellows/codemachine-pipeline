# analyzeResumeState Orchestrates 7 Sub-Checks Without Separating Optional vs Mandatory

**ID:** 166
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.75
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/resumeCoordinator.ts` lines 136-214

## Description

The analyzeResumeState function (~79 lines) calls 7 sub-functions and then applies post-processing logic directly in the body. The analysis object is passed by reference to each sub-function and mutated in place, making the order of calls critical but non-obvious.

## Suggested Remediation

Change sub-functions to return ResumeDiagnostic[] rather than mutating analysis. The orchestrator collects all diagnostics, then computes the final canResume flag from the combined set in a single deterministic pass. This eliminates order-of-call sensitivity.
