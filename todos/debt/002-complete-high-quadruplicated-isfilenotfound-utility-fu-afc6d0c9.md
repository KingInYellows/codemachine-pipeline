---
status: complete
priority: p2
issue_id: debt-002
category: ai-patterns
severity: high
effort: small
confidence: 0.98
tags:
  - technical-debt
  - ai-patterns
  - high
linear_issue_id: CDMCH-126
---

# Quadruplicated isFileNotFound utility function

## Category

ai-patterns

## Severity / Effort

high / small (confidence: 0.98)

## Affected Files

- src/utils/safeJson.ts (lines 35-42)
- src/workflows/writeActionQueue.ts (lines 254-261)
- src/cli/utils/writeActionQueueReporter.ts (lines 373-380)
- src/telemetry/rateLimitLedger.ts (lines 143-150)

## Description

The function isFileNotFound(error) is defined identically in 4 separate files despite being already exported from src/utils/safeJson.ts. Classic AI-generation smell where each file was generated independently.

## Suggested Remediation

Remove the three duplicate definitions and import isFileNotFound from src/utils/safeJson.ts.
