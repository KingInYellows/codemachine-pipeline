---
status: complete
priority: p3
issue_id: debt-044
category: complexity
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-189
---

# HttpClient request complex retry loop

## Category

complexity

## Severity / Effort

medium / medium (confidence: 0.85)

## Affected Files

- src/adapters/http/client.ts (lines 204-337)

## Description

request() spans ~130 lines with retry for-loop containing nested try/catch, conditional backoff, rate limit extraction, and two retry-decision points. Cyclomatic complexity ~16.

## Suggested Remediation

Extract single-attempt logic into a private method. Use a generic retry wrapper.
