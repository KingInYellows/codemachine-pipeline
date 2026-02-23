---
status: complete
priority: p3
issue_id: debt-072
category: security
severity: medium
effort: small
confidence: 0.75
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-217
---

# Binary resolver cache no TTL

## Category
security

## Severity / Effort
medium / small (confidence: 0.75)

## Affected Files
- src/adapters/codemachine/binaryResolver.ts (lines 27-48)

## Description
Module-level cached binary resolution persists for entire process lifetime with no re-validation.

## Suggested Remediation
Add TTL to cached result or re-validate binary existence on each resolution call.
