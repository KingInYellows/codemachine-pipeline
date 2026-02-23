---
status: ready
priority: p3
issue_id: debt-050
category: security
severity: medium
effort: small
confidence: 0.85
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-195
---

# JSON parse calls without schema validation

## Category
security

## Severity / Effort
medium / small (confidence: 0.85)

## Affected Files
- src/adapters/linear/LinearAdapter.ts (lines 659-660)
- src/persistence/runDirectoryManager.ts (lines 730-731)
- src/persistence/hashManifest.ts (lines 395-396)
- src/workflows/queueStore.ts (line 361)
- src/workflows/specComposer.ts, taskPlanner.ts, branchManager.ts

## Description
Many JSON.parse calls cast results directly to TypeScript types using 'as T' without runtime validation. Pattern is inconsistent -- some modules validate, others do not.

## Suggested Remediation
Add Zod validation after JSON.parse for all external/persisted data. Use validateOrThrow from validation/helpers.ts.
