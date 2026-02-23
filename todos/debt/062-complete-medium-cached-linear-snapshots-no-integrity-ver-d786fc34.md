---
status: complete
priority: p3
issue_id: debt-062
category: security
severity: medium
effort: medium
confidence: 0.80
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-207
---

# Cached Linear snapshots no integrity verification

## Category
security

## Severity / Effort
medium / medium (confidence: 0.80)

## Affected Files
- src/adapters/linear/LinearAdapter.ts (lines 652-680)

## Description
Cached issue snapshots include SHA-256 hash but loadCachedSnapshot does not verify it. Tampered files would be used without detection.

## Suggested Remediation
Recompute hash after loading and compare against stored metadata.hash.
