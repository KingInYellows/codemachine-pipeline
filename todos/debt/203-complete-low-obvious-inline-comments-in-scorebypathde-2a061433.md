# Obvious Inline Comments in scoreByPathDepth and scoreBySize in contextRanking

**ID:** 203
**Status:** complete
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.85
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/workflows/contextRanking.ts` lines 94-260

## Description

contextRanking.ts contains inline comments that describe arithmetic that is self-evident from the variable names: '// Count path segments (slashes)', '// Calculate age in days', '// Empty files get lowest score'. Magic-number annotations like '// 1KB' and '// 100KB' are genuinely useful and should be retained; the rest should be removed.

## Suggested Remediation

Remove comments that describe the adjacent line of code verbatim. Retain only comments that explain the rationale for a constant value or non-obvious algorithmic choice.
