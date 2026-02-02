import { describe, it, expect } from 'vitest';
import {
  createFeature,
  parseFeature,
  serializeFeature,
} from '../../../src/core/models/Feature';

describe('Feature', () => {
  const validRepoUrl = 'https://github.com/org/repo.git';
  const validFeatureId = 'feat-001';

  // -------------------------------------------------------------------------
  // createFeature
  // -------------------------------------------------------------------------

  describe('createFeature', () => {
    it('creates a Feature with default values', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);

      expect(feature.schema_version).toBe('1.0.0');
      expect(feature.feature_id).toBe(validFeatureId);
      expect(feature.repo.url).toBe(validRepoUrl);
      expect(feature.repo.default_branch).toBe('main');
      expect(feature.execution.completed_steps).toBe(0);
      expect(feature.approvals.pending).toEqual([]);
      expect(feature.approvals.completed).toEqual([]);
      expect(feature.artifacts).toEqual({});
      expect(feature.telemetry.logs_dir).toBe('logs');
      expect(feature.title).toBeUndefined();
      expect(feature.source).toBeUndefined();
      expect(feature.metadata).toBeUndefined();
    });

    it('creates a Feature with all options', () => {
      const feature = createFeature(validFeatureId, validRepoUrl, {
        title: 'My Feature',
        source: 'linear:PROJ-42',
        defaultBranch: 'develop',
        metadata: { priority: 'high', tags: ['auth'] },
      });

      expect(feature.title).toBe('My Feature');
      expect(feature.source).toBe('linear:PROJ-42');
      expect(feature.repo.default_branch).toBe('develop');
      expect(feature.metadata).toEqual({ priority: 'high', tags: ['auth'] });
    });

    it('sets status to pending', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      expect(feature.status).toBe('pending');
    });

    it('sets created_at and updated_at timestamps', () => {
      const before = new Date().toISOString();
      const feature = createFeature(validFeatureId, validRepoUrl);
      const after = new Date().toISOString();

      expect(feature.timestamps.created_at).toBeDefined();
      expect(feature.timestamps.updated_at).toBeDefined();
      // Timestamps should be between before and after
      expect(feature.timestamps.created_at >= before).toBe(true);
      expect(feature.timestamps.created_at <= after).toBe(true);
      // created_at and updated_at should be the same on creation
      expect(feature.timestamps.created_at).toBe(feature.timestamps.updated_at);
    });
  });

  // -------------------------------------------------------------------------
  // parseFeature
  // -------------------------------------------------------------------------

  describe('parseFeature', () => {
    it('validates a valid Feature object', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const result = parseFeature(feature);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.feature_id).toBe(validFeatureId);
        expect(result.data.status).toBe('pending');
      }
    });

    it('rejects invalid JSON with missing required fields', () => {
      const result = parseFeature({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        const paths = result.errors.map((e) => e.path);
        expect(paths).toContain('schema_version');
        expect(paths).toContain('feature_id');
      }
    });

    it('rejects invalid types for fields', () => {
      const invalid = {
        schema_version: 123, // should be string
        feature_id: '', // min length 1
        repo: { url: 'not-a-url', default_branch: 'main' },
        status: 'unknown_status',
        execution: { completed_steps: 0 },
        timestamps: {
          created_at: 'not-a-date',
          updated_at: 'not-a-date',
        },
        approvals: { pending: [], completed: [] },
        artifacts: {},
        telemetry: { logs_dir: 'logs' },
      };

      const result = parseFeature(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('accepts a Feature with optional fields populated', () => {
      const feature = createFeature(validFeatureId, validRepoUrl, {
        title: 'Optional Title',
        source: 'manual:prompt',
        metadata: { custom: true },
      });

      // Add optional nested fields
      const withOptionals = {
        ...feature,
        artifacts: {
          prd: 'artifacts/prd.md',
          spec: 'artifacts/spec.md',
          plan: 'artifacts/plan.json',
          hash_manifest: 'artifacts/hashes.json',
        },
        telemetry: {
          logs_dir: 'logs',
          metrics_file: 'metrics.json',
          traces_file: 'traces.json',
          costs_file: 'costs.json',
          trace_id: 'trace-abc-123',
        },
        rate_limits: {
          rate_limits_file: 'rate_limits.json',
        },
        execution: {
          last_step: 'generate-prd',
          current_step: 'generate-spec',
          total_steps: 5,
          completed_steps: 2,
        },
      };

      const result = parseFeature(withOptionals);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.artifacts.prd).toBe('artifacts/prd.md');
        expect(result.data.telemetry.trace_id).toBe('trace-abc-123');
        expect(result.data.rate_limits?.rate_limits_file).toBe('rate_limits.json');
        expect(result.data.execution.total_steps).toBe(5);
        expect(result.data.execution.completed_steps).toBe(2);
      }
    });

    it('rejects unrecognised keys due to strict mode', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const withExtra = { ...feature, unknown_field: 'surprise' };

      const result = parseFeature(withExtra);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.errors.map((e) => e.message);
        expect(messages.some((m) => m.includes('Unrecognized key'))).toBe(true);
      }
    });

    it('rejects invalid schema_version format', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const bad = { ...feature, schema_version: 'v1' };

      const result = parseFeature(bad);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path === 'schema_version')).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // serializeFeature
  // -------------------------------------------------------------------------

  describe('serializeFeature', () => {
    it('produces a valid JSON string', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const json = serializeFeature(feature);

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.feature_id).toBe(validFeatureId);
    });

    it('uses pretty printing by default', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const json = serializeFeature(feature);

      // Pretty-printed JSON contains newlines and indentation
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });

    it('produces compact JSON when pretty is false', () => {
      const feature = createFeature(validFeatureId, validRepoUrl);
      const json = serializeFeature(feature, false);

      expect(json).not.toContain('\n');
    });

    it('round-trips with parseFeature', () => {
      const original = createFeature(validFeatureId, validRepoUrl, {
        title: 'Round-trip Test',
        source: 'manual:test',
        metadata: { key: 'value' },
      });

      const json = serializeFeature(original);
      const parsed = JSON.parse(json);
      const result = parseFeature(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.feature_id).toBe(original.feature_id);
        expect(result.data.title).toBe(original.title);
        expect(result.data.source).toBe(original.source);
        expect(result.data.status).toBe(original.status);
        expect(result.data.repo).toEqual(original.repo);
        expect(result.data.metadata).toEqual(original.metadata);
        expect(result.data.timestamps.created_at).toBe(original.timestamps.created_at);
      }
    });
  });
});
