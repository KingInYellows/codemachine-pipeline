# Boilerplate Factory Functions on Every Adapter and Service

**ID:** 194
**Status:** complete
**Severity:** medium
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.82
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/adapters/github/GitHubAdapter.ts` lines 628-633
- `src/adapters/github/branchProtection.ts` lines 762-769
- `src/adapters/linear/LinearAdapter.ts` lines 691-696
- `src/telemetry/metrics.ts` lines 637-658
- `src/telemetry/costTracker.ts` lines 555-584

## Description

Every adapter and major service exports an identically-structured 3-line factory function that simply calls 'new ClassName(config)'. Same pattern appears in MetricsCollector, CostTracker, TraceManager, BranchProtectionAdapter, and more. None of these factories add any logic over the constructor.

## Suggested Remediation

Delete no-op factory functions and call constructors directly at call sites. If dependency injection or future factory logic is genuinely anticipated, keep a single factory with a comment explaining why. Do not delete if tests mock these factories by name.
