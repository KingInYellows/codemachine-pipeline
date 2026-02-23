---
status: complete
priority: p2
issue_id: debt-017
category: security
severity: high
effort: small
confidence: 0.90
tags:
  - technical-debt
  - security
  - high
linear_issue_id: CDMCH-174
---

# GitHub API URL path parameters not encoded

## Category

security

## Severity / Effort

high / small (confidence: 0.90)

## Affected Files

- src/adapters/github/GitHubAdapter.ts (lines 166-175)
- src/adapters/github/GitHubAdapter.ts (lines 304-314)
- src/adapters/github/GitHubAdapter.ts (lines 586-598)

## Description

GitHubAdapter interpolates user-provided values (branch names, SHAs, workflow IDs) into URL paths without encoding. BranchProtectionAdapter correctly uses encodeURIComponent() but GitHubAdapter does not.

## Suggested Remediation

Apply encodeURIComponent() to all user-provided URL path parameters, consistent with BranchProtectionAdapter.
