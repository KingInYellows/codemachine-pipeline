---
status: complete
priority: p3
issue_id: debt-032
category: duplication
severity: medium
effort: medium
confidence: 0.90
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-168
---

# Secret redaction patterns duplicated

## Category

duplication

## Severity / Effort

medium / medium (confidence: 0.90)

## Affected Files

- src/telemetry/logger.ts (lines 99-150)
- src/workflows/resultNormalizer.ts (lines 33-69)
- src/adapters/http/httpUtils.ts (lines 18-95)

## Description

Three independent credential/secret redaction engines with overlapping but non-identical regex patterns. resultNormalizer has additional patterns that logger.ts misses.

## Suggested Remediation

Consolidate all secret redaction patterns into a single src/utils/redaction.ts module.
