/**
 * Unit Tests for Plan Differ
 *
 * Tests the plan diffing workflow including:
 * - Spec hash comparison between plan and spec metadata
 * - Missing metadata handling (plan or spec)
 * - Plan file integrity checks (checksum, missing, invalid)
 * - Recommendation generation for detected changes
 * - Timestamp generation for analysis results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { comparePlanDiff } from '../../src/workflows/planDiffer';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('node:fs/promises');

vi.mock('../../src/workflows/taskPlanner', () => ({
  loadPlanMetadata: vi.fn(),
}));

vi.mock('../../src/workflows/specComposer', () => ({
  loadSpecMetadata: vi.fn(),
}));

vi.mock('../../src/utils/safeJson', () => ({
  safeJsonParse: vi.fn(),
}));

import { loadPlanMetadata } from '../../src/workflows/taskPlanner';
import { loadSpecMetadata } from '../../src/workflows/specComposer';
import { safeJsonParse } from '../../src/utils/safeJson';

const mockedLoadPlanMetadata = vi.mocked(loadPlanMetadata);
const mockedLoadSpecMetadata = vi.mocked(loadSpecMetadata);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedSafeJsonParse = vi.mocked(safeJsonParse);

// ============================================================================
// Helpers
// ============================================================================

function createPlanMetadata(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0.0',
    feature_id: 'feat-001',
    plan_hash: 'plan-hash-abc',
    spec_hash: 'spec-hash-xyz',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    total_tasks: 3,
    entry_tasks: ['PLAN-T1'],
    ...overrides,
  };
}

function createSpecMetadata(overrides: Record<string, unknown> = {}) {
  return {
    featureId: 'feat-001',
    specId: 'SPEC-001',
    specHash: 'spec-hash-xyz',
    prdHash: 'prd-hash-abc',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    approvalStatus: 'approved' as const,
    approvals: [],
    version: '1.0.0',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('comparePlanDiff', () => {
  const runDir = '/tmp/test-run';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no changes when plan and spec hashes match', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'matching-hash', plan_hash: 'plan-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'matching-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'plan-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'plan-checksum' });

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(false);
    expect(result.spec_hash_changed).toBe(false);
    expect(result.changed_fields).toEqual([]);
    expect(result.previous_spec_hash).toBe('matching-hash');
    expect(result.current_spec_hash).toBe('matching-hash');
    expect(result.recommendation).toBeUndefined();
  });

  it('detects spec hash changed', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'old-hash', plan_hash: 'plan-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'new-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'plan-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'plan-checksum' });

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.spec_hash_changed).toBe(true);
    expect(result.changed_fields).toContain('spec_hash');
    expect(result.previous_spec_hash).toBe('old-hash');
    expect(result.current_spec_hash).toBe('new-hash');
  });

  it('handles missing plan metadata', async () => {
    mockedLoadPlanMetadata.mockResolvedValue(null);

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.spec_hash_changed).toBe(false);
    expect(result.changed_fields).toEqual(['plan_metadata_missing']);
    expect(result.recommendation).toBe('Plan metadata not found. Generate plan first.');
    expect(result.previous_spec_hash).toBeUndefined();
    expect(result.current_spec_hash).toBeUndefined();
  });

  it('handles missing spec metadata', async () => {
    const planMeta = createPlanMetadata();
    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(null);

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.spec_hash_changed).toBe(false);
    expect(result.changed_fields).toEqual(['spec_metadata_missing']);
    expect(result.recommendation).toBe('Spec metadata not found. Generate spec first.');
  });

  it('returns changed_fields when plan checksum mismatches', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'same-hash', plan_hash: 'expected-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'same-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'different-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'different-checksum' });

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.changed_fields).toContain('plan_checksum_mismatch');
    expect(result.recommendation).toBe(
      'Plan file modified externally. Verify integrity or regenerate plan.'
    );
  });

  it('returns plan_file_missing when plan.json cannot be read', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'same-hash' });
    const specMeta = createSpecMetadata({ specHash: 'same-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.changed_fields).toContain('plan_file_missing');
    expect(result.recommendation).toBe('Plan file missing. Regenerate plan.');
  });

  it('returns plan_file_invalid when safeJsonParse returns null', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'same-hash' });
    const specMeta = createSpecMetadata({ specHash: 'same-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue('not valid json');
    mockedSafeJsonParse.mockReturnValue(undefined);

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.changed_fields).toContain('plan_file_invalid');
  });

  it('includes recommendation text for spec hash mismatch', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'old-hash', plan_hash: 'plan-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'new-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'plan-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'plan-checksum' });

    const result = await comparePlanDiff(runDir);

    expect(result.recommendation).toBe(
      'Specification changed. Re-run plan generation with: ai-feature plan --regenerate'
    );
  });

  it('sets analyzed_at as ISO timestamp', async () => {
    const fixedDate = new Date('2025-06-15T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);

    mockedLoadPlanMetadata.mockResolvedValue(null);

    const result = await comparePlanDiff(runDir);

    expect(result.analyzed_at).toBe('2025-06-15T12:00:00.000Z');
    // Validate ISO 8601 format
    expect(new Date(result.analyzed_at).toISOString()).toBe(result.analyzed_at);

    vi.useRealTimers();
  });

  it('handles both metadata missing by returning plan_metadata_missing first', async () => {
    mockedLoadPlanMetadata.mockResolvedValue(null);
    mockedLoadSpecMetadata.mockResolvedValue(null);

    const result = await comparePlanDiff(runDir);

    // The function checks plan metadata first, so it returns early with plan_metadata_missing
    expect(result.has_changes).toBe(true);
    expect(result.changed_fields).toEqual(['plan_metadata_missing']);
    expect(result.recommendation).toBe('Plan metadata not found. Generate plan first.');
    // loadSpecMetadata should not have been called since we returned early
    expect(mockedLoadSpecMetadata).not.toHaveBeenCalled();
  });

  it('accumulates multiple changed_fields when spec hash and plan checksum both differ', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'old-hash', plan_hash: 'expected-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'new-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'wrong-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'wrong-checksum' });

    const result = await comparePlanDiff(runDir);

    expect(result.has_changes).toBe(true);
    expect(result.spec_hash_changed).toBe(true);
    expect(result.changed_fields).toContain('spec_hash');
    expect(result.changed_fields).toContain('plan_checksum_mismatch');
    expect(result.changed_fields).toHaveLength(2);
    // spec_hash_changed takes priority in recommendation
    expect(result.recommendation).toBe(
      'Specification changed. Re-run plan generation with: ai-feature plan --regenerate'
    );
  });

  it('reads plan.json from the correct path within runDir', async () => {
    const planMeta = createPlanMetadata({ spec_hash: 'same-hash', plan_hash: 'plan-checksum' });
    const specMeta = createSpecMetadata({ specHash: 'same-hash' });

    mockedLoadPlanMetadata.mockResolvedValue(planMeta as never);
    mockedLoadSpecMetadata.mockResolvedValue(specMeta as never);
    mockedReadFile.mockResolvedValue(JSON.stringify({ checksum: 'plan-checksum' }));
    mockedSafeJsonParse.mockReturnValue({ checksum: 'plan-checksum' });

    await comparePlanDiff(runDir);

    expect(mockedReadFile).toHaveBeenCalledWith(`${runDir}/plan.json`, 'utf-8');
  });

  it('passes runDir to both metadata loaders', async () => {
    mockedLoadPlanMetadata.mockResolvedValue(null);

    await comparePlanDiff(runDir);

    expect(mockedLoadPlanMetadata).toHaveBeenCalledWith(runDir);
  });
});
