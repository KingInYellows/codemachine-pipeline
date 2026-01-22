import type { ExecutionMetricsHelper } from './executionMetrics';
import { createExecutionMetrics } from './executionMetrics';
import type { ExecutionLogWriter } from './logWriters';
import { createExecutionLogWriter } from './logWriters';
import type { StructuredLogger } from './logger';
import type { MetricsCollector } from './metrics';
import type { TraceManager, ActiveSpan } from './traces';
import { SpanStatusCode } from './traces';

/**
 * Execution telemetry adapters that bridge workflows to the observability hub.
 */
export interface ExecutionTelemetry {
  /** Execution-specific metrics helper */
  metrics?: ExecutionMetricsHelper;
  /** Structured execution log writer */
  logs?: ExecutionLogWriter;
  /** Trace manager scoped to the current run */
  traceManager?: TraceManager;
}

export interface ExecutionTelemetryOptions {
  logger: StructuredLogger;
  metrics: MetricsCollector;
  runDir: string;
  runId: string;
  traceManager?: TraceManager;
  component?: string;
}

export function createExecutionTelemetry(
  options: ExecutionTelemetryOptions
): ExecutionTelemetry {
  const telemetry: ExecutionTelemetry = {
    metrics: createExecutionMetrics(options.metrics, {
      runDir: options.runDir,
      runId: options.runId,
      component: options.component ?? 'execution_engine',
    }),
    logs: createExecutionLogWriter(options.logger, {
      runDir: options.runDir,
      runId: options.runId,
    }),
  };
  if (options.traceManager) {
    telemetry.traceManager = options.traceManager;
  }
  return telemetry;
}

/**
 * Start a span for execution instrumentation if tracing is enabled.
 */
export function startExecutionSpan(
  telemetry: ExecutionTelemetry | undefined,
  name: string,
  attributes: Record<string, string | number | boolean> = {}
): ActiveSpan | undefined {
  return telemetry?.traceManager?.startSpan(name, undefined, attributes);
}

/**
 * Helper to end a span with standard error semantics.
 */
export function endExecutionSpan(
  span: ActiveSpan | undefined,
  success: boolean,
  message?: string
): void {
  if (!span) {
    return;
  }

  span.end({
    code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    ...(message ? { message } : {}),
  });
}
