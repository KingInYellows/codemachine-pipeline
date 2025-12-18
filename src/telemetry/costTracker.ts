/**
 * Cost Tracker
 *
 * Tracks API costs across providers, records token usage, applies cost rates,
 * enforces budget thresholds, and persists cost telemetry to run directories.
 *
 * Key features:
 * - Per-provider token and cost accumulation
 * - Configurable cost rates (USD per 1K tokens)
 * - Budget warnings and enforcement
 * - Integration with MetricsCollector
 * - Persistence to costs.json and NDJSON logs
 * - Prometheus metrics emission
 *
 * Implements Observability Baseline and cost tracking requirements.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MetricsCollector } from './metrics';
import type { StructuredLogger } from './logger';
import { ExecutionMetricsHelper } from './executionMetrics';

// ============================================================================
// Types
// ============================================================================

/**
 * Cost entry for a single operation
 */
export interface CostEntry {
  /** Feature ID */
  feature_id: string;
  /** Provider identifier */
  provider: string;
  /** Operation type */
  operation: string;
  /** Prompt tokens consumed */
  prompt_tokens: number;
  /** Completion tokens consumed */
  completion_tokens: number;
  /** Total cost in USD */
  cost_usd: number;
  /** Timestamp */
  timestamp: string;
  /** Optional model identifier */
  model?: string;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Provider cost configuration
 */
export interface ProviderCostConfig {
  /** Provider identifier */
  provider: string;
  /** Model name (optional) */
  model?: string;
  /** Cost per 1K input tokens (USD) */
  inputCostPer1kTokens: number;
  /** Cost per 1K output tokens (USD) */
  outputCostPer1kTokens: number;
}

/**
 * Budget configuration
 */
export interface BudgetConfig {
  /** Maximum total cost in USD */
  maxCostUsd?: number;
  /** Maximum total tokens */
  maxTokens?: number;
  /** Warning threshold (percentage of budget) */
  warningThreshold?: number;
}

/**
 * Cost summary for a provider
 */
export interface ProviderCostSummary {
  /** Provider identifier */
  provider: string;
  /** Total prompt tokens */
  promptTokens: number;
  /** Total completion tokens */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Number of operations */
  operationCount: number;
}

/**
 * Cost tracker state
 */
export interface CostTrackerState {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Per-provider summaries */
  providers: Record<string, ProviderCostSummary>;
  /** Grand totals */
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    operationCount: number;
  };
  /** Budget configuration */
  budget?: BudgetConfig;
  /** Warnings issued */
  warnings: string[];
}

/**
 * Budget warning
 */
export interface BudgetWarning {
  /** Warning type */
  type: 'cost' | 'tokens';
  /** Current value */
  current: number;
  /** Limit value */
  limit: number;
  /** Percentage used */
  percentageUsed: number;
  /** Warning message */
  message: string;
}

// ============================================================================
// Cost Tracker Implementation
// ============================================================================

/**
 * Cost tracker for aggregating and persisting API costs
 */
export class CostTracker {
  private state: CostTrackerState;
  private costConfigs: Map<string, ProviderCostConfig>;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;
  private readonly costsFilePath: string;
  private readonly costsLogPath: string;
  private readonly executionMetrics: ExecutionMetricsHelper;

  constructor(
    featureId: string,
    runDir: string,
    logger: StructuredLogger,
    metrics: MetricsCollector,
    budget?: BudgetConfig
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.costsFilePath = path.join(runDir, 'telemetry', 'costs.json');
    this.costsLogPath = path.join(runDir, 'telemetry', 'costs.ndjson');
    this.executionMetrics = new ExecutionMetricsHelper(metrics, {
      runDir,
      runId: featureId,
      component: 'cost_tracker',
    });

    this.state = {
      schema_version: '1.0.0',
      feature_id: featureId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      providers: {},
      totals: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        operationCount: 0,
      },
      warnings: [],
      ...(budget ? { budget } : {}),
    };

    this.costConfigs = new Map();
    this.initializeDefaultCostConfigs();
  }

  /**
   * Initialize default cost configurations for common providers
   */
  private initializeDefaultCostConfigs(): void {
    // OpenAI GPT-4 (as of 2025)
    this.registerCostConfig({
      provider: 'openai',
      model: 'gpt-4',
      inputCostPer1kTokens: 0.03,
      outputCostPer1kTokens: 0.06,
    });

    // OpenAI GPT-3.5 Turbo
    this.registerCostConfig({
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      inputCostPer1kTokens: 0.0015,
      outputCostPer1kTokens: 0.002,
    });

    // Anthropic Claude 3 Opus
    this.registerCostConfig({
      provider: 'anthropic',
      model: 'claude-3-opus',
      inputCostPer1kTokens: 0.015,
      outputCostPer1kTokens: 0.075,
    });

    // Anthropic Claude 3 Sonnet
    this.registerCostConfig({
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015,
    });

    // Anthropic Claude 3 Haiku
    this.registerCostConfig({
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputCostPer1kTokens: 0.00025,
      outputCostPer1kTokens: 0.00125,
    });

    // Default fallback (if no model specified)
    this.registerCostConfig({
      provider: 'default',
      inputCostPer1kTokens: 0.01,
      outputCostPer1kTokens: 0.03,
    });
  }

  /**
   * Register a cost configuration for a provider/model
   */
  registerCostConfig(config: ProviderCostConfig): void {
    const key = config.model ? `${config.provider}:${config.model}` : config.provider;
    this.costConfigs.set(key, config);
  }

  /**
   * Get cost configuration for a provider/model
   */
  private getCostConfig(provider: string, model?: string): ProviderCostConfig {
    // Try model-specific config first
    if (model) {
      const modelKey = `${provider}:${model}`;
      const config = this.costConfigs.get(modelKey);
      if (config) return config;
    }

    // Try provider-level config
    const providerConfig = this.costConfigs.get(provider);
    if (providerConfig) return providerConfig;

    // Fallback to default
    const defaultConfig = this.costConfigs.get('default');
    if (defaultConfig) return defaultConfig;

    // Ultimate fallback
    return {
      provider: 'default',
      inputCostPer1kTokens: 0.01,
      outputCostPer1kTokens: 0.03,
    };
  }

  /**
   * Calculate cost for token usage
   */
  private calculateCost(
    promptTokens: number,
    completionTokens: number,
    config: ProviderCostConfig
  ): number {
    const promptCost = (promptTokens / 1000) * config.inputCostPer1kTokens;
    const completionCost = (completionTokens / 1000) * config.outputCostPer1kTokens;
    return promptCost + completionCost;
  }

  /**
   * Record token usage and cost for an operation
   */
  async recordUsage(
    provider: string,
    operation: string,
    promptTokens: number,
    completionTokens: number,
    model?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Get cost config
    const costConfig = this.getCostConfig(provider, model);

    // Calculate cost
    const costUsd = this.calculateCost(promptTokens, completionTokens, costConfig);

    // Create cost entry
    const entry: CostEntry = {
      feature_id: this.state.feature_id,
      provider,
      operation,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: costUsd,
      timestamp: new Date().toISOString(),
      ...(model ? { model } : {}),
      ...(metadata ? { metadata } : {}),
    };

    // Update provider summary
    if (!this.state.providers[provider]) {
      this.state.providers[provider] = {
        provider,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        operationCount: 0,
      };
    }

    const providerSummary = this.state.providers[provider];
    providerSummary.promptTokens += promptTokens;
    providerSummary.completionTokens += completionTokens;
    providerSummary.totalTokens += promptTokens + completionTokens;
    providerSummary.totalCostUsd += costUsd;
    providerSummary.operationCount += 1;

    // Update totals
    this.state.totals.promptTokens += promptTokens;
    this.state.totals.completionTokens += completionTokens;
    this.state.totals.totalTokens += promptTokens + completionTokens;
    this.state.totals.totalCostUsd += costUsd;
    this.state.totals.operationCount += 1;
    this.state.updated_at = new Date().toISOString();

    // Check budget warnings
    const warnings = this.checkBudgetWarnings();
    for (const warning of warnings) {
      this.state.warnings.push(warning.message);
      this.logger.warn('Budget warning', {
        type: warning.type,
        current: warning.current,
        limit: warning.limit,
        percentageUsed: warning.percentageUsed,
      });
    }

    // Log the entry to NDJSON
    await this.appendCostLog(entry);

    // Record metrics
    this.metrics.recordTokenUsage(promptTokens, completionTokens, {
      provider,
      model: model ?? 'unknown',
      operation,
    });
    this.executionMetrics.recordAgentCost(model ?? provider, promptTokens, completionTokens);
    this.executionMetrics.setAgentCostUsd(this.state.totals.totalCostUsd);

    // Record cost metric (custom gauge)
    this.metrics.gauge('cost_usd_total', this.state.totals.totalCostUsd, {
      feature_id: this.state.feature_id,
    });

    this.logger.debug('Recorded cost usage', {
      provider,
      operation,
      promptTokens,
      completionTokens,
      costUsd,
    });
  }

  /**
   * Check for budget warnings
   */
  private checkBudgetWarnings(): BudgetWarning[] {
    const warnings: BudgetWarning[] = [];

    if (!this.state.budget) {
      return warnings;
    }

    const threshold = this.state.budget.warningThreshold ?? 80; // Default 80%

    // Check cost budget
    if (this.state.budget.maxCostUsd !== undefined) {
      const percentageUsed = (this.state.totals.totalCostUsd / this.state.budget.maxCostUsd) * 100;

      if (percentageUsed >= 100) {
        warnings.push({
          type: 'cost',
          current: this.state.totals.totalCostUsd,
          limit: this.state.budget.maxCostUsd,
          percentageUsed,
          message: `Cost budget exceeded: $${this.state.totals.totalCostUsd.toFixed(4)} / $${this.state.budget.maxCostUsd.toFixed(4)} (${percentageUsed.toFixed(1)}%)`,
        });
      } else if (percentageUsed >= threshold) {
        warnings.push({
          type: 'cost',
          current: this.state.totals.totalCostUsd,
          limit: this.state.budget.maxCostUsd,
          percentageUsed,
          message: `Cost budget warning: $${this.state.totals.totalCostUsd.toFixed(4)} / $${this.state.budget.maxCostUsd.toFixed(4)} (${percentageUsed.toFixed(1)}%)`,
        });
      }
    }

    // Check token budget
    if (this.state.budget.maxTokens !== undefined) {
      const percentageUsed = (this.state.totals.totalTokens / this.state.budget.maxTokens) * 100;

      if (percentageUsed >= 100) {
        warnings.push({
          type: 'tokens',
          current: this.state.totals.totalTokens,
          limit: this.state.budget.maxTokens,
          percentageUsed,
          message: `Token budget exceeded: ${this.state.totals.totalTokens} / ${this.state.budget.maxTokens} (${percentageUsed.toFixed(1)}%)`,
        });
      } else if (percentageUsed >= threshold) {
        warnings.push({
          type: 'tokens',
          current: this.state.totals.totalTokens,
          limit: this.state.budget.maxTokens,
          percentageUsed,
          message: `Token budget warning: ${this.state.totals.totalTokens} / ${this.state.budget.maxTokens} (${percentageUsed.toFixed(1)}%)`,
        });
      }
    }

    return warnings;
  }

  /**
   * Get current cost state
   */
  getState(): CostTrackerState {
    return { ...this.state };
  }

  /**
   * Get summary for a specific provider
   */
  getProviderSummary(provider: string): ProviderCostSummary | null {
    return this.state.providers[provider] ?? null;
  }

  /**
   * Get all budget warnings
   */
  getBudgetWarnings(): BudgetWarning[] {
    return this.checkBudgetWarnings();
  }

  /**
   * Append cost entry to NDJSON log
   */
  private async appendCostLog(entry: CostEntry): Promise<void> {
    try {
      // Ensure telemetry directory exists
      const telemetryDir = path.dirname(this.costsLogPath);
      await fs.mkdir(telemetryDir, { recursive: true });

      // Append entry
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.costsLogPath, line, 'utf-8');
    } catch (error) {
      this.logger.error('Failed to append cost log', {
        error: String(error),
        path: this.costsLogPath,
      });
    }
  }

  /**
   * Persist cost state to JSON file
   */
  async flush(): Promise<void> {
    try {
      // Ensure telemetry directory exists
      const telemetryDir = path.dirname(this.costsFilePath);
      await fs.mkdir(telemetryDir, { recursive: true });

      // Write state to JSON
      const content = JSON.stringify(this.state, null, 2);
      await fs.writeFile(this.costsFilePath, content, 'utf-8');

      this.logger.debug('Flushed cost tracker state', {
        path: this.costsFilePath,
        totalCost: this.state.totals.totalCostUsd,
        totalTokens: this.state.totals.totalTokens,
      });

      // Also flush metrics
      await this.metrics.flush();
    } catch (error) {
      this.logger.error('Failed to flush cost tracker', {
        error: String(error),
        path: this.costsFilePath,
      });
      throw error;
    }
  }

  /**
   * Load existing cost state from file
   */
  static async load(
    runDir: string,
    logger: StructuredLogger,
    metrics: MetricsCollector
  ): Promise<CostTracker | null> {
    const costsFilePath = path.join(runDir, 'telemetry', 'costs.json');

    try {
      const content = await fs.readFile(costsFilePath, 'utf-8');
      const state = JSON.parse(content) as CostTrackerState;

      const tracker = new CostTracker(
        state.feature_id,
        runDir,
        logger,
        metrics,
        state.budget
      );
      tracker.state = state;

      logger.info('Loaded existing cost tracker state', {
        featureId: state.feature_id,
        totalCost: state.totals.totalCostUsd,
        totalTokens: state.totals.totalTokens,
      });

      return tracker;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a cost tracker instance
 */
export function createCostTracker(
  featureId: string,
  runDir: string,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  budget?: BudgetConfig
): CostTracker {
  return new CostTracker(featureId, runDir, logger, metrics, budget);
}

/**
 * Load or create a cost tracker
 */
export async function loadOrCreateCostTracker(
  featureId: string,
  runDir: string,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  budget?: BudgetConfig
): Promise<CostTracker> {
  const existing = await CostTracker.load(runDir, logger, metrics);
  if (existing) {
    return existing;
  }

  return createCostTracker(featureId, runDir, logger, metrics, budget);
}
