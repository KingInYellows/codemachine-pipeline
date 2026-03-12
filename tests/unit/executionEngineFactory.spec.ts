import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../src/core/config/RepoConfig';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { ExecutionTelemetry } from '../../src/telemetry/executionTelemetry';

vi.mock('../../src/workflows/executionStrategyBuilder.js', () => ({
  buildExecutionStrategies: vi.fn(),
}));

vi.mock('../../src/workflows/cliExecutionEngine', () => ({
  CLIExecutionEngine: vi.fn(),
}));

import {
  buildAndValidateExecutionEngine,
  type BuildExecutionEngineParams,
} from '../../src/workflows/executionEngineFactory';
import { buildExecutionStrategies } from '../../src/workflows/executionStrategyBuilder.js';
import { CLIExecutionEngine } from '../../src/workflows/cliExecutionEngine';

const mockBuildExecutionStrategies = vi.mocked(buildExecutionStrategies);
const MockCLIExecutionEngine = vi.mocked(CLIExecutionEngine);

const mockLogger: StructuredLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockTelemetry = {} as ExecutionTelemetry;

function mockEngineWith(validatePrereqs: ReturnType<typeof vi.fn>): void {
  MockCLIExecutionEngine.mockImplementation(function MockEngine() {
    return { validatePrerequisites: validatePrereqs } as unknown as CLIExecutionEngine;
  } as unknown as typeof CLIExecutionEngine);
}

describe('buildAndValidateExecutionEngine', () => {
  let baseParams: BuildExecutionEngineParams;

  beforeEach(() => {
    vi.clearAllMocks();

    const repoConfig = createDefaultConfig('https://github.com/test/repo');

    baseParams = {
      runDir: '/tmp/test-run',
      repoConfig,
      maxParallel: 4,
      logger: mockLogger,
      telemetry: mockTelemetry,
    };

    mockBuildExecutionStrategies.mockResolvedValue([]);
    mockEngineWith(vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }));
  });

  it('returns engine and prereqResult', async () => {
    const result = await buildAndValidateExecutionEngine(baseParams);

    expect(result).toHaveProperty('engine');
    expect(result).toHaveProperty('prereqResult');
    expect(result.prereqResult).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('does not expose mergedConfig in the result', async () => {
    const result = await buildAndValidateExecutionEngine(baseParams);

    expect(result).not.toHaveProperty('mergedConfig');
  });

  it('merges maxParallel into execution config', async () => {
    await buildAndValidateExecutionEngine(baseParams);

    expect(mockBuildExecutionStrategies).toHaveBeenCalledWith(
      expect.objectContaining({ max_parallel_tasks: 4 }),
      mockLogger
    );
  });

  it('uses DEFAULT_EXECUTION_CONFIG when repoConfig.execution is undefined', async () => {
    baseParams.repoConfig = {
      ...baseParams.repoConfig,
      execution: undefined,
    };

    await buildAndValidateExecutionEngine(baseParams);

    expect(mockBuildExecutionStrategies).toHaveBeenCalledWith(
      expect.objectContaining({ max_parallel_tasks: 4 }),
      mockLogger
    );
  });

  it('uses repoConfig execution max_parallel_tasks when maxParallel is omitted', async () => {
    baseParams.repoConfig = {
      ...baseParams.repoConfig,
      execution: {
        ...baseParams.repoConfig.execution,
        max_parallel_tasks: 7,
      },
    };
    baseParams.maxParallel = undefined;

    await buildAndValidateExecutionEngine(baseParams);

    expect(mockBuildExecutionStrategies).toHaveBeenCalledWith(
      expect.objectContaining({ max_parallel_tasks: 7 }),
      mockLogger
    );
  });

  it('passes dryRun to CLIExecutionEngine', async () => {
    await buildAndValidateExecutionEngine({ ...baseParams, dryRun: true });

    expect(MockCLIExecutionEngine).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('defaults dryRun to false', async () => {
    await buildAndValidateExecutionEngine(baseParams);

    expect(MockCLIExecutionEngine).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('calls validatePrerequisites on the constructed engine', async () => {
    const result = await buildAndValidateExecutionEngine(baseParams);

    expect(MockCLIExecutionEngine).toHaveBeenCalledTimes(1);
    expect(vi.mocked(result.engine.validatePrerequisites)).toHaveBeenCalledTimes(1);
  });

  it('propagates validatePrerequisites rejection', async () => {
    mockEngineWith(vi.fn().mockRejectedValue(new Error('binary not found')));

    await expect(buildAndValidateExecutionEngine(baseParams)).rejects.toThrow('binary not found');
  });

  it('propagates invalid prereqResult without transformation', async () => {
    const failedPrereq = {
      valid: false,
      errors: ['codemachine not found'],
      warnings: ['outdated version'],
    };
    mockEngineWith(vi.fn().mockResolvedValue(failedPrereq));

    const result = await buildAndValidateExecutionEngine(baseParams);

    expect(result.prereqResult).toEqual(failedPrereq);
  });

  it('propagates buildExecutionStrategies errors', async () => {
    const strategyError = new Error('invalid strategy config');
    mockBuildExecutionStrategies.mockRejectedValue(strategyError);

    await expect(buildAndValidateExecutionEngine(baseParams)).rejects.toThrow(
      'invalid strategy config'
    );
  });
});
