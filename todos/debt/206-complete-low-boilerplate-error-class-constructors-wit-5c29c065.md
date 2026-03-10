# Boilerplate Error Class Constructors with Identical Structure

**ID:** 206
**Status:** complete
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.78
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/adapters/github/GitHubAdapter.ts` lines 608-622
- `src/adapters/github/branchProtection.ts` lines 742-756
- `src/adapters/linear/LinearAdapterTypes.ts` lines 1-50

## Description

Three error classes — GitHubAdapterError, BranchProtectionError, LinearAdapterError — each have an identical 8-line constructor that only sets this.name. All three classes are structurally identical — same signature, same super() call, only differing in the this.name value. No class adds any behavior beyond the base class.

## Suggested Remediation

Consider making AdapterError accept a 'name' parameter, allowing: new AdapterError(message, type, statusCode, requestId, operation, 'GitHubAdapterError'). This eliminates 3 subclasses. Alternatively keep subclasses but document why they exist (e.g., instanceof checks in tests).
