---
status: complete
priority: p3
issue_id: debt-037
category: ai-patterns
severity: medium
effort: quick
confidence: 0.88
tags:
  - technical-debt
  - ai-patterns
  - medium
linear_issue_id: CDMCH-179
---

# Over-commented Zod schema fields in model files

## Category
ai-patterns

## Severity / Effort
medium / quick (confidence: 0.88)

## Affected Files
- src/core/models/ContextDocument.ts, ExecutionTask.ts, Feature.ts, ResearchTask.ts, Specification.ts
- All 15 model files

## Description
Model files combine Zod schemas with JSDoc that duplicates the schema constraints. The Zod schema is the source of truth.

## Suggested Remediation
Remove JSDoc from Zod schema fields where the schema already communicates the constraint.
