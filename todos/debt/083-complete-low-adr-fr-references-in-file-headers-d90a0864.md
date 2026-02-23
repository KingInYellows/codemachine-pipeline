---
status: complete
priority: p4
issue_id: debt-083
category: ai-patterns
severity: low
effort: quick
confidence: 0.85
tags:
  - technical-debt
  - ai-patterns
  - low
linear_issue_id: CDMCH-136
---

# ADR-FR references in file headers

## Category

ai-patterns

## Severity / Effort

low / quick (confidence: 0.85)

## Affected Files

- src/core/models/ContextDocument.ts, Feature.ts, ExecutionTask.ts
- src/workflows/taskPlanner.ts, writeActionQueue.ts

## Description

Formulaic 'Implements: FR-X, ADR-Y' references in nearly every file header. Maintenance overhead as references become stale.

## Suggested Remediation

Remove. If traceability needed, maintain a single traceability matrix document.
