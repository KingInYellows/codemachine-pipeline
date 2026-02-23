---
status: complete
priority: p3
issue_id: debt-048
category: complexity
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-193
---

# WriteActionQueue drain complex flow

## Category
complexity

## Severity / Effort
medium / medium (confidence: 0.85)

## Affected Files
- src/workflows/writeActionQueue.ts (lines 434-539)

## Description
drain() has outer try/catch, rate limit cooldown check with nested manual-ack, queue loading, filtering, sorting, capacity calculation, and sequential execution loop.

## Suggested Remediation
Extract rate-limit check into a guard function. Extract the action-execution loop into a separate method.
