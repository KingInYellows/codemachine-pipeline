# Feature: Cycle 8 Hardening Batch (CDMCH-201, CDMCH-196, CDMCH-161)

## Overview

Three focused fixes improving input hardening and code clarity across the
writeActionQueue, AgentAdapter, and LinearAdapter. All are small, low-risk
changes that ship as a single PR.

## Implementation Plan

### Fix 1: CDMCH-201 — Replace ternary chains in updateActionStatus

**File:** `src/workflows/writeActionQueue.ts` (lines 380–397)

**Current:** Five inline ternary expressions computing per-status deltas:
```typescript
const pendingDelta =
  status === WriteActionStatus.PENDING ? 1 : oldStatus === WriteActionStatus.PENDING ? -1 : 0;
// ... repeated for IN_PROGRESS, COMPLETED, FAILED, SKIPPED
```

**Fix:** Replace with a `computeStatusDelta` helper:
```typescript
function statusDelta(
  target: WriteActionStatus,
  oldStatus: WriteActionStatus,
  newStatus: WriteActionStatus
): number {
  if (newStatus === target) return 1;
  if (oldStatus === target) return -1;
  return 0;
}
```

Then the call site becomes:
```typescript
await this.store.updateManifestCounts(
  0,
  statusDelta(WriteActionStatus.PENDING, oldStatus, status),
  statusDelta(WriteActionStatus.IN_PROGRESS, oldStatus, status),
  statusDelta(WriteActionStatus.COMPLETED, oldStatus, status),
  statusDelta(WriteActionStatus.FAILED, oldStatus, status),
  statusDelta(WriteActionStatus.SKIPPED, oldStatus, status),
);
```

- [ ] Add `statusDelta()` function above `updateActionStatus`
- [ ] Replace 5 ternary chains with `statusDelta()` calls
- [ ] Verify existing tests pass

---

### Fix 2: CDMCH-196 — Cap retryAfterSeconds from external API

**File:** `src/adapters/agents/AgentAdapter.ts` (line 338)

**Current:** `retryAfterSeconds` from an agent error response is used directly:
```typescript
await this.sleep(agentError.retryAfterSeconds * 1000);
```

**Fix:** Cap with a reasonable upper bound (300s = 5 min):
```typescript
const MAX_RETRY_WAIT_SECONDS = 300;
// ...
await this.sleep(Math.min(agentError.retryAfterSeconds, MAX_RETRY_WAIT_SECONDS) * 1000);
```

- [ ] Add `MAX_RETRY_WAIT_SECONDS = 300` constant near other constants
- [ ] Apply `Math.min()` cap at the sleep call site
- [ ] Log when the cap is applied (warn level)

---

### Fix 3: CDMCH-161 — Add issueId validation to LinearAdapter public methods

**File:** `src/adapters/linear/LinearAdapter.ts`

**Current:** `getSnapshotPath()` (line 514) validates issue identifier format, but
public methods `fetchIssue()`, `fetchComments()`, `updateIssue()`, `postComment()`
pass `issueId` directly to GraphQL without validation.

**Fix:** Extract the validation from `getSnapshotPath()` into a shared guard and
call it at each public method entry point:

```typescript
private validateIssueId(issueId: string): void {
  if (!issueId || issueId.length > 100 || !/^[A-Z][A-Z0-9]*-\d+$/.test(issueId)) {
    throw new Error(`Invalid Linear issue ID: ${JSON.stringify(issueId)}`);
  }
}
```

Then `getSnapshotPath()` calls `this.validateIssueId(issueId)` instead of
inlining the check, and each public method adds `this.validateIssueId(issueId)`
as its first line.

- [ ] Extract `validateIssueId()` private method
- [ ] Add calls in `fetchIssue()`, `fetchComments()`, `updateIssue()`, `postComment()`
- [ ] Simplify `getSnapshotPath()` to use the shared method
- [ ] Verify existing tests pass

---

## Acceptance Criteria

- All 5 ternary chains replaced with `statusDelta()` calls
- `retryAfterSeconds` capped at 300s with warning log
- All LinearAdapter public methods validate issueId format before API call
- `npm test` passes
- `npm run lint` passes

## References

- `src/workflows/writeActionQueue.ts:359-407` — updateActionStatus
- `src/adapters/agents/AgentAdapter.ts:333-338` — retryAfterSeconds sleep
- `src/adapters/linear/LinearAdapter.ts:513-517` — existing getSnapshotPath validation
