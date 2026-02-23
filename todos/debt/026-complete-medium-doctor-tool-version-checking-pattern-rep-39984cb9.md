---
status: complete
priority: p3
issue_id: debt-026
category: duplication
severity: medium
effort: small
confidence: 0.95
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-147
---

# Doctor tool version checking pattern repeated

## Category
duplication

## Severity / Effort
medium / small (confidence: 0.95)

## Affected Files
- src/cli/commands/doctor.ts (lines 356-459)

## Description
checkGitInstalled(), checkNpmInstalled(), checkDockerInstalled() follow identical 30-line patterns differing only in tool name and failure severity.

## Suggested Remediation
Extract a generic checkToolVersion(toolName, args, options) helper.
