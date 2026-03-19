import { describe, expect, it } from 'vitest';
import { CycleSnapshotSchema } from '../../src/adapters/linear/LinearAdapterTypes.js';

const baseSnapshot = {
  cycle: {
    id: 'cycle-1',
    name: 'Cycle 42',
    number: 42,
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: '2026-03-14T23:59:59.000Z',
    issues: [
      {
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'One',
        description: null,
        state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
        priority: 1,
        labels: [],
        assignee: null,
        team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
        project: null,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        url: 'https://linear.app/acme/issue/ENG-1',
        relations: [],
      },
    ],
  },
  metadata: {
    retrieved_at: '2026-03-03T00:00:00.000Z',
    teamId: 'team-1',
    issueCount: 1,
  },
};

describe('CycleSnapshotSchema', () => {
  it('accepts ISO-8601 timestamps and matching issue counts', () => {
    const result = CycleSnapshotSchema.safeParse(baseSnapshot);
    expect(result.success).toBe(true);
  });

  it('rejects non-ISO timestamps in cycle metadata', () => {
    const result = CycleSnapshotSchema.safeParse({
      ...baseSnapshot,
      cycle: {
        ...baseSnapshot.cycle,
        startsAt: '2026-03-01',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects mismatched metadata.issueCount values', () => {
    const result = CycleSnapshotSchema.safeParse({
      ...baseSnapshot,
      metadata: {
        ...baseSnapshot.metadata,
        issueCount: 2,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['metadata', 'issueCount'],
          message: 'issueCount does not match number of cycle.issues',
        }),
      ])
    );
  });
});
