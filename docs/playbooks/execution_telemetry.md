# Execution Engine Telemetry

**Version:** 1.0.0
**Last Updated:** 2025-12-17
**Owners:** Execution Engine Team
**Related Documents:** [Observability Baseline](./observability_baseline.md)

## Overview

This document describes the telemetry instrumentation for the Execution Engine, covering specialized metrics, log events, and integration patterns for task execution workflows. The execution telemetry extends the baseline observability infrastructure with domain-specific instrumentation for code generation, validation, patch application, and git operations.

## Purpose

The Execution Engine telemetry enables:

- **Task Lifecycle Tracking**: Monitor execution tasks from start to completion/failure
- **Performance Analysis**: Measure validation durations, diff generation times, and queue throughput
- **Cost Attribution**: Track agent token usage and USD costs per execution run
- **Debugging Support**: Correlate logs, metrics, and traces across task boundaries
- **Capacity Planning**: Analyze queue depth trends and identify bottlenecks

---

## Architecture

### Components

1. **ExecutionMetricsHelper** (`src/telemetry/executionMetrics.ts`)
   - Wraps `MetricsCollector` with execution-specific helpers
   - Emits counters, gauges, and histograms for task events
   - Integrates with cost tracking via `CostTracker`

2. **ExecutionLogWriter** (`src/telemetry/logWriters.ts`)
   - Wraps `StructuredLogger` with typed event methods
   - Ensures consistent context field naming across execution logs
   - Provides domain-specific log message templates

3. **Integration Points**
   - Execution Orchestrator initializes metrics/logs at workflow start
   - Task Executor calls helpers during lifecycle transitions
   - Validation Engine records validation runs and error details
   - Patch Manager logs diff statistics and git operations

---

## Metrics Reference

All metrics follow the namespace prefix `codemachine_pipeline_`.

### Task Lifecycle Metrics

| Metric Name                  | Type      | Description                              | Labels                                                  | Retention |
| ---------------------------- | --------- | ---------------------------------------- | ------------------------------------------------------- | --------- |
| `execution_tasks_total`      | Counter   | Total execution tasks by status and type | `run_id`, `component`, `task_id`, `task_type`, `status` | 90 days   |
| `execution_task_duration_ms` | Histogram | Execution task duration distribution     | `run_id`, `component`, `task_type`                      | 90 days   |

**Label Values:**

- `task_type`: `code_generation`, `validation`, `patch_application`, `git_operation`, `custom`
- `status`: `started`, `completed`, `failed`, `skipped`

**Example Prometheus Query:**

```promql
# Task success rate by type
sum by (task_type) (
  codemachine_pipeline_execution_tasks_total{status="completed"}
) / sum by (task_type) (
  codemachine_pipeline_execution_tasks_total{status=~"completed|failed"}
)
```

### Validation Metrics

| Metric Name                   | Type      | Description                      | Labels                              | Retention |
| ----------------------------- | --------- | -------------------------------- | ----------------------------------- | --------- |
| `validation_duration_seconds` | Histogram | Validation duration distribution | `run_id`, `component`, `passed`     | 90 days   |
| `validation_runs_total`       | Counter   | Total validation runs by result  | `run_id`, `component`, `passed`     | 90 days   |
| `validation_errors_total`     | Counter   | Total validation errors by type  | `run_id`, `component`, `error_type` | 90 days   |

**Histogram Buckets (seconds):**

```
0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120
```

**Example Prometheus Query:**

```promql
# P95 validation duration
histogram_quantile(0.95,
  sum by (le) (
    rate(codemachine_pipeline_validation_duration_seconds_bucket[5m])
  )
)
```

### Diff Statistics Metrics

| Metric Name             | Type      | Description                      | Labels                                         | Retention |
| ----------------------- | --------- | -------------------------------- | ---------------------------------------------- | --------- |
| `diff_files_changed`    | Histogram | Number of files changed in diff  | `run_id`, `component`, `patch_id`              | 90 days   |
| `diff_lines_total`      | Histogram | Lines added/removed in diff      | `run_id`, `component`, `patch_id`, `operation` | 90 days   |
| `diff_operations_total` | Counter   | Total diff generation operations | `run_id`, `component`, `patch_id`              | 90 days   |

**Label Values:**

- `operation`: `insertion`, `deletion`

**Histogram Buckets:**

- Files Changed: `1, 2, 5, 10, 20, 50, 100, 200, 500`
- Line Counts: `10, 50, 100, 250, 500, 1000, 2500, 5000, 10000`

**Example Prometheus Query:**

```promql
# Average files changed per diff
sum(rate(codemachine_pipeline_diff_files_changed_sum[5m])) /
sum(rate(codemachine_pipeline_diff_files_changed_count[5m]))
```

### Queue Depth Metrics

| Metric Name                 | Type  | Description                         | Labels                | Retention |
| --------------------------- | ----- | ----------------------------------- | --------------------- | --------- |
| `execution_queue_depth`     | Gauge | Total execution queue depth         | `run_id`, `component` | 30 days   |
| `execution_queue_pending`   | Gauge | Number of pending execution tasks   | `run_id`, `component` | 30 days   |
| `execution_queue_completed` | Gauge | Number of completed execution tasks | `run_id`, `component` | 30 days   |
| `execution_queue_failed`    | Gauge | Number of failed execution tasks    | `run_id`, `component` | 30 days   |

**Note:** Queue depth gauges are updated as snapshots (not incremented/decremented).

**Example Prometheus Query:**

```promql
# Queue completion rate
rate(codemachine_pipeline_execution_queue_completed[5m])
```

### Agent Cost Metrics

| Metric Name               | Type    | Description                               | Labels                                 | Retention |
| ------------------------- | ------- | ----------------------------------------- | -------------------------------------- | --------- |
| `agent_cost_tokens_total` | Counter | Agent token usage (prompt and completion) | `run_id`, `component`, `model`, `type` | 1 year    |
| `agent_cost_usd_total`    | Gauge   | Total agent cost in USD                   | `run_id`, `component`                  | 1 year    |

**Label Values:**

- `type`: `prompt`, `completion`
- `model`: `gpt-4`, `gpt-3.5-turbo`, `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`, etc.

**Integration Note:** Prefer using `CostTracker.recordUsage()` for comprehensive cost tracking. Execution metrics provide aggregated counters for quick dashboard queries.

**Example Prometheus Query:**

```promql
# Cost per task (approximate)
codemachine_pipeline_agent_cost_usd_total /
codemachine_pipeline_execution_tasks_total{status="completed"}
```

---

## Log Schema Extensions

Execution logs extend the [baseline log schema](./observability_baseline.md#log-schema) with execution-specific context fields.

### Standard Log Fields

All execution logs include:

- `timestamp` (string, ISO 8601)
- `level` (string: `debug`, `info`, `warn`, `error`, `fatal`)
- `run_id` (string: feature ID)
- `component` (string: typically `execution`)
- `message` (string: human-readable event description)
- `context` (object: structured event data)

### Execution Context Fields

| Field Name               | Type     | Description                      | Required    |
| ------------------------ | -------- | -------------------------------- | ----------- |
| `task_id`                | string   | Execution task identifier        | Yes         |
| `execution_task_type`    | string   | Task type (see Task Types below) | Yes         |
| `duration_ms`            | number   | Task duration in milliseconds    | Conditional |
| `patch_id`               | string   | Patch identifier for correlation | Conditional |
| `diff_stats`             | object   | Diff statistics (see below)      | Conditional |
| `validation_duration_ms` | number   | Validation duration              | Conditional |
| `passed`                 | boolean  | Validation result                | Conditional |
| `error_count`            | number   | Number of validation errors      | Conditional |
| `error_types`            | string[] | Error type identifiers           | Conditional |
| `git_operation`          | string   | Git operation type               | Conditional |
| `agent_type`             | string   | Agent type identifier            | Conditional |
| `model`                  | string   | Model identifier                 | Conditional |
| `prompt_tokens`          | number   | Prompt tokens consumed           | Conditional |
| `completion_tokens`      | number   | Completion tokens consumed       | Conditional |

### Task Types

- `code_generation`: Agent-driven code generation tasks
- `validation`: Schema/lint/test validation runs
- `patch_application`: Git patch application operations
- `git_operation`: Branch creation, merges, resets
- `custom`: Extension point for custom task types

### Diff Stats Object

```json
{
  "files_changed": 5,
  "insertions": 123,
  "deletions": 45
}
```

### Sample Log Entries

#### Task Started

```json
{
  "timestamp": "2025-12-17T14:32:11.123Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Execution task started: I3.T6",
  "context": {
    "task_id": "I3.T6",
    "execution_task_type": "code_generation"
  }
}
```

#### Task Completed

```json
{
  "timestamp": "2025-12-17T14:33:45.678Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Execution task completed: I3.T6 (94555ms)",
  "context": {
    "task_id": "I3.T6",
    "execution_task_type": "code_generation",
    "duration_ms": 94555
  }
}
```

#### Diff Generated

```json
{
  "timestamp": "2025-12-17T14:34:12.345Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Diff generated for task I3.T6: 4 files, +423/-89 lines",
  "context": {
    "task_id": "I3.T6",
    "execution_task_type": "patch_application",
    "patch_id": "patch_01JFABCXYZ123",
    "diff_stats": {
      "files_changed": 4,
      "insertions": 423,
      "deletions": 89
    }
  }
}
```

#### Validation Completed

```json
{
  "timestamp": "2025-12-17T14:35:03.789Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Validation passed for task I3.T6",
  "context": {
    "task_id": "I3.T6",
    "execution_task_type": "validation",
    "validation_duration_ms": 2345,
    "passed": true
  }
}
```

#### Validation Failed

```json
{
  "timestamp": "2025-12-17T14:36:21.456Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Validation failed for task I3.T7 (3 errors)",
  "context": {
    "task_id": "I3.T7",
    "execution_task_type": "validation",
    "validation_duration_ms": 1234,
    "passed": false,
    "error_count": 3,
    "error_types": ["schema_error", "lint_error", "type_error"]
  }
}
```

#### Agent Invocation

```json
{
  "timestamp": "2025-12-17T14:37:45.123Z",
  "level": "info",
  "run_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "component": "execution",
  "message": "Agent invoked for task I3.T6: BackendAgent (gpt-4)",
  "context": {
    "task_id": "I3.T6",
    "execution_task_type": "code_generation",
    "agent_type": "BackendAgent",
    "model": "gpt-4",
    "prompt_tokens": 2341,
    "completion_tokens": 1523
  }
}
```

---

## Usage Patterns

### Initializing Execution Telemetry

```typescript
import { createRunMetricsCollector } from './telemetry/metrics';
import { createLogger } from './telemetry/logger';
import { createExecutionMetrics } from './telemetry/executionMetrics';
import { createExecutionLogWriter } from './telemetry/logWriters';

// Initialize base infrastructure
const metrics = createRunMetricsCollector(runDir, runId);
const logger = createLogger({
  runDir,
  runId,
  component: 'execution',
  minLevel: LogLevel.INFO,
});

// Create execution-specific helpers
const executionMetrics = createExecutionMetrics(metrics, { runDir, runId });
const executionLogs = createExecutionLogWriter(logger, { runDir, runId });
```

### Recording Task Lifecycle

```typescript
import { ExecutionTaskType, ExecutionTaskStatus } from './telemetry/executionMetrics';

// Task started
const startTime = Date.now();
executionLogs.taskStarted('I3.T6', ExecutionTaskType.CODE_GENERATION);
executionMetrics.recordTaskLifecycle(
  'I3.T6',
  ExecutionTaskType.CODE_GENERATION,
  ExecutionTaskStatus.STARTED
);

// ... execute task ...

// Task completed
const durationMs = Date.now() - startTime;
executionLogs.taskCompleted('I3.T6', ExecutionTaskType.CODE_GENERATION, durationMs);
executionMetrics.recordTaskLifecycle(
  'I3.T6',
  ExecutionTaskType.CODE_GENERATION,
  ExecutionTaskStatus.COMPLETED,
  durationMs
);
```

### Recording Validation Runs

```typescript
const validationStart = Date.now();

// ... run validation ...

const result = {
  passed: false,
  durationMs: Date.now() - validationStart,
  errorCount: 3,
  errorTypes: ['schema_error', 'lint_error'],
};

executionLogs.validationCompleted('I3.T6', result);
executionMetrics.recordValidationRun(result);
```

### Recording Diff Statistics

```typescript
const diffStats = {
  filesChanged: 4,
  insertions: 423,
  deletions: 89,
  patchId: 'patch_01JFABCXYZ123',
};

executionLogs.diffGenerated('I3.T6', diffStats.patchId!, diffStats);
executionMetrics.recordDiffStats(diffStats);
```

### Updating Queue Depth

```typescript
// Snapshot current queue state
const pending = 5;
const completed = 10;
const failed = 2;

executionMetrics.setQueueDepth(pending, completed, failed);
executionLogs.queueStateChanged(pending, completed, failed);
```

### Recording Agent Costs

```typescript
// Option 1: Use CostTracker (preferred for comprehensive tracking)
await costTracker.recordUsage('openai', 'code_generation', 2341, 1523, 'gpt-4');

// Option 2: Record execution-specific metrics
executionMetrics.recordAgentCost('gpt-4', 2341, 1523);
executionLogs.agentInvoked('I3.T6', 'BackendAgent', 'gpt-4', 2341, 1523);
```

### Flushing Telemetry

```typescript
// Flush at workflow completion
await executionMetrics.flush();
await executionLogs.flush();
```

---

## Configuration & Retention

### Metrics Retention

Metrics retention is controlled via `RepoConfig`:

```json
{
  "metrics": {
    "retention_days": 90
  }
}
```

Default retention policies:

- Task lifecycle metrics: 90 days
- Validation metrics: 90 days
- Diff statistics: 90 days
- Queue depth gauges: 30 days (snapshots decay faster)
- Cost metrics: 1 year

### Log Retention

Log retention follows the [observability baseline](./observability_baseline.md#log-levels):

- `debug`: 7 days
- `info`: 30 days
- `warn`: 90 days
- `error`: 1 year
- `fatal`: Permanent

### Cost Budget Thresholds

Cost warnings are emitted when budget thresholds are breached:

```json
{
  "cost": {
    "budget": {
      "maxCostUsd": 10.0,
      "maxTokens": 1000000,
      "warningThreshold": 80
    }
  }
}
```

---

## Querying Telemetry

### Example LogQL Queries (for Loki/Grafana)

```logql
# All execution task events
{component="execution"} | json

# Failed tasks only
{component="execution"} | json | level="error"

# Tasks by type
{component="execution"} | json | execution_task_type="code_generation"

# Validation errors
{component="execution"} | json | execution_task_type="validation" | passed="false"

# High diff volumes
{component="execution"} | json | diff_stats_files_changed > 10
```

### Example PromQL Queries

```promql
# Task throughput (tasks/sec)
rate(codemachine_pipeline_execution_tasks_total[5m])

# Task failure rate
sum by (task_type) (
  rate(codemachine_pipeline_execution_tasks_total{status="failed"}[5m])
) / sum by (task_type) (
  rate(codemachine_pipeline_execution_tasks_total[5m])
)

# P99 task duration
histogram_quantile(0.99,
  sum by (le, task_type) (
    rate(codemachine_pipeline_execution_task_duration_ms_bucket[5m])
  )
)

# Current queue backlog
codemachine_pipeline_execution_queue_pending

# Total cost trend
delta(codemachine_pipeline_agent_cost_usd_total[1h])
```

---

## Troubleshooting

### Missing Execution Metrics

**Symptom:** Execution metrics absent from `prometheus.txt`

**Diagnostics:**

1. Verify `executionMetrics.flush()` called before process exit
2. Check metrics collector initialized with valid run directory
3. Inspect stderr for metric recording errors
4. Verify task lifecycle methods invoked (check logs for task events)

**Fix:**

```typescript
// Ensure flush in finally block
try {
  await executeWorkflow();
} finally {
  await executionMetrics.flush();
}
```

### Inconsistent Log/Metric Correlation

**Symptom:** Logs reference `task_id` but metrics missing for same task

**Diagnostics:**

1. Verify `run_id` label matches across logs and metrics
2. Check task_id sanitization (labels must be valid Prometheus format)
3. Inspect metric cardinality (too many unique task_ids may cause truncation)

**Fix:**

```typescript
// Sanitize task_id for metric labels
const sanitizedTaskId = taskId.replace(/[^a-zA-Z0-9_]/g, '_');
executionMetrics.recordTaskLifecycle(sanitizedTaskId, ...);
```

### Validation Duration Outliers

**Symptom:** Validation duration metrics show unexpectedly high P99 values

**Diagnostics:**

1. Query logs for `validation_duration_ms` outliers
2. Filter by `error_types` to identify problematic validators
3. Check for timeouts or retries in validation code

**Example Query:**

```logql
{component="execution"} | json | execution_task_type="validation" | validation_duration_ms > 30000
```

### Cost Budget Warnings Not Triggering

**Symptom:** `costWarning` logs absent despite high token usage

**Diagnostics:**

1. Verify `CostTracker` initialized with budget configuration
2. Check `warningThreshold` set correctly (default: 80%)
3. Ensure `CostTracker.recordUsage()` called for all agent invocations

**Fix:**

```typescript
const costTracker = createCostTracker(featureId, runDir, logger, metrics, {
  maxCostUsd: 10.0,
  warningThreshold: 80,
});
```

---

## CLI Integration

### Status Command

The `codepipe status` command surfaces execution telemetry:

```bash
codepipe status --json
```

**Output:**

```json
{
  "feature_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "execution": {
    "queue_depth": 17,
    "pending": 5,
    "completed": 10,
    "failed": 2,
    "total_cost_usd": 4.23
  },
  "telemetry": {
    "logs_file": "logs/logs.ndjson",
    "metrics_file": "metrics/prometheus.txt",
    "traces_file": "telemetry/traces.json"
  }
}
```

### Export Command

The `codepipe export` command bundles execution telemetry:

```bash
codepipe export --run-id 01JFABCDEFGHIJKLMNOPQRSTUV --output export.tar.gz
```

Includes:

- `logs/logs.ndjson` (with execution events)
- `metrics/prometheus.txt` (with execution metrics)
- `telemetry/traces.json` (with execution spans)
- `telemetry/costs.json` (cost tracker state)
- `manifest.json` (file hashes and metadata)

---

## Extending Telemetry

### Adding Custom Metrics

```typescript
// Define custom metric name
const CUSTOM_METRIC = 'custom_operation_total';

// Record via metrics collector
executionMetrics['metrics'].increment(CUSTOM_METRIC, { operation: 'foo' }, 1, 'Custom operations');
```

### Adding Custom Log Events

```typescript
// Use underlying logger for custom events
executionLogs['logger'].info('Custom event occurred', {
  task_id: 'I3.T6',
  custom_field: 'value',
});
```

### Adding Custom Task Types

```typescript
// Extend ExecutionTaskType enum
export enum ExecutionTaskType {
  // ... existing types ...
  CUSTOM_ANALYSIS = 'custom_analysis',
}

// Use in task lifecycle recording
executionMetrics.recordTaskLifecycle(
  'I3.T99',
  ExecutionTaskType.CUSTOM_ANALYSIS,
  ExecutionTaskStatus.COMPLETED
);
```

---

## References

- **Observability Baseline**: [docs/ops/observability_baseline.md](./observability_baseline.md)
- **Structured Logger**: [src/telemetry/logger.ts](../../src/telemetry/logger.ts)
- **Metrics Collector**: [src/telemetry/metrics.ts](../../src/telemetry/metrics.ts)
- **Cost Tracker**: [src/telemetry/costTracker.ts](../../src/telemetry/costTracker.ts)
- **Execution Metrics**: [src/telemetry/executionMetrics.ts](../../src/telemetry/executionMetrics.ts)
- **Execution Log Writers**: [src/telemetry/logWriters.ts](../../src/telemetry/logWriters.ts)
- **Blueprint Foundation**: [.codemachine/artifacts/architecture/01_Blueprint_Foundation.md](../../.codemachine/artifacts/architecture/01_Blueprint_Foundation.md)
- **Operational Architecture**: [.codemachine/artifacts/architecture/04_Operational_Architecture.md](../../.codemachine/artifacts/architecture/04_Operational_Architecture.md)
- **Iteration I3 Plan**: [.codemachine/artifacts/plan/02_Iteration_I3.md](../../.codemachine/artifacts/plan/02_Iteration_I3.md)
