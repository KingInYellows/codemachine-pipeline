# God Module adapters github branchProtection ts 769 Lines 12 Exports

**ID:** 145
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.78
**Scanner:** architecture-scanner

## Affected Files

- `src/adapters/github/branchProtection.ts` lines 1-769

## Description

branchProtection.ts is 769 lines with 12 exports. It handles branch protection rule fetching, compliance checking, merge readiness assessment, error formatting, and status check aggregation — all within a single adapter file. The branchProtection module has grown into a domain-specific policy engine rather than remaining a pure adapter.

## Suggested Remediation

Extract compliance checking and merge readiness assessment logic to src/workflows/branchComplianceChecker.ts (pure domain logic, no HTTP). Keep branchProtection.ts as a thin adapter that fetches raw data from the GitHub API and returns typed structures. This reduces the adapter to under 300 lines and moves the policy logic to the correct layer.
