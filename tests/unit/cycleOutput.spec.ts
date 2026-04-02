import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderCycleJson,
  renderCycleSummary,
  renderDashboardHeader,
  renderDashboardUpdate,
  renderDryRun,
} from '../../src/cli/cycleOutput.js';
import type { CyclePayload } from '../../src/cli/cycleTypes.js';
import type { CycleIssueResult, CycleResult } from '../../src/workflows/cycleTypes.js';

describe('cycleOutput', () => {
  const log = vi.fn<(msg: string) => void>();
  const warn = vi.fn<(msg: string) => void>();

  beforeEach(() => {
    log.mockReset();
    warn.mockReset();
  });

  it('renders dry-run output without leaking undefined skip reasons', () => {
    const payload: CyclePayload = {
      cycleId: 'cycle-1',
      cycleName: 'Sprint 12',
      cycleNumber: 12,
      totalIssues: 2,
      processable: 1,
      skipped: 1,
      orderedIssues: [
        {
          identifier: 'CM-123',
          title: 'Skipped issue',
          priority: 2,
          state: 'Todo',
          willSkip: true,
        },
        {
          identifier: 'CM-124',
          title: 'Process issue',
          priority: 4,
          state: 'In Progress',
          willSkip: false,
        },
      ],
      hasCycles: true,
      cycleInvolvedIds: ['CM-200', 'CM-201'],
    };

    renderDryRun(payload, { log, warn });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Issues: 2 total | 1 processable | 1 will skip')
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Medium'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Urgent'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('skip'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('undefined'));
    expect(warn).toHaveBeenCalledWith('⚠ Dependency cycle detected involving: CM-200, CM-201');
  });

  it('routes dashboard updates through callbacks', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write');
    const result: CycleIssueResult = {
      issueId: 'issue-1',
      identifier: 'CM-123',
      title: 'Done',
      status: 'completed',
      durationMs: 1_200,
    };

    renderDashboardUpdate(result, 0, 3, 0, { log, warn });

    expect(log).toHaveBeenCalledWith('  ✓ [1/3] CM-123       done     0m 01s');
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('renders a dashboard header aligned with update rows', () => {
    renderDashboardHeader('Sprint 12', 'cycle-1', 3, { log, warn });

    expect(log).toHaveBeenCalledWith('  Progress   Issue        Status    Duration');
    expect(log).toHaveBeenCalledWith(`  ${'─'.repeat(46)}`);
  });

  it('renders summary totals and lists failed and completed issues', () => {
    const result: CycleResult = {
      cycleId: 'cycle-1',
      cycleName: 'Sprint 12',
      startedAt: '2026-03-19T00:00:00Z',
      completedAt: '2026-03-19T00:00:03Z',
      cycleIssueCount: 5,
      totalIssues: 3,
      processed: 2,
      completed: 1,
      failed: 1,
      skipped: 1,
      durationMs: 3_000,
      issues: [
        {
          issueId: 'issue-101',
          identifier: 'CM-101',
          title: 'Completed',
          status: 'completed',
          durationMs: 1_000,
        },
        {
          issueId: 'issue-102',
          identifier: 'CM-102',
          title: 'Failed',
          status: 'failed',
          durationMs: 2_000,
          error: 'boom',
        },
        {
          issueId: 'issue-103',
          identifier: 'CM-103',
          title: 'Skipped',
          status: 'skipped',
          durationMs: 0,
        },
      ],
    };

    renderCycleSummary(result, { log, warn });

    expect(log).toHaveBeenCalledWith('  Total:     3');
    expect(log).toHaveBeenCalledWith('  Cycle size: 5');
    expect(warn).toHaveBeenCalledWith('Needs attention:');
    expect(warn).toHaveBeenCalledWith('  ✗ CM-102 - Failed');
    expect(warn).toHaveBeenCalledWith('    Error: boom');
    expect(log).toHaveBeenCalledWith('Completed:');
    expect(log).toHaveBeenCalledWith('  ✓ CM-101 - Completed (0m 01s)');
  });

  it('renders cycle results as formatted JSON', () => {
    const result: CycleResult = {
      cycleId: 'cycle-1',
      cycleName: 'Sprint 12',
      startedAt: '2026-03-19T00:00:00Z',
      completedAt: '2026-03-19T00:00:01Z',
      cycleIssueCount: 1,
      totalIssues: 1,
      processed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 1_000,
      issues: [
        {
          issueId: 'issue-101',
          identifier: 'CM-101',
          title: 'Completed',
          status: 'completed',
          durationMs: 1_000,
        },
      ],
    };

    renderCycleJson(result, { log, warn });

    expect(log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
  });
});
