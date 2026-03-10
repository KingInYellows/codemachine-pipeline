# Feature Envy cli startHelpers ts Directly Calls Linear Adapter

**ID:** 139
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.82
**Scanner:** architecture-scanner

## Affected Files

- `src/cli/startHelpers.ts` line 13
- `src/cli/startHelpers.ts` lines 111-168

## Description

src/cli/startHelpers.ts imports and calls createLinearAdapter directly, including the fetchLinearIssue function that constructs the adapter, calls it, and formats the response. The CLI helper layer is directly coupled to a concrete adapter rather than going through the workflow layer. Contrast this with how the PR commands in cli/pr/shared.ts accept the adapter as an injected factory, which is the preferred pattern.

## Suggested Remediation

Move fetchLinearIssue to src/workflows/linearIssueLoader.ts (or into the existing researchCoordinator if it fits). The start.ts command should receive a linearIssueLoader dependency that can be overridden in tests, consistent with how the PR commands handle the GitHub adapter factory pattern.
