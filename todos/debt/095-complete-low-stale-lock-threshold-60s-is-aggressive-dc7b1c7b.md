---
status: complete
priority: p4
issue_id: debt-095
category: security
severity: low
effort: quick
confidence: 0.70
tags:
  - technical-debt
  - security
  - low
linear_issue_id: CDMCH-158
---

# Stale lock threshold 60s is aggressive

## Category
security

## Severity / Effort
low / quick (confidence: 0.70)

## Affected Files
- src/persistence/runDirectoryManager.ts (line 201)

## Description
60 second stale lock threshold may cause premature lock-breaking for long operations.

## Suggested Remediation
Increase to 5 minutes or make configurable.
