---
status: complete
priority: p3
issue_id: debt-030
category: complexity
severity: medium
effort: small
confidence: 0.92
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-164
---

# finalizeTelemetry-exitCommand take 7 parameters

## Category
complexity

## Severity / Effort
medium / small (confidence: 0.92)

## Affected Files
- src/cli/commands/init.ts (lines 397-481)

## Description
Both finalizeTelemetry() and exitCommand() accept 6-7 parameters including exitCode, startTime, metrics, commandSpan, traceManager, logger.

## Suggested Remediation
Create a TelemetryContext object bundling metrics, commandSpan, traceManager, and logger.
