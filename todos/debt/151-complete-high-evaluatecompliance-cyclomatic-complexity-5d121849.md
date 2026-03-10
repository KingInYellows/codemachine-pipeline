# evaluateCompliance Cyclomatic Complexity 18 Multi-Level Nested Conditionals

**ID:** 151
**Status:** complete
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.88
**Scanner:** complexity-scanner

## Affected Files

- `src/adapters/github/branchProtection.ts` lines 551-730

## Description

The evaluateCompliance method spans ~180 lines, makes 4-6 async API calls sequentially or in parallel, and then applies compliance rules through 4 levels of nesting. Estimated cyclomatic complexity: 18. The method is the hot path for branch protection checks called on every 'status' command run.

## Suggested Remediation

Extract the status-check evaluation block into evaluateStatusChecks(protection, statuses, checkRuns, baseRef) and the review evaluation into evaluateReviews(protection, pullNumber, reviews). Each extracted function has a single responsibility and can be independently unit-tested.
