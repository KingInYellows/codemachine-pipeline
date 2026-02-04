# Observability Baseline

**Version:** 1.0.0
**Last Updated:** 2025-12-15
**Owners:** Platform Team

## Overview

This document defines the observability baseline for the AI Feature Pipeline CLI, covering structured logging, metrics collection, and distributed tracing. All telemetry outputs are local-first, stored in run directories for offline debugging and audit trails.

## Architecture

The telemetry system consists of three independent but complementary components:

1. **Structured Logger** (`src/telemetry/logger.ts`) - JSON-line logs with secret redaction
2. **Metrics Collector** (`src/telemetry/metrics.ts`) - Prometheus textfile format metrics
3. **Trace Manager** (`src/telemetry/traces.ts`) - File-based distributed tracing

### Integration Points

- **Run Directory Manager**: Provisions `logs/`, `telemetry/`, and `metrics/` subdirectories
- **HTTP Client**: Instruments requests with duration histograms and error counters
- **Rate Limit Ledger**: Logs cooldown events and state transitions
- **CLI Commands**: Emit command lifecycle events and execution durations
- **Queue System**: Tracks queue depth, processing times, and failure rates

---

## Structured Logging

### Log Schema

All log entries follow this JSON schema:

```json
{
  "timestamp": "2025-12-15T10:30:45.123Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "http:github",
  "trace_id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "message": "HTTP request completed",
  "context": {
    "endpoint": "/repos/owner/repo/pulls",
    "status_code": 200,
    "duration_ms": 423
  }
}
```

### Log Levels

| Level | Usage | Retention |
|-------|-------|-----------|
| `debug` | Detailed diagnostics (disabled by default) | 7 days |
| `info` | Normal operations, lifecycle events | 30 days |
| `warn` | Recoverable errors, rate limit warnings | 90 days |
| `error` | Unrecoverable errors requiring intervention | 1 year |
| `fatal` | Critical failures causing process termination | Permanent |

### Log Fields

#### Required Fields

- `timestamp` (string, ISO 8601): Event timestamp
- `level` (string): Log severity (debug, info, warn, error, fatal)
- `component` (string): Originating component (e.g., `cli:status`, `http:github`, `queue`)
- `message` (string): Human-readable event description

#### Optional Fields

- `run_id` (string): Feature ID for correlation across runs
- `trace_id` (string): Distributed trace ID for span correlation
- `context` (object): Structured metadata (endpoint, status_code, etc.)
- `error` (object): Error details (`name`, `message`, `stack`)

### Log File Locations

Logs are written to `<run_dir>/logs/logs.ndjson` in NDJSON (newline-delimited JSON) format.

Example path:
```
.codepipe/runs/01JFABCDEFGHIJKLMNOPQRSTUV/logs/logs.ndjson
```

### Verbosity Control

- **Default**: `INFO` level and above
- **Verbose Mode** (`--verbose`): `DEBUG` level and above
- **JSON Mode** (`--json`): Logs written to file only (no stderr mirroring)
- **Interactive Mode**: Logs mirrored to stderr for real-time feedback

---

## Secret Redaction

### Redaction Rules

The logger automatically redacts secrets before writing to disk or stderr. Redaction is **always enabled** and cannot be disabled (enforces NFR-6).

### Protected Patterns

| Pattern | Example | Replacement |
|---------|---------|-------------|
| GitHub Personal Access Token | `ghp_1234567890abcdef` | `[REDACTED_GITHUB_TOKEN]` |
| GitHub OAuth Token | `gho_1234567890abcdef` | `[REDACTED_GITHUB_TOKEN]` |
| GitHub App Token | `ghs_1234567890abcdef` | `[REDACTED_GITHUB_APP_TOKEN]` |
| Linear API Key | `lin_api_abc123...` | `[REDACTED_LINEAR_KEY]` |
| JWT Bearer Token | `eyJhbGc...` | `[REDACTED_JWT]` |
| API Key | `api_key=abc123...` | `api_key=[REDACTED_API_KEY]` |
| Authorization Header | `Authorization: Bearer xyz...` | `Authorization: Bearer [REDACTED_TOKEN]` |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | `[REDACTED_AWS_KEY]` |
| Environment Secrets | `GITHUB_TOKEN=xyz...` | `GITHUB_TOKEN=[REDACTED]` |

### Sample Redacted Log

```json
{
  "timestamp": "2025-12-15T10:32:11.123Z",
  "level": "warn",
  "component": "http:github",
  "message": "Retrying request after rate limit",
  "context": {
    "endpoint": "/repos/owner/repo/pulls",
    "status_code": 429,
    "Authorization": "[REDACTED]"
  }
}
```

Severity tags appear in the `level` field (`debug`, `info`, `warn`, `error`, `fatal`) so downstream tooling can filter alerts without schema guessing.

### Field-Level Redaction

Fields with sensitive names are automatically redacted:

- `password`, `secret`, `token`, `api_key`, `apikey`
- `auth`, `authorization`, `credential`
- `private_key`, `privatekey`

### Testing Redaction

To verify redaction is working:

```bash
# Generate test logs with known secrets
npm run test telemetry

# Inspect logs for redaction markers
cat .codepipe/runs/*/logs/logs.ndjson | grep REDACTED
```

---

## Metrics

### Metrics Schema

Metrics are exported in **Prometheus textfile format** to:

```
<run_dir>/metrics/prometheus.txt
```

### Standard Metrics

#### Queue Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `codemachine_pipeline_queue_depth` | Gauge | Total queue depth (pending + completed + failed) | `run_id` |
| `codemachine_pipeline_queue_pending_count` | Gauge | Number of pending tasks | `run_id` |
| `codemachine_pipeline_queue_completed_count` | Gauge | Number of completed tasks | `run_id` |
| `codemachine_pipeline_queue_failed_count` | Gauge | Number of failed tasks | `run_id` |
| `codemachine_pipeline_queue_processing_duration_ms` | Histogram | Task processing time distribution | `run_id`, `task_type` |

#### Rate Limit Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `codemachine_pipeline_rate_limit_remaining` | Gauge | Requests remaining before rate limit | `provider` (github, linear) |
| `codemachine_pipeline_rate_limit_reset_timestamp` | Gauge | Unix timestamp when rate limit resets | `provider` |
| `codemachine_pipeline_rate_limit_hits_total` | Counter | Total rate limit hits (HTTP 429) | `provider`, `endpoint` |
| `codemachine_pipeline_rate_limit_cooldown_active` | Gauge | Cooldown state (0=inactive, 1=active) | `provider` |

#### HTTP Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `codemachine_pipeline_http_requests_total` | Counter | Total HTTP requests | `provider`, `endpoint`, `status` |
| `codemachine_pipeline_http_errors_total` | Counter | Total HTTP errors | `provider`, `endpoint`, `status` |
| `codemachine_pipeline_http_request_duration_ms` | Histogram | HTTP request latency distribution | `provider`, `endpoint`, `status` |
| `codemachine_pipeline_http_retry_count` | Counter | HTTP retry attempts | `provider`, `endpoint`, `attempt` |

#### Token Usage Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `codemachine_pipeline_token_usage_prompt` | Counter | Prompt tokens consumed | `run_id`, `model` |
| `codemachine_pipeline_token_usage_completion` | Counter | Completion tokens consumed | `run_id`, `model` |
| `codemachine_pipeline_token_usage_total` | Counter | Total tokens consumed | `run_id`, `model` |

#### CLI Command Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `codemachine_pipeline_command_execution_duration_ms` | Histogram | Command execution time | `command` |
| `codemachine_pipeline_command_invocations_total` | Counter | Command invocation count | `command`, `exit_code` |

### Histogram Buckets

Latency histograms use the following buckets (milliseconds):

```
10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
```

### Metrics Collection Example

```typescript
import { createRunMetricsCollector } from './telemetry/metrics';

const metrics = createRunMetricsCollector(runDir, runId);

// Record queue depth
metrics.recordQueueDepth(5, 10, 2);

// Record HTTP request
metrics.recordHttpRequest('github', '/repos/owner/repo/pulls', 200, 423, true);

// Record custom metric
metrics.increment('custom_counter', { component: 'parser' });

// Flush to disk
await metrics.flush();
```

---

## Distributed Tracing

### Trace Schema

Traces are exported as NDJSON to:

```
<run_dir>/telemetry/traces.json
```

Each span record follows this schema:

```json
{
  "traceId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "spanId": "x1y2z3a4b5c6d7e8",
  "parentSpanId": "p1q2r3s4t5u6v7w8",
  "name": "http_request",
  "kind": 2,
  "startTime": 1734256245123,
  "endTime": 1734256245546,
  "duration": 423,
  "status": {
    "code": 1,
    "message": "OK"
  },
  "attributes": {
    "service.name": "codemachine-pipeline",
    "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
    "http.method": "GET",
    "http.url": "/repos/owner/repo/pulls",
    "http.status_code": 200
  },
  "events": []
}
```

### Span Kinds

| Kind | Value | Usage |
|------|-------|-------|
| `INTERNAL` | 0 | Internal operations (default) |
| `SERVER` | 1 | Server-side request handling |
| `CLIENT` | 2 | Client-side requests (HTTP calls) |
| `PRODUCER` | 3 | Message queue producers |
| `CONSUMER` | 4 | Message queue consumers |

### Status Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `UNSET` | Status not explicitly set |
| 1 | `OK` | Operation succeeded |
| 2 | `ERROR` | Operation failed |

### Trace Context Propagation

Trace context is propagated through:

1. **Logger**: Accepts `trace_id` in constructor options
2. **ActiveSpan**: Exposes `context.traceId` for child span creation
3. **HTTP Adapters**: Include `x-trace-id` header in requests (optional)

### Tracing Example

```typescript
import { createRunTraceManager, withSpan, SpanKind } from './telemetry/traces';

const traceManager = createRunTraceManager(runDir, runId);

// Root span
await withSpan(traceManager, 'process_feature', async (parentSpan) => {
  parentSpan.setAttribute('feature_id', featureId);

  // Child span
  await withSpan(
    traceManager,
    'fetch_issue',
    async (childSpan) => {
      childSpan.setAttribute('issue_id', issueId);
      // ... fetch issue ...
    },
    parentSpan.context,
    SpanKind.CLIENT
  );
});

// Flush to disk
await traceManager.flush();
```

---

## Integration with CLI

### Status Command Output

The `status --json` command includes telemetry file references:

```json
{
  "feature_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "telemetry": {
    "logs_dir": "logs",
    "metrics_file": "metrics/prometheus.txt",
    "traces_file": "telemetry/traces.json"
  }
}
```

### Toggling Verbosity

```bash
# Default (INFO level)
codepipe status

# Verbose (DEBUG level)
codepipe status --verbose

# JSON mode (no stderr mirroring)
codepipe status --json
```

---

## Querying Telemetry Data

### Logs

```bash
# View all logs for a run
cat .codepipe/runs/01JFABCDEFGHIJKLMNOPQRSTUV/logs/logs.ndjson

# Filter by level
jq 'select(.level == "error")' < logs/logs.ndjson

# Search for specific component
jq 'select(.component | startswith("http:"))' < logs/logs.ndjson

# Count logs by level
jq -r '.level' < logs/logs.ndjson | sort | uniq -c
```

### Metrics

```bash
# View current metrics snapshot
cat .codepipe/runs/01JFABCDEFGHIJKLMNOPQRSTUV/metrics/prometheus.txt

# Extract specific metric
grep "http_request_duration_ms" metrics/prometheus.txt
```

### Traces

```bash
# View all spans
cat .codepipe/runs/01JFABCDEFGHIJKLMNOPQRSTUV/telemetry/traces.json

# Find spans by trace ID
jq 'select(.traceId == "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6")' < telemetry/traces.json

# Calculate average span duration
jq -s 'map(.duration) | add / length' < telemetry/traces.json

# Find error spans
jq 'select(.status.code == 2)' < telemetry/traces.json
```

---

## Troubleshooting

### Logs Not Appearing

1. **Check run directory exists**: `ls -la .codepipe/runs/<feature_id>/logs/`
2. **Verify log level**: Use `--verbose` flag to enable DEBUG logs
3. **Check stderr mirroring**: Disable `--json` mode for interactive feedback
4. **Inspect file permissions**: Ensure logs directory is writable

### Metrics File Empty

1. **Verify flush called**: Metrics are buffered until `flush()` is invoked
2. **Check metrics directory**: Should exist at `<run_dir>/metrics/`
3. **Inspect for write errors**: Check stderr for `[LOGGER_ERROR]` messages

### Traces Missing

1. **Verify span ended**: Call `span.end()` to finalize span records
2. **Check flush called**: Traces are buffered until `traceManager.flush()`
3. **Inspect telemetry directory**: Should exist at `<run_dir>/telemetry/`

### Secrets Leaking

**CRITICAL**: If you observe unredacted secrets in logs:

1. **Stop the process immediately**
2. **Rotate exposed credentials** (GitHub tokens, API keys)
3. **File incident report** with examples of leaked patterns
4. **Update redaction patterns** in `src/telemetry/logger.ts`
5. **Verify fix with unit tests**: `npm run test telemetry`

---

## Future Enhancements

### Optional OTLP Export

Add optional OpenTelemetry Protocol (OTLP) export to observability backends (Jaeger, Grafana, etc.) when configured:

```json
{
  "telemetry": {
    "otlp_endpoint": "http://localhost:4318/v1/traces"
  }
}
```

### Structured Log Streaming

Implement real-time log streaming via WebSocket for remote monitoring:

```bash
codepipe observe --follow
```

### Cost Tracking

Add cost estimation metrics based on token usage and API call counts:

```
codemachine_pipeline_estimated_cost_usd
```

---

## Compliance

### NFR-6: Secret Protection

All secrets are redacted before writing to disk or stderr. Redaction engine scans for:

- GitHub tokens (all formats)
- Linear API keys
- Generic API keys and JWTs
- Authorization headers
- Environment variable secrets

### NFR-9: Centralized HTTP Layer

HTTP client integrates with logger, metrics, and trace manager for comprehensive observability of all external API calls.

### NFR-10: Audit Trail

Run directories contain complete telemetry bundles (logs, metrics, traces) for post-mortem analysis and compliance audits.

---

## References

- **Run Directory Schema**: `docs/requirements/run_directory_schema.md`
- **Logger Implementation**: `src/telemetry/logger.ts`
- **Metrics Implementation**: `src/telemetry/metrics.ts`
- **Trace Implementation**: `src/telemetry/traces.ts`
- **Rate Limit Ledger**: `src/telemetry/rateLimitLedger.ts`
- **Non-Functional Requirements**: `docs/requirements/non_functional.md` (NFR-6, NFR-9, NFR-10)
