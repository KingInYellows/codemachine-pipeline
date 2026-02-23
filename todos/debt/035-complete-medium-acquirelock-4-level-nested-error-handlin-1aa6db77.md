---
status: complete
priority: p3
issue_id: debt-035
category: complexity
severity: medium
effort: small
confidence: 0.90
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-175
---

# acquireLock 4-level nested error handling

## Category

complexity

## Severity / Effort

medium / small (confidence: 0.90)

## Affected Files

- src/persistence/runDirectoryManager.ts (lines 295-361)

## Description

acquireLock() has while-loop containing try/catch, nested if for EEXIST, nested if for stale lock, nested try/catch for unlink, creating 4+ levels of nesting.

## Suggested Remediation

Extract stale-lock-removal into a separate async function. Use early returns to flatten nesting.
