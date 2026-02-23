---
status: complete
priority: p4
issue_id: debt-091
category: duplication
severity: low
effort: small
confidence: 0.75
tags:
  - technical-debt
  - duplication
  - low
linear_issue_id: CDMCH-152
---

# Logger factory functions repetitive pattern

## Category

duplication

## Severity / Effort

low / small (confidence: 0.75)

## Affected Files

- src/telemetry/logger.ts (lines 569-640)

## Description

Four logger factories follow same pattern with minor variations. Conditional runId/runDir setting repeated 3 times.

## Suggested Remediation

Low priority. Could simplify with spread operator but readability cost may not justify it.
