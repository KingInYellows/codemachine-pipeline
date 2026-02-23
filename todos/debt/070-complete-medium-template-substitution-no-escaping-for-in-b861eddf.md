---
status: complete
priority: p3
issue_id: debt-070
category: security
severity: medium
effort: small
confidence: 0.75
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-215
---

# Template substitution no escaping for injected values

## Category

security

## Severity / Effort

medium / small (confidence: 0.75)

## Affected Files

- src/workflows/autoFixEngine.ts (lines 775-777)

## Description

applyCommandTemplate replaces mustache placeholders with values without escaping. Special characters could alter argument parsing.

## Suggested Remediation

Validate or sanitize template context values. Reject shell metacharacters. Consider using argument arrays instead.
