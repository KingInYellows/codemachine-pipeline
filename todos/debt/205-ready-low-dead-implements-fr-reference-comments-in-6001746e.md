# Dead Implements FR Reference Comments in File Headers With No Live Link

**ID:** 205
**Status:** pending
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.80
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/workflows/branchProtectionReporter.ts` lines 1-11
- `src/adapters/github/branchProtection.ts` lines 1-11
- `src/adapters/github/GitHubAdapter.ts` lines 1-19
- `src/adapters/linear/LinearAdapter.ts` lines 1-20
- `src/workflows/contextRanking.ts` lines 1-14
- `src/workflows/planDiffer.ts` lines 1-16

## Description

12+ files open with a JSDoc block citing internal document references like 'FR-7', 'FR-15', 'IR-5', 'ADR-6', 'Section 2.1', 'Task I4.T5'. These references point to planning documents that are not in the repository. The references cannot be navigated, verified, or updated. This is a common AI-generation artifact where requirement traceability comments are added by default but reference documents that may no longer match the implementation.

## Suggested Remediation

Either link these references to navigable documents (e.g., docs/requirements/FR-15.md) or remove the Implements section from file headers. Dead references are worse than no references.
