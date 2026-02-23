---
status: complete
priority: p3
issue_id: debt-057
category: duplication
severity: medium
effort: small
confidence: 0.82
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-202
---

# GitHub adapter try-log-call-catch pattern

## Category
duplication

## Severity / Effort
medium / small (confidence: 0.82)

## Affected Files
- src/adapters/github/GitHubAdapter.ts (lines 102-619)

## Description
11 public methods follow identical try/catch structure: log params, call API, log result, catch/normalize error. 15-20 lines of boilerplate each.

## Suggested Remediation
Consider a withLogging<T>() wrapper. Accept the trade-off between observability and DRY.
