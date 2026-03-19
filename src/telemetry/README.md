# Telemetry

Structured logging, metrics collection, distributed tracing, cost tracking,
and rate limit monitoring for the pipeline.

## Key Exports

From the barrel (`index.ts`):

- `createCliLogger` / `StructuredLogger` / `LogLevel` — JSON-line logging with secret redaction
- `MetricsCollector` / `StandardMetrics` / `MetricType` — typed metrics with labels
- `TraceManager` / `withSpan` / `SpanKind` / `SpanStatusCode` — distributed tracing
- `CostTracker` / `loadOrCreateCostTracker` — LLM cost tracking with budget enforcement
- `ExecutionTelemetry` / `createExecutionTelemetry` — execution-level telemetry aggregation
- `createRateLimitLedger` — rate limit tracking ledger
- `RateLimitReporter` — rate limit dashboard reporting
- `ExecutionLogWriter` / `createExecutionLogWriter` — execution event log formatting (from `logWriters.ts`)

## Structure

- `logger.ts` — structured logger with NDJSON persistence and secret redaction
- `metrics.ts` — metrics collector with standard metric names
- `traces.ts` — trace manager with span lifecycle
- `costTracker.ts` — per-provider cost tracking and budget warnings
- `executionTelemetry.ts` — execution-scoped telemetry
- `executionMetrics.ts` — execution metrics factory
- `rateLimitLedger.ts` — rate limit state tracking
- `rateLimitReporter.ts` — rate limit reporting and formatting
- `logWriters.ts` — log output writers

## Dependencies

Imports from: `core`, `utils`, `validation`

Depended on by: `adapters`, `cli`, `workflows`
