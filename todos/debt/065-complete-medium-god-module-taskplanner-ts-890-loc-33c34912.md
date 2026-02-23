---
status: complete
priority: p3
issue_id: debt-065
category: architecture
severity: medium
effort: medium
confidence: 0.80
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-210
---

# God module taskPlanner ts 890 LOC

## Category

architecture

## Severity / Effort

medium / medium (confidence: 0.80)

## Affected Files

- src/workflows/taskPlanner.ts (lines 1-890)

## Description

890 lines combining task decomposition, dependency graph construction, planning strategies, DAG validation, and persistence.

## Suggested Remediation

Extract DAG logic to plannerDAG.ts. Extract persistence to plannerPersistence.ts.
