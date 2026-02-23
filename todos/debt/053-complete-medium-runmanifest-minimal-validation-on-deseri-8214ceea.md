---
status: complete
priority: p3
issue_id: debt-053
category: security
severity: medium
effort: small
confidence: 0.85
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-198
---

# RunManifest minimal validation on deserialized data

## Category
security

## Severity / Effort
medium / small (confidence: 0.85)

## Affected Files
- src/persistence/runDirectoryManager.ts (lines 726-742)

## Description
readManifest only checks schema_version and feature_id. Does not validate structure of nested fields.

## Suggested Remediation
Create a Zod schema for RunManifest and validate parsed JSON against it.
