---
status: ready
priority: p3
issue_id: debt-046
category: architecture
severity: medium
effort: small
confidence: 0.85
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-191
---

# Feature envy executionMetrics redefines domain enums

## Category
architecture

## Severity / Effort
medium / small (confidence: 0.85)

## Affected Files
- src/telemetry/executionMetrics.ts (lines 1-30)
- src/workflows/cliExecutionEngine.ts (lines 22-30)

## Description
executionMetrics.ts defines its own ExecutionTaskStatus/Type enums that mirror core/models. cliExecutionEngine maintains a manual mapping between them.

## Suggested Remediation
Have telemetry import domain enums from core/models directly. Remove duplicate definitions and manual mapping.
