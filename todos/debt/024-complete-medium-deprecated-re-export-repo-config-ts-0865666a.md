---
status: complete
priority: p3
issue_id: debt-024
category: architecture
severity: medium
effort: small
confidence: 0.95
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-141
---

# Deprecated re-export repo-config ts

## Category

architecture

## Severity / Effort

medium / small (confidence: 0.95)

## Affected Files

- src/core/config/repo_config.ts (lines 1-8)
- src/cli/commands/health.ts (line 4)
- src/cli/commands/doctor.ts (line 5)
- src/cli/commands/init.ts (line 15)

## Description

repo_config.ts exists solely as a deprecated re-export. Three commands still import from this deprecated path.

## Suggested Remediation

Update the three commands to import from ./RepoConfig. Delete repo_config.ts.
