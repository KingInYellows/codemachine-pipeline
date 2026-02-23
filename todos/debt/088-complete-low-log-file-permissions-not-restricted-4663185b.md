---
status: complete
priority: p4
issue_id: debt-088
category: security
severity: low
effort: quick
confidence: 0.80
tags:
  - technical-debt
  - security
  - low
linear_issue_id: CDMCH-145
---

# Log file permissions not restricted

## Category

security

## Severity / Effort

low / quick (confidence: 0.80)

## Affected Files

- src/telemetry/logger.ts (lines 444-445)

## Description

StructuredLogger creates log files with default permissions (0o644, world-readable). codeMachineRunner correctly uses 0o600.

## Suggested Remediation

Use explicit mode 0o600 for log file creation.
