---
status: complete
priority: p2
issue_id: debt-006
category: complexity
severity: high
effort: small
confidence: 0.95
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-135
---

# executeValidationCommand takes 8 parameters

## Category
complexity

## Severity / Effort
high / small (confidence: 0.95)

## Affected Files
- src/workflows/autoFixEngine.ts (lines 389-527)

## Description
executeValidationCommand() accepts 8 parameters: runDir, command, attemptNumber, isAutoFixAttempt, options, logger, metrics, telemetry. Exceeds the threshold of 5 parameters.

## Suggested Remediation
Group telemetry parameters into a TelemetryContext object. Group attempt-specific data into an AttemptContext. Reduces to 4 parameters.
