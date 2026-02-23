---
status: complete
priority: p4
issue_id: debt-078
category: duplication
severity: low
effort: quick
confidence: 0.98
tags:
  - technical-debt
  - duplication
  - low
linear_issue_id: CDMCH-128
---

# process env JSON-OUTPUT duplication across 16 files

## Category

duplication

## Severity / Effort

low / quick (confidence: 0.98)

## Affected Files

- 16 CLI command files

## Description

process.env.JSON_OUTPUT = '1' repeated in 16 files. Fragile convention.

## Suggested Remediation

Absorbed into CLI TelemetryCommand base class. Or export setJsonOutputMode() from cli/utils/.
