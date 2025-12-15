import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Prometheus Metrics Writer
 *
 * Exports metrics in Prometheus textfile format:
 * - Counter: monotonically increasing values
 * - Gauge: point-in-time values that can go up or down
 * - Histogram: bucketed observations (e.g., latency distributions)
 * - Summary: quantiles and totals
 *
 * Metrics are buffered in memory and flushed atomically to
 * metrics/prometheus.txt using temp-file-rename pattern.
 *
 * Implements Observability Rulebook metrics requirements.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Metric types supported by Prometheus
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

/**
 * Label map for metric dimensions
 */
export type Labels = Record<string, string>;

/**
 * Metric sample (single data point)
 */
export interface MetricSample {
  /** Metric name */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Help text describing the metric */
  help?: string;
  /** Label dimensions */
  labels: Labels;
  /** Metric value */
  value: number;
  /** Optional timestamp (milliseconds since epoch) */
  timestamp?: number;
}

/**
 * Histogram bucket definition
 */
export interface HistogramBucket {
  /** Upper bound (le = less than or equal) */
  le: number;
  /** Count of observations <= le */
  count: number;
}

/**
 * Histogram metric data
 */
export interface HistogramData {
  /** Buckets */
  buckets: HistogramBucket[];
  /** Total sum of all observations */
  sum: number;
  /** Total count of observations */
  count: number;
}

/**
 * Metrics collector configuration
 */
export interface MetricsCollectorOptions {
  /** Run directory path */
  runDir?: string;
  /** Namespace prefix for all metrics */
  namespace?: string;
  /** Default labels attached to all metrics */
  defaultLabels?: Labels;
}

// ============================================================================
// Standard Metrics Definitions
// ============================================================================

/**
 * Standard metric names used across the CLI
 */
export const StandardMetrics = {
  // Queue metrics
  QUEUE_DEPTH: 'queue_depth',
  QUEUE_PENDING_COUNT: 'queue_pending_count',
  QUEUE_COMPLETED_COUNT: 'queue_completed_count',
  QUEUE_FAILED_COUNT: 'queue_failed_count',
  QUEUE_PROCESSING_DURATION_MS: 'queue_processing_duration_ms',

  // Rate limit metrics
  RATE_LIMIT_REMAINING: 'rate_limit_remaining',
  RATE_LIMIT_RESET_TIMESTAMP: 'rate_limit_reset_timestamp',
  RATE_LIMIT_HITS_TOTAL: 'rate_limit_hits_total',
  RATE_LIMIT_COOLDOWN_ACTIVE: 'rate_limit_cooldown_active',

  // HTTP metrics
  HTTP_REQUEST_DURATION_MS: 'http_request_duration_ms',
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_ERRORS_TOTAL: 'http_errors_total',
  HTTP_RETRY_COUNT: 'http_retry_count',

  // Token usage metrics
  TOKEN_USAGE_PROMPT: 'token_usage_prompt',
  TOKEN_USAGE_COMPLETION: 'token_usage_completion',
  TOKEN_USAGE_TOTAL: 'token_usage_total',

  // Validation metrics
  VALIDATION_DURATION_MS: 'validation_duration_ms',
  VALIDATION_ERRORS_TOTAL: 'validation_errors_total',

  // CLI command metrics
  COMMAND_EXECUTION_DURATION_MS: 'command_execution_duration_ms',
  COMMAND_INVOCATIONS_TOTAL: 'command_invocations_total',
} as const;

/**
 * Standard histogram buckets for latency measurements (milliseconds)
 */
export const LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// ============================================================================
// Metrics Buffer & Collector
// ============================================================================

/**
 * In-memory metric storage with aggregation support
 */
class MetricsBuffer {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramData>();
  private readonly metadata = new Map<string, { type: MetricType; help: string }>();

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, labels: Labels, value = 1, help?: string): void {
    const key = this.serializeKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);

    if (help) {
      this.metadata.set(name, { type: MetricType.COUNTER, help });
    }
  }

  /**
   * Set a gauge metric
   */
  setGauge(name: string, labels: Labels, value: number, help?: string): void {
    const key = this.serializeKey(name, labels);
    this.gauges.set(key, value);

    if (help) {
      this.metadata.set(name, { type: MetricType.GAUGE, help });
    }
  }

  /**
   * Observe a value in a histogram
   */
  observeHistogram(name: string, labels: Labels, value: number, buckets: number[], help?: string): void {
    const key = this.serializeKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = {
        buckets: buckets.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, histogram);
    }

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }

    // Update sum and count
    histogram.sum += value;
    histogram.count++;

    if (help) {
      this.metadata.set(name, { type: MetricType.HISTOGRAM, help });
    }
  }

  /**
   * Get all metric samples for export
   */
  getAllSamples(): MetricSample[] {
    const samples: MetricSample[] = [];

    // Export counters
    for (const [key, value] of this.counters.entries()) {
      const { name, labels } = this.deserializeKey(key);
      const meta = this.metadata.get(name);

      const sample: MetricSample = {
        name,
        type: MetricType.COUNTER,
        labels,
        value,
      };
      if (meta?.help) sample.help = meta.help;
      samples.push(sample);
    }

    // Export gauges
    for (const [key, value] of this.gauges.entries()) {
      const { name, labels } = this.deserializeKey(key);
      const meta = this.metadata.get(name);

      const sample: MetricSample = {
        name,
        type: MetricType.GAUGE,
        labels,
        value,
      };
      if (meta?.help) sample.help = meta.help;
      samples.push(sample);
    }

    // Export histograms
    for (const [key, histogram] of this.histograms.entries()) {
      const { name, labels } = this.deserializeKey(key);
      const meta = this.metadata.get(name);

      // Histogram bucket samples
      for (const bucket of histogram.buckets) {
        const bucketSample: MetricSample = {
          name: `${name}_bucket`,
          type: MetricType.HISTOGRAM,
          labels: { ...labels, le: String(bucket.le) },
          value: bucket.count,
        };
        if (meta?.help) bucketSample.help = meta.help;
        samples.push(bucketSample);
      }

      // +Inf bucket
      samples.push({
        name: `${name}_bucket`,
        type: MetricType.HISTOGRAM,
        labels: { ...labels, le: '+Inf' },
        value: histogram.count,
      });

      // Sum
      samples.push({
        name: `${name}_sum`,
        type: MetricType.HISTOGRAM,
        labels,
        value: histogram.sum,
      });

      // Count
      samples.push({
        name: `${name}_count`,
        type: MetricType.HISTOGRAM,
        labels,
        value: histogram.count,
      });
    }

    return samples;
  }

  /**
   * Clear all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.metadata.clear();
  }

  /**
   * Serialize metric name + labels into storage key
   */
  private serializeKey(name: string, labels: Labels): string {
    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');

    return `${name}{${labelPairs}}`;
  }

  /**
   * Deserialize storage key back into name + labels
   */
  private deserializeKey(key: string): { name: string; labels: Labels } {
    const match = key.match(/^([^{]+)\{([^}]*)\}$/);

    if (!match) {
      return { name: key, labels: {} };
    }

    const name = match[1];
    const labelsStr = match[2];
    const labels: Labels = {};

    if (labelsStr) {
      const pairs = labelsStr.split(',');
      for (const pair of pairs) {
        const [k, v] = pair.split('=');
        labels[k] = v?.replace(/^"|"$/g, '') ?? '';
      }
    }

    return { name, labels };
  }
}

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * Metrics collector with Prometheus textfile export
 */
export class MetricsCollector {
  private readonly options: Required<MetricsCollectorOptions>;
  private readonly buffer: MetricsBuffer;
  private readonly metricsFilePath?: string;

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      runDir: options.runDir ?? '',
      namespace: options.namespace ?? 'ai_feature_pipeline',
      defaultLabels: options.defaultLabels ?? {},
    };

    this.buffer = new MetricsBuffer();

    // Determine metrics file path if run directory is provided
    if (this.options.runDir) {
      this.metricsFilePath = path.join(this.options.runDir, 'metrics', 'prometheus.txt');
    }
  }

  /**
   * Increment a counter metric
   */
  increment(name: string, labels: Labels = {}, value = 1, help?: string): void {
    const fullName = this.prefixMetricName(name);
    const fullLabels = this.mergeLabels(labels);
    this.buffer.incrementCounter(fullName, fullLabels, value, help);
  }

  /**
   * Set a gauge metric
   */
  gauge(name: string, value: number, labels: Labels = {}, help?: string): void {
    const fullName = this.prefixMetricName(name);
    const fullLabels = this.mergeLabels(labels);
    this.buffer.setGauge(fullName, fullLabels, value, help);
  }

  /**
   * Observe a histogram value
   */
  observe(name: string, value: number, labels: Labels = {}, buckets = LATENCY_BUCKETS, help?: string): void {
    const fullName = this.prefixMetricName(name);
    const fullLabels = this.mergeLabels(labels);
    this.buffer.observeHistogram(fullName, fullLabels, value, buckets, help);
  }

  /**
   * Record queue depth metrics
   */
  recordQueueDepth(pending: number, completed: number, failed: number, labels: Labels = {}): void {
    this.gauge(StandardMetrics.QUEUE_PENDING_COUNT, pending, labels, 'Number of pending queue tasks');
    this.gauge(StandardMetrics.QUEUE_COMPLETED_COUNT, completed, labels, 'Number of completed queue tasks');
    this.gauge(StandardMetrics.QUEUE_FAILED_COUNT, failed, labels, 'Number of failed queue tasks');
    this.gauge(StandardMetrics.QUEUE_DEPTH, pending + completed + failed, labels, 'Total queue depth');
  }

  /**
   * Record rate limit state
   */
  recordRateLimit(provider: string, remaining: number, resetTimestamp: number): void {
    const labels = { provider };
    this.gauge(StandardMetrics.RATE_LIMIT_REMAINING, remaining, labels, 'Requests remaining before rate limit');
    this.gauge(StandardMetrics.RATE_LIMIT_RESET_TIMESTAMP, resetTimestamp, labels, 'Unix timestamp when rate limit resets');
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(provider: string, endpoint: string, statusCode: number, durationMs: number, success: boolean): void {
    const labels = { provider, endpoint, status: String(statusCode) };

    this.increment(StandardMetrics.HTTP_REQUESTS_TOTAL, labels, 1, 'Total HTTP requests');
    this.observe(StandardMetrics.HTTP_REQUEST_DURATION_MS, durationMs, labels, LATENCY_BUCKETS, 'HTTP request duration in milliseconds');

    if (!success) {
      this.increment(StandardMetrics.HTTP_ERRORS_TOTAL, labels, 1, 'Total HTTP errors');
    }
  }

  /**
   * Record HTTP retry
   */
  recordHttpRetry(provider: string, endpoint: string, attempt: number): void {
    const labels = { provider, endpoint };
    this.increment(StandardMetrics.HTTP_RETRY_COUNT, { ...labels, attempt: String(attempt) }, 1, 'HTTP retry attempts');
  }

  /**
   * Record token usage
   */
  recordTokenUsage(promptTokens: number, completionTokens: number, labels: Labels = {}): void {
    this.increment(StandardMetrics.TOKEN_USAGE_PROMPT, labels, promptTokens, 'Prompt tokens consumed');
    this.increment(StandardMetrics.TOKEN_USAGE_COMPLETION, labels, completionTokens, 'Completion tokens consumed');
    this.increment(StandardMetrics.TOKEN_USAGE_TOTAL, labels, promptTokens + completionTokens, 'Total tokens consumed');
  }

  /**
   * Flush metrics to Prometheus textfile
   */
  async flush(): Promise<void> {
    if (!this.metricsFilePath) {
      return;
    }

    const samples = this.buffer.getAllSamples();
    const content = this.formatPrometheusText(samples);

    // Ensure metrics directory exists
    const metricsDir = path.dirname(this.metricsFilePath);
    await fs.mkdir(metricsDir, { recursive: true });

    // Atomic write using temp file
    const tempPath = `${this.metricsFilePath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, this.metricsFilePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.buffer.reset();
  }

  /**
   * Format metrics as Prometheus textfile format
   */
  private formatPrometheusText(samples: MetricSample[]): string {
    const lines: string[] = [];
    const metricsByName = new Map<string, MetricSample[]>();

    // Group samples by metric name
    for (const sample of samples) {
      const existing = metricsByName.get(sample.name) ?? [];
      existing.push(sample);
      metricsByName.set(sample.name, existing);
    }

    // Format each metric group
    for (const [name, metricSamples] of metricsByName.entries()) {
      const firstSample = metricSamples[0];

      // Write HELP line (if provided)
      if (firstSample.help) {
        lines.push(`# HELP ${name} ${firstSample.help}`);
      }

      // Write TYPE line
      lines.push(`# TYPE ${name} ${firstSample.type}`);

      // Write sample lines
      for (const sample of metricSamples) {
        const labelStr = this.formatLabels(sample.labels);
        const timestampStr = sample.timestamp ? ` ${sample.timestamp}` : '';
        lines.push(`${sample.name}${labelStr} ${sample.value}${timestampStr}`);
      }

      lines.push(''); // Blank line between metrics
    }

    return lines.join('\n');
  }

  /**
   * Format labels as Prometheus label string
   */
  private formatLabels(labels: Labels): string {
    const entries = Object.entries(labels);

    if (entries.length === 0) {
      return '';
    }

    const pairs = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
      .join(',');

    return `{${pairs}}`;
  }

  /**
   * Escape label value for Prometheus format
   */
  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Prefix metric name with namespace
   */
  private prefixMetricName(name: string): string {
    if (this.options.namespace) {
      return `${this.options.namespace}_${name}`;
    }
    return name;
  }

  /**
   * Merge default labels with call-site labels
   */
  private mergeLabels(labels: Labels): Labels {
    return {
      ...this.options.defaultLabels,
      ...labels,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a metrics collector instance
 */
export function createMetricsCollector(options: MetricsCollectorOptions = {}): MetricsCollector {
  return new MetricsCollector(options);
}

/**
 * Create a metrics collector for a run directory
 */
export function createRunMetricsCollector(runDir: string, runId?: string): MetricsCollector {
  const defaultLabels: Labels = {};

  if (runId) {
    defaultLabels.run_id = runId;
  }

  return createMetricsCollector({
    runDir,
    defaultLabels,
  });
}
