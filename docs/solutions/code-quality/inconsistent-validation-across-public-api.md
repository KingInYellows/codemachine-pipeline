---
title: Inconsistent Input Validation Across Public API Methods
date: 2026-03-05
category: code-quality
tags: [validation, input-sanitization, graphql, adapter, defensive-programming, helper-extraction]
severity: p1
component: adapters/linear, adapters/agents, workflows
symptom: 'Validation exists in one code path but is absent from sibling public methods accepting the same parameter'
root_cause: 'Validation was added to an internal helper (getSnapshotPath) but not to the public methods that also accept the same input'
resolution: 'Extract shared validation into a private method and call it at the top of every public method'
related_issues: ['CDMCH-161', 'CDMCH-201', 'PR #740']
---

# Inconsistent Input Validation Across Public API Methods

## Problem

When a class has multiple public methods that accept the same parameter (e.g.,
`issueId`), validation is sometimes added to only one code path while the others
pass the input directly to an external system (API, database, file system).

In `LinearAdapter`, `getSnapshotPath()` validated `issueId` format using a regex
check, but the four public methods -- `fetchIssue()`, `fetchComments()`,
`updateIssue()`, `postComment()` -- all passed `issueId` directly to GraphQL
queries without validation. A malformed identifier would reach the Linear API
and produce confusing GraphQL errors instead of a clear validation failure.

## Root Cause

The validation was initially added as an inline check inside `getSnapshotPath()`
to prevent path traversal in file system operations. Because the validation was
embedded in a specific method rather than extracted as a reusable guard, it was
not applied to other methods that also handle the same parameter.

This is a common pattern when validation is added reactively (in response to a
specific bug or security concern) rather than applied systematically to the
entire public API surface.

## Fix

### Step 1: Extract a shared validation method

Move the inline validation logic into a dedicated private method:

```typescript
private validateIssueId(issueId: string): void {
  if (!issueId || issueId.length > 100 || !/^[A-Z][A-Z0-9]*-\d+$/.test(issueId)) {
    throw new Error(`Invalid Linear issue ID: ${JSON.stringify(issueId)}`);
  }
}
```

### Step 2: Add validation at the top of every public method

Call the validation as the first line of each public method that accepts the
parameter:

```typescript
async fetchIssue(issueId: string): Promise<LinearIssue> {
  this.validateIssueId(issueId);
  // ... rest of method
}

async fetchComments(issueId: string): Promise<LinearComment[]> {
  this.validateIssueId(issueId);
  // ... rest of method
}

async updateIssue(params: UpdateIssueParams): Promise<void> {
  this.validateIssueId(params.issueId);
  // ... rest of method
}

async postComment(params: PostCommentParams): Promise<void> {
  this.validateIssueId(params.issueId);
  // ... rest of method
}
```

### Step 3: Delegate from the original call site

The original method that had the inline check now delegates to the shared method:

```typescript
private getSnapshotPath(issueId: string): string {
  this.validateIssueId(issueId);  // was inline before
  return path.join(this.runDir!, SNAPSHOT_DIR, `linear_issue_${issueId}.json`);
}
```

## Detection

After adding validation to any method in a class, run this check to find sibling
methods that accept the same parameter without validation:

```bash
# Find all methods in the same file that accept the validated parameter
grep -n 'issueId' src/adapters/linear/LinearAdapter.ts

# Generalized: find all public async methods in a class
grep -n 'async.*issueId\|async.*params.*issueId' src/adapters/linear/LinearAdapter.ts
```

For a broader codebase sweep:

```bash
# Find adapter classes with public methods that accept string IDs
grep -rn 'async \(fetch\|update\|post\|delete\|create\).*Id.*string' src/adapters/

# Cross-reference: which of those methods call a validate function?
grep -rn 'this\.validate' src/adapters/ | grep -oP '\w+Adapter' | sort -u
```

## Related Pattern: Helper Extraction for Repetitive Logic

The same session (CDMCH-201) applied a similar extraction technique for a
different kind of duplication. In `WriteActionQueue.updateActionStatus()`, five
inline ternary expressions computed per-status count deltas:

```typescript
// Before: repeated ternary pattern
const pendingDelta = newStatus === 'pending' ? 1 : oldStatus === 'pending' ? -1 : 0;
const inProgressDelta = newStatus === 'in_progress' ? 1 : oldStatus === 'in_progress' ? -1 : 0;
// ... 3 more identical patterns
```

Extracted to a `statusDelta(target, oldStatus, newStatus)` helper:

```typescript
private statusDelta(
  target: WriteActionStatus,
  oldStatus: WriteActionStatus,
  newStatus: WriteActionStatus
): number {
  if (newStatus === target) return 1;
  if (oldStatus === target) return -1;
  return 0;
}
```

**When to apply:** Any time 3+ expressions follow the same structure with only
a parameter varying, extract a helper that takes the varying part as an argument.

## Prevention Checklist

- [ ] When adding validation to any method that accepts an external input, grep
      the entire class for other methods that accept the same parameter
- [ ] Validation should be a standalone private method, not inlined in a
      specific code path
- [ ] Call the validation method as the first statement in each public method
      (fail-fast pattern)
- [ ] Include format validation tests for each public method, not just the
      method where the validation was originally added
- [ ] When a class has 3+ methods computing the same result from the same
      inputs, extract a helper method

## Related Documentation

- `docs/solutions/code-quality/tech-debt-refactoring-patterns.md` -- broader
  refactoring patterns catalog from the same codebase
- `docs/solutions/logic-errors/engine-schema-canhandle-overreach-codeMachineCLI-20260213.md` --
  a related validation gap in a different module (schema validation bypass)
- MEMORY.md entry: "Unbounded Retry Delay from External API Values" -- the
  CDMCH-196 fix from this same session (already documented)
