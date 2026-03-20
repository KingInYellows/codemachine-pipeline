import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSkipIssue } from '../../../src/workflows/cycleOrchestrator';
import { orderCycleIssues } from '../../../src/workflows/cycleIssueOrderer';
import { CliError, CliErrorCode } from '../../../src/cli/utils/cliErrors';
import { getCyclePayloadCounts, type CyclePayload } from '../../../src/cli/cycleTypes';
import type { LinearCycleIssue } from '../../../src/adapters/linear/LinearAdapterTypes';

// Test skip logic and ordering integration without requiring full CLI bootstrap

function makeIssue(overrides: Partial<{
  identifier: string;
  stateType: string;
  stateName: string;
  priority: number;
  relations: LinearCycleIssue['relations'];
}> = {}): LinearCycleIssue {
  return {
    id: `id-${overrides.identifier ?? 'TEST-1'}`,
    identifier: overrides.identifier ?? 'TEST-1',
    title: `Issue ${overrides.identifier ?? 'TEST-1'}`,
    description: null,
    state: {
      id: 'state-1',
      name: overrides.stateName ?? 'Todo',
      type: overrides.stateType ?? 'unstarted',
    },
    priority: overrides.priority ?? 2,
    labels: [],
    assignee: null,
    team: { id: 'team-1', name: 'Eng', key: 'ENG' },
    project: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    url: `https://linear.app/test/issue/${overrides.identifier ?? 'TEST-1'}`,
    relations: overrides.relations ?? [],
  };
}

describe('cycle command logic', () => {
  describe('issue filtering', () => {
    it('filters out Done issues', () => {
      const issues = [
        makeIssue({ identifier: 'ENG-1', stateType: 'completed', stateName: 'Done' }),
        makeIssue({ identifier: 'ENG-2', stateType: 'unstarted', stateName: 'Todo' }),
        makeIssue({ identifier: 'ENG-3', stateType: 'canceled', stateName: 'Cancelled' }),
      ];

      const processable = issues.filter((i) => !shouldSkipIssue(i).skip);
      expect(processable).toHaveLength(1);
      expect(processable[0].identifier).toBe('ENG-2');
    });

    it('filters In Review issues with custom state names', () => {
      const issues = [
        makeIssue({ identifier: 'ENG-1', stateType: 'started', stateName: 'In Review' }),
        makeIssue({ identifier: 'ENG-2', stateType: 'started', stateName: 'Peer Review' }),
        makeIssue({ identifier: 'ENG-3', stateType: 'started', stateName: 'In Progress' }),
      ];

      const processable = issues.filter((i) => !shouldSkipIssue(i).skip);
      expect(processable).toHaveLength(1);
      expect(processable[0].identifier).toBe('ENG-3');
    });
  });

  describe('ordering and filtering integration', () => {
    it('orders then filters correctly', () => {
      const issues = [
        makeIssue({ identifier: 'ENG-1', priority: 4 }),
        makeIssue({
          identifier: 'ENG-2',
          priority: 1,
          stateType: 'completed',
          stateName: 'Done',
        }),
        makeIssue({ identifier: 'ENG-3', priority: 2 }),
      ];

      const { ordered } = orderCycleIssues(issues);
      const processable = ordered.filter((i) => !shouldSkipIssue(i).skip);

      // ENG-2 is Done, should be filtered out
      expect(processable).toHaveLength(2);
      // Highest priority first
      expect(processable[0].identifier).toBe('ENG-1');
      expect(processable[1].identifier).toBe('ENG-3');
    });
  });

  describe('dry-run output payload', () => {
    it('builds correct payload shape', () => {
      const issues = [
        makeIssue({ identifier: 'ENG-1', priority: 4 }),
        makeIssue({
          identifier: 'ENG-2',
          priority: 1,
          stateType: 'completed',
          stateName: 'Done',
        }),
      ];

      const { ordered, hasCycle, cycleInvolvedIds } = orderCycleIssues(issues);

      const payload: CyclePayload = {
        cycleId: 'test-uuid',
        cycleName: 'Sprint 14',
        cycleNumber: 14,
        orderedIssues: ordered.map((issue) => {
          const skipCheck = shouldSkipIssue(issue);
          return {
            identifier: issue.identifier,
            title: issue.title,
            priority: issue.priority,
            state: issue.state.name,
            willSkip: skipCheck.skip,
            skipReason: skipCheck.reason,
          };
        }),
        hasCycles: hasCycle,
        cycleInvolvedIds,
      };

      const counts = getCyclePayloadCounts(payload);
      expect(counts.totalIssues).toBe(2);
      expect(counts.processable).toBe(1);
      expect(counts.skipped).toBe(1);
      expect(payload.orderedIssues[0].willSkip).toBe(false);
    });
  });

  describe('error handling scenarios', () => {
    it('constructs CONFIG_INVALID error when linear is not enabled', () => {
      const error = new CliError(
        'Linear integration is not enabled.',
        CliErrorCode.CONFIG_INVALID,
        { remediation: 'Enable Linear integration in your config.' }
      );
      expect(error.code).toBe(CliErrorCode.CONFIG_INVALID);
      expect(error.exitCode).toBe(10);
      expect(error.remediation).toContain('Enable Linear');
    });

    it('constructs CONFIG_INVALID error when team_id is missing', () => {
      const error = new CliError(
        'Linear team_id is not configured.',
        CliErrorCode.CONFIG_INVALID
      );
      expect(error.code).toBe(CliErrorCode.CONFIG_INVALID);
      expect(error.exitCode).toBe(10);
    });

    it('constructs CYCLE_NOT_FOUND error when no active cycle', () => {
      const error = new CliError(
        'No active cycle found for this team.',
        CliErrorCode.CYCLE_NOT_FOUND,
        { commonFixes: ['Create a new cycle in your Linear workspace'] }
      );
      expect(error.code).toBe(CliErrorCode.CYCLE_NOT_FOUND);
      expect(error.exitCode).toBe(10);
      expect(error.commonFixes).toContain('Create a new cycle in your Linear workspace');
    });
  });
});

describe('cycle output rendering', () => {
  it('imports render functions without error', async () => {
    const {
      renderDryRun,
      renderDashboardHeader,
      renderDashboardUpdate,
      renderCycleSummary,
      renderCycleJson,
    } = await import('../../../src/cli/cycleOutput');

    expect(typeof renderDryRun).toBe('function');
    expect(typeof renderDashboardHeader).toBe('function');
    expect(typeof renderDashboardUpdate).toBe('function');
    expect(typeof renderCycleSummary).toBe('function');
    expect(typeof renderCycleJson).toBe('function');
  });

  it('renderCycleSummary produces expected output', async () => {
    const { renderCycleSummary } = await import('../../../src/cli/cycleOutput');
    const lines: string[] = [];
    const warnings: string[] = [];

    renderCycleSummary(
      {
        cycleId: 'test-id',
        cycleName: 'Sprint 14',
        startedAt: '2026-03-19T00:00:00Z',
        completedAt: '2026-03-19T00:05:00Z',
        totalIssues: 3,
        processed: 2,
        completed: 1,
        failed: 1,
        skipped: 1,
        durationMs: 300000,
        issues: [
          {
            issueId: 'id-1',
            identifier: 'ENG-1',
            title: 'Fix bug',
            status: 'completed' as const,
            runDir: '/tmp/run/ENG-1',
            durationMs: 60000,
          },
          {
            issueId: 'id-2',
            identifier: 'ENG-2',
            title: 'Add feature',
            status: 'failed' as const,
            durationMs: 120000,
            error: 'Pipeline timeout',
          },
          {
            issueId: 'id-3',
            identifier: 'ENG-3',
            title: 'Done already',
            status: 'skipped' as const,
            skipReason: 'Already done',
            durationMs: 0,
          },
        ],
      },
      {
        log: (msg) => lines.push(msg),
        warn: (msg) => warnings.push(msg),
      }
    );

    const output = lines.join('\n');
    expect(output).toContain('Sprint 14');
    expect(output).toContain('Completed: 1');
    expect(output).toContain('Failed:    1');
    expect(output).toContain('Skipped:   1');
    expect(warnings.some((w) => w.includes('ENG-2'))).toBe(true);
    expect(warnings.some((w) => w.includes('Pipeline timeout'))).toBe(true);
  });

  it('renderDryRun includes cycle name, issue table, and dependency warning', async () => {
    const { renderDryRun } = await import('../../../src/cli/cycleOutput');
    const lines: string[] = [];
    const warnings: string[] = [];

    const payload: CyclePayload = {
      cycleId: 'test-uuid',
      cycleName: 'Sprint 14',
      cycleNumber: 14,
      orderedIssues: [
        { identifier: 'ENG-1', title: 'Fix bug', priority: 4, state: 'Todo', willSkip: false },
        { identifier: 'ENG-2', title: 'Done', priority: 1, state: 'Done', willSkip: true, skipReason: 'Already done' },
      ],
      hasCycles: true,
      cycleInvolvedIds: ['ENG-3', 'ENG-4'],
    };

    renderDryRun(payload, {
      log: (msg) => lines.push(msg),
      warn: (msg) => warnings.push(msg),
    });

    const output = lines.join('\n');
    expect(output).toContain('Sprint 14');
    expect(output).toContain('ENG-1');
    expect(output).toContain('ENG-2');
    expect(output).toContain('process');
    expect(output).toContain('skip');
    expect(output).toContain('Dry run complete');
    expect(warnings.some((w) => w.includes('ENG-3'))).toBe(true);
    expect(warnings.some((w) => w.includes('Dependency cycle'))).toBe(true);
  });

  it('renderDashboardHeader includes cycle name and count', async () => {
    const { renderDashboardHeader } = await import('../../../src/cli/cycleOutput');
    const lines: string[] = [];

    renderDashboardHeader('Sprint 14', 'test-uuid', 5, {
      log: (msg) => lines.push(msg),
      warn: vi.fn(),
    });

    const output = lines.join('\n');
    expect(output).toContain('Sprint 14');
    expect(output).toContain('5 to process');
  });

  it('renderDashboardUpdate renders correct status for each type', async () => {
    const { renderDashboardUpdate } = await import('../../../src/cli/cycleOutput');
    const lines: string[] = [];
    const cb = { log: (msg: string) => lines.push(msg), warn: vi.fn() };

    renderDashboardUpdate(
      { issueId: 'id-1', identifier: 'ENG-1', title: 'Test', status: 'completed', runDir: '/tmp', durationMs: 5000 },
      0, 3, 5000, cb
    );
    renderDashboardUpdate(
      { issueId: 'id-2', identifier: 'ENG-2', title: 'Test', status: 'failed', error: 'oops', durationMs: 2000 },
      1, 3, 7000, cb
    );
    renderDashboardUpdate(
      { issueId: 'id-3', identifier: 'ENG-3', title: 'Test', status: 'skipped', skipReason: 'Done', durationMs: 0 },
      2, 3, 7000, cb
    );

    expect(lines.some((l) => l.includes('ENG-1') && l.includes('done'))).toBe(true);
    expect(lines.some((l) => l.includes('ENG-2') && l.includes('FAILED'))).toBe(true);
    expect(lines.some((l) => l.includes('ENG-3') && l.includes('skipped'))).toBe(true);
  });

  it('renderCycleJson outputs valid JSON', async () => {
    const { renderCycleJson } = await import('../../../src/cli/cycleOutput');
    const lines: string[] = [];

    const result = {
      cycleId: 'test-id',
      cycleName: 'Sprint 14',
      startedAt: '2026-03-19T00:00:00Z',
      completedAt: '2026-03-19T00:05:00Z',
      totalIssues: 1,
      processed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 300000,
      issues: [{
        issueId: 'id-1',
        identifier: 'ENG-1',
        title: 'Fix bug',
        status: 'completed' as const,
        runDir: '/tmp/run',
        durationMs: 60000,
      }],
    };

    renderCycleJson(result, { log: (msg) => lines.push(msg), warn: vi.fn() });

    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.cycleId).toBe('test-id');
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.completed).toBe(1);
  });
});
