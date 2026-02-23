---
status: complete
priority: p3
issue_id: debt-073
category: complexity
severity: medium
effort: small
confidence: 0.75
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-218
---

# selectDeploymentStrategy 7-way decision tree

## Category

complexity

## Severity / Effort

medium / small (confidence: 0.75)

## Affected Files

- src/workflows/deploymentTrigger.ts (lines 94-154)

## Description

7-level sequential if/else chain for strategy selection. Moderate cyclomatic complexity.

## Suggested Remediation

Consider a strategy-selection table pattern: { predicate, strategy } array, first match wins.
