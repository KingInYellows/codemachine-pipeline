---
status: complete
priority: p3
issue_id: debt-025
category: duplication
severity: medium
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-143
---

# PRD section extraction duplicated 6 times

## Category

duplication

## Severity / Effort

medium / medium (confidence: 0.95)

## Affected Files

- src/workflows/specParsing.ts (lines 32-103)

## Description

Six markdown sections are extracted using the same regex+filter+map pattern in extractPRDSections().

## Suggested Remediation

Extract a helper extractBulletSection(markdown, sectionName) that encapsulates the pattern.
