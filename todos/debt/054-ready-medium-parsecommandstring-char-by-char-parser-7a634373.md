---
status: ready
priority: p3
issue_id: debt-054
category: complexity
severity: medium
effort: medium
confidence: 0.82
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-199
---

# parseCommandString char-by-char parser

## Category
complexity

## Severity / Effort
medium / medium (confidence: 0.82)

## Affected Files
- src/workflows/autoFixEngine.ts (lines 545-595)

## Description
Custom character-by-character parser with 4 state variables and 6 conditional branches. High cognitive complexity.

## Suggested Remediation
Consider using shell-quote library. If custom implementation stays, add comprehensive unit tests.
