---
status: complete
priority: p4
issue_id: debt-079
category: duplication
severity: low
effort: quick
confidence: 0.95
tags:
  - technical-debt
  - duplication
  - low
linear_issue_id: CDMCH-129
---

# CONFIG-RELATIVE-PATH duplicated in doctor and health

## Category
duplication

## Severity / Effort
low / quick (confidence: 0.95)

## Affected Files
- src/cli/commands/doctor.ts (line 14)
- src/cli/commands/health.ts (line 7)

## Description
CONFIG_RELATIVE_PATH constant defined independently in two files.

## Suggested Remediation
Export from src/cli/utils/ or src/core/config/.
