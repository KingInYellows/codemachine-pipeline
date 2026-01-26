import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  CostTracker,
  type ProviderCostConfig,
  type BudgetConfig,
} from '../../src/telemetry/costTracker';
import { createCliLogger } from '../../src/telemetry/logger';
import { createRunMetricsCollector } from '../../src/telemetry/metrics';

describe('CostTracker', () => {
  let tempDir: string;
  let runDir: string;
  let tracker: CostTracker;
  const featureId = 'test-feature-123';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'costtracker-test-'));
    runDir = path.join(tempDir, 'runs', featureId);
    await fs.mkdir(path.join(runDir, 'telemetry'), { recursive: true });

    const logger = createCliLogger('costTracker', 'info', runDir);
    const metrics = createRunMetricsCollector(runDir, featureId, 'costTracker');

    tracker = new CostTracker(featureId, runDir, logger, metrics);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should initialize with correct feature ID', () => {
      const state = tracker.getState();
      expect(state.feature_id).toBe(featureId);
    });

    it('should initialize with zero totals', () => {
      const state = tracker.getState();
      expect(state.totals.promptTokens).toBe(0);
      expect(state.totals.completionTokens).toBe(0);
      expect(state.totals.totalTokens).toBe(0);
      expect(state.totals.totalCostUsd).toBe(0);
      expect(state.totals.operationCount).toBe(0);
    });

    it('should initialize with empty providers', () => {
      const state = tracker.getState();
      expect(Object.keys(state.providers)).toHaveLength(0);
    });

    it('should accept budget configuration', async () => {
      const budget: BudgetConfig = {
        maxCostUsd: 10.0,
        maxTokens: 100000,
        warningThreshold: 80, // 80% threshold
      };

      const logger = createCliLogger('costTracker', 'info', runDir);
      const metrics = createRunMetricsCollector(runDir, featureId, 'costTracker');
      const trackerWithBudget = new CostTracker(featureId, runDir, logger, metrics, budget);

      const state = trackerWithBudget.getState();
      expect(state.budget).toBeDefined();
      expect(state.budget?.maxCostUsd).toBe(10.0);
      expect(state.budget?.maxTokens).toBe(100000);
    });
  });

  describe('registerCostConfig', () => {
    it('should register custom cost configuration', async () => {
      const customConfig: ProviderCostConfig = {
        provider: 'custom-provider',
        model: 'custom-model',
        inputCostPer1kTokens: 0.05,
        outputCostPer1kTokens: 0.10,
      };

      tracker.registerCostConfig(customConfig);

      // Record usage with custom provider to verify config was applied
      // recordUsage(provider, operation, promptTokens, completionTokens, model?, metadata?)
      await tracker.recordUsage(
        'custom-provider',
        'test',
        1000,
        1000,
        'custom-model'
      );

      const summary = tracker.getProviderSummary('custom-provider');
      expect(summary).toBeDefined();
      // Cost should be 0.05 * 1 + 0.10 * 1 = 0.15
      expect(summary!.totalCostUsd).toBeCloseTo(0.15, 4);
    });
  });

  describe('recordUsage', () => {
    it('should record token usage correctly', async () => {
      // recordUsage(provider, operation, promptTokens, completionTokens, model?, metadata?)
      await tracker.recordUsage('openai', 'completion', 500, 200, 'gpt-4');

      const state = tracker.getState();
      expect(state.totals.promptTokens).toBe(500);
      expect(state.totals.completionTokens).toBe(200);
      expect(state.totals.totalTokens).toBe(700);
      expect(state.totals.operationCount).toBe(1);
    });

    it('should accumulate multiple usages', async () => {
      await tracker.recordUsage('openai', 'completion', 100, 50);
      await tracker.recordUsage('anthropic', 'completion', 200, 100);

      const state = tracker.getState();
      expect(state.totals.promptTokens).toBe(300);
      expect(state.totals.completionTokens).toBe(150);
      expect(state.totals.totalTokens).toBe(450);
      expect(state.totals.operationCount).toBe(2);
    });

    it('should calculate cost using configured rates', async () => {
      // GPT-4 rates: input $0.03/1K, output $0.06/1K
      await tracker.recordUsage('openai', 'completion', 1000, 1000, 'gpt-4');

      const state = tracker.getState();
      // Cost should be 0.03 * 1 + 0.06 * 1 = 0.09
      expect(state.totals.totalCostUsd).toBeCloseTo(0.09, 4);
    });

    it('should track per-provider summaries', async () => {
      await tracker.recordUsage('openai', 'completion', 1000, 500);
      await tracker.recordUsage('anthropic', 'completion', 2000, 1000);

      const openaiSummary = tracker.getProviderSummary('openai');
      const anthropicSummary = tracker.getProviderSummary('anthropic');

      expect(openaiSummary).toBeDefined();
      expect(openaiSummary!.promptTokens).toBe(1000);
      expect(openaiSummary!.completionTokens).toBe(500);
      expect(openaiSummary!.operationCount).toBe(1);

      expect(anthropicSummary).toBeDefined();
      expect(anthropicSummary!.promptTokens).toBe(2000);
      expect(anthropicSummary!.completionTokens).toBe(1000);
      expect(anthropicSummary!.operationCount).toBe(1);
    });
  });

  describe('getProviderSummary', () => {
    it('should return null for unknown provider', () => {
      const summary = tracker.getProviderSummary('unknown-provider');
      expect(summary).toBeNull();
    });

    it('should return summary for known provider', async () => {
      await tracker.recordUsage('openai', 'completion', 100, 50);

      const summary = tracker.getProviderSummary('openai');
      expect(summary).toBeDefined();
      expect(summary!.provider).toBe('openai');
    });
  });

  describe('budget warnings', () => {
    it('should issue warning when cost threshold exceeded', async () => {
      const budget: BudgetConfig = {
        maxCostUsd: 1.0,
        warningThreshold: 50, // Warn at 50% (percentage, not decimal)
      };

      const logger = createCliLogger('costTracker', 'info', runDir);
      const metrics = createRunMetricsCollector(runDir, featureId, 'costTracker');
      const trackerWithBudget = new CostTracker(featureId, runDir, logger, metrics, budget);

      // Record usage that exceeds 50% of budget
      // Default rates: input $0.01/1K, output $0.03/1K
      // Need to exceed 50% = $0.50
      // 30K prompt = $0.30, 10K completion = $0.30 -> total $0.60 = 60% > 50%
      await trackerWithBudget.recordUsage('default', 'completion', 30000, 10000);

      const warnings = trackerWithBudget.getBudgetWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].type).toBe('cost');
    });

    it('should issue warning when token threshold exceeded', async () => {
      const budget: BudgetConfig = {
        maxTokens: 1000,
        warningThreshold: 50, // Warn at 50% (percentage, not decimal)
      };

      const logger = createCliLogger('costTracker', 'info', runDir);
      const metrics = createRunMetricsCollector(runDir, featureId, 'costTracker');
      const trackerWithBudget = new CostTracker(featureId, runDir, logger, metrics, budget);

      // Total 600 tokens, which is 60% > 50%
      await trackerWithBudget.recordUsage('openai', 'completion', 400, 200);

      const warnings = trackerWithBudget.getBudgetWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.type === 'tokens')).toBe(true);
    });
  });

  describe('flush', () => {
    it('should persist state to costs.json', async () => {
      await tracker.recordUsage('openai', 'completion', 100, 50);

      await tracker.flush();

      const costsPath = path.join(runDir, 'telemetry', 'costs.json');
      const content = await fs.readFile(costsPath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.feature_id).toBe(featureId);
      expect(saved.totals.promptTokens).toBe(100);
      expect(saved.totals.completionTokens).toBe(50);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = tracker.getState();
      expect(state).toBeDefined();
      expect(state.schema_version).toBe('1.0.0');
      expect(state.feature_id).toBe(featureId);
      expect(state.providers).toBeDefined();
      expect(state.totals).toBeDefined();
    });
  });
});
