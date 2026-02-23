---
status: complete
priority: p2
issue_id: debt-010
category: security
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - security
  - high
linear_issue_id: CDMCH-154
---

# AutoFixEngine passes full process env to child processes

## Category
security

## Severity / Effort
high / medium (confidence: 0.95)

## Affected Files
- src/workflows/autoFixEngine.ts (lines 419-424)

## Description
The autoFixEngine spreads all process.env (including GITHUB_TOKEN, LINEAR_API_KEY) into validation command child processes. Unlike CodeMachineCLIAdapter and codeMachineRunner which use a filtered allowlist.

## Suggested Remediation
Apply the same filterEnvironment() pattern used by CodeMachineCLIAdapter and codeMachineRunner.
