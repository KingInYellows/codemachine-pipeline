import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Trace Instrumentation (File-Based)
 *
 * Provides distributed tracing capabilities with:
 * - Span creation with parent-child relationships
 * - Trace ID and span ID generation
 * - Automatic timing and duration calculation
 * - Attribute tagging (run_id, component, endpoint, etc.)
 * - JSON file export for local debugging
 *
 * Implements local-first OpenTelemetry-compatible tracing
 * without requiring external OTLP endpoints.
 *
 * Future enhancement: Add optional OTLP export support.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Trace context (W3C Trace Context compatible)
 */
export interface TraceContext {
  /** Trace ID (128-bit hex string) */
  traceId: string;
  /** Span ID (64-bit hex string) */
  spanId: string;
  /** Parent span ID (if nested span) */
  parentSpanId?: string;
  /** Trace flags (sampled, etc.) */
  traceFlags: number;
}

/**
 * Span status codes (OpenTelemetry compatible)
 */
export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/**
 * Span kind (OpenTelemetry compatible)
 */
export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

/**
 * Span event (log event within a span)
 */
export interface SpanEvent {
  /** Event name */
  name: string;
  /** Event timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Event attributes */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Span data (exported trace record)
 */
export interface Span {
  /** Trace ID */
  traceId: string;
  /** Span ID */
  spanId: string;
  /** Parent span ID */
  parentSpanId?: string;
  /** Span name */
  name: string;
  /** Span kind */
  kind: SpanKind;
  /** Start timestamp (milliseconds since epoch) */
  startTime: number;
  /** End timestamp (milliseconds since epoch) */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Status code */
  status: {
    code: SpanStatusCode;
    message?: string;
  };
  /** Span attributes (tags) */
  attributes: Record<string, string | number | boolean>;
  /** Events logged during span */
  events: SpanEvent[];
}

/**
 * Active span interface (for instrumentation)
 */
export interface ActiveSpan {
  /** Trace context */
  context: TraceContext;
  /** Span name */
  name: string;
  /** Set span attribute */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Add event to span */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  /** End span with status */
  end(status?: { code: SpanStatusCode; message?: string }): void;
}

/**
 * Trace manager configuration
 */
export interface TraceManagerOptions {
  /** Run directory path */
  runDir?: string;
  /** Service name */
  serviceName?: string;
  /** Default attributes attached to all spans */
  defaultAttributes?: Record<string, string | number | boolean>;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a random trace ID (128-bit hex string)
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a random span ID (64-bit hex string)
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ============================================================================
// Active Span Implementation
// ============================================================================

/**
 * Active span implementation with fluent API
 */
class ActiveSpanImpl implements ActiveSpan {
  readonly context: TraceContext;
  readonly name: string;
  private readonly startTime: number;
  private readonly kind: SpanKind;
  private readonly attributes: Record<string, string | number | boolean>;
  private readonly events: SpanEvent[] = [];
  private endTime?: number;
  private status: { code: SpanStatusCode; message?: string } = { code: SpanStatusCode.UNSET };
  private readonly onEnd: (span: Span) => void;

  constructor(
    name: string,
    context: TraceContext,
    kind: SpanKind,
    defaultAttributes: Record<string, string | number | boolean>,
    onEnd: (span: Span) => void
  ) {
    this.name = name;
    this.context = context;
    this.kind = kind;
    this.attributes = { ...defaultAttributes };
    this.startTime = Date.now();
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const event: SpanEvent = {
      name,
      timestamp: Date.now(),
    };
    if (attributes) event.attributes = attributes;
    this.events.push(event);
  }

  end(status?: { code: SpanStatusCode; message?: string }): void {
    if (this.endTime) {
      return; // Already ended
    }

    this.endTime = Date.now();
    this.status = status ?? { code: SpanStatusCode.OK };

    // Build span record
    const span: Span = {
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime - this.startTime,
      status: this.status,
      attributes: this.attributes,
      events: this.events,
    };

    if (this.context.parentSpanId) {
      span.parentSpanId = this.context.parentSpanId;
    }

    // Notify trace manager
    this.onEnd(span);
  }
}

// ============================================================================
// Trace Manager
// ============================================================================

/**
 * Trace manager with file-based export
 */
export class TraceManager {
  private readonly options: Required<TraceManagerOptions>;
  private readonly tracesFilePath?: string;
  private readonly spans: Span[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: TraceManagerOptions = {}) {
    this.options = {
      runDir: options.runDir ?? '',
      serviceName: options.serviceName ?? 'ai-feature-pipeline',
      defaultAttributes: options.defaultAttributes ?? {},
    };

    // Determine traces file path if run directory is provided
    if (this.options.runDir) {
      this.tracesFilePath = path.join(this.options.runDir, 'telemetry', 'traces.json');
    }
  }

  /**
   * Start a new root span (new trace)
   */
  startSpan(name: string, kind = SpanKind.INTERNAL, attributes: Record<string, string | number | boolean> = {}): ActiveSpan {
    const context: TraceContext = {
      traceId: generateTraceId(),
      spanId: generateSpanId(),
      traceFlags: 1, // Sampled
    };

    return this.createActiveSpan(name, context, kind, attributes);
  }

  /**
   * Start a child span (nested within parent trace)
   */
  startChildSpan(
    name: string,
    parentContext: TraceContext,
    kind = SpanKind.INTERNAL,
    attributes: Record<string, string | number | boolean> = {}
  ): ActiveSpan {
    const context: TraceContext = {
      traceId: parentContext.traceId,
      spanId: generateSpanId(),
      parentSpanId: parentContext.spanId,
      traceFlags: parentContext.traceFlags,
    };

    return this.createActiveSpan(name, context, kind, attributes);
  }

  /**
   * Create active span instance
   */
  private createActiveSpan(
    name: string,
    context: TraceContext,
    kind: SpanKind,
    attributes: Record<string, string | number | boolean>
  ): ActiveSpan {
    const mergedAttributes = {
      'service.name': this.options.serviceName,
      ...this.options.defaultAttributes,
      ...attributes,
    };

    return new ActiveSpanImpl(name, context, kind, mergedAttributes, (span) => {
      this.recordSpan(span);
    });
  }

  /**
   * Record completed span
   */
  private recordSpan(span: Span): void {
    this.spans.push(span);

    // Automatically flush to file if path is configured
    if (this.tracesFilePath) {
      this.writeQueue = this.writeQueue.then(async () => {
        try {
          await this.appendSpanToFile(span);
        } catch (error) {
          console.error('[TRACE_ERROR] Failed to write span:', error);
        }
      });
    }
  }

  /**
   * Append span to traces file (NDJSON format)
   */
  private async appendSpanToFile(span: Span): Promise<void> {
    if (!this.tracesFilePath) {
      return;
    }

    // Ensure telemetry directory exists
    const telemetryDir = path.dirname(this.tracesFilePath);
    await fs.mkdir(telemetryDir, { recursive: true });

    // Append span as JSON line
    const line = JSON.stringify(span);
    await fs.appendFile(this.tracesFilePath, `${line}\n`, 'utf-8');
  }

  /**
   * Get all recorded spans
   */
  getSpans(): Span[] {
    return [...this.spans];
  }

  /**
   * Flush pending writes (call before process exit)
   */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  /**
   * Clear recorded spans
   */
  reset(): void {
    this.spans.length = 0;
  }
}

// ============================================================================
// Instrumentation Helpers
// ============================================================================

/**
 * Execute a function within a trace span
 */
export async function withSpan<T>(
  traceManager: TraceManager,
  name: string,
  fn: (span: ActiveSpan) => Promise<T>,
  parentContext?: TraceContext,
  kind = SpanKind.INTERNAL,
  attributes: Record<string, string | number | boolean> = {}
): Promise<T> {
  const span = parentContext
    ? traceManager.startChildSpan(name, parentContext, kind, attributes)
    : traceManager.startSpan(name, kind, attributes);

  try {
    const result = await fn(span);
    span.end({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setAttribute('error', true);

    if (error instanceof Error) {
      span.setAttribute('error.message', error.message);
      span.setAttribute('error.name', error.name);

      if (error.stack) {
        span.setAttribute('error.stack', error.stack);
      }
    }

    span.end({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

/**
 * Execute a synchronous function within a trace span
 */
export function withSpanSync<T>(
  traceManager: TraceManager,
  name: string,
  fn: (span: ActiveSpan) => T,
  parentContext?: TraceContext,
  kind = SpanKind.INTERNAL,
  attributes: Record<string, string | number | boolean> = {}
): T {
  const span = parentContext
    ? traceManager.startChildSpan(name, parentContext, kind, attributes)
    : traceManager.startSpan(name, kind, attributes);

  try {
    const result = fn(span);
    span.end({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setAttribute('error', true);

    if (error instanceof Error) {
      span.setAttribute('error.message', error.message);
      span.setAttribute('error.name', error.name);

      if (error.stack) {
        span.setAttribute('error.stack', error.stack);
      }
    }

    span.end({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a trace manager instance
 */
export function createTraceManager(options: TraceManagerOptions = {}): TraceManager {
  return new TraceManager(options);
}

/**
 * Create a trace manager for a run directory
 */
export function createRunTraceManager(runDir: string, runId?: string): TraceManager {
  const defaultAttributes: Record<string, string | number | boolean> = {};

  if (runId) {
    defaultAttributes.run_id = runId;
  }

  return createTraceManager({
    runDir,
    defaultAttributes,
  });
}
