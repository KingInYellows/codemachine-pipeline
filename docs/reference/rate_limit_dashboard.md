# Rate Limit Dashboard Requirements

**Version:** 1.0.0
**Last Updated:** 2025-12-17
**Owners:** Observability Team
**Related Documents:** [Rate Limit Reference](../ops/rate_limit_reference.md), [Operational Architecture](../../.codemachine/artifacts/architecture/04_Operational_Architecture.md)

## Overview

This document defines the observability surfaces for rate limit telemetry, including CLI commands, Prometheus metrics, and operational runbooks for managing API provider rate limits across GitHub, Linear, and custom integrations.

## Purpose

Rate limit dashboards enable operators to:

- **Monitor Budget Consumption**: Track remaining requests and reset times per provider
- **Detect Cooldown States**: Identify providers in cooldown before workflows fail
- **Surface Manual Interventions**: Alert when repeated secondary limits require operator action
- **Plan Capacity**: Analyze historical rate limit trends to optimize request patterns
- **Troubleshoot Failures**: Correlate rate limit hits with workflow errors

---

## CLI Commands

### `codepipe rate-limits`

Display current rate limit status across all providers tracked in the run directory.

#### Synopsis

```bash
codepipe rate-limits [--feature <feature-id>] [--json] [--verbose] [--provider <name>]
codepipe rate-limits --clear <provider> --feature <feature-id>
```

#### Flags

| Flag                 | Alias | Description                                                   | Default       |
| -------------------- | ----- | ------------------------------------------------------------- | ------------- |
| `--feature <id>`     | `-f`  | Feature ID to query (defaults to current/latest)              | Latest run    |
| `--json`             | -     | Output results in JSON format                                 | `false`       |
| `--verbose`          | `-v`  | Show detailed rate limit history and diagnostics              | `false`       |
| `--provider <name>`  | `-p`  | Filter output to specific provider (github, linear, etc.)     | All providers |
| `--clear <provider>` | -     | Clear cooldown for specified provider (requires confirmation) | -             |

#### Exit Codes

- `0`: Success
- `1`: General error (file read failure, invalid provider)
- `10`: Feature not found

#### Examples

**Display all providers:**

```bash
codepipe rate-limits
```

**Display specific provider:**

```bash
codepipe rate-limits --provider github
```

**JSON output for automation:**

```bash
codepipe rate-limits --json
```

**Clear cooldown for GitHub:**

```bash
codepipe rate-limits --clear github --feature feature-auth-123
```

#### Human-Readable Output Format

```
Rate Limit Status (2025-12-17T14:32:11.123Z)

Providers tracked: 2
⚠ Providers in cooldown: 1

Provider: github
  Remaining: 4850
  Reset: 2025-12-17T15:00:00.000Z (27m 49s)
  Cooldown: Inactive
  Recent hits: 0

Provider: linear
  Remaining: 8
  Reset: 2025-12-17T14:45:00.000Z (12m 49s)
  ⚠ Cooldown: Active until 2025-12-17T14:45:00.000Z (12m 49s)
  ⚠ Manual Acknowledgement Required: 3 consecutive rate limit hits
     Action: Review rate limit strategy and clear cooldown manually when ready
  Recent hits: 3

Warnings:
  • One or more providers are in cooldown. Consider throttling requests or waiting for reset.
  • One or more providers require manual acknowledgement due to repeated rate limit hits.
    Review your rate limit strategy and use `codepipe rate-limits clear <provider>` when ready.
```

#### JSON Output Schema

```json
{
  "featureId": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "providers": {
    "github": {
      "provider": "github",
      "remaining": 4850,
      "reset": 1734444000,
      "resetAt": "2025-12-17T15:00:00.000Z",
      "secondsUntilReset": 1669,
      "inCooldown": false,
      "manualAckRequired": false,
      "recentHitCount": 0,
      "lastUpdated": "2025-12-17T14:30:00.000Z"
    },
    "linear": {
      "provider": "linear",
      "remaining": 8,
      "reset": 1734443100,
      "resetAt": "2025-12-17T14:45:00.000Z",
      "secondsUntilReset": 769,
      "inCooldown": true,
      "cooldownUntil": "2025-12-17T14:45:00.000Z",
      "secondsUntilCooldownEnd": 769,
      "manualAckRequired": true,
      "recentHitCount": 3,
      "lastError": {
        "timestamp": "2025-12-17T14:32:00.000Z",
        "message": "Rate limit exceeded",
        "requestId": "req_abc123"
      },
      "lastUpdated": "2025-12-17T14:32:05.000Z"
    }
  },
  "summary": {
    "providerCount": 2,
    "providersInCooldown": 1,
    "providersRequiringAck": 1,
    "anyInCooldown": true,
    "anyRequiresAck": true
  },
  "generatedAt": "2025-12-17T14:32:11.123Z"
}
```

---

## Prometheus Metrics

All metrics use the namespace prefix `codemachine_pipeline_`.

### Core Rate Limit Metrics

| Metric Name                      | Type  | Description                                                             | Labels     | Example Query                                                            |
| -------------------------------- | ----- | ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `rate_limit_remaining`           | Gauge | Requests remaining before rate limit                                    | `provider` | `codemachine_pipeline_rate_limit_remaining{provider="github"}`           |
| `rate_limit_reset_timestamp`     | Gauge | Unix timestamp when rate limit resets                                   | `provider` | `codemachine_pipeline_rate_limit_reset_timestamp{provider="github"}`     |
| `rate_limit_cooldown_active`     | Gauge | Whether provider is in cooldown (1=active, 0=inactive)                  | `provider` | `codemachine_pipeline_rate_limit_cooldown_active{provider="linear"}`     |
| `rate_limit_recent_hits`         | Gauge | Number of recent rate limit hits (429 responses)                        | `provider` | `codemachine_pipeline_rate_limit_recent_hits{provider="linear"}`         |
| `rate_limit_manual_ack_required` | Gauge | Whether manual acknowledgement is required (1=required, 0=not required) | `provider` | `codemachine_pipeline_rate_limit_manual_ack_required{provider="linear"}` |

### Supporting Metrics

These metrics are emitted by the HTTP client and complement rate limit reporting:

| Metric Name             | Type    | Description                           | Labels                            |
| ----------------------- | ------- | ------------------------------------- | --------------------------------- |
| `rate_limit_hits_total` | Counter | Total rate limit hits (429 responses) | `provider`, `endpoint`            |
| `http_requests_total`   | Counter | Total HTTP requests                   | `provider`, `endpoint`, `status`  |
| `http_retry_count`      | Counter | HTTP retry attempts                   | `provider`, `endpoint`, `attempt` |

### Metric Collection

Metrics are collected via the `RateLimitReporter.exportMetrics()` method, typically invoked by:

1. **CLI commands** (`codepipe rate-limits`, `codepipe status`)
2. **Workflow orchestrator** (periodic snapshots during execution)
3. **Cron jobs** (`codepipe observe` for multi-run aggregation)

**Example Integration:**

```typescript
import { createRunMetricsCollector } from './telemetry/metrics';
import { exportRateLimitMetrics } from './telemetry/rateLimitReporter';

const metrics = createRunMetricsCollector(runDir, featureId);
await exportRateLimitMetrics(runDir, metrics);
await metrics.flush(); // Writes to metrics/prometheus.txt
```

---

## Grafana Dashboard Templates

### Panel: Rate Limit Budget Overview

**Query:**

```promql
codemachine_pipeline_rate_limit_remaining
```

**Visualization:** Gauge
**Thresholds:**

- Green: `> 100`
- Yellow: `10-100`
- Red: `< 10`

**Panel Options:**

- Unit: `short`
- Min: `0`
- Max: `5000` (GitHub) / `1500` (Linear)

### Panel: Time Until Reset

**Query:**

```promql
codemachine_pipeline_rate_limit_reset_timestamp - time()
```

**Visualization:** Stat
**Unit:** `s` (seconds)

**Panel Options:**

- Display: Time remaining until reset
- Decimals: `0`

### Panel: Cooldown Status

**Query:**

```promql
codemachine_pipeline_rate_limit_cooldown_active
```

**Visualization:** Stat
**Thresholds:**

- Green: `0` (inactive)
- Red: `1` (active)

**Value Mappings:**

- `0` → `Inactive`
- `1` → `Active`

### Panel: Rate Limit Hits Over Time

**Query:**

```promql
rate(codemachine_pipeline_rate_limit_hits_total[5m])
```

**Visualization:** Time series
**Unit:** `ops` (operations per second)

**Panel Options:**

- Legend: `{{provider}} - {{endpoint}}`
- Stack: `false`

### Dashboard JSON Template

A complete Grafana dashboard JSON template is available at:

```
.codepipe/templates/grafana/rate_limits_dashboard.json
```

**Import Instructions:**

1. Navigate to Grafana → Dashboards → Import
2. Upload `rate_limits_dashboard.json`
3. Select Prometheus data source
4. Configure variables:
   - `$feature_id`: Feature ID filter (optional)
   - `$provider`: Provider filter (default: All)

---

## Operational Runbooks

### Runbook 1: Provider in Cooldown

**Symptom:** `codepipe rate-limits` shows `⚠ Cooldown: Active` for a provider.

**Diagnosis:**

1. Check remaining requests and reset time:
   ```bash
   codepipe rate-limits --provider <name>
   ```
2. Review recent envelopes in ledger:
   ```bash
   cat .codepipe/runs/<feature-id>/rate_limits.json | \
     jq '.providers.<provider>.recentEnvelopes[]'
   ```
3. Identify high-consumption endpoints:
   ```bash
   cat .codepipe/runs/<feature-id>/rate_limits.json | \
     jq '.providers.<provider>.recentEnvelopes | group_by(.endpoint) |
         map({endpoint: .[0].endpoint, count: length}) | sort_by(.count) | reverse'
   ```

**Resolution:**

- **Option A (Wait):** Wait until reset time, then resume operations
- **Option B (Clear):** Clear cooldown manually if reset has occurred:
  ```bash
  codepipe rate-limits --clear <provider> --feature <feature-id>
  ```
- **Option C (Throttle):** Reduce concurrency via environment variable:
  ```bash
  export CODEPIPE_HTTP_MAX_CONCURRENCY=2
  codepipe resume
  ```

**Prevention:**

- Set `rate_limit.cooldown_threshold` in RepoConfig to enter cooldown earlier
- Implement request batching for high-volume operations
- Use GitHub Apps instead of PATs for higher rate limits

### Runbook 2: Manual Acknowledgement Required

**Symptom:** `codepipe rate-limits` shows `⚠ Manual Acknowledgement Required` with 3+ consecutive hits.

**Diagnosis:**

1. Review error details:
   ```bash
   codepipe rate-limits --provider <name> --verbose
   ```
2. Check for secondary abuse limits (GitHub):
   ```bash
   curl -H "Authorization: Bearer $GITHUB_TOKEN" \
     https://api.github.com/rate_limit
   ```
3. Inspect logs for repeated endpoint calls:
   ```bash
   grep "rate_limit_exceeded" .codepipe/runs/<feature-id>/logs/logs.ndjson
   ```

**Resolution:**

1. **Wait for full reset:** GitHub secondary limits may require waiting beyond the primary reset window.
2. **Review strategy:** Identify code paths causing repeated requests (e.g., polling loops, pagination bugs).
3. **Clear cooldown:** After confirming strategy fix:
   ```bash
   codepipe rate-limits --clear <provider> --feature <feature-id>
   ```
4. **Resume workflow:**
   ```bash
   codepipe resume --feature <feature-id>
   ```

**Prevention:**

- Implement exponential backoff with jitter (already handled by HttpClient)
- Add caching for idempotent GET requests
- Use GraphQL batching for GitHub queries
- Set up Prometheus alerts for `rate_limit_manual_ack_required == 1`

### Runbook 3: Rate Limit Metrics Missing

**Symptom:** Prometheus metrics show no data for `rate_limit_remaining`.

**Diagnosis:**

1. Verify metrics file exists:
   ```bash
   ls -la .codepipe/runs/<feature-id>/metrics/prometheus.txt
   ```
2. Check metrics content:
   ```bash
   grep "rate_limit" .codepipe/runs/<feature-id>/metrics/prometheus.txt
   ```
3. Verify ledger file exists:
   ```bash
   cat .codepipe/runs/<feature-id>/rate_limits.json
   ```

**Resolution:**

1. **Run CLI command to refresh metrics:**
   ```bash
   codepipe rate-limits --feature <feature-id> --json > /dev/null
   ```
2. **Check metrics collector initialization in logs:**
   ```bash
   grep "MetricsCollector" .codepipe/runs/<feature-id>/logs/logs.ndjson
   ```
3. **Verify HTTP requests are being made:**
   ```bash
   grep "http_request" .codepipe/runs/<feature-id>/logs/logs.ndjson | head -5
   ```

**Prevention:**

- Ensure `codepipe status` or `codepipe rate-limits` is run periodically
- Configure cron job to refresh metrics every 5 minutes:
  ```bash
  */5 * * * * cd /path/to/repo && codepipe rate-limits --json > /dev/null
  ```

---

## Alerting Rules

### Prometheus Alert: Low Rate Limit Budget

**Rule:**

```yaml
groups:
  - name: rate_limits
    interval: 30s
    rules:
      - alert: RateLimitLow
        expr: codemachine_pipeline_rate_limit_remaining < 50
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: 'Rate limit budget low for {{ $labels.provider }}'
          description: 'Provider {{ $labels.provider }} has {{ $value }} requests remaining'
```

**Action:** Trigger Slack/email notification to throttle workflows or wait for reset.

### Prometheus Alert: Rate Limit Cooldown Active

**Rule:**

```yaml
- alert: RateLimitCooldown
  expr: codemachine_pipeline_rate_limit_cooldown_active == 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: 'Rate limit cooldown active for {{ $labels.provider }}'
    description: 'Provider {{ $labels.provider }} is in cooldown. Check rate_limits.json for reset time.'
```

**Action:** Pause non-essential workflows, alert ops team.

### Prometheus Alert: Manual Acknowledgement Required

**Rule:**

```yaml
- alert: RateLimitManualAck
  expr: codemachine_pipeline_rate_limit_manual_ack_required == 1
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: 'Manual acknowledgement required for {{ $labels.provider }}'
    description: 'Provider {{ $labels.provider }} has hit rate limits 3+ times consecutively. Manual intervention needed.'
```

**Action:** Escalate to on-call engineer, review rate limit strategy.

---

## Integration with `codepipe status`

The `codepipe status` command surfaces rate limit highlights alongside other telemetry:

**Example Output:**

```bash
$ codepipe status --verbose

Feature: 01JFABCDEFGHIJKLMNOPQRSTUV
Status: in_progress
Queue: pending=5 completed=10 failed=0

Rate Limits:
  github: 4850/5000 remaining (resets in 27m)
  linear: ⚠ 8/1500 remaining (cooldown active, resets in 12m)

Warnings:
  • Linear rate limit in cooldown. Consider throttling requests.
```

**Implementation Notes:**

- Status command reads `rate_limits.json` via `generateRateLimitReport()`
- Displays condensed summary in human mode, full details in `--verbose`
- JSON mode includes `rate_limits` field with structured data

---

## Monitoring Best Practices

### 1. Proactive Budget Tracking

**Recommendation:** Set up Grafana alerts to trigger at 80% budget consumption (1000 remaining for GitHub, 300 for Linear).

**Rationale:** Prevents workflows from failing mid-execution due to unexpected rate limit hits.

### 2. Cooldown Acknowledgement Workflow

**Recommendation:** Require manual operator acknowledgement before clearing cooldowns after 3+ consecutive hits.

**Rationale:** Forces review of rate limit strategy to prevent repeated failures.

### 3. Cross-Run Aggregation

**Recommendation:** Use `codepipe observe` to aggregate rate limit trends across multiple runs.

**Rationale:** Identifies systemic issues (e.g., shared tokens across CI jobs) vs. one-off spikes.

### 4. Separate Tokens for CI vs. Interactive

**Recommendation:** Use dedicated GitHub App installations or separate PATs for CI workflows vs. interactive development.

**Rationale:** Prevents CI rate limit exhaustion from blocking local development.

---

## Future Enhancements

### Planned Features (Not Yet Implemented)

1. **Historical Trend Analysis:**
   - CLI command: `codepipe rate-limits history <provider>`
   - Output: Time-series chart of remaining requests over past 24 hours

2. **Automatic Throttling:**
   - Pause task execution when `remaining < threshold`
   - Resume automatically after reset window

3. **Multi-Run Coordination:**
   - Shared ledger across runs using same provider token
   - SQLite index for cross-run rate limit tracking

4. **Provider-Specific Recommendations:**
   - GitHub: Suggest switching to GraphQL for batch queries
   - Linear: Recommend using subscriptions instead of polling

5. **Rate Limit Budget Forecasting:**
   - Predict when rate limits will be exhausted based on current consumption rate
   - Alert when estimated time-to-exhaustion < workflow ETA

---

## References

- **Rate Limit Reference:** [docs/ops/rate_limit_reference.md](../ops/rate_limit_reference.md)
- **Operational Playbook:** [.codemachine/artifacts/architecture/04_Operational_Architecture.md](../../.codemachine/artifacts/architecture/04_Operational_Architecture.md#3-18-rate-limit-playbook)
- **Ledger Implementation:** [src/telemetry/rateLimitLedger.ts](../../src/telemetry/rateLimitLedger.ts)
- **Reporter Implementation:** [src/telemetry/rateLimitReporter.ts](../../src/telemetry/rateLimitReporter.ts)
- **CLI Command:** [src/cli/commands/rate-limits.ts](../../src/cli/commands/rate-limits.ts)
- **HTTP Client:** [src/adapters/http/client.ts](../../src/adapters/http/client.ts)

---

## Changelog

| Version | Date       | Changes                                               |
| ------- | ---------- | ----------------------------------------------------- |
| 1.0.0   | 2025-12-17 | Initial dashboard requirements and metric definitions |
