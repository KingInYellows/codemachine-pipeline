# executeWithFallback 6 Early-Throw Paths Inside While Loop with Mutable Provider State

**ID:** 154
**Status:** pending
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.83
**Scanner:** complexity-scanner

## Affected Files

- `src/adapters/agents/AgentAdapter.ts` lines 225-328

## Description

The executeWithFallback method (103 lines) contains a while-loop with 5 independent throw conditions inside the catch block, mutable loop variables (currentManifest, fallbackAttempts), and side-effectful sleep. Cyclomatic complexity is approximately 10 within a 103-line method.

## Suggested Remediation

Replace the while-loop with explicit recursion or a for-loop with a maximum iteration cap. Extract resolveFallbackManifest(currentManifest, attemptedProviders) to encapsulate the cycle-detection and manifest-lookup logic, reducing the catch block to 2-3 lines.
