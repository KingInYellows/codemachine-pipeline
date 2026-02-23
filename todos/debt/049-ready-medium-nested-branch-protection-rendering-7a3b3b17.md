---
status: ready
priority: p3
issue_id: debt-049
category: complexity
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-194
---

# Nested branch protection rendering

## Category
complexity

## Severity / Effort
medium / medium (confidence: 0.85)

## Affected Files
- src/cli/status/renderers.ts (lines 155-206)

## Description
The branch_protection section has 5 nested subsections each with conditional rendering and verbose-mode checks.

## Suggested Remediation
Extract renderBranchProtection() as a standalone function with subsection render functions.
