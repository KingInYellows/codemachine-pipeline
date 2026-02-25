# Over-Specified JSDoc on Trivial Private Helper Methods in LinearAdapter

**ID:** 208
**Status:** pending
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.83
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/adapters/linear/LinearAdapter.ts` lines 597-682

## Description

LinearAdapter contains JSDoc on private helper methods that do 1-3 lines of work: '/** Format error message */', '/** Record request timestamp for sliding window tracking */'. Private methods called only from within the class do not benefit from JSDoc — they are implementation details. The method names already describe what they do.

## Suggested Remediation

Remove JSDoc from private methods in LinearAdapter (and similarly in GitHubAdapter and BranchProtectionAdapter). Reserve JSDoc for public API surface only.
