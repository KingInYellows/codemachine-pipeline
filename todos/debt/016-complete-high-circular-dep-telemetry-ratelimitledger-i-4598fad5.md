---
status: complete
priority: p2
issue_id: debt-016
category: architecture
severity: high
effort: medium
confidence: 0.92
tags:
  - technical-debt
  - architecture
  - high
linear_issue_id: CDMCH-172
---

# Circular dep telemetry-rateLimitLedger imports adapters-http

## Category

architecture

## Severity / Effort

high / medium (confidence: 0.92)

## Affected Files

- src/telemetry/rateLimitLedger.ts (line 3)
- src/adapters/http/httpTypes.ts (lines 30-36)

## Description

The telemetry layer imports the Provider enum from adapters/http, creating bidirectional dependency between telemetry and adapters layers.

## Suggested Remediation

Move the Provider enum from adapters/http/httpTypes.ts to src/core/sharedTypes.ts.
