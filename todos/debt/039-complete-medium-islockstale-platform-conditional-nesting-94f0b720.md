---
status: complete
priority: p3
issue_id: debt-039
category: complexity
severity: medium
effort: small
confidence: 0.88
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-183
---

# isLockStale platform-conditional nesting

## Category
complexity

## Severity / Effort
medium / small (confidence: 0.88)

## Affected Files
- src/persistence/runDirectoryManager.ts (lines 414-458)

## Description
isLockStale() has 3+ levels of nesting with platform checks and nested try/catch for process.kill.

## Suggested Remediation
Extract process-existence checking into isProcessRunning(pid) utility.
