import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSpecification,
  parseSpecification,
  serializeSpecification,
  addChangeLogEntry,
  isFullyApproved,
  getPendingReviewers,
  formatSpecificationValidationErrors,
  type ReviewerInfo,
  type RiskAssessment,
  type TestPlanItem,
  type RolloutPlan,
} from '../../../src/core/models/Specification';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2025-06-15T10:00:00.000Z';

function makeReviewer(overrides: Partial<ReviewerInfo> = {}): ReviewerInfo {
  return {
    reviewer_id: 'reviewer-1',
    name: 'Alice',
    assigned_at: NOW,
    verdict: 'pending',
    ...overrides,
  };
}

function makeApprovedReviewer(id: string): ReviewerInfo {
  return makeReviewer({
    reviewer_id: id,
    name: id,
    verdict: 'approved',
    reviewed_at: NOW,
  });
}

function makeRisk(): RiskAssessment {
  return {
    description: 'Data loss on migration',
    severity: 'high',
    mitigation: 'Run backup first',
    owner: 'ops-team',
  };
}

function makeTestPlanItem(): TestPlanItem {
  return {
    test_id: 'T-001',
    description: 'Verify user creation',
    test_type: 'unit',
    acceptance_criteria: ['Returns 201', 'Stores in DB'],
  };
}

function makeRolloutPlan(): RolloutPlan {
  return {
    strategy: 'canary',
    phases: [
      {
        phase_id: 'p1',
        description: '10% canary',
        percentage: 10,
        duration: '1h',
      },
      {
        phase_id: 'p2',
        description: 'Full rollout',
        percentage: 100,
      },
    ],
    rollback_plan: 'Revert deployment and restore DB snapshot',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Specification model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================================================
  // createSpecification
  // ========================================================================

  describe('createSpecification', () => {
    it('should create a specification with defaults', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'My Title', 'Some content');

      expect(spec.spec_id).toBe('spec-1');
      expect(spec.feature_id).toBe('feat-1');
      expect(spec.title).toBe('My Title');
      expect(spec.content).toBe('Some content');
      expect(spec.schema_version).toBe('1.0.0');
      expect(spec.status).toBe('draft');
      expect(spec.reviewers).toEqual([]);
      expect(spec.change_log).toEqual([]);
      expect(spec.risks).toEqual([]);
      expect(spec.test_plan).toEqual([]);
      expect(spec.rollout_plan).toBeUndefined();
      expect(spec.metadata).toBeUndefined();
      expect(spec.created_at).toBe(NOW);
      expect(spec.updated_at).toBe(NOW);
    });

    it('should create a specification with reviewers, risks, testPlan, and rolloutPlan', () => {
      const reviewers = [makeReviewer({ reviewer_id: 'r1' }), makeReviewer({ reviewer_id: 'r2' })];
      const risks = [makeRisk()];
      const testPlan = [makeTestPlanItem()];
      const rolloutPlan = makeRolloutPlan();
      const metadata = { priority: 'high' };

      const spec = createSpecification('spec-2', 'feat-2', 'Full Spec', 'Detailed content', {
        reviewers,
        risks,
        testPlan,
        rolloutPlan,
        metadata,
      });

      expect(spec.reviewers).toHaveLength(2);
      expect(spec.reviewers[0].reviewer_id).toBe('r1');
      expect(spec.risks).toHaveLength(1);
      expect(spec.risks[0].severity).toBe('high');
      expect(spec.test_plan).toHaveLength(1);
      expect(spec.test_plan[0].test_id).toBe('T-001');
      expect(spec.rollout_plan).toBeDefined();
      const rolloutPlanVal = spec.rollout_plan;
      if (!rolloutPlanVal) {
        throw new Error('Expected rollout_plan to be defined');
      }
      expect(rolloutPlanVal.strategy).toBe('canary');
      expect(rolloutPlanVal.phases).toHaveLength(2);
      expect(spec.metadata).toEqual({ priority: 'high' });
    });
  });

  // ========================================================================
  // parseSpecification
  // ========================================================================

  describe('parseSpecification', () => {
    it('should parse a valid specification JSON object', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'Title', 'Content');
      const result = parseSpecification(spec);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spec_id).toBe('spec-1');
        expect(result.data.status).toBe('draft');
      }
    });

    it('should return errors for invalid JSON', () => {
      const result = parseSpecification({ spec_id: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeInstanceOf(Array);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toHaveProperty('path');
        expect(result.errors[0]).toHaveProperty('message');
      }
    });

    it('should reject completely wrong types', () => {
      const result = parseSpecification('not an object');

      expect(result.success).toBe(false);
    });

    it('should reject objects with extra unknown keys due to strict mode', () => {
      const spec = {
        ...createSpecification('spec-1', 'feat-1', 'Title', 'Content'),
        unknown_field: 'not allowed',
      };
      const result = parseSpecification(spec);

      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // serializeSpecification / round-trip
  // ========================================================================

  describe('serializeSpecification', () => {
    it('should round-trip through serialize and parse', () => {
      const original = createSpecification('spec-rt', 'feat-rt', 'Round Trip', 'Body text', {
        reviewers: [makeApprovedReviewer('r1')],
        risks: [makeRisk()],
        testPlan: [makeTestPlanItem()],
        rolloutPlan: makeRolloutPlan(),
      });

      const json = serializeSpecification(original);
      const parsed = parseSpecification(JSON.parse(json));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.spec_id).toBe('spec-rt');
        expect(parsed.data.reviewers).toHaveLength(1);
        expect(parsed.data.risks).toHaveLength(1);
        expect(parsed.data.test_plan).toHaveLength(1);
        expect(parsed.data.rollout_plan).toBeDefined();
        if (!parsed.data.rollout_plan) {
          throw new Error('Expected rollout_plan to be defined');
        }
        expect(parsed.data.rollout_plan.strategy).toBe('canary');
      }
    });

    it('should produce pretty output by default', () => {
      const spec = createSpecification('s1', 'f1', 'T', 'C');
      const pretty = serializeSpecification(spec);
      const compact = serializeSpecification(spec, false);

      expect(pretty).toContain('\n');
      expect(compact).not.toContain('\n');
    });
  });

  // ========================================================================
  // addChangeLogEntry
  // ========================================================================

  describe('addChangeLogEntry', () => {
    it('should add an entry and update the timestamp', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C');

      // Advance time so updated_at differs
      vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
      const updated = addChangeLogEntry(spec, 'alice', 'Initial draft');

      expect(updated.change_log).toHaveLength(1);
      expect(updated.change_log[0].author).toBe('alice');
      expect(updated.change_log[0].description).toBe('Initial draft');
      expect(updated.change_log[0].timestamp).toBe('2025-06-15T12:00:00.000Z');
      expect(updated.updated_at).toBe('2025-06-15T12:00:00.000Z');
      // Original should be unchanged
      expect(spec.change_log).toHaveLength(0);
    });

    it('should preserve existing entries when adding new ones', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C');
      const first = addChangeLogEntry(spec, 'alice', 'First change', 'v1');

      vi.setSystemTime(new Date('2025-06-15T13:00:00.000Z'));
      const second = addChangeLogEntry(first, 'bob', 'Second change', 'v2');

      expect(second.change_log).toHaveLength(2);
      expect(second.change_log[0].author).toBe('alice');
      expect(second.change_log[0].version).toBe('v1');
      expect(second.change_log[1].author).toBe('bob');
      expect(second.change_log[1].version).toBe('v2');
    });

    it('should support optional version parameter', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C');
      const updated = addChangeLogEntry(spec, 'alice', 'No version');

      expect(updated.change_log[0].version).toBeUndefined();
    });
  });

  // ========================================================================
  // isFullyApproved
  // ========================================================================

  describe('isFullyApproved', () => {
    it('should return true when all reviewers have approved', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C', {
        reviewers: [makeApprovedReviewer('r1'), makeApprovedReviewer('r2')],
      });

      expect(isFullyApproved(spec)).toBe(true);
    });

    it('should return false when some reviewers are still pending', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C', {
        reviewers: [
          makeApprovedReviewer('r1'),
          makeReviewer({ reviewer_id: 'r2', verdict: 'pending' }),
        ],
      });

      expect(isFullyApproved(spec)).toBe(false);
    });

    it('should return false when a reviewer has rejected', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C', {
        reviewers: [
          makeApprovedReviewer('r1'),
          makeReviewer({ reviewer_id: 'r2', verdict: 'rejected' }),
        ],
      });

      expect(isFullyApproved(spec)).toBe(false);
    });

    it('should return false when there are no reviewers', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C');

      expect(isFullyApproved(spec)).toBe(false);
    });
  });

  // ========================================================================
  // getPendingReviewers
  // ========================================================================

  describe('getPendingReviewers', () => {
    it('should return only reviewers with pending verdict', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C', {
        reviewers: [
          makeApprovedReviewer('r1'),
          makeReviewer({ reviewer_id: 'r2', verdict: 'pending' }),
          makeReviewer({ reviewer_id: 'r3', verdict: 'rejected' }),
          makeReviewer({ reviewer_id: 'r4', verdict: 'pending' }),
        ],
      });

      const pending = getPendingReviewers(spec);

      expect(pending).toHaveLength(2);
      expect(pending.map((r) => r.reviewer_id)).toEqual(['r2', 'r4']);
    });

    it('should return empty array when all reviewers have reviewed', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C', {
        reviewers: [
          makeApprovedReviewer('r1'),
          makeReviewer({ reviewer_id: 'r2', verdict: 'rejected', reviewed_at: NOW }),
        ],
      });

      const pending = getPendingReviewers(spec);

      expect(pending).toHaveLength(0);
    });

    it('should return empty array when there are no reviewers', () => {
      const spec = createSpecification('spec-1', 'feat-1', 'T', 'C');

      expect(getPendingReviewers(spec)).toEqual([]);
    });
  });

  // ========================================================================
  // formatSpecificationValidationErrors
  // ========================================================================

  describe('formatSpecificationValidationErrors', () => {
    it('should produce readable output from error array', () => {
      const errors = [
        { path: 'title', message: 'String must contain at least 1 character(s)' },
        { path: 'schema_version', message: 'Invalid semver format' },
      ];

      const output = formatSpecificationValidationErrors(errors);

      expect(output).toContain('Specification validation failed:');
      expect(output).toContain('title: String must contain at least 1 character(s)');
      expect(output).toContain('schema_version: Invalid semver format');
      expect(output).toContain('docs/reference/data_model_dictionary.md');
    });

    it('should handle an empty error array', () => {
      const output = formatSpecificationValidationErrors([]);

      expect(output).toContain('Specification validation failed:');
      expect(output).toContain('docs/reference/data_model_dictionary.md');
    });

    it('should format errors returned from parseSpecification', () => {
      const result = parseSpecification({});

      expect(result.success).toBe(false);
      if (!result.success) {
        const output = formatSpecificationValidationErrors(result.errors);
        expect(output).toContain('Specification validation failed:');
        // Should have at least one bullet point
        expect(output).toMatch(/\s+\u2022\s+/);
      }
    });
  });
});
