---
status: ready
priority: p4
issue_id: debt-098
category: security
severity: low
effort: small
confidence: 0.70
tags:
  - technical-debt
  - security
  - low
linear_issue_id: CDMCH-165
---

# filterManifest RegExp no escaping

## Category
security

## Severity / Effort
low / small (confidence: 0.70)

## Affected Files
- src/persistence/hashManifest.ts (lines 443-457)

## Description
String pattern compiled to RegExp without escaping. User input could cause ReDoS or unexpected matching.

## Suggested Remediation
Escape regex special characters or use glob-matching library (picomatch).
