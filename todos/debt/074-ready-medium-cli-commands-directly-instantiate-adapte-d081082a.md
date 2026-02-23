---
status: ready
priority: p3
issue_id: debt-074
category: architecture
severity: medium
effort: small
confidence: 0.72
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-219
---

# CLI commands directly instantiate adapters

## Category
architecture

## Severity / Effort
medium / small (confidence: 0.72)

## Affected Files
- src/cli/commands/start.ts (lines 33-37)
- src/cli/pr/shared.ts (line 18)

## Description
CLI commands directly call factory functions for adapters. Tight coupling prevents unit testing without module mocking.

## Suggested Remediation
Introduce an AdapterRegistry or service container pattern for dependency injection.
