# generateRecommendations Iterates Diagnostics 3 Times with Repetitive Code String Matching

**ID:** 155
**Status:** pending
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.85
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/resumeCoordinator.ts` lines 491-565

## Description

The generateRecommendations function (75 lines) applies 3 separate filter passes over the same array and then uses cascading if/else if chains on string codes. The function has 12+ branches. Moving the recommendation text into a lookup table keyed by code would reduce the complexity significantly.

## Suggested Remediation

Replace the cascading if/else chains with a RECOMMENDATION_MAP: Record<string, string> keyed by diagnostic code. The function body reduces to a single blockers.map(b => RECOMMENDATION_MAP[b.code] ?? b.message) pattern per severity.
