---
status: ready
priority: p2
issue_id: debt-011
category: complexity
severity: high
effort: large
confidence: 0.95
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-160
---

# God function Init run 300 lines deep nesting

## Category
complexity

## Severity / Effort
high / large (confidence: 0.95)

## Affected Files
- src/cli/commands/init.ts (lines 92-395)

## Description
Init.run() spans ~300 lines with 7+ sequential steps, deeply nested conditionals for JSON/human output, dry-run, force-mode, validate-only, and interactive prompting. Cyclomatic complexity >25. Also has 8 separate if(flags.json)/else blocks.

## Suggested Remediation
Extract each step into dedicated private methods. Collect results into a structured payload and render output once at the end.
