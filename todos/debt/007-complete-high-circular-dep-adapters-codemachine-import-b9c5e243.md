---
status: complete
priority: p2
issue_id: debt-007
category: architecture
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - architecture
  - high
linear_issue_id: CDMCH-138
---

# Circular dep adapters-codemachine imports from workflows

## Category

architecture

## Severity / Effort

high / medium (confidence: 0.95)

## Affected Files

- src/adapters/codemachine/CodeMachineCLIAdapter.ts (line 4)
- src/adapters/codemachine/binaryResolver.ts (line 3)
- src/adapters/codemachine/index.ts (lines 14-18)
- src/workflows/codemachineTypes.ts
- src/workflows/codeMachineRunner.ts (lines 113-136)

## Description

The adapters/codemachine module imports types and validation functions from the workflows layer, violating the expected dependency direction.

## Suggested Remediation

Move CodeMachineExecutionResult, CodeMachineEngineType, and CODEMACHINE_STRATEGY_NAMES from workflows/codemachineTypes.ts to adapters/codemachine/types.ts. Move validateCliPath into the codemachine adapter.
