import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { LinearAdapter, LinearAdapterError } from '../../src/adapters/linear/LinearAdapter';
import type { LinearCycleIssue } from '../../src/adapters/linear/LinearAdapterTypes';

// Mock the HttpClient module
const mockPost = vi.fn();
vi.mock('../../src/adapters/http/client', () => ({
  HttpClient: class {
    post = mockPost;
  },
  Provider: { LINEAR: 'linear' },
  HttpError: class extends Error {},
  ErrorType: {
    TRANSIENT: 'transient',
    PERMANENT: 'permanent',
    HUMAN_ACTION_REQUIRED: 'human_action_required',
  },
}));

vi.mock('../../src/telemetry/rateLimitLedger', () => ({
  RateLimitLedger: class {
    isInCooldown = vi.fn().mockResolvedValue(false);
    requiresManualAcknowledgement = vi.fn().mockResolvedValue(false);
  },
}));

vi.mock('../../src/telemetry/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

function createAdapter(): LinearAdapter {
  return new LinearAdapter({
    apiKey: 'test-api-key',
    runDir: '/tmp/test-run',
  });
}

// mockPost is hoisted above the vi.mock call

const VALID_CYCLE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_TEAM_ID = 'f1e2d3c4-b5a6-7890-abcd-ef1234567890';

function makeCycleIssueNode(overrides: Partial<{
  id: string;
  identifier: string;
  title: string;
  stateType: string;
  stateName: string;
  priority: number;
  relations: Array<{ type: string; relatedIssue: { id: string; identifier: string } }>;
}> = {}) {
  return {
    id: overrides.id ?? 'issue-1',
    identifier: overrides.identifier ?? 'CDMCH-101',
    title: overrides.title ?? 'Test Issue',
    description: 'Test description',
    state: {
      id: 'state-1',
      name: overrides.stateName ?? 'In Progress',
      type: overrides.stateType ?? 'started',
    },
    priority: overrides.priority ?? 2,
    labels: { nodes: [{ id: 'label-1', name: 'bug', color: '#ff0000' }] },
    assignee: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    team: { id: VALID_TEAM_ID, name: 'Engineering', key: 'CDMCH' },
    project: { id: 'project-1', name: 'Test Project' },
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    url: `https://linear.app/test/issue/${overrides.identifier ?? 'CDMCH-101'}`,
    relations: { nodes: overrides.relations ?? [] },
  };
}

describe('LinearAdapter cycle methods', () => {
  let adapter: LinearAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createAdapter();
  });

  describe('fetchCycleIssues', () => {
    it('fetches cycle issues and transforms GraphQL response', async () => {
      const issueNode = makeCycleIssueNode({
        relations: [
          { type: 'blocks', relatedIssue: { id: 'issue-2', identifier: 'CDMCH-102' } },
        ],
      });

      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            cycle: {
              id: VALID_CYCLE_ID,
              name: 'Sprint 14',
              number: 14,
              startsAt: '2026-03-10T00:00:00Z',
              endsAt: '2026-03-24T00:00:00Z',
              issues: { nodes: [issueNode] },
            },
          },
        },
      });

      const result = await adapter.fetchCycleIssues(VALID_CYCLE_ID);

      expect(result.cycle.id).toBe(VALID_CYCLE_ID);
      expect(result.cycle.name).toBe('Sprint 14');
      expect(result.cycle.number).toBe(14);
      expect(result.cycle.issues).toHaveLength(1);

      const issue = result.cycle.issues[0];
      expect(issue.identifier).toBe('CDMCH-101');
      // Labels should be unwrapped from nodes
      expect(Array.isArray(issue.labels)).toBe(true);
      expect(issue.labels[0].name).toBe('bug');
      // Relations should be unwrapped and augmented with issue reference
      expect(issue.relations).toHaveLength(1);
      expect(issue.relations[0].type).toBe('blocks');
      expect(issue.relations[0].issue.identifier).toBe('CDMCH-101');
      expect(issue.relations[0].relatedIssue.identifier).toBe('CDMCH-102');

      expect(result.metadata.issueCount).toBe(1);
      expect(result.metadata.retrievedAt).toBeDefined();
    });

    it('handles cycle with multiple issues and no relations', async () => {
      const nodes = [
        makeCycleIssueNode({ id: 'issue-1', identifier: 'CDMCH-101', priority: 4 }),
        makeCycleIssueNode({ id: 'issue-2', identifier: 'CDMCH-102', priority: 1 }),
      ];

      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            cycle: {
              id: VALID_CYCLE_ID,
              name: 'Sprint 15',
              number: 15,
              startsAt: '2026-03-24T00:00:00Z',
              endsAt: '2026-04-07T00:00:00Z',
              issues: { nodes },
            },
          },
        },
      });

      const result = await adapter.fetchCycleIssues(VALID_CYCLE_ID);
      expect(result.cycle.issues).toHaveLength(2);
      expect(result.cycle.issues[0].relations).toEqual([]);
      expect(result.cycle.issues[1].relations).toEqual([]);
    });

    it('throws when cycle is not found', async () => {
      mockPost.mockResolvedValueOnce({
        data: { data: { cycle: null } },
      });

      await expect(adapter.fetchCycleIssues(VALID_CYCLE_ID)).rejects.toThrow(
        /not found/
      );
    });

    it('rejects invalid cycle ID format', async () => {
      await expect(adapter.fetchCycleIssues('not-a-uuid')).rejects.toThrow(
        LinearAdapterError
      );
      await expect(adapter.fetchCycleIssues('CDMCH-123')).rejects.toThrow(
        /Cycle IDs must be UUIDs/
      );
    });

    it('rejects empty cycle ID', async () => {
      await expect(adapter.fetchCycleIssues('')).rejects.toThrow(LinearAdapterError);
    });

    it('handles empty issues list', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            cycle: {
              id: VALID_CYCLE_ID,
              name: 'Empty Sprint',
              number: 1,
              startsAt: '2026-03-10T00:00:00Z',
              endsAt: '2026-03-24T00:00:00Z',
              issues: { nodes: [] },
            },
          },
        },
      });

      const result = await adapter.fetchCycleIssues(VALID_CYCLE_ID);
      expect(result.cycle.issues).toHaveLength(0);
      expect(result.metadata.issueCount).toBe(0);
      expect(result.metadata.teamId).toBe('');
    });
  });

  describe('fetchActiveCycle', () => {
    it('returns active cycle when one exists', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            team: {
              activeCycle: {
                id: VALID_CYCLE_ID,
                name: 'Sprint 14',
                number: 14,
              },
            },
          },
        },
      });

      const result = await adapter.fetchActiveCycle(VALID_TEAM_ID);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(VALID_CYCLE_ID);
      expect(result!.name).toBe('Sprint 14');
      expect(result!.number).toBe(14);
    });

    it('returns null when no active cycle', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            team: {
              activeCycle: null,
            },
          },
        },
      });

      const result = await adapter.fetchActiveCycle(VALID_TEAM_ID);
      expect(result).toBeNull();
    });

    it('returns null when team not found', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          data: {
            team: null,
          },
        },
      });

      const result = await adapter.fetchActiveCycle(VALID_TEAM_ID);
      expect(result).toBeNull();
    });

    it('propagates API errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Network failure'));

      await expect(adapter.fetchActiveCycle(VALID_TEAM_ID)).rejects.toThrow();
    });
  });

  describe('validateCycleId', () => {
    it('accepts valid UUID format', async () => {
      mockPost.mockResolvedValueOnce({
        data: { data: { cycle: null } },
      });

      // Should not throw on validation; the "not found" error comes after
      await expect(adapter.fetchCycleIssues(VALID_CYCLE_ID)).rejects.toThrow(
        /not found/
      );
    });

    it('rejects Linear issue identifier format', async () => {
      await expect(adapter.fetchCycleIssues('CDMCH-123')).rejects.toThrow(
        /Cycle IDs must be UUIDs/
      );
    });

    it('rejects arbitrary strings', async () => {
      await expect(adapter.fetchCycleIssues('hello world')).rejects.toThrow(
        LinearAdapterError
      );
    });
  });
});
