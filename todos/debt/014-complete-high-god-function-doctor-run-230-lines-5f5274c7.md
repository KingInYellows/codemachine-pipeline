---
status: complete
priority: p2
issue_id: debt-014
category: complexity
severity: high
effort: large
confidence: 0.92
tags:
  - technical-debt
  - complexity
  - high
linear_issue_id: CDMCH-169
---

# God function Doctor run 230 lines

## Category

complexity

## Severity / Effort

high / large (confidence: 0.92)

## Affected Files

- src/cli/commands/doctor.ts (lines 76-309)

## Description

Doctor.run() spans ~230 lines with nested try/catch, sequential diagnostics, 4-way exit-code determination using string-based name matching, and duplicated telemetry flush logic in success and error paths. Cyclomatic complexity >20.

## Suggested Remediation

Extract exit-code determination into a pure function. Consolidate telemetry flush into a finally block. Use array-driven diagnostic checks.
