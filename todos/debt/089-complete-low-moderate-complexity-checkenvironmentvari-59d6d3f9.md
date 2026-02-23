---
status: complete
priority: p4
issue_id: debt-089
category: complexity
severity: low
effort: small
confidence: 0.80
tags:
  - technical-debt
  - complexity
  - low
linear_issue_id: CDMCH-148
---

# Moderate complexity checkEnvironmentVariables

## Category

complexity

## Severity / Effort

low / small (confidence: 0.80)

## Affected Files

- src/cli/commands/doctor.ts (lines 634-727)

## Description

Iterates environment variable checks with nested conditionals inspecting config properties.

## Suggested Remediation

Define declarative array of { envVar, configPath, checkFn } objects.
