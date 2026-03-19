import { describe, it, expect } from 'vitest';
import { orderCycleIssues } from '../../src/workflows/cycleIssueOrderer';
import type { LinearCycleIssue, LinearIssueRelation } from '../../src/adapters/linear/LinearAdapterTypes';

function makeIssue(
  identifier: string,
  priority: number,
  relations: LinearIssueRelation[] = []
): LinearCycleIssue {
  return {
    id: `id-${identifier}`,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
    priority,
    labels: [],
    assignee: null,
    team: { id: 'team-1', name: 'Eng', key: 'ENG' },
    project: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    url: `https://linear.app/test/issue/${identifier}`,
    relations,
  };
}

function blocksRelation(
  blockerIdentifier: string,
  blockedIdentifier: string
): LinearIssueRelation {
  return {
    type: 'blocks',
    issue: { id: `id-${blockerIdentifier}`, identifier: blockerIdentifier },
    relatedIssue: { id: `id-${blockedIdentifier}`, identifier: blockedIdentifier },
  };
}

describe('orderCycleIssues', () => {
  it('returns empty result for empty input', () => {
    const result = orderCycleIssues([]);
    expect(result.ordered).toEqual([]);
    expect(result.hasCycle).toBe(false);
    expect(result.cycleInvolvedIds).toEqual([]);
  });

  it('sorts by priority descending when no relations', () => {
    const issues = [
      makeIssue('ENG-1', 1), // Low
      makeIssue('ENG-2', 4), // Urgent
      makeIssue('ENG-3', 2), // Medium
      makeIssue('ENG-4', 0), // None
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(false);
    expect(result.ordered.map((i) => i.identifier)).toEqual([
      'ENG-2', // Urgent (4)
      'ENG-3', // Medium (2)
      'ENG-1', // Low (1)
      'ENG-4', // None (0)
    ]);
  });

  it('handles linear chain: A blocks B blocks C', () => {
    const issues = [
      makeIssue('ENG-3', 4, []), // Highest priority but depends on ENG-2
      makeIssue('ENG-1', 1, [blocksRelation('ENG-1', 'ENG-2')]),
      makeIssue('ENG-2', 2, [blocksRelation('ENG-2', 'ENG-3')]),
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(false);
    const ids = result.ordered.map((i) => i.identifier);
    expect(ids).toEqual(['ENG-1', 'ENG-2', 'ENG-3']);
  });

  it('handles diamond dependency: A blocks B and C, both block D', () => {
    // A → B → D
    // A → C → D
    const issues = [
      makeIssue('ENG-A', 1, [
        blocksRelation('ENG-A', 'ENG-B'),
        blocksRelation('ENG-A', 'ENG-C'),
      ]),
      makeIssue('ENG-B', 3, [blocksRelation('ENG-B', 'ENG-D')]),
      makeIssue('ENG-C', 2, [blocksRelation('ENG-C', 'ENG-D')]),
      makeIssue('ENG-D', 4, []),
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(false);
    const ids = result.ordered.map((i) => i.identifier);

    // A must be first, D must be last
    expect(ids[0]).toBe('ENG-A');
    expect(ids[ids.length - 1]).toBe('ENG-D');
    // B (pri 3) should come before C (pri 2) in the middle level
    expect(ids.indexOf('ENG-B')).toBeLessThan(ids.indexOf('ENG-C'));
  });

  it('detects dependency cycles and appends cycle-involved issues at end', () => {
    // A → B → A (cycle), C is independent
    const issues = [
      makeIssue('ENG-A', 3, [blocksRelation('ENG-A', 'ENG-B')]),
      makeIssue('ENG-B', 2, [blocksRelation('ENG-B', 'ENG-A')]),
      makeIssue('ENG-C', 1, []), // Independent
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleInvolvedIds).toContain('ENG-A');
    expect(result.cycleInvolvedIds).toContain('ENG-B');
    expect(result.cycleInvolvedIds).not.toContain('ENG-C');

    // C should come first (not in cycle), then cycle issues sorted by priority
    const ids = result.ordered.map((i) => i.identifier);
    expect(ids[0]).toBe('ENG-C');
    // Cycle issues: A (3) before B (2)
    expect(ids[1]).toBe('ENG-A');
    expect(ids[2]).toBe('ENG-B');
  });

  it('ignores duplicate and related relations (only uses blocks)', () => {
    const issues = [
      makeIssue('ENG-1', 2, [
        { type: 'duplicate', issue: { id: 'id-ENG-1', identifier: 'ENG-1' }, relatedIssue: { id: 'id-ENG-2', identifier: 'ENG-2' } },
        { type: 'related', issue: { id: 'id-ENG-1', identifier: 'ENG-1' }, relatedIssue: { id: 'id-ENG-3', identifier: 'ENG-3' } },
      ]),
      makeIssue('ENG-2', 4),
      makeIssue('ENG-3', 1),
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(false);
    // No blocks relations, so just sorted by priority
    expect(result.ordered.map((i) => i.identifier)).toEqual(['ENG-2', 'ENG-1', 'ENG-3']);
  });

  it('ignores blocks relations referencing issues outside the cycle', () => {
    const issues = [
      makeIssue('ENG-1', 2, [
        blocksRelation('ENG-1', 'ENG-EXTERNAL'), // Not in our issue set
      ]),
      makeIssue('ENG-2', 3),
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(false);
    expect(result.ordered.map((i) => i.identifier)).toEqual(['ENG-2', 'ENG-1']);
  });

  it('handles single issue', () => {
    const issues = [makeIssue('ENG-1', 3)];
    const result = orderCycleIssues(issues);
    expect(result.ordered).toHaveLength(1);
    expect(result.hasCycle).toBe(false);
  });

  it('handles all issues in a cycle', () => {
    // A → B → C → A (complete cycle, no roots)
    const issues = [
      makeIssue('ENG-A', 1, [blocksRelation('ENG-A', 'ENG-B')]),
      makeIssue('ENG-B', 3, [blocksRelation('ENG-B', 'ENG-C')]),
      makeIssue('ENG-C', 2, [blocksRelation('ENG-C', 'ENG-A')]),
    ];

    const result = orderCycleIssues(issues);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleInvolvedIds).toHaveLength(3);
    // Should still be sorted by priority descending
    expect(result.ordered.map((i) => i.identifier)).toEqual(['ENG-B', 'ENG-C', 'ENG-A']);
  });

  it('preserves stable ordering for same-priority issues', () => {
    const issues = [
      makeIssue('ENG-1', 2),
      makeIssue('ENG-2', 2),
      makeIssue('ENG-3', 2),
    ];

    const result = orderCycleIssues(issues);
    // All same priority — Array.sort is stable in V8, so input order preserved
    expect(result.ordered.map((i) => i.identifier)).toEqual(['ENG-1', 'ENG-2', 'ENG-3']);
  });
});
