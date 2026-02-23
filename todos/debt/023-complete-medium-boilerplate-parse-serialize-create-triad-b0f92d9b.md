---
status: complete
priority: p3
issue_id: debt-023
category: ai-patterns
severity: medium
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - ai-patterns
  - medium
linear_issue_id: CDMCH-137
---

# Boilerplate parse-serialize-create triad across 15 models

## Category
ai-patterns

## Severity / Effort
medium / medium (confidence: 0.95)

## Affected Files
- src/core/models/Feature.ts, TraceLink.ts, ArtifactBundle.ts, ExecutionTask.ts, ContextDocument.ts
- 15 model files total in src/core/models/

## Description
Every model file follows identical boilerplate: define Zod schema, provide parseX(), serializeX(), createX() with near-identical implementations.

## Suggested Remediation
Create a generic createModelParser<T>(schema) helper that returns typed parse/serialize functions.
