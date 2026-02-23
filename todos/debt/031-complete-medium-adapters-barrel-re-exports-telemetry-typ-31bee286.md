---
status: complete
priority: p3
issue_id: debt-031
category: architecture
severity: medium
effort: small
confidence: 0.90
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-166
---

# Adapters barrel re-exports telemetry type

## Category

architecture

## Severity / Effort

medium / small (confidence: 0.90)

## Affected Files

- src/adapters/index.ts (lines 119-120)
- src/adapters/http/client.ts (line 43)

## Description

src/adapters/index.ts re-exports LoggerInterface from the telemetry layer. Creates confusing import paths. Comment acknowledges it as legacy.

## Suggested Remediation

Remove LoggerInterface re-export from adapters/index.ts and adapters/http/client.ts. Update consumers to import from telemetry/logger.ts.
