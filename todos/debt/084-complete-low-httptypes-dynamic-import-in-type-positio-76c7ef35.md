---
status: complete
priority: p4
issue_id: debt-084
category: architecture
severity: low
effort: small
confidence: 0.85
tags:
  - technical-debt
  - architecture
  - low
linear_issue_id: CDMCH-139
---

# httpTypes dynamic import in type position

## Category
architecture

## Severity / Effort
low / small (confidence: 0.85)

## Affected Files
- src/adapters/http/httpTypes.ts (line 98)

## Description
Dynamic import expression for rateLimitEnvelope type creates hidden dependency not visible in import statements.

## Suggested Remediation
Replace with explicit top-level import type.
