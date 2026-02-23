---
status: complete
priority: p3
issue_id: debt-034
category: ai-patterns
severity: medium
effort: small
confidence: 0.90
tags:
  - technical-debt
  - ai-patterns
  - medium
linear_issue_id: CDMCH-173
---

# createConsoleLogger triplication

## Category

ai-patterns

## Severity / Effort

medium / small (confidence: 0.90)

## Affected Files

- src/adapters/http/httpUtils.ts (lines 125-130)
- src/telemetry/logger.ts (line 634)
- src/workflows/writeActionQueue.ts (lines 266-272)

## Description

Three separate createConsoleLogger functions with slightly different implementations but identical purpose.

## Suggested Remediation

Use the parameterized createConsoleLogger from telemetry/logger.ts. Remove the two duplicates.
