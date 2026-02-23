---
status: complete
priority: p3
issue_id: debt-033
category: complexity
severity: medium
effort: small
confidence: 0.90
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-171
---

# Deeply nested JSON output conditionals in Init

## Category
complexity

## Severity / Effort
medium / small (confidence: 0.90)

## Affected Files
- src/cli/commands/init.ts (lines 92-395)

## Description
Init.run() has 8 separate if(flags.json)/else blocks for output mode switching, creating shotgun surgery for any new output format.

## Suggested Remediation
Collect results into a structured payload throughout the function, render once at the end.
