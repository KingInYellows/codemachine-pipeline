# Inconsistent Pattern branchProtectionReporter Mixed Adapter and Workflow Concerns

**ID:** 138
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.80
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/branchProtectionReporter.ts` lines 1-406
- `src/adapters/github/branchProtection.ts` lines 1-769

## Description

src/workflows/branchProtectionReporter.ts imports from src/adapters/github/branchProtection.ts (type BranchProtectionCompliance) and contains both report generation logic and filesystem persistence. This creates a file that spans the adapter and persistence layers while living in workflows/. In contrast, the deployment module correctly separates execution from persistence within its own subdirectory.

## Suggested Remediation

Split branchProtectionReporter.ts into (1) report generation logic that remains in workflows/ and (2) a persistence helper for reading/writing branch protection artifacts that moves to persistence/. Consider whether the GitHub adapter should own the BranchProtectionCompliance type rather than having the workflows layer import a concrete adapter type.
