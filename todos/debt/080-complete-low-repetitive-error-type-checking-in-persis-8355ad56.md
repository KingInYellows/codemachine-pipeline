---
status: complete
priority: p4
issue_id: debt-080
category: complexity
severity: low
effort: small
confidence: 0.92
tags:
  - technical-debt
  - complexity
  - low
linear_issue_id: CDMCH-130
---

# Repetitive error-type checking in persistence

## Category

complexity

## Severity / Effort

low / small (confidence: 0.92)

## Affected Files

- src/persistence/runDirectoryManager.ts (lines 295-602)

## Description

The pattern error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' appears 5+ times.

## Suggested Remediation

Create isNodeError(error, code) type guard utility.
