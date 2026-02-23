---
status: complete
priority: p4
issue_id: debt-081
category: architecture
severity: low
effort: quick
confidence: 0.92
tags:
  - technical-debt
  - architecture
  - low
linear_issue_id: CDMCH-132
---

# Example file in production source tree

## Category
architecture

## Severity / Effort
low / quick (confidence: 0.92)

## Affected Files
- src/workflows/writeActionQueueIntegration.example.ts (lines 1-363)

## Description
Example/reference implementation file in production source directory. Inflates module graph and confuses static analysis.

## Suggested Remediation
Move to examples/ or docs/reference/ directory.
