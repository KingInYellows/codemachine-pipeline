---
title: Layer Inversion Fix via Type Extraction to core/models
date: 2026-03-01
category: integration-issues
tags: [architecture, layer-inversion, dependency-direction, type-extraction, persistence, workflows]
severity: p1
component: persistence/branchProtectionStore, workflows/branchProtectionReporter, core/models
symptom: "persistence/ layer imports types from workflows/ layer, creating an upward dependency"
root_cause: "Shared type (BranchProtectionReport) was defined in the higher-level workflows/ layer and imported by the lower-level persistence/ layer"
resolution: "Extract shared types to core/models/ and have both layers import from there"
related_issues: ["PR #661", "PR #662", "PR #663"]
---

# Layer Inversion Fix via Type Extraction to core/models

## Problem

During tech debt remediation (PRs #661-663), a multi-agent code review
identified a P1 architecture violation: `src/persistence/branchProtectionStore.ts`
imported the `BranchProtectionReport` interface from
`src/workflows/branchProtectionReporter.ts`.

This violates the intended dependency direction:

```
cli/commands  -->  workflows  -->  persistence  -->  core/models
```

When persistence/ imports from workflows/, the dependency arrow points upward,
creating a layer inversion that risks circular dependencies and makes the
persistence layer harder to test and reuse independently.

A second P1 finding in the same review: `src/cli/commands/doctor.ts` defined its
own copy of the `DiagnosticCheck` interface, duplicating the canonical definition
in `src/cli/diagnostics.ts`. This creates type drift risk where the two
definitions diverge silently over time.

### Symptoms

- `persistence/branchProtectionStore.ts` has `import { BranchProtectionReport } from '../workflows/branchProtectionReporter.js'`
- `cli/commands/doctor.ts` defines a local `DiagnosticCheck` interface identical to the one in `cli/diagnostics.ts`
- Circular dependency checker (madge) may flag the persistence-to-workflows edge

## Root Cause

When the branch protection reporting feature was originally built, the report
type was defined in the module that produced it (`branchProtectionReporter.ts`
in workflows/). The persistence layer needed to reference that type to store
reports, so it imported directly from workflows/. This is a natural but
incorrect shortcut -- the type belongs to neither layer but to the shared model
layer.

Similarly, `doctor.ts` needed `DiagnosticCheck` but the developer defined a
local copy rather than importing from the existing `diagnostics.ts` module.

## Fix

### Layer Inversion (P1)

1. Create `src/core/models/BranchProtectionReport.ts` with the shared interface
   and any related types (e.g., `BranchProtectionFinding`):

```typescript
// src/core/models/BranchProtectionReport.ts
export interface BranchProtectionFinding {
  rule: string;
  expected: string;
  actual: string;
  severity: 'error' | 'warning' | 'info';
}

export interface BranchProtectionReport {
  repository: string;
  branch: string;
  timestamp: string;
  findings: BranchProtectionFinding[];
  overallStatus: 'pass' | 'fail' | 'warning';
}
```

2. Update `persistence/branchProtectionStore.ts` to import from `core/models/`:

```typescript
// Before:
import { BranchProtectionReport } from '../workflows/branchProtectionReporter.js';

// After:
import { BranchProtectionReport } from '../core/models/BranchProtectionReport.js';
```

3. Update `workflows/branchProtectionReporter.ts` to re-export from
   `core/models/` for backward compatibility:

```typescript
// Re-export so existing consumers don't break
export type {
  BranchProtectionReport,
  BranchProtectionFinding,
} from '../core/models/BranchProtectionReport.js';
```

### Duplicate Interface (P1)

Remove the local `DiagnosticCheck` definition from `doctor.ts` and import from
the canonical location:

```typescript
// Before: local interface DiagnosticCheck { ... }
// After:
import { type DiagnosticCheck } from '../diagnostics.js';
```

## Prevention

- **Dependency direction rule:** Lower layers (core, persistence) must never
  import from higher layers (workflows, cli). Shared types belong in
  `core/models/`.
- **Detection command:** Run periodically or in CI:

```bash
# Find persistence/ files importing from workflows/
grep -rn "from.*workflows/" src/persistence/
# Find duplicate interface definitions
grep -rn "^export interface" src/ | awk -F: '{print $NF}' | sort | uniq -d
```

- **madge check:** The existing `npm run deps:check` (madge) should catch
  circular dependencies, but one-directional layer inversions that do not form
  a cycle require the grep-based check above.

## Related Documentation

- `docs/solutions/code-review/multi-agent-wave-resolution-pr-findings.md` --
  similar multi-agent review process for PR #466
- MEMORY.md entry: "[2026-02-23] Incomplete Base-Class Migration" -- related
  architecture hierarchy pattern
