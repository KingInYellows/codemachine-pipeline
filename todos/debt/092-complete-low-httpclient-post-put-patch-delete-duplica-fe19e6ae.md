---
status: complete
priority: p4
issue_id: debt-092
category: duplication
severity: low
effort: small
confidence: 0.70
tags:
  - technical-debt
  - duplication
  - low
linear_issue_id: CDMCH-153
---

# HttpClient post-put-patch-delete duplication

## Category

duplication

## Severity / Effort

low / small (confidence: 0.70)

## Affected Files

- src/adapters/http/client.ts (lines 149-199)

## Description

post/put/patch/delete all delegate to request() with identical JSON.stringify + idempotent pattern.

## Suggested Remediation

Low priority. Standard HTTP client pattern. Could extract mutationRequest() helper.
