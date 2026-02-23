---
status: complete
priority: p2
issue_id: debt-013
category: architecture
severity: high
effort: medium
confidence: 0.93
tags:
  - technical-debt
  - architecture
  - high
linear_issue_id: CDMCH-167
---

# Boundary violation workflows imports from cli-pr-shared

## Category
architecture

## Severity / Effort
high / medium (confidence: 0.93)

## Affected Files
- src/workflows/deploymentTriggerTypes.ts (line 10)
- src/workflows/deploymentTriggerContext.ts (line 16)
- src/cli/pr/shared.ts (lines 26-30)

## Description
Two workflow modules import PRMetadata from src/cli/pr/shared.ts, violating the expected dependency direction. PRMetadata represents pipeline state, not CLI presentation.

## Suggested Remediation
Move PRMetadata interface to src/core/models/. Update imports in both deployment trigger workflows and cli/pr/shared.ts.
