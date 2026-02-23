---
status: complete
priority: p3
issue_id: debt-076
category: architecture
severity: medium
effort: small
confidence: 0.70
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-221
---

# Workflows widespread direct persistence imports

## Category

architecture

## Severity / Effort

medium / small (confidence: 0.70)

## Affected Files

- src/workflows/specComposer.ts, taskPlanner.ts, approvalRegistry.ts, branchManager.ts, queueStore.ts, contextAggregator.ts, patchManager.ts

## Description

20+ workflow files directly import from persistence/runDirectoryManager.ts. Tight coupling to file-system implementation.

## Suggested Remediation

Introduce a PersistenceContext interface. Or expose a facade object instead of 25+ individual exports.
