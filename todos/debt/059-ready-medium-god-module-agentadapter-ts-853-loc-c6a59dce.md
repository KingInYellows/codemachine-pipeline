---
status: ready
priority: p3
issue_id: debt-059
category: architecture
severity: medium
effort: medium
confidence: 0.82
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-204
---

# God module AgentAdapter ts 853 LOC

## Category
architecture

## Severity / Effort
medium / medium (confidence: 0.82)

## Affected Files
- src/adapters/agents/AgentAdapter.ts (lines 1-853)

## Description
853 lines with 14 exported symbols including Zod schemas, types, error class, mapping function, and main class.

## Suggested Remediation
Extract types and schemas into AgentAdapterTypes.ts. Move context mapping to agentContextMapping.ts.
