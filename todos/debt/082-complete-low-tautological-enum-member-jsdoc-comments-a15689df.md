---
status: complete
priority: p4
issue_id: debt-082
category: ai-patterns
severity: low
effort: quick
confidence: 0.90
tags:
  - technical-debt
  - ai-patterns
  - low
linear_issue_id: CDMCH-134
---

# Tautological enum member JSDoc comments

## Category

ai-patterns

## Severity / Effort

low / quick (confidence: 0.90)

## Affected Files

- src/workflows/writeActionQueue.ts (lines 37-65)
- src/adapters/http/httpTypes.ts (lines 18-25)

## Description

Enum members have JSDoc that restates the member name: PR\*COMMENT gets '/\*\* Create PR comment \_/'.

## Suggested Remediation

Remove JSDoc from self-descriptive enum members.
