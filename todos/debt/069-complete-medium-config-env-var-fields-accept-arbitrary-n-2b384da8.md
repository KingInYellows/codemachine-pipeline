---
status: complete
priority: p3
issue_id: debt-069
category: security
severity: medium
effort: small
confidence: 0.75
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-214
---

# Config env var fields accept arbitrary names

## Category

security

## Severity / Effort

medium / small (confidence: 0.75)

## Affected Files

- src/core/config/RepoConfig.ts (lines 104-116, 124-131, 139-141)

## Description

token_env_var and api_key_env_var accept arbitrary strings used as keys to index process.env. No validation against safe naming conventions.

## Suggested Remediation

Add regex constraint (/^[A-Z][A-Z0-9_]\*$/) and optionally reject known system variable names.
