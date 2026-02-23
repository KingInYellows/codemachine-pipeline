---
status: ready
priority: p3
issue_id: debt-038
category: duplication
severity: medium
effort: medium
confidence: 0.88
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-181
---

# Child process spawn duplication across 3 files

## Category
duplication

## Severity / Effort
medium / medium (confidence: 0.88)

## Affected Files
- src/workflows/codeMachineRunner.ts (lines 271-503)
- src/adapters/codemachine/CodeMachineCLIAdapter.ts (lines 122-296)

## Description
Three locations implement the same child process lifecycle: spawn with shell:false, buffer collection, SIGTERM then SIGKILL timeout, exit code handling. Buffer limiting logic also duplicated.

## Suggested Remediation
Extract a shared ProcessRunner utility in src/utils/processRunner.ts.
