# Rate Limit Reference

**Version:** 1.0.0
**Last Updated:** 2025-12-15

This document describes how the AI Feature Pipeline handles API rate limits, persists rate limit envelopes, manages cooldown states, and guides operators through rate limit failure scenarios.

## Overview

The HTTP client module implements zero-tolerance rate limit discipline by:

- Extracting rate limit metadata from API response headers
- Persisting envelopes to `rate_limits.json` in run directories
- Implementing exponential backoff with jitter for retries
- Entering cooldown states when limits are approached
- Surfacing actionable guidance for manual intervention

## Rate Limit Ledger Schema

### File Location

Each run directory contains a rate limit ledger at:

```
.codepipe/runs/<feature_id>/rate_limits.json
```

### Schema Structure

```json
{
  "schema_version": "1.0.0",
  "feature_id": "optional-feature-identifier",
  "providers": {
    "github": {
      "provider": "github",
      "state": {
        "remaining": 4999,
        "reset": 1234567890,
        "inCooldown": false,
        "cooldownUntil": "2024-01-15T12:00:00.000Z"
      },
      "lastError": {
        "timestamp": "2024-01-15T11:00:00.000Z",
        "message": "Rate limit exceeded",
        "requestId": "req_abc123"
      },
      "recentEnvelopes": [
        {
          "provider": "github",
          "remaining": 4999,
          "reset": 1234567890,
          "retryAfter": 60,
          "timestamp": "2024-01-15T11:00:00.000Z",
          "requestId": "req_abc123",
          "endpoint": "https://api.github.com/repos/org/repo",
          "statusCode": 200
        }
      ],
      "lastUpdated": "2024-01-15T11:00:00.000Z"
    },
    "linear": {
      "provider": "linear",
      "state": {
        "remaining": 1450,
        "reset": 1234567890,
        "inCooldown": false
      },
      "recentEnvelopes": [],
      "lastUpdated": "2024-01-15T11:00:00.000Z"
    }
  },
  "metadata": {
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T11:00:00.000Z"
  }
}
```

### Field Descriptions

#### Top Level

- `schema_version`: Semantic version for migrations (currently `1.0.0`)
- `feature_id`: Optional reference to the feature being developed (not automatically populated by the ledger writer yet; orchestration layers may set this when creating manifests)
- `providers`: Provider-specific rate limit states (keyed by provider name)
- `metadata`: Ledger creation and update timestamps

#### Provider State

- `provider`: Provider identifier (`github`, `linear`, `graphite`, `codemachine`, `custom`)
- `state.remaining`: Number of API requests remaining in current window
- `state.reset`: Unix epoch timestamp when rate limit window resets
- `state.inCooldown`: Boolean indicating if provider is in cooldown
- `state.cooldownUntil`: ISO 8601 timestamp when cooldown expires (if applicable)
- `lastError`: Most recent rate limit error encountered (if any)
- `recentEnvelopes`: Array of last 10 rate limit envelopes (FIFO)
- `lastUpdated`: ISO 8601 timestamp of last state update

#### Envelope Structure

- `provider`: Provider that returned this envelope
- `remaining`: Requests remaining from `x-ratelimit-remaining` header
- `reset`: Reset timestamp from `x-ratelimit-reset` header (unix epoch)
- `retryAfter`: Retry delay in seconds from `retry-after` header
- `timestamp`: ISO 8601 timestamp when envelope was captured
- `requestId`: Unique request ID for tracing (`req_<hex>`)
- `endpoint`: API endpoint called (with sensitive query params removed)
- `statusCode`: HTTP status code of the response
- `errorMessage`: Optional error message if status was 429 or 5xx

## Rate Limit Header Extraction

### GitHub API

The HTTP client extracts these headers from GitHub responses:

| Header                  | Purpose                               | Example      |
| ----------------------- | ------------------------------------- | ------------ |
| `x-ratelimit-remaining` | Requests remaining in window          | `4999`       |
| `x-ratelimit-reset`     | Unix timestamp when limit resets      | `1705329600` |
| `retry-after`           | Seconds to wait before retry (on 429) | `60`         |

**GitHub Rate Limits:**

- **Primary Limit:** 5,000 requests/hour for authenticated users
- **Secondary Limits:** Per-endpoint abuse detection (variable thresholds)
- **Reset Window:** Hourly, based on first request in window

### Linear API

Linear uses different header conventions:

| Header                  | Purpose                | Example      |
| ----------------------- | ---------------------- | ------------ |
| `x-ratelimit-remaining` | Requests remaining     | `1450`       |
| `x-ratelimit-reset`     | Reset timestamp        | `1705329600` |
| `retry-after`           | Retry delay in seconds | `60`         |

**Linear Rate Limits:**

- **Standard Limit:** 1,500 requests/hour
- **Burst Limit:** 60 requests/minute
- **Reset Window:** Sliding window

### Custom Providers

For custom providers (`graphite`, `codemachine`, or generic HTTP APIs), the client attempts to extract standard headers but gracefully handles missing values.

## Retry Logic and Backoff

### Exponential Backoff Formula

```
backoff_ms = min(initial_backoff * 2^attempt, max_backoff) + jitter
```

Where:

- `initial_backoff`: Default 1000ms (configurable)
- `max_backoff`: Default 32000ms (configurable)
- `jitter`: ±10% random variance to prevent thundering herd
- `attempt`: Zero-indexed retry attempt number

### Retry-After Override

When a `retry-after` header is present (typically on 429 responses), the client:

1. Ignores exponential backoff calculation
2. Waits exactly `retry-after` seconds before retrying
3. Caps retry delay at `max_backoff` to prevent indefinite waits

### Reset-Time Backoff

If `retry-after` is absent but `x-ratelimit-reset` is present:

1. Calculate wait time: `reset_timestamp - current_time`
2. Cap at `max_backoff`
3. Add jitter
4. Wait and retry

## Cooldown States

### Primary Cooldown (Low Remaining Requests)

**Trigger:** `remaining <= 10` requests

**Behavior:**

- Set `state.inCooldown = true`
- Calculate `cooldownUntil` from reset timestamp
- Log warning with cooldown end time
- Continue processing requests (no automatic pause)

**Rationale:** Operators should be aware of low quota but pipeline doesn't halt unless configured with approval gates.

### Secondary Cooldown (Rate Limit Hit)

**Trigger:** HTTP 429 response received

**Behavior:**

- Set `state.inCooldown = true`
- Record error in `lastError` field
- Calculate `cooldownUntil` from `retry-after` or `reset` header
- Log error with request ID and endpoint
- Retry with backoff (up to `maxRetries` attempts)

### Manual Acknowledgement Requirement

**Trigger:** 3 consecutive HTTP 429 responses for same provider

**Behavior:**

- Log critical error with escalation guidance
- Suggest manual cooldown clearing or config review
- Provide diagnostic commands (see [Operator Actions](#operator-actions))

**Implementation Note:** Currently logged as critical warnings; future CLI commands (`codepipe rate-limits clear`) will enable interactive acknowledgement.

## Error Escalation Guidance

### Error Taxonomy

All HTTP errors are classified into three types:

1. **Transient Errors** (Retryable)
   - `429 Too Many Requests`: Rate limit exceeded
   - `503 Service Unavailable`: Provider downtime
   - `502/504 Bad Gateway/Timeout`: Network issues
   - Network-level failures (ECONNRESET, timeouts)

2. **Permanent Errors** (Non-Retryable)
   - `404 Not Found`: Resource doesn't exist
   - `422 Validation Error`: Invalid request payload
   - `400 Bad Request`: Malformed request

3. **Human Action Required** (Non-Retryable)
   - `401 Unauthorized`: Missing or invalid token
   - `403 Forbidden`: Insufficient permissions

### Failure Escalation Flow

```
[HTTP Request]
     |
     v
[Transient Error?] --No--> [Log and Fail]
     |
    Yes
     |
     v
[Retry with Backoff] (up to maxRetries)
     |
     v
[Still Failing?] --No--> [Success]
     |
    Yes
     |
     v
[Log Critical Error + Escalation Guidance]
     |
     v
[Pause Run / Request Manual Intervention]
```

## Operator Actions

### Inspecting Rate Limit State

**View current rate limits for a run:**

```bash
cat .codepipe/runs/<feature_id>/rate_limits.json | jq '.providers'
```

**Check GitHub remaining requests:**

```bash
cat .codepipe/runs/<feature_id>/rate_limits.json | \
  jq '.providers.github.state.remaining'
```

**Check if in cooldown:**

```bash
cat .codepipe/runs/<feature_id>/rate_limits.json | \
  jq '.providers.github.state.inCooldown'
```

### Clearing Cooldown (Manual Override)

**Warning:** Only clear cooldowns if you've verified rate limits have reset.

```bash
# Edit ledger to clear cooldown
jq '.providers.github.state.inCooldown = false | del(.providers.github.state.cooldownUntil)' \
  .codepipe/runs/<feature_id>/rate_limits.json > temp.json && \
  mv temp.json .codepipe/runs/<feature_id>/rate_limits.json
```

**Future CLI Command:**

```bash
# Not yet implemented
codepipe rate-limits clear --provider github --run <feature_id>
```

### Verifying Token Scopes

**GitHub:**

```bash
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/rate_limit
```

Response shows `resources.core.limit` (should be 5000 for authenticated) and `remaining`.

**Linear:**

```bash
curl -H "Authorization: $LINEAR_API_KEY" \
  https://api.linear.app/graphql \
  -d '{"query": "{ rateLimit { remaining resetAt } }"}'
```

### Monitoring Rate Limit Consumption

**Track envelope history:**

```bash
cat .codepipe/runs/<feature_id>/rate_limits.json | \
  jq '.providers.github.recentEnvelopes[] | {timestamp, remaining, endpoint}'
```

**Identify high-consumption endpoints:**

```bash
cat .codepipe/runs/<feature_id>/rate_limits.json | \
  jq '.providers.github.recentEnvelopes | group_by(.endpoint) |
      map({endpoint: .[0].endpoint, count: length}) | sort_by(.count) | reverse'
```

## Integration with Run Directory Manager

The rate limit ledger integrates with `runDirectoryManager.ts` through manifest updates:

### Manifest Reference

When the ledger is created, the run manifest can optionally track its path:

```json
{
  "rate_limits": {
    "rate_limits_file": "rate_limits.json"
  }
}
```

### Atomic Writes

While the ledger itself doesn't use `withLock()` (to avoid blocking HTTP responses), operators should use run directory locks when manually editing ledgers. The telemetry helper exports two filesystem utilities:

- `readRateLimitLedger(runDir: string)` – loads and parses `rate_limits.json`, returning a schema-compliant object (creating one when the file is missing).
- `writeRateLimitLedger(runDir: string, ledger: RateLimitLedgerData)` – persists updated ledger content back to disk.

Using them keeps ad-hoc edits aligned with the schema and metadata conventions:

```typescript
import { withLock } from './persistence/runDirectoryManager';

await withLock(runDir, async () => {
  // Safe to edit rate_limits.json here
  const ledger = await readRateLimitLedger(runDir);
  ledger.providers.github.state.inCooldown = false;
  await writeRateLimitLedger(runDir, ledger);
});
```

## HTTP Client Configuration

### Rate Limit Settings

```typescript
const client = new HttpClient({
  baseUrl: 'https://api.github.com',
  provider: Provider.GITHUB,
  token: process.env.GITHUB_TOKEN,
  runDir: '.codepipe/runs/feature-123',
  maxRetries: 3,
  initialBackoff: 1000,
  maxBackoff: 32000,
  timeout: 30000,
});
```

### Provider-Specific Recommendations

**GitHub:**

- `maxRetries`: 3 (primary limits rarely need more)
- `initialBackoff`: 1000ms
- `timeout`: 30000ms (GraphQL queries can be slow)

**Linear:**

- `maxRetries`: 5 (smaller rate limit, more sensitive to bursts)
- `initialBackoff`: 500ms
- `timeout`: 15000ms

**Custom/CodeMachine:**

- `maxRetries`: 2
- `initialBackoff`: 2000ms
- `timeout`: 60000ms (agent calls can be slow)

## Troubleshooting

### Symptom: Repeated 429 errors despite waiting

**Possible Causes:**

1. Secondary abuse detection limits (GitHub)
2. Incorrect token scopes
3. Shared token across multiple pipelines

**Resolution:**

```bash
# Check token scopes
curl -I -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user

# Verify X-OAuth-Scopes header includes: repo, workflow

# Check for concurrent usage
ps aux | grep codepipe
```

### Symptom: Cooldown never clears

**Possible Causes:**

1. Reset timestamp is in the future (timezone issue)
2. Stale lock on ledger file

**Resolution:**

```bash
# Check reset timestamp
cat .codepipe/runs/<feature_id>/rate_limits.json | \
  jq '.providers.github.state.reset' | \
  xargs -I {} date -d @{}

# If in past, manually clear cooldown (see Operator Actions)
```

### Symptom: Ledger not being written

**Possible Causes:**

1. Run directory not passed to HttpClient constructor
2. File permission issues

**Resolution:**

```bash
# Check run directory exists and is writable
ls -ld .codepipe/runs/<feature_id>/
# Should show drwxr-xr-x or similar with write permission

# Check client initialization in logs
grep "runDir" .codepipe/runs/<feature_id>/logs/*.ndjson
```

## Security and Privacy

### Token Redaction

The HTTP client sanitizes all logs to prevent token leakage:

**Headers:**

- `Authorization`: Redacted as `[REDACTED]`
- `X-API-Key`: Redacted as `[REDACTED]`
- `Cookie`: Redacted as `[REDACTED]`

**URLs:**

- Known secret parameters (`token`, `access_token`, `api_key`, etc.) are removed entirely
- Other parameters matching sensitive field patterns are redacted as `[REDACTED]`

**Ledger Storage:**

- Tokens are NEVER stored in `rate_limits.json`
- Only non-sensitive headers (remaining, reset) are persisted

### Ledger File Permissions

Recommended permissions:

```bash
chmod 600 .codepipe/runs/*/rate_limits.json
```

Prevents other users from reading rate limit state.

## Future Enhancements

### Planned Features (Not Yet Implemented)

1. **CLI Commands:**
   - `codepipe rate-limits status`: View current state across all providers
   - `codepipe rate-limits clear <provider>`: Clear cooldown with confirmation
   - `codepipe rate-limits history <provider>`: Show envelope timeline

2. **Proactive Throttling:**
   - Pause task execution when `remaining < threshold`
   - Resume automatically after reset window

3. **Multi-Run Coordination:**
   - Shared ledger across runs using same provider token
   - SQLite index for cross-run rate limit tracking

4. **Metrics Export:**
   - Prometheus metrics for rate limit consumption
   - Grafana dashboard templates

## References

- **Blueprint:** `docs/blueprint/01_Blueprint_Foundation.md` (Section 3.0: Rate Limit Discipline)
- **Technology Stack:** `docs/blueprint/02_System_Structure_and_Data.md` (Section 3.2: HTTP Layer)
- **HTTP Client Implementation:** `src/adapters/http/client.ts`
- **Ledger Implementation:** `src/telemetry/rateLimitLedger.ts`
- **Unit Tests:** `tests/unit/httpClient.spec.ts`

## Changelog

| Version | Date       | Changes                         |
| ------- | ---------- | ------------------------------- |
| 1.0.0   | 2024-01-15 | Initial reference documentation |
