---
status: complete
priority: p4
issue_id: debt-094
category: architecture
severity: low
effort: small
confidence: 0.70
tags:
  - technical-debt
  - architecture
  - low
linear_issue_id: CDMCH-157
---

# Workflows barrel minimal

## Category

architecture

## Severity / Effort

low / small (confidence: 0.70)

## Affected Files

- src/workflows/index.ts (lines 1-28)

## Description

Only 7 symbols exported from 2 files. 40+ workflow modules have no barrel representation.

## Suggested Remediation

Expand to include commonly used APIs or remove and standardize on direct imports.
