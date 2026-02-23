---
status: complete
priority: p3
issue_id: debt-064
category: security
severity: medium
effort: small
confidence: 0.80
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-209
---

# Hardcoded GitHub API version string

## Category
security

## Severity / Effort
medium / small (confidence: 0.80)

## Affected Files
- src/adapters/http/httpTypes.ts (line 118)

## Description
GITHUB_API_VERSION hardcoded as '2022-11-28'. Will eventually be deprecated by GitHub.

## Suggested Remediation
Make configurable through RepoConfig (github.api_version) with current value as default.
