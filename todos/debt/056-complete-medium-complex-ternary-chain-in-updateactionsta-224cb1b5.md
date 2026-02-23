---
status: complete
priority: p3
issue_id: debt-056
category: complexity
severity: medium
effort: small
confidence: 0.82
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-201
---

# Complex ternary chain in updateActionStatus

## Category

complexity

## Severity / Effort

medium / small (confidence: 0.82)

## Affected Files

- src/workflows/writeActionQueue.ts (lines 649-704)

## Description

Complex inline ternary expressions for status transition delta calculations.

## Suggested Remediation

Create an explicit status-transition table (Map<OldStatus, Map<NewStatus, DeltaUpdate>>).
