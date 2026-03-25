import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Errors } from '@oclif/core';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { shouldSkipIssue } from '../../../src/workflows/cycleOrchestrator';
import { orderCycleIssues } from '../../../src/workflows/cycleIssueOrderer';
import { getCyclePayloadCounts, type CyclePayload } from '../../../src/cli/cycleTypes';
import { CliErrorCode } from '../../../src/cli/utils/cliErrors';
import type { LinearCycleIssue } from '../../../src/adapters/linear/LinearAdapterTypes';
import Cycle from '../../../src/cli/commands/cycle';

const {
  mockResolveRunDirectorySettings,
  mockRequireConfig,
  mockFetchActiveCycle,
  mockFetchCycleIssues,
} = vi.hoisted(() => ({
  mockResolveRunDirectorySettings: vi.fn(),
  mockRequireConfig: vi.fn(),
  mockFetchActiveCycle: vi.fn(),
  mockFetchCycleIssues: vi.fn(),
}));

vi.mock('../../../src/cli/utils/runDirectory', () => ({
  resolveRunDirectorySettings: mockResolveRunDirectorySettings,
  requireConfig: mockRequireConfig,
}));

vi.mock('../../../src/adapters/linear/LinearAdapter', () => ({
  LinearAdapter: class {
    fetchActiveCycle = mockFetchActiveCycle;
    fetchCycleIssues = mockFetchCycleIssues;
  },
}));

function makeIssue(
  overrides: Partial<{
    identifier: string;
    stateType: string;
    stateName: string;
    priority: number;
    relations: LinearCycleIssue['relations'];
  }> = {}
): LinearCycleIssue {
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
        makeIssue({ identifier: 'ENG-3', stateType: 'canceled', stateName: 'Canceled' }),
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

      expect(processable).toHaveLength(2);
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
});

describe('cycle command integration', () => {
  let testDir: string;
  const binPath = path.join(__dirname, '../../../bin/run.js');

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['LINEAR_API_KEY'];
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('runs a dry-run happy path with a valid cycle ID', async () => {
    process.env['LINEAR_API_KEY'] = 'lin_api_test';
    const baseDir = path.join(testDir, '.codepipe', 'runs');

    mockResolveRunDirectorySettings.mockResolvedValue({
      baseDir,
      configPath: path.join(testDir, '.codepipe', 'config.json'),
      warnings: [],
      errors: [],
    });
    mockRequireConfig.mockReturnValue({
      linear: {
        enabled: true,
        team_id: 'team-123',
        api_key_env_var: 'LINEAR_API_KEY',
      },
      project: {
        repo_url: 'https://github.com/test/repo',
        default_branch: 'main',
      },
    });
    mockFetchCycleIssues.mockResolvedValue({
      cycle: {
        id: 'cycle-123',
        name: 'Sprint 14',
        number: 14,
        issues: [makeIssue({ identifier: 'ENG-1' })],
      },
    });

    const command = new Cycle([], {} as never);
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => undefined);
    vi.spyOn(command as Cycle & { parse: Cycle['parse'] }, 'parse').mockResolvedValue({
      flags: {
        cycle: 'cycle-123',
        'dry-run': true,
        'fail-fast': false,
        'max-issues': 30,
        'plan-only': false,
        json: false,
        verbose: false,
      },
    } as never);
    vi.spyOn(
      command as Cycle & { runWithTelemetry: Cycle['runWithTelemetry'] },
      'runWithTelemetry'
    ).mockImplementation(async (_options, execute) => {
      await execute({
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        metrics: {
          increment: vi.fn(),
          gauge: vi.fn(),
        },
      } as never);
    });

    await command.run();

    expect(fs.existsSync(path.join(baseDir, '.cycle-command'))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'cycle-cycle-123'))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Sprint 14 (cycle-123)'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run complete'));
  });

  it('rejects cycle IDs with path traversal through the command error path', async () => {
    process.env['LINEAR_API_KEY'] = 'lin_api_test';
    const baseDir = path.join(testDir, '.codepipe', 'runs');

    mockResolveRunDirectorySettings.mockResolvedValue({
      baseDir,
      configPath: path.join(testDir, '.codepipe', 'config.json'),
      warnings: [],
      errors: [],
    });
    mockRequireConfig.mockReturnValue({
      linear: {
        enabled: true,
        team_id: 'team-123',
        api_key_env_var: 'LINEAR_API_KEY',
      },
      project: {
        repo_url: 'https://github.com/test/repo',
        default_branch: 'main',
      },
    });

    const errorSpy = vi.spyOn(Errors, 'error').mockImplementation(() => undefined as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const command = new Cycle([], {} as never);

    vi.spyOn(command as Cycle & { parse: Cycle['parse'] }, 'parse').mockResolvedValue({
      flags: {
        cycle: '../escape',
        'dry-run': true,
        'fail-fast': false,
        'max-issues': 30,
        'plan-only': false,
        json: false,
        verbose: false,
      },
    } as never);

    await command.run();

    expect(fs.existsSync(path.join(baseDir, '.cycle-command'))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'cycle-escape'))).toBe(false);
    expect(mockFetchCycleIssues).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Cycle ID must not contain path traversal or path separator characters.',
      expect.objectContaining({ exit: false, code: CliErrorCode.CONFIG_INVALID })
    );
    expect(exitSpy).toHaveBeenCalledWith(10);
  });

  it('shows help for the real CLI command', () => {
    const output = execSync(`node ${binPath} cycle --help`, {
      cwd: testDir,
      encoding: 'utf-8',
    });

    expect(output).toContain('Run all issues in a Linear cycle through the pipeline');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--max-issues');
  });

  it('returns CONFIG_INVALID JSON when Linear integration is disabled', () => {
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });
    execSync(`node ${binPath} init --yes`, { cwd: testDir, stdio: 'pipe' });

    const configPath = path.join(testDir, '.codepipe', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      linear: { enabled: boolean };
    };
    config.linear.enabled = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    try {
      execSync(`node ${binPath} cycle --json`, {
        cwd: testDir,
        stdio: 'pipe',
      });
      expect.unreachable('cycle command should exit with CONFIG_INVALID');
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && 'stdout' in error) {
        expect(error.status).toBe(10);
        const payload = JSON.parse(String(error.stdout)) as {
          code: string;
          exit_code: number;
          message: string;
        };
        expect(payload.code).toBe('CONFIG_INVALID');
        expect(payload.exit_code).toBe(10);
        expect(payload.message).toContain('Linear integration is not enabled');
        return;
      }

      throw error;
    }
  });
});
