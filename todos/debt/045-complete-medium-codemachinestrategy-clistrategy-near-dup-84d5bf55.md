---
status: complete
priority: p3
issue_id: debt-045
category: duplication
severity: medium
effort: small
confidence: 0.85
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-190
---

# CodeMachineStrategy-CLIStrategy near-duplicate

## Category
duplication

## Severity / Effort
medium / small (confidence: 0.85)

## Affected Files
- src/workflows/codeMachineStrategy.ts (lines 1-125)
- src/workflows/codeMachineCLIStrategy.ts (lines 1-157)

## Description
Both implement ExecutionStrategy with nearly identical constructor patterns, canHandle(), execute(), factory functions, and status derivation logic.

## Suggested Remediation
Extract shared mapExitToStatus() and buildStrategyResult() helpers.
