---
status: ready
priority: p3
issue_id: debt-071
category: architecture
severity: medium
effort: small
confidence: 0.75
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-216
---

# Barrel file re-exports 137 symbols

## Category
architecture

## Severity / Effort
medium / small (confidence: 0.75)

## Affected Files
- src/core/models/index.ts (lines 1-218)

## Description
137 individually named symbols from 15 model files re-exported through a single barrel. Tree-shaking difficulties, circular dependency risk, IDE slowdowns.

## Suggested Remediation
Split into domain-grouped sub-barrels or encourage direct imports for internal code.
