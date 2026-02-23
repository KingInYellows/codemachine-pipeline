---
status: complete
priority: p3
issue_id: debt-047
category: complexity
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-192
---

# buildDependencyGraph triple-nested loops

## Category

complexity

## Severity / Effort

medium / medium (confidence: 0.85)

## Affected Files

- src/workflows/taskPlanner.ts (lines 332-428)

## Description

Three nested loop patterns for resolving task dependencies, O(n\*m) complexity.

## Suggested Remediation

Use Set-based lookups. Extract test-type ordering into a declarative configuration.
