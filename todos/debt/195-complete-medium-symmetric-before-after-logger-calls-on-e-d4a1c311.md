# Symmetric Before-After Logger Calls on Every Adapter Method

**ID:** 195
**Status:** complete
**Severity:** medium
**Category:** ai-patterns
**Effort:** small
**Confidence:** 0.85
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/adapters/github/GitHubAdapter.ts` lines 133-600
- `src/adapters/github/branchProtection.ts` lines 283-730
- `src/adapters/linear/LinearAdapter.ts` lines 225-465

## Description

GitHubAdapter, BranchProtectionAdapter, and LinearAdapter each log a 'Fetching X' message before every API call and a 'X fetched/created successfully' message after. This produces 2 log events per operation across 12+ methods with no added diagnostic value beyond what structured request logging (already handled by HttpClient) already captures. The triple-log pattern (before, after-success, after-error) is repeated identically for approximately 20 methods across 3 adapters.

## Suggested Remediation

Remove before/after debug logs from adapter methods. Keep only error-path logs. The HttpClient already records request/response telemetry. If operation-level tracing is needed, use the existing TraceManager spans rather than log statements.
