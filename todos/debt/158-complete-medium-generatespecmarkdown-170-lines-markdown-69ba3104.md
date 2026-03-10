# generateSpecMarkdown 170 Lines Markdown Builder Mixed Formatting and Data Concerns

**ID:** 158
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.80
**Scanner:** complexity-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 357-526

## Description

The generateSpecMarkdown function (~170 lines) accumulates all specification sections into a single function with 9 independently varying sections, several nested loops, and inline conditional formatting. This is a textbook case for the Template Method pattern.

## Suggested Remediation

Split into section-generating private functions: renderFrontMatter(), renderTestPlan(), renderRolloutPlan(), renderRiskAssessment(), renderChangeLog(). The main function delegates to each, keeping it under 20 lines.
