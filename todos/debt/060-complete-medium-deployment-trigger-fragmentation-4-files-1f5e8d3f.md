---
status: ready
priority: p3
issue_id: debt-060
category: architecture
severity: medium
effort: medium
confidence: 0.80
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-205
---

# Deployment trigger fragmentation 4 files

## Category

architecture

## Severity / Effort

medium / medium (confidence: 0.80)

## Affected Files

- src/workflows/deploymentTrigger.ts (lines 1-308)
- src/workflows/deploymentTriggerContext.ts (lines 1-269)
- src/workflows/deploymentTriggerExecution.ts (lines 1-500)
- src/workflows/deploymentTriggerTypes.ts (lines 1-224)

## Description

4 files (1301 LOC) with cross-layer imports. Types file contains only interfaces. Context and execution are tightly coupled to main trigger.

## Suggested Remediation

Move into src/workflows/deployment/ directory. Merge types into main trigger file.
