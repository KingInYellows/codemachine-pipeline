---
status: complete
priority: p3
issue_id: debt-036
category: complexity
severity: medium
effort: small
confidence: 0.90
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-176
---

# Kahns algorithm with O-V-E inner scan

## Category
complexity

## Severity / Effort
medium / small (confidence: 0.90)

## Affected Files
- src/workflows/taskPlanner.ts (lines 433-486)

## Description
computeTopologicalOrder() uses an O(V) scan of all tasks to find dependents instead of O(V+E) with an adjacency list.

## Suggested Remediation
Build a reverse adjacency map before the main loop for O(1) dependent lookup.
