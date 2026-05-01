import * as fs from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSkipIssue, CycleOrchestrator } from '../../src/workflows/cycleOrchestrator';
import type { LinearCycleIssue } from '../../src/adapters/linear/LinearAdapterTypes';
import type { CycleOrchestratorConfig, CycleIssueResult } from '../../src/workflows/cycleTypes';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/telemetry/executionTelemetry.js', () => ({
  createExecutionTelemetry: vi.fn().mockReturnValue({
    metrics: undefined,
    logs: undefined,
  }),
}));

vi.mock('../../src/persistence/runLifecycle.js', () => ({
  createRunDirectory: vi
    .fn()
    .mockImplementation(
      async (_issuesDir: string, identifier: string) => `/tmp/test-run/issues/${identifier}`
    ),
}));

const mockExecute = vi.fn();
vi.mock('../../src/workflows/pipelineOrchestrator.js', () => ({
  PipelineOrchestrator: class {
    execute = mockExecute;
  },
  PrerequisiteError: class extends Error {},
}));

vi.mock('../../src/cli/startHelpers.js', () => ({
  formatLinearContext: vi.fn().mockReturnValue('# Linear Issue Context\n...'),
}));

function makeIssue(
  overrides: Partial<{
    id: string;
    identifier: string;
    title: string;
    stateType: string;
    stateName: string;
    priority: number;
  }> = {}
): LinearCycleIssue {
  return {
    id: overrides.id ?? 'issue-1',
    identifier: overrides.identifier ?? 'CDMCH-101',
    title: overrides.title ?? 'Test Issue',
    description: 'Test description',
    state: {
      id: 'state-1',
      name: overrides.stateName ?? 'Todo',
      type: overrides.stateType ?? 'unstarted',
    },
    priority: overrides.priority ?? 2,
    labels: [],
    assignee: null,
    team: { id: 'team-1', name: 'Engineering', key: 'CDMCH' },
    project: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    url: 'https://linear.app/test/issue/CDMCH-101',
    relations: [],
  };
}

function makeConfig(overrides: Partial<CycleOrchestratorConfig> = {}): CycleOrchestratorConfig {
  return {
    repoRoot: '/tmp/repo',
    cycleBaseDir: '/tmp/test-run/cycle-abc',
    cycleId: 'abc-123',
    cycleName: 'Sprint 14',
    repoConfig: {
      project: {
        repo_url: 'https://github.com/test/repo',
        default_branch: 'main',
        context_paths: ['src/'],
      },
      runtime: {
        context_token_budget: 32000,
      },
      safety: {
        require_approval_for_prd: false,
      },
    } as CycleOrchestratorConfig['repoConfig'],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as CycleOrchestratorConfig['logger'],
    metrics: {
      increment: vi.fn(),
      gauge: vi.fn(),
    } as unknown as CycleOrchestratorConfig['metrics'],
    failFast: false,
    planOnly: false,
    maxIssues: 30,
    ...overrides,
  };
}

describe('shouldSkipIssue', () => {
  it('skips completed issues', () => {
    const issue = makeIssue({ stateType: 'completed', stateName: 'Done' });
    const result = shouldSkipIssue(issue);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('done');
  });

  it('skips canceled issues', () => {
    const issue = makeIssue({ stateType: 'canceled', stateName: 'Canceled' });
    const result = shouldSkipIssue(issue);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('Canceled');
  });

  it('skips issues in review', () => {
    const issue = makeIssue({ stateType: 'started', stateName: 'In Review' });
    const result = shouldSkipIssue(issue);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('review');
  });

  it('skips issues with "review" in state name case-insensitively', () => {
    const issue = makeIssue({ stateType: 'started', stateName: 'Code REVIEW' });
    expect(shouldSkipIssue(issue).skip).toBe(true);
  });

  it('does not skip unstarted issues', () => {
    const issue = makeIssue({ stateType: 'unstarted', stateName: 'Todo' });
    expect(shouldSkipIssue(issue).skip).toBe(false);
  });

  it('does not skip in-progress issues', () => {
    const issue = makeIssue({ stateType: 'started', stateName: 'In Progress' });
    expect(shouldSkipIssue(issue).skip).toBe(false);
  });

  it('does not skip triage issues', () => {
    const issue = makeIssue({ stateType: 'triage', stateName: 'Triage' });
    expect(shouldSkipIssue(issue).skip).toBe(false);
  });

  it('does not skip backlog issues', () => {
    const issue = makeIssue({ stateType: 'backlog', stateName: 'Backlog' });
    expect(shouldSkipIssue(issue).skip).toBe(false);
  });
});

describe('CycleOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    mockExecute.mockResolvedValue({
      context: { files: 5, totalTokens: 1000, warnings: [] },
      research: { tasksDetected: 0, pending: 0 },
      prd: { path: 'prd.md', hash: 'abc', diagnostics: { incompleteSections: [], warnings: [] } },
      approvalRequired: false,
    });
  });

  it('processes all issues sequentially', async () => {
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);
    const issues = [makeIssue({ identifier: 'CDMCH-101' }), makeIssue({ identifier: 'CDMCH-102' })];

    const result = await orchestrator.run(issues);

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.cycleIssueCount).toBe(2);
    expect(result.totalIssues).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('skips terminal-state issues', async () => {
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);
    const issues = [
      makeIssue({ identifier: 'CDMCH-101', stateType: 'completed', stateName: 'Done' }),
      makeIssue({ identifier: 'CDMCH-102', stateType: 'unstarted', stateName: 'Todo' }),
    ];

    const result = await orchestrator.run(issues);

    expect(result.skipped).toBe(1);
    expect(result.completed).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('stops on first failure when failFast is true', async () => {
    const config = makeConfig({ failFast: true });
    const orchestrator = new CycleOrchestrator(config);

    mockExecute.mockRejectedValueOnce(new Error('Pipeline failed'));

    const issues = [makeIssue({ identifier: 'CDMCH-101' }), makeIssue({ identifier: 'CDMCH-102' })];

    const result = await orchestrator.run(issues);

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.runDir).toBe('/tmp/test-run/issues/CDMCH-101');
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('continues after failure when failFast is false', async () => {
    const config = makeConfig({ failFast: false });
    const orchestrator = new CycleOrchestrator(config);

    mockExecute.mockRejectedValueOnce(new Error('Pipeline failed')).mockResolvedValueOnce({
      context: { files: 5, totalTokens: 1000, warnings: [] },
      research: { tasksDetected: 0, pending: 0 },
      prd: { path: 'prd.md', hash: 'abc', diagnostics: { incompleteSections: [], warnings: [] } },
      approvalRequired: false,
    });

    const issues = [makeIssue({ identifier: 'CDMCH-101' }), makeIssue({ identifier: 'CDMCH-102' })];

    const result = await orchestrator.run(issues);

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.issues).toHaveLength(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('calls onIssueComplete callback for each issue', async () => {
    const onIssueComplete = vi.fn();
    const config = makeConfig({ onIssueComplete });
    const orchestrator = new CycleOrchestrator(config);

    const issues = [
      makeIssue({ identifier: 'CDMCH-101', stateType: 'completed', stateName: 'Done' }),
      makeIssue({ identifier: 'CDMCH-102' }),
    ];

    await orchestrator.run(issues);

    expect(onIssueComplete).toHaveBeenCalledTimes(2);
    const firstCall = onIssueComplete.mock.calls[0][0] as CycleIssueResult;
    expect(firstCall.status).toBe('skipped');
    const secondCall = onIssueComplete.mock.calls[1][0] as CycleIssueResult;
    expect(secondCall.status).toBe('completed');
  });

  it('does not fail an issue when onIssueComplete throws', async () => {
    const onIssueComplete = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('stream closed');
      })
      .mockImplementationOnce(() => undefined);
    const config = makeConfig({ onIssueComplete });
    const orchestrator = new CycleOrchestrator(config);

    const issues = [makeIssue({ identifier: 'CDMCH-101' }), makeIssue({ identifier: 'CDMCH-102' })];

    const result = await orchestrator.run(issues);

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(config.logger.warn).toHaveBeenCalledWith(
      'Issue completion callback failed',
      expect.objectContaining({
        identifier: 'CDMCH-101',
      })
    );
  });

  it('respects maxIssues limit', async () => {
    const config = makeConfig({ maxIssues: 1 });
    const orchestrator = new CycleOrchestrator(config);

    const issues = [
      makeIssue({ identifier: 'CDMCH-101' }),
      makeIssue({ identifier: 'CDMCH-102' }),
      makeIssue({ identifier: 'CDMCH-103' }),
    ];

    const result = await orchestrator.run(issues);

    expect(result.cycleIssueCount).toBe(3);
    expect(result.totalIssues).toBe(1);
    expect(result.completed).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('reports only attempted issues after fail-fast stops the cycle', async () => {
    const config = makeConfig({ failFast: true, maxIssues: 3 });
    const orchestrator = new CycleOrchestrator(config);

    mockExecute.mockRejectedValueOnce(new Error('Pipeline failed'));

    const issues = [
      makeIssue({ identifier: 'CDMCH-101' }),
      makeIssue({ identifier: 'CDMCH-102' }),
      makeIssue({ identifier: 'CDMCH-103' }),
    ];

    const result = await orchestrator.run(issues);

    expect(result.cycleIssueCount).toBe(3);
    expect(result.totalIssues).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.completed + result.failed + result.skipped).toBe(result.totalIssues);
  });

  it('does not process a negative maxIssues subset', async () => {
    const config = makeConfig({ maxIssues: -1 });
    const orchestrator = new CycleOrchestrator(config);

    const result = await orchestrator.run([
      makeIssue({ identifier: 'CDMCH-101' }),
      makeIssue({ identifier: 'CDMCH-102' }),
    ]);

    expect(result.cycleIssueCount).toBe(2);
    expect(result.totalIssues).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('passes planOnly to PipelineOrchestrator', async () => {
    const config = makeConfig({ planOnly: true });
    const orchestrator = new CycleOrchestrator(config);

    await orchestrator.run([makeIssue()]);

    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ skipExecution: true }));
  });

  it('handles empty issue list', async () => {
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);

    const result = await orchestrator.run([]);

    expect(result.cycleIssueCount).toBe(0);
    expect(result.totalIssues).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.issues).toHaveLength(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('records error message in failed result', async () => {
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);
    mockExecute.mockRejectedValueOnce(new Error('Something broke'));

    const result = await orchestrator.run([makeIssue()]);

    expect(result.issues[0].status).toBe('failed');
    expect(result.issues[0].runDir).toBe('/tmp/test-run/issues/CDMCH-101');
    expect(result.issues[0].error).toBe('Something broke');
  });

  it('writes report.json to cycle base dir', async () => {
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);

    await orchestrator.run([makeIssue()]);

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [reportPath, reportBody, encoding] = vi.mocked(fs.writeFile).mock.calls[0] ?? [];
    expect(reportPath).toBe('/tmp/test-run/cycle-abc/report.json');
    expect(encoding).toBe('utf-8');

    const report = JSON.parse(reportBody as string) as {
      cycleId: string;
      cycleName: string;
      totalIssues: number;
      cycleIssueCount: number;
      completed: number;
    };
    expect(report.cycleId).toBe('abc-123');
    expect(report.cycleName).toBe('Sprint 14');
    expect(report.totalIssues).toBe(1);
    expect(report.cycleIssueCount).toBe(1);
    expect(report.completed).toBe(1);
  });

  it('returns results when report.json cannot be written', async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('disk full'));
    const config = makeConfig();
    const orchestrator = new CycleOrchestrator(config);

    const result = await orchestrator.run([makeIssue()]);

    expect(result.completed).toBe(1);
    expect(config.logger.warn).toHaveBeenCalledWith(
      'Failed to write cycle report.json',
      expect.objectContaining({
        reportPath: '/tmp/test-run/cycle-abc/report.json',
      })
    );
  });
});
