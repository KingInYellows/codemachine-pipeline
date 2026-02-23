---
status: complete
priority: p4
issue_id: debt-097
category: security
severity: low
effort: quick
confidence: 0.75
tags:
  - technical-debt
  - security
  - low
linear_issue_id: CDMCH-162
---

# HTTP response body in HttpError no size limit

## Category

security

## Severity / Effort

low / quick (confidence: 0.75)

## Affected Files

- src/adapters/http/client.ts (lines 421-442)

## Description

Full response body stored in HttpError. Only truncated in toJSON(), not in constructor.

## Suggested Remediation

Truncate response body in constructor to reasonable limit (2KB).
