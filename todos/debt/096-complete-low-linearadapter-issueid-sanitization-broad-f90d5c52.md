---
status: complete
priority: p4
issue_id: debt-096
category: security
severity: low
effort: quick
confidence: 0.70
tags:
  - technical-debt
  - security
  - low
linear_issue_id: CDMCH-161
---

# LinearAdapter issueId sanitization broad

## Category
security

## Severity / Effort
low / quick (confidence: 0.70)

## Affected Files
- src/adapters/linear/LinearAdapter.ts (lines 742-745)

## Description
No length validation on issueId. No format validation for Linear UUID format.

## Suggested Remediation
Add max length check and validate against expected Linear issue ID format.
