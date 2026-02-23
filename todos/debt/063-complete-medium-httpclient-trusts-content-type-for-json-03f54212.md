---
status: complete
priority: p3
issue_id: debt-063
category: security
severity: medium
effort: small
confidence: 0.80
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-208
---

# HttpClient trusts Content-Type for JSON parsing

## Category

security

## Severity / Effort

medium / small (confidence: 0.80)

## Affected Files

- src/adapters/http/client.ts (lines 607-617)

## Description

parseResponseBody decides between json() and text() based on Content-Type header. Non-JSON responses are cast via 'as unknown as T'.

## Suggested Remediation

Add response body validation. Throw structured error for unexpected content types. Remove unsafe cast.
