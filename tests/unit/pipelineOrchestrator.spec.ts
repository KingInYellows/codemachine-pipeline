import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig, type RepoConfig } from '../../src/core/config/RepoConfig';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';
import type { ExecutionTelemetry } from '../../src/telemetry/executionTelemetry';

vi.mock('../../src/workflows/contextAggregator', () => ({
  aggregateContext: vi.fn(),
}));

vi.mock('../../src/workflows/researchCoordinator', () => ({
  createResearchCoordinator: vi.fn(),
}));

vi.mock('../../src/workflows/prdAuthoringEngine', () => ({
  draftPRD: vi.fn(),
}));

vi.mock('../../src/workflows/queueStore', () => ({
  loadQueue: vi.fn(),
}));

vi.mock('../../src/workflows/executionStrategyBuilder.js', () => ({
  buildExecutionStrategies: vi.fn(),
}));

vi.mock('../../src/workflows/cliExecutionEngine', () => ({
  CLIExecutionEngine: vi.fn(),
}));

vi.mock('../../src/persistence/manifestManager.js', () => ({
  updateManifest: vi.fn(),
  setCurrentStep: vi.fn(),
  setLastStep: vi.fn(),
  markApprovalRequired: vi.fn(),
}));

import { PipelineOrchestrator, PrerequisiteError } from '../../src/workflows/pipelineOrchestrator';
import { aggregateContext } from '../../src/workflows/contextAggregator';
import { createResearchCoordinator } from '../../src/workflows/researchCoordinator';
import { draftPRD } from '../../src/workflows/prdAuthoringEngine';
import { loadQueue } from '../../src/workflows/queueStore';
import { buildExecutionStrategies } from '../../src/workflows/executionStrategyBuilder.js';
import { CLIExecutionEngine } from '../../src/workflows/cliExecutionEngine';
import {
  updateManifest,
  setCurrentStep,
  setLastStep,
  markApprovalRequired,
} from '../../src/persistence/manifestManager.js';

const mockAggregateContext = vi.mocked(aggregateContext);
const mockCreateResearchCoordinator = vi.mocked(createResearchCoordinator);
const mockDraftPRD = vi.mocked(draftPRD);
const mockLoadQueue = vi.mocked(loadQueue);
const mockBuildExecutionStrategies = vi.mocked(buildExecutionStrategies);
const MockCLIExecutionEngine = vi.mocked(CLIExecutionEngine);
const mockUpdateManifest = vi.mocked(updateManifest);
const mockSetCurrentStep = vi.mocked(setCurrentStep);
const mockSetLastStep = vi.mocked(setLastStep);
const mockMarkApprovalRequired = vi.mocked(markApprovalRequired);

const mockLogger: StructuredLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockMetrics: MetricsCollector = {
  increment: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  timing: vi.fn(),
};

const mockTelemetry = {
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
} as unknown as ExecutionTelemetry;

type ManifestUpdateSnapshot = {
  artifacts?: {
    prd?: string;
  };
  execution?: {
    completed_steps: number;
  };
  status?: string;
};

function createRepoConfig(): RepoConfig {
  const config = createDefaultConfig('https://github.com/test/repo.git');
  return {
    ...config,
    governance: {
      ...config.governance,
      approval_workflow: {
        ...config.governance?.approval_workflow,
        require_approval_for_prd: false,
      },
    },
    safety: {
      ...config.safety,
      require_approval_for_prd: false,
    },
  };
}

function createContextResult() {
  return {
    contextDocument: {
      files: {
        'src/index.ts': { path: 'src/index.ts' },
      },
      total_token_count: 42,
    },
    diagnostics: {
      warnings: [],
    },
  };
}

function createPrdResult() {
  return {
    prdPath: '/tmp/run/artifacts/prd.md',
    prdHash: 'prd-hash',
    diagnostics: {
      incompleteSections: [],
      warnings: [],
    },
  };
}

function createOrchestrator(repoConfig = createRepoConfig()): PipelineOrchestrator {
  return new PipelineOrchestrator({
    repoRoot: '/tmp/repo',
    runDir: '/tmp/run',
    featureId: 'feat-123',
    featureTitle: 'Test feature',
    featureSource: 'prompt',
    repoConfig,
    logger: mockLogger,
    metrics: mockMetrics,
    telemetry: mockTelemetry,
  });
}

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUpdateManifest.mockResolvedValue(undefined);
    mockSetCurrentStep.mockResolvedValue(undefined);
    mockSetLastStep.mockResolvedValue(undefined);
    mockMarkApprovalRequired.mockResolvedValue(undefined);
    mockAggregateContext.mockResolvedValue(createContextResult() as never);
    mockDraftPRD.mockResolvedValue(createPrdResult() as never);
    mockLoadQueue.mockResolvedValue(new Map() as never);
    mockBuildExecutionStrategies.mockResolvedValue([] as never);
    mockCreateResearchCoordinator.mockReturnValue({
      detectUnknownsFromContext: vi.fn().mockResolvedValue([]),
    } as never);
    MockCLIExecutionEngine.mockImplementation(function MockExecutionEngine() {
      return {
        validatePrerequisites: vi.fn().mockResolvedValue({
          valid: true,
          errors: [],
          warnings: [],
        }),
        execute: vi.fn().mockResolvedValue({
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          permanentlyFailedTasks: 0,
        }),
      } as never;
    } as never);
  });

  it('completes PRD stages without executing tasks when skipExecution is true', async () => {
    const orchestrator = createOrchestrator();

    const result = await orchestrator.execute({
      promptText: 'Add approval flow',
      specText: 'Spec text',
      linearContextText: 'Linear context',
      maxParallel: 2,
      skipExecution: true,
    });

    expect(result.approvalRequired).toBe(false);
    expect(result.execution).toBeUndefined();
    expect(mockSetCurrentStep).toHaveBeenCalledWith('/tmp/run', 'context_aggregation');
    expect(mockSetCurrentStep).toHaveBeenCalledWith('/tmp/run', 'research_detection');
    expect(mockSetCurrentStep).toHaveBeenCalledWith('/tmp/run', 'prd_authoring');
    expect(mockSetCurrentStep).not.toHaveBeenCalledWith('/tmp/run', 'task_execution');
    expect(mockLoadQueue).not.toHaveBeenCalled();
    expect(mockMarkApprovalRequired).not.toHaveBeenCalled();
  });

  it('records the PRD artifact path returned by the authoring engine', async () => {
    const orchestrator = createOrchestrator();
    const manifestUpdates: ManifestUpdateSnapshot[] = [];

    mockDraftPRD.mockResolvedValue({
      ...createPrdResult(),
      prdPath: '/tmp/run/output/generated-prd.md',
    } as never);
    mockUpdateManifest.mockImplementation(async (_runDir, update) => {
      manifestUpdates.push(
        update({
          artifacts: {},
          execution: {
            completed_steps: 0,
          },
          status: 'initializing',
        } as never) as ManifestUpdateSnapshot
      );
    });

    await orchestrator.execute({
      promptText: 'Capture PRD path',
      skipExecution: true,
    });

    expect(manifestUpdates).toContainEqual(
      expect.objectContaining({
        artifacts: expect.objectContaining({
          prd: 'output/generated-prd.md',
        }),
      })
    );
  });

  it('runs task execution and returns results when skipExecution is false and queue is non-empty', async () => {
    const orchestrator = createOrchestrator();
    mockLoadQueue.mockResolvedValue(new Map([['task-1', {}]]) as never);

    const execute = vi.fn().mockResolvedValue({
      totalTasks: 1,
      completedTasks: 1,
      failedTasks: 0,
      permanentlyFailedTasks: 0,
    });
    MockCLIExecutionEngine.mockImplementation(function MockExecutionEngine() {
      return {
        validatePrerequisites: vi.fn().mockResolvedValue({
          valid: true,
          errors: [],
          warnings: [],
        }),
        execute,
      } as never;
    } as never);

    const result = await orchestrator.execute({
      promptText: 'Run tasks',
      maxParallel: 1,
      skipExecution: false,
    });

    expect(result.execution).toEqual({
      totalTasks: 1,
      completedTasks: 1,
      failedTasks: 0,
      permanentlyFailedTasks: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockSetLastStep).toHaveBeenCalledWith('/tmp/run', 'task_execution');
    expect(mockSetCurrentStep).toHaveBeenCalledWith('/tmp/run', 'task_execution');
  });

  it('returns permanently failed task counts from the execution engine', async () => {
    const orchestrator = createOrchestrator();
    mockLoadQueue.mockResolvedValue(new Map([['task-1', {}]]) as never);

    const execute = vi.fn().mockResolvedValue({
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
      permanentlyFailedTasks: 1,
    });
    MockCLIExecutionEngine.mockImplementation(function MockExecutionEngine() {
      return {
        validatePrerequisites: vi.fn().mockResolvedValue({
          valid: true,
          errors: [],
          warnings: [],
        }),
        execute,
      } as never;
    } as never);

    const result = await orchestrator.execute({
      promptText: 'Run tasks',
      maxParallel: 1,
      skipExecution: false,
    });

    expect(result.execution).toEqual({
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
      permanentlyFailedTasks: 1,
    });
  });

  it('keeps task_execution as currentStep when prerequisite validation fails', async () => {
    const orchestrator = createOrchestrator();
    mockLoadQueue.mockResolvedValue(new Map([['task-1', {}]]) as never);

    const validatePrerequisites = vi.fn().mockResolvedValue({
      valid: false,
      errors: ['Codemachine CLI is not installed'],
      warnings: [],
    });
    const execute = vi.fn();

    MockCLIExecutionEngine.mockImplementation(function MockExecutionEngine() {
      return {
        validatePrerequisites,
        execute,
      } as never;
    } as never);

    await expect(
      orchestrator.execute({
        promptText: 'Run tasks',
        maxParallel: 3,
        skipExecution: false,
      })
    ).rejects.toBeInstanceOf(PrerequisiteError);

    expect(orchestrator.currentStep).toBe('task_execution');
    expect(mockSetCurrentStep).toHaveBeenCalledWith('/tmp/run', 'task_execution');
    expect(mockBuildExecutionStrategies).toHaveBeenCalledWith(
      expect.objectContaining({ max_parallel_tasks: 3 }),
      mockLogger
    );
    expect(validatePrerequisites).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
