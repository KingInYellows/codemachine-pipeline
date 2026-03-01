# buildResearchOptions 4 If-Else Branches for 3-Way String Concatenation

**ID:** 172
**Status:** complete
**Severity:** low
**Category:** complexity
**Effort:** quick
**Confidence:** 0.75
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/commands/start.ts` lines 453-483

## Description

The buildResearchOptions private method uses 3 if/else branches to combine optional specText and linearContext strings. The logic is simple but obscured by the branching.

## Suggested Remediation

Simplify to: const parts = [input.specText, linearContext].filter(Boolean); if (parts.length) options.specText = parts.join('\n\n'); This eliminates all 3 branches.
