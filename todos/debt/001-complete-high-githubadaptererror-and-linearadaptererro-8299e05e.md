---
status: complete
priority: p2
issue_id: debt-001
category: duplication
severity: high
effort: small
confidence: 0.98
tags:
  - technical-debt
  - duplication
  - high
linear_issue_id: CDMCH-125
---

# GitHubAdapterError and LinearAdapterError are identical

## Category
duplication

## Severity / Effort
high / small (confidence: 0.98)

## Affected Files
- src/adapters/github/GitHubAdapter.ts (lines 642-672)
- src/adapters/linear/LinearAdapter.ts (lines 865-895)

## Description
GitHubAdapterError and LinearAdapterError are nearly character-for-character identical. Both extend Error with the same constructor signature (message, errorType, statusCode?, requestId?, operation?), the same Object.setPrototypeOf call, and an identical toJSON() method.

## Suggested Remediation
Create a generic AdapterError base class in src/adapters/ or src/utils/errors.ts. Both adapter-specific errors can extend it or be replaced entirely with a single parameterized AdapterError class with an 'adapter' field.
