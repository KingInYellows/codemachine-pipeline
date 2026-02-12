---
title: "ESLint no-restricted-types: Index Signature Evasion and Correct Suppression"
date: "2026-02-11"
category: "linting"
tags:
  - type-safety
  - eslint
  - typescript
  - no-restricted-types
  - Record<string, unknown>
severity: medium
component: eslint.config.cjs, src/**/*.ts
related_issues:
  - "#202"
related_prs:
  - "#399"
  - "#432"
symptoms:
  - "Index signatures { [key: string]: unknown } silently bypass no-restricted-types rule"
  - "JSDoc comments do not suppress ESLint warnings"
  - "Inconsistent suppression patterns across codebase"
---

# ESLint no-restricted-types: Index Signature Evasion and Correct Suppression

## Problem

When enforcing `@typescript-eslint/no-restricted-types` to flag `Record<string, unknown>`, two
subtle issues arose:

1. **Index signature evasion**: Replacing `Record<string, unknown>` with `{ [key: string]: unknown }` is structurally identical but silently bypasses the ESLint rule. This creates a false sense of compliance without adding type safety.

2. **JSDoc does not suppress ESLint**: The original rule message suggested adding `/** Intentional: [reason] */` JSDoc comments, but JSDoc annotations have no effect on ESLint warning suppression. Only `// eslint-disable-next-line` comments work.

### How It Was Discovered

During a code review of PR #432, the pattern-recognition agent flagged 3 sites where
`Record<string, unknown>` had been replaced with `{ [key: string]: unknown }` — cosmetically
different but semantically identical. The review also identified that the ESLint rule's guidance
message was directing developers to use JSDoc (which doesn't work) instead of eslint-disable
comments.

## Root Cause

- `@typescript-eslint/no-restricted-types` matches types by their **literal string representation**. It matches `Record<string, unknown>` but not the structurally equivalent `{ [key: string]: unknown }`.
- ESLint suppression only works via `// eslint-disable` directives, never via JSDoc comments.

## Solution

### 1. Fix the ESLint Rule Message

Update `eslint.config.cjs` to direct developers to the correct suppression mechanism:

```javascript
// eslint.config.cjs (lines 47-57)
'@typescript-eslint/no-restricted-types': [
  'warn',
  {
    types: {
      'Record<string, unknown>': {
        message:
          'Prefer a specific interface. If intentional (metadata, logging), add // eslint-disable-next-line with reason.',
      },
    },
  },
],
```

### 2. Use eslint-disable with Semantic Reason (for Legitimate Uses)

When `Record<string, unknown>` is genuinely needed (arbitrary object shapes, redaction, sorting):

```typescript
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: [reason]
const variable: Record<string, unknown> = {};
```

Real examples from this codebase:

```typescript
// src/telemetry/logger.ts:221 — Redaction engine processes arbitrary input keys
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: redaction output preserves arbitrary input keys
const redacted: Record<string, unknown> = {};

// src/cli/pr/shared.ts:362 — sortKeys processes arbitrary object shapes
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: sortKeys processes arbitrary object shapes
const record = obj as Record<string, unknown>;

// src/core/config/validator.ts:400 — Deprecated safety fields are open-ended
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: deprecated safety fields are open-ended
const rawSafety = raw.safety as Record<string, unknown>;
```

### 3. Use Type Guard Narrowing (Preferred When Shape Is Known)

When the object shape is defined, cast to an explicit property interface instead:

```typescript
// Cast to interface listing only accessed properties as `unknown`
const candidate = value as {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
};

// Then validate each field
if (typeof candidate.name !== 'string') return false;
```

This avoids `Record<string, unknown>` entirely and documents exactly which fields are expected.

### 4. Use Semantic Index Signatures (for Dynamic Keys)

When field names are genuinely dynamic (task IDs, locale codes), use a named index signature:

```typescript
// The key name "taskId" documents what the keys represent
tasks: { [taskId: string]: unknown };
```

This is NOT the same as evasion — it communicates that the object is a map keyed by task IDs,
which adds documentation value beyond `Record<string, unknown>`.

## Decision Tree

```
Is the object shape truly arbitrary (unknown keys)?
├─ YES → Use Record<string, unknown> + eslint-disable with reason
│
└─ NO (shape is known or partially known):
   ├─ All fields can be enumerated?
   │  └─ YES → Cast to explicit property interface { field?: unknown }
   │
   └─ Keys are dynamic but semantically meaningful?
      └─ YES → Use named index signature { [taskId: string]: unknown }
```

## Prevention

- **Rule message**: Always direct to `// eslint-disable-next-line`, never JSDoc
- **Code review**: Flag `{ [key: string]: unknown }` replacements that are cosmetic evasion
- **Semantic keys**: When using index signatures, name the key (`taskId`, not `key`)
- **Reason required**: Every eslint-disable comment must include `-- intentional: [reason]`

## References

- Issue: [#202](https://github.com/KingInYellows/codemachine-pipeline/issues/202) — Broader type safety
- PR: [#399](https://github.com/KingInYellows/codemachine-pipeline/pull/399) — Original Record audit (Cycle 6)
- PR: [#432](https://github.com/KingInYellows/codemachine-pipeline/pull/432) — Type safety enforcement + P2 fix
- ADR: [ADR-7](../adr/ADR-7-validation-policy.md) — Validation policy (Zod runtime validation)
- ESLint config: `eslint.config.cjs` (lines 47-57)
