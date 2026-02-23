---
status: complete
priority: p3
issue_id: debt-052
category: security
severity: medium
effort: quick
confidence: 0.85
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-197
---

# Error stack traces in deployment outcome persistence

## Category
security

## Severity / Effort
medium / quick (confidence: 0.85)

## Affected Files
- src/workflows/deploymentTrigger.ts (lines 292-296)

## Description
Full error stack traces are persisted in deployment outcome JSON files, revealing internal file paths and module structure.

## Suggested Remediation
Redact stack traces before persisting. Include only error message and type.
