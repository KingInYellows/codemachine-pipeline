---
status: complete
priority: p2
issue_id: debt-012
category: complexity
severity: high
effort: large
confidence: 0.93
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-163
---

# God function Start run 270 lines

## Category
complexity

## Severity / Effort
high / large (confidence: 0.93)

## Affected Files
- src/cli/commands/start.ts (lines 151-423)

## Description
Start.run() spans ~270 lines orchestrating context aggregation, research detection, PRD authoring, approval gating, and task execution with 5+ branching paths. Cyclomatic complexity >22.

## Suggested Remediation
Extract orchestration steps into a pipeline pattern. Move telemetry recording into a wrapper/decorator.
