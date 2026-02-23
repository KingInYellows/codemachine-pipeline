---
status: complete
priority: p3
issue_id: debt-027
category: duplication
severity: medium
effort: small
confidence: 0.97
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-151
---

# createDefaultLogger duplicated in three adapters

## Category

duplication

## Severity / Effort

medium / small (confidence: 0.97)

## Affected Files

- src/adapters/github/GitHubAdapter.ts (lines 626-632)
- src/adapters/linear/LinearAdapter.ts (lines 849-855)
- src/adapters/github/branchProtection.ts (lines 731-737)

## Description

Three adapter classes have identical createDefaultLogger() methods differing only in the component name string.

## Suggested Remediation

Replace with a shared createAdapterLogger(componentName) utility or use createLogger() directly.
