/**
 * Unit Tests for Task Planner
 *
 * Tests the task planning workflow including:
 * - Spec requirement extraction
 * - Task node generation with stable IDs
 * - Dependency graph construction
 * - DAG validation (cycle detection, missing deps)
 * - Topological ordering
 * - Plan persistence with checksums
 * - Resume logic support
 * - CLI summary generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  generateExecutionPlan,
  loadPlanSummary,
  loadPlanMetadata,
  type TaskPlannerConfig,
} from '../../src/workflows/taskPlanner';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';
import type { PlanArtifact } from '../../src/core/models/PlanArtifact';

// ============================================================================
// Test Setup
// ============================================================================

vi.mock('node:fs/promises');
vi.mock('../../src/persistence/lockManager', () => ({
  withLock: vi.fn(async (_runDir: string, fn: () => Promise<unknown>) => await fn()),
}));
vi.mock('../../src/persistence/runLifecycle', () => ({
  getSubdirectoryPath: vi.fn((runDir: string, subdir: string) => `${runDir}/${subdir}`),
}));
vi.mock('../../src/persistence/hashManifest', () => ({
  computeFileHash: vi.fn().mockResolvedValue('spec-hash-123'),
}));

const rawLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} satisfies Record<'info' | 'warn' | 'error' | 'debug', ReturnType<typeof vi.fn>>;
const mockLogger = rawLogger as unknown as StructuredLogger;

const rawMetrics = {
  increment: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  timing: vi.fn(),
} satisfies Record<'increment' | 'gauge' | 'histogram' | 'timing', ReturnType<typeof vi.fn>>;
const mockMetrics = rawMetrics as unknown as MetricsCollector;

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

function createMockSpecJson() {
  return {
    spec_id: 'SPEC-123',
    feature_id: 'feat-123',
    test_plan: [
      {
        test_id: 'T-UNIT-001',
        description: 'Verify task planner generates stable IDs',
        test_type: 'unit',
        priority: 'high',
      },
      {
        test_id: 'T-UNIT-002',
        description: 'Verify DAG cycle detection',
        test_type: 'unit',
        priority: 'high',
      },
      {
        test_id: 'T-INT-001',
        description: 'Verify plan.json persistence',
        test_type: 'integration',
        priority: 'medium',
      },
      {
        test_id: 'T-E2E-001',
        description: 'End-to-end plan generation workflow',
        test_type: 'e2e',
        priority: 'low',
      },
    ],
  };
}

function createMockTraceJson() {
  return {
    schema_version: '1.0.0',
    feature_id: 'feat-123',
    trace_id: 'TRACE-1702823456789',
    links: [
      {
        link_id: 'LINK-PRD-SPEC-GOAL-001-T-UNIT-001',
        source_type: 'prd_goal',
        source_id: 'GOAL-001',
        target_type: 'spec_requirement',
        target_id: 'T-UNIT-001',
        relationship: 'derived_from',
      },
    ],
    created_at: '2025-12-17T10:00:00Z',
    updated_at: '2025-12-17T10:00:00Z',
  };
}

function createTraceWithExecutionTaskLinks() {
  const base = createMockTraceJson();
  return {
    ...base,
    links: [
      ...base.links,
      {
        schema_version: '1.0.0',
        link_id: 'LINK-SPEC-TASK-T-UNIT-001-LEGACY-TASK-1',
        feature_id: 'feat-123',
        source_type: 'execution_task',
        source_id: 'LEGACY-TASK-1',
        target_type: 'spec_requirement',
        target_id: 'T-UNIT-001',
        relationship: 'implements',
        created_at: '2025-12-17T10:00:00Z',
      },
    ],
  };
}

type PersistedPlanMetadata = {
  plan_hash: string;
  spec_hash: string;
  total_tasks: number;
  entry_tasks: string[];
};

// ============================================================================
// Test Suites
// ============================================================================

describe('Task Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('generateExecutionPlan', () => {
    it('should generate plan from spec requirements', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();
      const traceJson = createMockTraceJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found')); // plan.json doesn't exist
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        if (path.includes('trace.json')) {
          return Promise.resolve(JSON.stringify(traceJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.plan.tasks).toHaveLength(4);
      expect(result.plan.feature_id).toBe('feat-123');
      expect(result.statistics.totalTasks).toBe(4);
      expect(result.statistics.entryTasks).toBeGreaterThan(0);
      expect(result.statistics.blockedTasks).toBe(result.summary.blockedTasks);
      expect(result.summary.totalTasks).toBe(4);
      expect(result.summary.queueState.ready.length).toBeGreaterThan(0);
      expect(result.summary.frReferences).toEqual(['FR-12', 'FR-13', 'FR-14']);
      expect(result.summary.taskTypeBreakdown.testing).toBe(4);
      expect(result.summary.dag?.parallelPaths).toBe(result.statistics.parallelPaths);
      expect(result.plan.checksum).toBeDefined();
      expect(result.plan.checksum).toMatch(/^[a-f0-9]{64}$/);

      const startLog = rawLogger.info.mock.calls.find(
        (call) => call[0] === 'Starting execution plan generation'
      );
      expect(startLog).toBeDefined();
      const startContext = (startLog?.[1] ?? {}) as Record<string, unknown>;
      expect(startContext).toMatchObject({ featureId: 'feat-123' });

      expect(rawMetrics.increment).toHaveBeenCalledWith(
        'execution_plans_generated_total',
        expect.objectContaining({ feature_id: 'feat-123' })
      );
    });

    it('should generate stable task IDs based on iteration', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        if (path.includes('trace.json')) {
          return Promise.reject(new Error('File not found'));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.plan.tasks[0].task_id).toBe('I3-T-UNIT-001');
      expect(result.plan.tasks[1].task_id).toBe('I3-T-UNIT-002');
      expect(result.plan.tasks[2].task_id).toBe('I3-T-INT-001');
      expect(result.plan.tasks[3].task_id).toBe('I3-T-E2E-001');
    });

    it('should reuse task IDs from traceability links when available', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();
      const traceJson = createTraceWithExecutionTaskLinks();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        if (path.includes('trace.json')) {
          return Promise.resolve(JSON.stringify(traceJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.plan.tasks[0].task_id).toBe('LEGACY-TASK-1');
      expect(result.summary.entryTasks).toContain('LEGACY-TASK-1');
    });

    it('should build dependency graph with testing depending on code_generation', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = {
        test_plan: [
          {
            test_id: 'T-CODE-001',
            description: 'Implement feature X',
            test_type: 'code_generation',
          },
          {
            test_id: 'T-UNIT-001',
            description: 'Test feature X',
            test_type: 'unit',
          },
        ],
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      const codeTask = result.plan.tasks.find((t) => t.task_type === 'code_generation');
      const testTask = result.plan.tasks.find((t) => t.task_type === 'testing');

      expect(codeTask).toBeDefined();
      expect(testTask).toBeDefined();
      expect(testTask?.dependencies).toHaveLength(1);
      expect(testTask?.dependencies[0].task_id).toBe(codeTask?.task_id);
      expect(testTask?.dependencies[0].type).toBe('required');
    });

    it('should order testing tasks: unit → integration → e2e', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson(); // Has unit, integration, e2e tests

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      const unitTasks = result.plan.tasks.filter((t) => t.config?.test_type === 'unit');
      const integrationTasks = result.plan.tasks.filter(
        (t) => t.config?.test_type === 'integration'
      );
      const e2eTasks = result.plan.tasks.filter((t) => t.config?.test_type === 'e2e');

      // Integration tasks should depend on unit tasks
      for (const intTask of integrationTasks) {
        const hasDependencyOnUnit = unitTasks.some((unitTask) =>
          intTask.dependencies.some((dep) => dep.task_id === unitTask.task_id)
        );
        expect(hasDependencyOnUnit).toBe(true);
      }

      // E2E tasks should depend on integration tasks
      for (const e2eTask of e2eTasks) {
        const hasDependencyOnInt = integrationTasks.some((intTask) =>
          e2eTask.dependencies.some((dep) => dep.task_id === intTask.task_id)
        );
        expect(hasDependencyOnInt).toBe(true);
      }
    });

    it('should validate DAG and detect no cycles in valid plan', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act & Assert
      await expect(generateExecutionPlan(config, mockLogger, mockMetrics)).resolves.toBeDefined();

      expect(rawLogger.info).toHaveBeenCalledWith('DAG validation passed');
    });

    it('should throw when requirement dependencies form a cycle', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = {
        test_plan: [
          {
            test_id: 'REQ-1',
            description: 'Requirement 1',
            test_type: 'unit',
            depends_on: ['REQ-2'],
          },
          {
            test_id: 'REQ-2',
            description: 'Requirement 2',
            test_type: 'unit',
            depends_on: ['REQ-1'],
          },
        ],
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act & Assert
      await expect(generateExecutionPlan(config, mockLogger, mockMetrics)).rejects.toThrow(
        /Plan validation failed/
      );
    });

    it('should compute topological order and depth levels', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.statistics.maxDepth).toBeGreaterThan(0);
      expect(result.statistics.parallelPaths).toBeGreaterThan(0);

      const orderLog = rawLogger.debug.mock.calls.find(
        (call) => call[0] === 'Computed execution order'
      );
      expect(orderLog).toBeDefined();
      const orderContext = (orderLog?.[1] ?? {}) as Record<string, unknown>;
      expect(typeof orderContext.maxDepth).toBe('number');
      expect(typeof orderContext.parallelPaths).toBe('number');
    });

    it('should persist plan.json and plan_metadata.json with checksums', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const specJson = createMockSpecJson();

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(specJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(fs.writeFile).toHaveBeenCalledTimes(2); // plan.json + plan_metadata.json

      const writeCalls = vi.mocked(fs.writeFile).mock.calls;

      // Check plan.json write
      const planJsonCall = writeCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('plan.json')
      );
      expect(planJsonCall).toBeDefined();
      if (!planJsonCall) {
        throw new Error('planJsonCall is undefined');
      }
      const parsedPlan: unknown = JSON.parse(planJsonCall[1] as string);
      const planContent = parsedPlan as PlanArtifact;
      expect(planContent.checksum).toBeDefined();
      expect(planContent.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(planContent.dag_metadata.parallel_paths).toBeGreaterThanOrEqual(0);
      expect(planContent.metadata?.critical_path_depth).toBeGreaterThanOrEqual(0);

      // Check plan_metadata.json write
      const metadataCall = writeCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('plan_metadata.json')
      );
      expect(metadataCall).toBeDefined();
      if (!metadataCall) {
        throw new Error('metadataCall is undefined');
      }
      const parsedMetadata: unknown = JSON.parse(metadataCall[1] as string);
      const metadataContent = parsedMetadata as PersistedPlanMetadata;
      expect(metadataContent.plan_hash).toBeDefined();
      expect(metadataContent.spec_hash).toBe(specMetadata.specHash);
      expect(Array.isArray(metadataContent.entry_tasks)).toBe(true);
    });

    it('should throw error when spec is not approved', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const unapprovedSpecMetadata = {
        ...createMockSpecMetadata(),
        approvalStatus: 'pending' as const,
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(unapprovedSpecMetadata));
        }
        return Promise.reject(new Error('File not found'));
      });

      // Act & Assert
      await expect(generateExecutionPlan(config, mockLogger, mockMetrics)).rejects.toThrow(
        'Spec must be approved before generating execution plan'
      );
    });

    it('should throw error when spec metadata is missing', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      // Act & Assert
      await expect(generateExecutionPlan(config, mockLogger, mockMetrics)).rejects.toThrow(
        'Spec metadata not found'
      );
    });

    it('should load existing plan when force=false and plan exists', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const existingPlan = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
        tasks: [
          {
            task_id: 'I3.T01',
            title: 'Existing task',
            task_type: 'code_generation',
            dependencies: [],
          },
        ],
        dag_metadata: {
          total_tasks: 1,
          generated_at: '2025-12-17T10:00:00Z',
        },
        checksum: 'abc123',
      };

      vi.mocked(fs.access).mockResolvedValue(); // plan.json exists
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingPlan));

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.plan.tasks).toHaveLength(1);
      expect(result.summary.totalTasks).toBe(1);
      expect(result.statistics.blockedTasks).toBe(result.summary.blockedTasks);
      expect(result.diagnostics.warnings).toContain(
        'plan.json already exists; use --force to regenerate'
      );
      const reuseLog = rawLogger.info.mock.calls.find(
        (call) => call[0] === 'plan.json already exists, loading existing plan'
      );
      expect(reuseLog).toBeDefined();
      const reuseContext = (reuseLog?.[1] ?? {}) as Record<string, unknown>;
      const planPath = typeof reuseContext.planPath === 'string' ? reuseContext.planPath : '';
      expect(planPath).toContain('plan.json');
    });

    it('should handle empty test plan gracefully', async () => {
      // Arrange
      const config: TaskPlannerConfig = {
        runDir: '/test/run/dir',
        featureId: 'feat-123',
        iterationId: 'I3',
        force: false,
      };

      const specMetadata = createMockSpecMetadata();
      const emptySpecJson = {
        test_plan: [],
      };

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.readFile).mockImplementation((filePath: string | Buffer) => {
        const path = filePath.toString();
        if (path.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(specMetadata));
        }
        if (path.includes('spec.json')) {
          return Promise.resolve(JSON.stringify(emptySpecJson));
        }
        return Promise.reject(new Error('File not found'));
      });

      vi.mocked(fs.writeFile).mockResolvedValue();

      // Act
      const result = await generateExecutionPlan(config, mockLogger, mockMetrics);

      // Assert
      expect(result.plan.tasks).toHaveLength(0);
      expect(result.statistics.totalTasks).toBe(0);
      expect(result.diagnostics.warnings).toContain('No requirements found in spec.json test_plan');
      expect(rawLogger.warn).toHaveBeenCalledWith('No requirements found in spec.json test_plan');
    });
  });

  describe('loadPlanSummary', () => {
    it('should load plan summary from plan.json', async () => {
      // Arrange
      const runDir = '/test/run/dir';
      const planJson = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
        tasks: [
          {
            task_id: 'I3.T01',
            title: 'Task 1',
            task_type: 'code_generation',
            dependencies: [],
          },
          {
            task_id: 'I3.T02',
            title: 'Task 2',
            task_type: 'testing',
            dependencies: [{ task_id: 'I3.T01', type: 'required' }],
          },
        ],
        dag_metadata: {
          total_tasks: 2,
          generated_at: '2025-12-17T10:00:00Z',
        },
        checksum: 'abc123',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(planJson));

      // Act
      const summary = await loadPlanSummary(runDir);

      // Assert
      expect(summary).toBeDefined();
      expect(summary?.totalTasks).toBe(2);
      expect(summary?.entryTasks).toEqual(['I3.T01']);
      expect(summary?.blockedTasks).toBe(1);
      expect(summary?.queueState.ready).toEqual(['I3.T01']);
      expect(summary?.queueState.blocked).toHaveLength(1);
      expect(summary?.queueState.blockers[0]?.reason).toContain('dependency');
      expect(summary?.taskTypeBreakdown.testing).toBe(1);
      expect(summary?.checksum).toBe('abc123');
      expect(summary?.lastUpdated).toBe('2025-12-17T10:00:00Z');
      expect(summary?.frReferences).toEqual(['FR-12', 'FR-13', 'FR-14']);
    });

    it('should return null when plan.json does not exist', async () => {
      // Arrange
      const runDir = '/test/run/dir';
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      // Act
      const summary = await loadPlanSummary(runDir);

      // Assert
      expect(summary).toBeNull();
    });
  });

  describe('loadPlanMetadata', () => {
    it('should load plan metadata from plan_metadata.json', async () => {
      // Arrange
      const runDir = '/test/run/dir';
      const metadata = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        plan_hash: 'plan-hash-abc',
        spec_hash: 'spec-hash-def',
        iteration_id: 'I3',
        created_at: '2025-12-17T10:00:00Z',
        updated_at: '2025-12-17T10:00:00Z',
        total_tasks: 4,
        entry_tasks: ['I3.T01', 'I3.T02'],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      // Act
      const result = await loadPlanMetadata(runDir);

      // Assert
      expect(result).toEqual(metadata);
    });

    it('should return null when plan_metadata.json does not exist', async () => {
      // Arrange
      const runDir = '/test/run/dir';
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      // Act
      const result = await loadPlanMetadata(runDir);

      // Assert
      expect(result).toBeNull();
    });
  });
});
