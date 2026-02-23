---
status: complete
priority: p2
issue_id: debt-008
category: architecture
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - architecture
  - high
linear_issue_id: CDMCH-146
---

# Circular dep utils-errors imports from adapters-http

## Category

architecture

## Severity / Effort

high / medium (confidence: 0.95)

## Affected Files

- src/utils/errors.ts (lines 1-2)
- src/adapters/http/client.ts (lines 60-108)
- src/adapters/http/httpTypes.ts (lines 18-36)

## Description

The utils layer imports HttpError and ErrorType from adapters/http/client.ts. Utils should have zero dependencies on higher layers.

## Suggested Remediation

Move ErrorType enum and HttpError class (or at minimum ErrorType) out of adapters/http into src/core/sharedTypes.ts or src/utils/errorTypes.ts.
