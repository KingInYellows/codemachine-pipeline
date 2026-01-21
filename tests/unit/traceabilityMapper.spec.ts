/**
 * Unit Tests for Traceability Mapper
 *
 * Tests the traceability mapping workflow including:
 * - PRD goal extraction and linking
 * - Spec requirement extraction and linking
 * - Execution task extraction and linking
 * - Duplicate prevention and validation
 * - Trace document persistence
 * - Summary generation for CLI
 * - Update workflows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  generateTraceMap,
  loadTraceSummary,
  updateTraceMapOnSpecChange,
  type TraceMapperConfig,
} from '../../src/workflows/traceabilityMapper';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';

// ============================================================================
// Test Setup
// ============================================================================

vi.mock('node:fs/promises');
vi.mock('../../src/persistence/runDirectoryManager', () => ({
  withLock: vi.fn(async (_runDir: string, fn: () => Promise<unknown>) => await fn()),
  getSubdirectoryPath: vi.fn((runDir: string, subdir: string) => `${runDir}/${subdir}`),
}));
vi.mock('../../src/persistence/hashManifest', () => ({
  computeFileHash: vi.fn().mockResolvedValue('plan-hash-123'),
}));

const mockLogger: StructuredLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockMetrics: MetricsCollector = {
  increment: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  timing: vi.fn(),
};

function createMockPRDMetadata() {
  return {
    featureId: 'feat-123',
    prdHash: 'prd-hash-abcd1234',
    createdAt: '2025-12-17T10:00:00Z',
    updatedAt: '2025-12-17T10:00:00Z',
    approvalStatus: 'approved' as const,
    approvals: ['APR-001'],
    version: '1.0.0',
    traceId: 'TRACE-1702823456789',
  };
}

function createMockSpecMetadata() {
  return {
    featureId: 'feat-123',
    specId: 'SPEC-123',
    specHash: 'spec-hash-ef567890',
    prdHash: 'prd-hash-abcd1234',
    createdAt: '2025-12-17T10:00:00Z',
    updatedAt: '2025-12-17T10:00:00Z',
    approvalStatus: 'approved' as const,
    approvals: ['APR-002'],
    version: '1.0.0',
    traceId: 'TRACE-1702823456789',
  };
}

function createMockPRDMarkdown() {
  return `# Product Requirements Document

## Problem Statement

Users need authentication.

## Goals

- Goal 1: Implement OAuth authentication
- Goal 2: Support multi-factor authentication
- Goal 3: Enable session management

## Non-Goals

- Not supporting LDAP

## Success Criteria & Acceptance Criteria

- Users can log in
- Sessions expire after 24 hours
`;
}

function createMockSpecJson() {
  return {
    spec_id: 'SPEC-123',
    feature_id: 'feat-123',
    title: 'Authentication Feature',
    content: 'Spec content...',
    status: 'approved',
    created_at: '2025-12-17T10:00:00Z',
    updated_at: '2025-12-17T10:00:00Z',
    test_plan: [
      {
        test_id: 'T-UNIT-001',
        description: 'Verify OAuth token validation',
        test_type: 'unit',
        acceptance_criteria: ['Token must be valid'],
      },
      {
        test_id: 'T-INT-001',
        description: 'Verify login flow integration',
        test_type: 'integration',
        acceptance_criteria: ['User can log in'],
      },
    ],
    risks: [],
    change_log: [],
  };
}

function createMockPlanJson() {
  return {
    tasks: [
      {
        task_id: 'EXEC-TASK-001',
        description: 'Implement OAuth handler',
      },
      {
        task_id: 'EXEC-TASK-002',
        description: 'Implement session manager',
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('traceabilityMapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('generateTraceMap', () => {
    it('should generate trace map with PRD→Spec and Spec→Task links', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
        force: false,
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = createMockSpecMetadata();
      const prdMarkdown = createMockPRDMarkdown();
      const specJson = createMockSpecJson();
      const planJson = createMockPlanJson();

      // Mock file reads
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        if (filePath.includes('prd.md')) {
          return prdMarkdown;
        }
        if (filePath.includes('spec.json')) {
          return JSON.stringify(specJson);
        }
        if (filePath.includes('plan.json')) {
          return JSON.stringify(planJson);
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      // Mock trace.json doesn't exist (first time generation)
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      // Mock writeFile
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Act
      const result = await generateTraceMap(config, mockLogger, mockMetrics);

      // Assert
      expect(result.tracePath).toBe('/run/feat-123/trace.json');
      expect(result.links.length).toBeGreaterThan(0);

      // Should have PRD→Spec links (3 goals × 2 requirements = 6 links)
      expect(result.statistics.prdToSpecLinks).toBe(6);

      // Should have Spec→Task links (2 requirements × 2 tasks = 4 links)
      expect(result.statistics.specToTaskLinks).toBe(4);

      // Total links
      expect(result.statistics.totalLinks).toBe(10);

      // Verify links structure
      const prdToSpecLink = result.links.find(
        l => l.source_type === 'prd_goal' && l.target_type === 'spec_requirement'
      );
      expect(prdToSpecLink).toBeDefined();
      expect(prdToSpecLink?.relationship).toBe('derived_from');
      expect(prdToSpecLink?.metadata).toHaveProperty('trace_id');

      const specToTaskLink = result.links.find(
        l => l.source_type === 'execution_task' && l.target_type === 'spec_requirement'
      );
      expect(specToTaskLink).toBeDefined();
      expect(specToTaskLink?.relationship).toBe('implements');

      // Verify trace.json was written
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/run/feat-123/trace.json',
        expect.stringContaining('"schema_version": "1.0.0"'),
        'utf-8'
      );

      // Verify metrics
      expect(mockMetrics.increment).toHaveBeenCalledWith('trace_maps_generated_total', {
        feature_id: 'feat-123',
      });

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting traceability map generation',
        expect.objectContaining({ featureId: 'feat-123' })
      );
    });

    it('should skip generation if trace.json exists and force=false', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
        force: false,
      };

      const existingTraceDoc = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        trace_id: 'TRACE-1702823456789',
        links: [
          {
            schema_version: '1.0.0',
            link_id: 'LINK-PRD-SPEC-GOAL-001-T-UNIT-001',
            feature_id: 'feat-123',
            source_type: 'prd_goal',
            source_id: 'GOAL-001',
            target_type: 'spec_requirement',
            target_id: 'T-UNIT-001',
            relationship: 'derived_from',
            created_at: '2025-12-17T10:00:00Z',
          },
        ],
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
        metadata: {
          prd_hash: 'prd-hash',
          spec_hash: 'spec-hash',
          generator: 'traceability-mapper:v1.0.0',
        },
      };

      // Mock trace.json exists
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingTraceDoc));

      // Act
      const result = await generateTraceMap(config, mockLogger, mockMetrics);

      // Assert
      expect(result.tracePath).toBe('/run/feat-123/trace.json');
      expect(result.links.length).toBe(1);
      expect(result.diagnostics.warnings).toContain(
        'trace.json already exists; use --force to regenerate'
      );

      // Verify no new writes
      expect(fs.writeFile).not.toHaveBeenCalled();

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'trace.json already exists, skipping generation',
        expect.any(Object)
      );
    });

    it('should throw error if PRD not approved', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
      };

      const prdMetadata = {
        ...createMockPRDMetadata(),
        approvalStatus: 'pending' as const,
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      // Act & Assert
      await expect(generateTraceMap(config, mockLogger, mockMetrics)).rejects.toThrow(
        'PRD must be approved before generating trace map'
      );
    });

    it('should throw error if Spec not approved', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = {
        ...createMockSpecMetadata(),
        approvalStatus: 'pending' as const,
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      // Act & Assert
      await expect(generateTraceMap(config, mockLogger, mockMetrics)).rejects.toThrow(
        'Spec must be approved before generating trace map'
      );
    });

    it('should handle plan.json not existing (no Spec→Task links)', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
        force: false,
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = createMockSpecMetadata();
      const prdMarkdown = createMockPRDMarkdown();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        if (filePath.includes('prd.md')) {
          return prdMarkdown;
        }
        if (filePath.includes('spec.json')) {
          return JSON.stringify(specJson);
        }
        if (filePath.includes('plan.json')) {
          throw new Error('ENOENT');
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Act
      const result = await generateTraceMap(config, mockLogger, mockMetrics);

      // Assert
      expect(result.statistics.specToTaskLinks).toBe(0);
      expect(result.statistics.prdToSpecLinks).toBe(6); // Still have PRD→Spec links

      // Should have gap for execution tasks
      expect(result.diagnostics.gaps).toContainEqual({
        source: 'Plan',
        target: 'ExecutionTasks',
        reason: 'No execution tasks found in plan.json (may be generated later)',
      });
    });

    it('should prevent duplicate links when spec requirements repeat IDs', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
        force: false,
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = createMockSpecMetadata();

      const prdMarkdown = `
## Goals

- Implement OAuth
`;

      const specJson = {
        ...createMockSpecJson(),
        test_plan: [
          {
            test_id: 'T-UNIT-001',
            description: 'Test 1',
            test_type: 'unit',
            acceptance_criteria: [],
          },
          {
            test_id: 'T-UNIT-001',
            description: 'Duplicate ID test',
            test_type: 'unit',
            acceptance_criteria: [],
          },
        ],
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        if (filePath.includes('prd.md')) {
          return prdMarkdown;
        }
        if (filePath.includes('spec.json')) {
          return JSON.stringify(specJson);
        }
        if (filePath.includes('plan.json')) {
          throw new Error('ENOENT');
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Act
      const result = await generateTraceMap(config, mockLogger, mockMetrics);

      // Assert
      expect(result.statistics.totalLinks).toBe(1);
      expect(result.statistics.prdToSpecLinks).toBe(1);
      expect(result.statistics.duplicatesPrevented).toBe(1);
    });

    it('should detect gaps when PRD has no goals', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = createMockSpecMetadata();

      const prdMarkdown = `
# PRD

## Problem Statement

Some problem

## Goals

_TODO: Define goals_
`;

      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        if (filePath.includes('prd.md')) {
          return prdMarkdown;
        }
        if (filePath.includes('spec.json')) {
          return JSON.stringify(specJson);
        }
        if (filePath.includes('plan.json')) {
          throw new Error('ENOENT');
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Act
      const result = await generateTraceMap(config, mockLogger, mockMetrics);

      // Assert
      expect(result.diagnostics.gaps).toContainEqual({
        source: 'PRD',
        target: 'Goals',
        reason: 'No goals extracted from PRD',
      });
    });
  });

  describe('loadTraceSummary', () => {
    it('should load trace summary from trace.json', async () => {
      // Arrange
      const runDir = '/run/feat-123';

      const traceDoc = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        trace_id: 'TRACE-123',
        links: [
          {
            schema_version: '1.0.0',
            link_id: 'LINK-1',
            feature_id: 'feat-123',
            source_type: 'prd_goal',
            source_id: 'GOAL-001',
            target_type: 'spec_requirement',
            target_id: 'T-UNIT-001',
            relationship: 'derived_from',
            created_at: '2025-12-17T10:00:00Z',
          },
          {
            schema_version: '1.0.0',
            link_id: 'LINK-2',
            feature_id: 'feat-123',
            source_type: 'execution_task',
            source_id: 'EXEC-001',
            target_type: 'spec_requirement',
            target_id: 'T-UNIT-001',
            relationship: 'implements',
            created_at: '2025-12-17T10:00:00Z',
          },
        ],
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T11:00:00Z',
        metadata: {
          prd_hash: 'prd-hash',
          spec_hash: 'spec-hash',
          generator: 'traceability-mapper:v1.0.0',
        },
        diagnostics: {
          warnings: [],
          gaps: [],
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(traceDoc));

      // Act
      const summary = await loadTraceSummary(runDir);

      // Assert
      expect(summary).toBeDefined();
      expect(summary?.tracePath).toBe('/run/feat-123/trace.json');
      expect(summary?.totalLinks).toBe(2);
      expect(summary?.prdGoalsMapped).toBe(1);
      expect(summary?.specRequirementsMapped).toBe(1);
      expect(summary?.executionTasksMapped).toBe(1);
      expect(summary?.lastUpdated).toBe('2025-12-17T11:00:00Z');
      expect(summary?.outstandingGaps).toBe(0);
    });

    it('should return null if trace.json does not exist', async () => {
      // Arrange
      const runDir = '/run/feat-123';

      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      // Act
      const summary = await loadTraceSummary(runDir);

      // Assert
      expect(summary).toBeNull();
    });

    it('should detect outstanding gaps when no execution tasks', async () => {
      // Arrange
      const runDir = '/run/feat-123';

      const traceDoc = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        trace_id: 'TRACE-123',
        links: [
          {
            schema_version: '1.0.0',
            link_id: 'LINK-1',
            feature_id: 'feat-123',
            source_type: 'prd_goal',
            source_id: 'GOAL-001',
            target_type: 'spec_requirement',
            target_id: 'T-UNIT-001',
            relationship: 'derived_from',
            created_at: '2025-12-17T10:00:00Z',
          },
        ],
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T11:00:00Z',
        metadata: {
          prd_hash: 'prd-hash',
          spec_hash: 'spec-hash',
          generator: 'traceability-mapper:v1.0.0',
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(traceDoc));

      // Act
      const summary = await loadTraceSummary(runDir);

      // Assert
      expect(summary?.outstandingGaps).toBe(1);
    });

    it('should surface documented gaps even when execution tasks exist', async () => {
      // Arrange
      const runDir = '/run/feat-123';

      const traceDoc = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        trace_id: 'TRACE-789',
        links: [
          {
            schema_version: '1.0.0',
            link_id: 'LINK-3',
            feature_id: 'feat-123',
            source_type: 'execution_task',
            source_id: 'EXEC-001',
            target_type: 'spec_requirement',
            target_id: 'T-UNIT-002',
            relationship: 'implements',
            created_at: '2025-12-17T10:00:00Z',
          },
        ],
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T11:05:00Z',
        metadata: {
          prd_hash: 'prd-hash',
          spec_hash: 'spec-hash',
          generator: 'traceability-mapper:v1.0.0',
        },
        diagnostics: {
          warnings: [],
          gaps: [
            { source: 'PRD', target: 'Goals', reason: 'No goals extracted from PRD' },
            { source: 'Spec', target: 'Requirements', reason: 'No requirements extracted from spec' },
          ],
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(traceDoc));

      // Act
      const summary = await loadTraceSummary(runDir);

      // Assert
      expect(summary?.executionTasksMapped).toBe(1);
      expect(summary?.outstandingGaps).toBe(2);
    });
  });

  describe('updateTraceMapOnSpecChange', () => {
    it('should regenerate trace map with force=true', async () => {
      // Arrange
      const config: TraceMapperConfig = {
        runDir: '/run/feat-123',
        featureId: 'feat-123',
      };

      const prdMetadata = createMockPRDMetadata();
      const specMetadata = createMockSpecMetadata();
      const prdMarkdown = createMockPRDMarkdown();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockImplementation(async (filePath: string) => {
        await Promise.resolve();
        if (filePath.includes('prd_metadata.json')) {
          return JSON.stringify(prdMetadata);
        }
        if (filePath.includes('spec_metadata.json')) {
          return JSON.stringify(specMetadata);
        }
        if (filePath.includes('prd.md')) {
          return prdMarkdown;
        }
        if (filePath.includes('spec.json')) {
          return JSON.stringify(specJson);
        }
        if (filePath.includes('plan.json')) {
          throw new Error('ENOENT');
        }
        throw new Error(`Unexpected file read: ${filePath}`);
      });

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Act
      const result = await updateTraceMapOnSpecChange(config, mockLogger, mockMetrics);

      // Assert
      expect(result.tracePath).toBe('/run/feat-123/trace.json');
      expect(result.links.length).toBeGreaterThan(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Updating trace map due to spec change',
        expect.objectContaining({ featureId: 'feat-123' })
      );
    });
  });
});
