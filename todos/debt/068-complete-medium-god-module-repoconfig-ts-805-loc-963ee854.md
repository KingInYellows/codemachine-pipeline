---
status: complete
priority: p3
issue_id: debt-068
category: architecture
severity: medium
effort: medium
confidence: 0.78
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-213
---

# God module RepoConfig ts 805 LOC

## Category

architecture

## Severity / Effort

medium / medium (confidence: 0.78)

## Affected Files

- src/core/config/RepoConfig.ts (lines 1-805)

## Description

805 lines combining Zod schemas, environment variable overrides, default constants, file I/O, and validation error formatting. Imported by nearly every module.

## Suggested Remediation

Split into RepoConfigSchema.ts, RepoConfigDefaults.ts, and RepoConfigLoader.ts.
