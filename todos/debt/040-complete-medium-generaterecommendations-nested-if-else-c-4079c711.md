---
status: complete
priority: p3
issue_id: debt-040
category: complexity
severity: medium
effort: small
confidence: 0.88
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-185
---

# generateRecommendations nested if-else chain

## Category

complexity

## Severity / Effort

medium / small (confidence: 0.88)

## Affected Files

- src/workflows/resumeCoordinator.ts (lines 491-565)

## Description

4-level nested structure with string-based diagnostic code matching across 5+ branches.

## Suggested Remediation

Use a Map<string, (diagnostic) => string> to replace the nested if-else chain with lookup.
