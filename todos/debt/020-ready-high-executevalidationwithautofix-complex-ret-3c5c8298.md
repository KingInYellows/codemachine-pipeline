---
status: ready
priority: p2
issue_id: debt-020
category: complexity
severity: high
effort: medium
confidence: 0.88
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-180
---

# executeValidationWithAutoFix complex retry loop

## Category
complexity

## Severity / Effort
high / medium (confidence: 0.88)

## Affected Files
- src/workflows/autoFixEngine.ts (lines 102-274)

## Description
executeValidationWithAutoFix() spans ~170 lines with a retry loop, conditional auto-fix, and interleaved telemetry span management. Cyclomatic complexity ~18.

## Suggested Remediation
Extract single-attempt execution into a helper. Use a telemetry wrapper. Make the retry loop a generic utility.
