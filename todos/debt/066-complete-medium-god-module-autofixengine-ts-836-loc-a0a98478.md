---
status: complete
priority: p3
issue_id: debt-066
category: architecture
severity: medium
effort: medium
confidence: 0.78
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-211
---

# God module autoFixEngine ts 836 LOC

## Category
architecture

## Severity / Effort
medium / medium (confidence: 0.78)

## Affected Files
- src/workflows/autoFixEngine.ts (lines 1-836)

## Description
836 lines combining validation execution, auto-fix retry, child process management, telemetry, and error summarization.

## Suggested Remediation
Extract child process execution and retry logic into a shared commandRunner utility.
