---
status: complete
priority: p3
issue_id: debt-075
category: security
severity: medium
effort: small
confidence: 0.70
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-220
---

# GraphQL mutations inline not frozen

## Category
security

## Severity / Effort
medium / small (confidence: 0.70)

## Affected Files
- src/adapters/github/GitHubAdapter.ts (lines 474-488, 541-551)

## Description
GraphQL mutations constructed as inline template strings. Currently safe (variables parameterized) but pattern is fragile.

## Suggested Remediation
Extract to named constants at module scope with Object.freeze or as const.
