---
status: complete
priority: p4
issue_id: debt-087
category: complexity
severity: low
effort: small
confidence: 0.80
tags:
  - technical-debt
  - complexity
  - low
linear_issue_id: CDMCH-144
---

# Complex integrations rendering duplication

## Category

complexity

## Severity / Effort

low / small (confidence: 0.80)

## Affected Files

- src/cli/status/renderers.ts (lines 254-315)

## Description

GitHub and Linear subsection patterns are nearly identical with 4-5 conditional checks each.

## Suggested Remediation

Extract renderIntegrationSection(name, data, flags) and call twice.
