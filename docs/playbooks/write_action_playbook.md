# Write Action Queue Playbook

## Overview

The Write Action Queue is a throttling and retry mechanism for GitHub write operations (PR comments, labels, review requests) designed to prevent secondary rate limits and abuse detection. It implements IR-6 and IR-7 integration requirements for rate-limit safe HTTP calls.

## Purpose

GitHub's REST API enforces both primary rate limits (typically 5,000 requests/hour for authenticated users) and secondary rate limits for content creation operations. The secondary limits are less well-documented and can vary based on:

- Request patterns and frequency
- Account age and reputation
- Repository activity
- Content size and type

When secondary limits are hit, GitHub returns `429 Too Many Requests` responses with `retry-after` headers. Repeated violations can lead to temporary API access suspension.

The Write Action Queue serializes write operations, implements backoff/retry logic, monitors rate limit state via the Rate Limit Ledger, and pauses operations when cooldowns are triggered.

## Architecture

### Components

1. **WriteActionQueue** (`src/workflows/writeActionQueue.ts`)
   - Main queue implementation with JSONL persistence
   - Serialized action execution with concurrency limits
   - Idempotency key-based deduplication
   - Integration with RateLimitLedger for cooldown awareness

2. **RateLimitLedger** (`src/telemetry/rateLimitLedger.ts`)
   - Tracks rate limit envelopes from HTTP responses
   - Manages cooldown state per provider
   - Detects consecutive 429s requiring manual acknowledgement

3. **Queue Storage** (run directory: `write_actions/`)
   - `queue.jsonl`: Append-only action log (one JSON object per line)
   - `manifest.json`: Metadata with counts, checksums, and concurrency settings

### Action Types

The queue supports the following GitHub write operations:

- `PR_COMMENT`: Create PR comments
- `PR_LABEL`: Add labels to PRs
- `PR_REVIEW_REQUEST`: Request reviewers for PRs
- `PR_UPDATE`: Update PR title, body, or state
- `ISSUE_COMMENT`: Create issue comments

### Action Lifecycle

```
PENDING -> IN_PROGRESS -> COMPLETED
                |
              FAILED (after max retries)
```

Actions can also be marked as `SKIPPED` if they match an existing idempotency key.

## Configuration

### Queue Initialization

```typescript
import { createWriteActionQueue, WriteActionType } from './workflows/writeActionQueue';

const queue = createWriteActionQueue({
  runDir: '/path/to/run/directory',
  featureId: 'feature-123',
  provider: 'github',
  logger: yourLogger,
  metrics: yourMetricsCollector,
  maxRetries: 3, // Default: 3 attempts per action
  concurrencyLimit: 2, // Default: 2 actions in flight (conservative)
  backoffBaseMs: 2000, // Default: 2 seconds initial backoff
  backoffMaxMs: 60000, // Default: 60 seconds max backoff
});

await queue.initialize();
```

### Concurrency Knobs

The `concurrencyLimit` parameter controls how many write actions can execute simultaneously. Lower values reduce the risk of triggering secondary limits but increase queue processing time.

**Recommended values:**

- **Conservative (default):** `concurrencyLimit: 2` - Safest for avoiding abuse detection
- **Moderate:** `concurrencyLimit: 3-5` - Acceptable if your account has high reputation
- **Aggressive:** `concurrencyLimit: 10+` - Only for GitHub Apps with dedicated rate limit pools

**Environment variable override:**

```bash
export CODEPIPE_WRITE_CONCURRENCY=2
```

## Usage

### Enqueueing Actions

```typescript
// Enqueue a PR comment
await queue.enqueue(WriteActionType.PR_COMMENT, 'owner', 'repo', {
  target_number: 42,
  comment_body: 'Deployment successful!',
});

// Enqueue a review request
await queue.enqueue(WriteActionType.PR_REVIEW_REQUEST, 'owner', 'repo', {
  target_number: 42,
  reviewers: ['alice', 'bob'],
  team_reviewers: ['engineering'],
});

// Enqueue label additions
await queue.enqueue(WriteActionType.PR_LABEL, 'owner', 'repo', {
  target_number: 42,
  labels: ['ready-for-review', 'backend'],
});
```

### Draining the Queue

Provide an executor function that performs the actual GitHub API call:

```typescript
import { GitHubAdapter } from './adapters/github/GitHubAdapter';

const adapter = new GitHubAdapter({
  owner: 'owner',
  repo: 'repo',
  token: process.env.GITHUB_TOKEN,
  runDir: '/path/to/run/directory',
});

const executor = async (action: WriteAction) => {
  switch (action.action_type) {
    case WriteActionType.PR_COMMENT:
      // Use GitHub's REST API or adapter method
      await adapter.createComment(action.payload.target_number!, action.payload.comment_body!);
      break;

    case WriteActionType.PR_REVIEW_REQUEST:
      await adapter.requestReviewers({
        pull_number: action.payload.target_number!,
        reviewers: action.payload.reviewers,
        team_reviewers: action.payload.team_reviewers,
      });
      break;

    case WriteActionType.PR_LABEL:
      await adapter.addLabels(action.payload.target_number!, action.payload.labels!);
      break;

    // ... handle other action types
  }
};

// Drain the queue
const result = await queue.drain(executor);

if (!result.success) {
  console.error('Queue drain failed:', result.message);
  if (result.errors) {
    console.error('Errors:', result.errors);
  }
}
```

### Checking Queue Status

```typescript
const status = await queue.getStatus();

console.log('Queue status:', {
  total: status.total_actions,
  pending: status.pending_count,
  in_progress: status.in_progress_count,
  completed: status.completed_count,
  failed: status.failed_count,
  skipped: status.skipped_count,
  concurrency_limit: status.concurrency_limit,
});
```

### Clearing Completed Actions

```typescript
const result = await queue.clearCompleted();
console.log(result.message); // "Cleared N completed/failed/skipped action(s)"
```

## Rate Limit Handling

### Cooldown Detection

The queue integrates with `RateLimitLedger` to detect and respect cooldown periods:

1. **Automatic pause:** When `isInCooldown()` returns true, `drain()` pauses execution
2. **Manual acknowledgement:** After 3 consecutive 429 responses, the queue requires operator intervention
3. **Cooldown expiry:** Once the `cooldownUntil` timestamp passes, draining automatically resumes

### Viewing Rate Limit State

Use the CLI command to inspect the rate limit ledger:

```bash
codepipe rate-limits --json
```

This surfaces:

- Remaining request budget per provider
- Cooldown status and expiry time
- Recent 429 hit count
- Whether manual acknowledgement is required

For details, see `docs/reference/cli/rate_limit_reference.md`.

### Clearing Cooldowns

If you've reviewed the situation and want to resume operations:

```bash
codepipe rate-limits clear github
```

**Warning:** Only clear cooldowns after:

1. Confirming the secondary limit cause (burst writes, large payloads, etc.)
2. Adjusting concurrency or timing parameters
3. Ensuring sufficient time has passed (check `retry-after` headers)

## Idempotency & Deduplication

Each action is assigned an idempotency key computed from:

- Action type
- Repository owner and name
- Payload content

If you enqueue an action with the same key twice, the second enqueue returns the existing action without creating a duplicate. This ensures:

- Crash recovery doesn't spam GitHub with duplicate comments
- Resume operations pick up where they left off
- Operators can safely re-run workflows

**Example:**

```typescript
// First enqueue
const action1 = await queue.enqueue(WriteActionType.PR_COMMENT, 'owner', 'repo', {
  target_number: 42,
  comment_body: 'Hello, world!',
});

// Second enqueue (identical payload)
const action2 = await queue.enqueue(WriteActionType.PR_COMMENT, 'owner', 'repo', {
  target_number: 42,
  comment_body: 'Hello, world!',
});

// action1.action_id === action2.action_id (same action returned)
```

## Retry & Backoff

Failed actions are retried with exponential backoff:

1. **Retry count:** Each action tracks `retry_count` (max: `maxRetries`, default 3)
2. **Backoff formula:** `delay = min(backoffBaseMs * 2^retry_count, backoffMaxMs)`
3. **Default delays:** 2s, 4s, 8s (with `backoffBaseMs=2000`, `backoffMaxMs=60000`)
4. **Terminal failure:** After exhausting retries, action status becomes `FAILED`

The queue does **not** retry actions automatically after failure. Operators must:

- Clear the failed action from the queue
- Re-enqueue if necessary (with adjusted parameters or after resolving the root cause)

## Telemetry

### Metrics

The queue emits the following Prometheus metrics:

| Metric                         | Type    | Labels                    | Description                      |
| ------------------------------ | ------- | ------------------------- | -------------------------------- |
| `write_action_queue_enqueued`  | counter | `provider`, `action_type` | Actions added to queue           |
| `write_action_queue_deduped`   | counter | `provider`, `action_type` | Actions skipped via idempotency  |
| `write_action_queue_completed` | counter | `provider`, `action_type` | Actions completed successfully   |
| `write_action_queue_retried`   | counter | `provider`, `action_type` | Actions retried after failure    |
| `write_action_queue_failed`    | counter | `provider`, `action_type` | Actions failed after max retries |
| `write_action_queue_depth`     | gauge   | `provider`, `status`      | Current queue depth by status    |

### Logs

All queue operations emit structured logs with the following context fields:

- `action_id`: Unique action identifier
- `action_type`: Write action type (PR_COMMENT, etc.)
- `idempotency_key`: Deduplication key
- `retry_count`: Current retry attempt
- `provider`: GitHub provider name
- `owner`, `repo`: Target repository

Example log:

```json
{
  "level": "info",
  "message": "Action enqueued",
  "context": {
    "action_id": "wa_1640000000000_abc123def456",
    "action_type": "pr_comment",
    "idempotency_key": "sha256:...",
    "provider": "github"
  }
}
```

## CLI Integration

### Status Command

Extend the `codepipe status` command to show write action queue metrics:

```typescript
import { WriteActionQueue } from './workflows/writeActionQueue';

const queue = createWriteActionQueue({ runDir, featureId, ... });
const status = await queue.getStatus();

console.log(`Write Actions (queue): ${status.pending_count} pending, ${status.completed_count} completed`);
```

### Resume Behavior

When `codepipe resume` runs, it should:

1. Initialize the write action queue from persisted state
2. Call `queue.drain(executor)` to process pending actions
3. Respect cooldown pauses (log warnings if manual ack required)
4. Update run manifest to reflect queue progress

## Troubleshooting

### Queue Not Draining

**Symptoms:**

- `pending_count` remains high
- No actions executing despite calling `drain()`

**Diagnosis:**

1. Check rate limit ledger: `codepipe rate-limits`
2. Look for cooldown warnings in logs
3. Verify `concurrencyLimit` isn't exceeded by `in_progress_count`

**Resolution:**

- If in cooldown, wait for `cooldownUntil` timestamp or clear manually
- If manual ack required, review cause and clear with `codepipe rate-limits clear github`
- Increase `concurrencyLimit` if backlog is growing and no rate limits are active

### Duplicate Actions

**Symptoms:**

- GitHub receives the same comment/label multiple times

**Diagnosis:**

1. Check if idempotency keys are being generated correctly
2. Verify executor function isn't being called multiple times per action
3. Review queue file for duplicate `action_id` entries

**Resolution:**

- Ensure payload hashing is deterministic (no timestamps or random data)
- Fix executor to be truly idempotent (check if comment already exists before posting)

### Failed Actions Accumulating

**Symptoms:**

- `failed_count` grows over time
- Same action IDs retry and fail repeatedly

**Diagnosis:**

1. Check `last_error` field in queue.jsonl
2. Review GitHub API error responses (4xx vs 5xx)
3. Validate token permissions and repository access

**Resolution:**

- For permanent errors (403, 404), remove actions manually or adjust payloads
- For transient errors (503), increase backoff times or retry limits
- For auth errors (401), rotate token or update permissions

## Best Practices

### 1. Use Conservative Concurrency

Start with `concurrencyLimit: 2` and monitor metrics. Only increase if you observe:

- No 429 responses in rate limit ledger
- Backlog is growing faster than drain rate
- Account has high reputation (old, verified, many repos)

### 2. Batch Related Operations

Instead of enqueueing 10 separate label additions, combine them into a single action:

```typescript
// BAD: 10 API calls
for (const label of labels) {
  await queue.enqueue(WriteActionType.PR_LABEL, owner, repo, {
    target_number: pr,
    labels: [label],
  });
}

// GOOD: 1 API call
await queue.enqueue(WriteActionType.PR_LABEL, owner, repo, {
  target_number: pr,
  labels: labels,
});
```

### 3. Monitor Queue Depth

Set up alerts when `write_action_queue_depth{status="pending"}` exceeds thresholds:

- **Warning:** `> 50` (investigate drain performance)
- **Critical:** `> 200` (may indicate rate limit issues or executor failures)

### 4. Respect cooldown Signals

Do **not** bypass cooldown checks. The ledger's cooldown logic protects your account from suspension. If you're hitting secondary limits frequently:

- Reduce write operation volume
- Spread operations over longer time windows
- Use GitHub webhooks instead of polling + commenting

### 5. Persist Queue State

Always initialize the queue with a valid `runDir` and ensure the directory is not deleted mid-execution. The queue relies on JSONL persistence for crash recovery.

## Integration Constraints

This playbook assumes you've reviewed:

- **IR-6:** GitHub primary/secondary rate-limit handling (retry-after, backoff)
- **IR-7:** Content creation throttling via queues
- **FR-3:** Resumability via queue persistence
- **Section 4:** Rate-limit playbook and ledger management (see `docs/reference/cli/rate_limit_reference.md`)

For additional context on rate limit ledger structure and cooldown thresholds, consult:

- `docs/reference/cli/rate_limit_reference.md`: Ledger schema, inspection commands, manual intervention steps

## Version History

| Version | Date       | Changes                                |
| ------- | ---------- | -------------------------------------- |
| 1.0.0   | 2024-01-XX | Initial release with IR-6/IR-7 support |

## Support

For questions or issues:

1. Check queue status: `codepipe status --json`
2. Review rate limits: `codepipe rate-limits`
3. Inspect logs: `tail -f <runDir>/logs.ndjson`
4. Report bugs: GitHub issues with queue manifest and recent log excerpts
