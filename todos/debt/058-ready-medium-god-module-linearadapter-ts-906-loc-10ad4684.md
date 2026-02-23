---
status: ready
priority: p3
issue_id: debt-058
category: architecture
severity: medium
effort: medium
confidence: 0.82
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-203
---

# God module LinearAdapter ts 906 LOC

## Category
architecture

## Severity / Effort
medium / medium (confidence: 0.82)

## Affected Files
- src/adapters/linear/LinearAdapter.ts (lines 1-906)

## Description
906 lines with LinearAdapter class, error class, factory function, 7 interfaces. Handles CRUD, comments, snapshots, caching, error normalization, pagination.

## Suggested Remediation
Extract types into LinearAdapterTypes.ts. Move LinearAdapterError to shared adapter error module.
