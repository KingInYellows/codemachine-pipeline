# Reviewer List Parsing Logic Duplicated Between pr create ts and pr reviewers ts

**ID:** 188
**Status:** complete
**Severity:** low
**Category:** duplication
**Effort:** quick
**Confidence:** 0.95
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/pr/create.ts` lines 253-256
- `src/cli/commands/pr/reviewers.ts` lines 118-123

## Description

The reviewer string splitting and trimming logic is duplicated: .split(',').map(r => r.trim()).filter(r => r.length > 0) appears in both files performing the same comma-split + trim + filter-empty operation on a reviewer string.

## Suggested Remediation

Add a parseReviewerList(input: string): string[] helper to src/cli/pr/shared.ts. Both commands call parseReviewerList(typedFlags.reviewers) / parseReviewerList(typedFlags.add).
