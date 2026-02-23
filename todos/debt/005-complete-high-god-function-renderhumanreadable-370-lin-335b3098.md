---
status: complete
priority: p2
issue_id: debt-005
category: complexity
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-133
---

# God function renderHumanReadable 370 lines

## Category

complexity

## Severity / Effort

high / medium (confidence: 0.95)

## Affected Files

- src/cli/status/renderers.ts (lines 8-376)

## Description

The renderHumanReadable() function spans ~370 lines rendering 12+ distinct payload sections. Each section has nested conditionals for verbose mode and data presence checks. Longest single function in the codebase by line count.

## Suggested Remediation

Extract each section into a dedicated render function (renderQueueSection, renderApprovalsSection, etc.). Register them in an array and iterate.
