import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createRunDirectory,
  setLastStep,
  setCurrentStep,
  updateManifest,
  markApprovalRequired,
} from '../../src/persistence/runDirectoryManager';
import { initializeQueue, appendToQueue } from '../../src/workflows/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { generateExecutionPlan } from '../../src/workflows/taskPlanner';
import { createCliLogger, LogLevel } from '../../src/telemetry/logger';
import { createRunMetricsCollector } from '../../src/telemetry/metrics';
import { createResearchTask } from '../../src/core/models/ResearchTask';
import type { RateLimitLedgerData } from '../../src/telemetry/rateLimitLedger';
import type { BranchProtectionReport } from '../../src/workflows/branchProtectionReporter';

const CLI_BIN_PATH = path.resolve(__dirname, '../../bin/run.js');
const ROOT_CONFIG_PATH = path.resolve(__dirname, '../../.ai-feature-pipeline/config.json');

interface PlanCommandPayload {
  feature_id: string | null;
  plan_summary?: {
    total_tasks: number;
    entry_tasks: string[];
    blocked_tasks: number;
    dag_metadata?: {
      parallel_paths?: number;
      critical_path_depth?: number;
    };
  };
  plan_diff?: {
    has_changes: boolean;
    changed_fields: string[];
    spec_hash_changed: boolean;
  };
  notes: string[];
}

interface StatusCommandPayload {
  plan?: {
    plan_exists: boolean;
    total_tasks?: number;
    entry_tasks?: number;
    blocked_tasks?: number;
    dag_metadata?: {
      parallel_paths?: number;
      critical_path_depth?: number;
    };
  };
  validation?: {
    has_validation_data: boolean;
    queue_valid?: boolean;
    plan_valid?: boolean;
  };
  integrations?: {
    github?: {
      enabled: boolean;
      rate_limit?: {
        remaining: number;
        reset_at: string;
        in_cooldown: boolean;
      };
      pr_status?: {
        number: number;
        state: string;
        mergeable: boolean | null;
        url: string;
      };
      warnings: string[];
    };
    linear?: {
      enabled: boolean;
      rate_limit?: {
        remaining: number;
        reset_at: string;
        in_cooldown: boolean;
      };
      issue_status?: {
        identifier: string;
        state: string;
        url: string;
      };
      warnings: string[];
    };
  };
  rate_limits?: {
    providers: Record<string, {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
      manual_ack_required: boolean;
      recent_hit_count: number;
    }>;
    summary: {
      any_in_cooldown: boolean;
      any_requires_ack: boolean;
      providers_in_cooldown: number;
    };
    warnings: string[];
  };
  research?: {
    total_tasks: number;
    pending_tasks: number;
    in_progress_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    cached_tasks: number;
    stale_tasks: number;
    research_dir: string;
    tasks_file: string;
    warnings: string[];
  };
}

interface ResumeCommandPayload {
  pending_approvals: string[];
  plan_summary?: {
    total_tasks: number;
    entry_tasks: number;
    next_tasks: string[];
  };
  resume_instructions?: {
    checkpoint?: string;
    next_step?: string;
    pending_approvals?: string[];
  };
  rate_limit_warnings?: Array<{
    provider: string;
    in_cooldown: boolean;
    manual_ack_required: boolean;
    reset_at: string;
  }>;
  integration_blockers?: {
    github?: string[];
    linear?: string[];
  };
  branch_protection_blockers?: string[];
}

describe('CLI Status/Plan/Resume Surfaces', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;
  let specMetadataPath: string;

  beforeEach(async () => {
    featureId = 'cli-test-feature';
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-surface-'));
    pipelineDir = path.join(workspaceDir, '.ai-feature-pipeline');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });
    await copyRepoConfig(pipelineDir);
    await enableIntegrations(pipelineDir);

    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
      title: 'CLI Surface Test Feature',
    });
    await initializeQueue(runDir, featureId);

    specMetadataPath = await seedPlanArtifacts(runDir, featureId);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('plan --json surfaces DAG summary and detects spec diff changes', async () => {
    // Simulate spec metadata change after plan generation
    await fs.writeFile(
      specMetadataPath,
      JSON.stringify(
        {
          specHash: 'spec-hash-updated',
          approvalStatus: 'approved',
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf-8'
    );

    const { payload } = runCliJSON<PlanCommandPayload>(workspaceDir, [
      'plan',
      '--feature',
      featureId,
      '--json',
      '--show-diff',
    ]);

    expect(payload.plan_summary?.total_tasks).toBe(2);
    expect(payload.plan_summary?.entry_tasks).toHaveLength(1);
    expect(payload.plan_summary?.dag_metadata?.parallel_paths).toBeDefined();

    expect(payload.plan_diff?.has_changes).toBe(true);
    expect(payload.plan_diff?.spec_hash_changed).toBe(true);
    expect(payload.plan_diff?.changed_fields).toContain('spec_hash');

    const hasDagNote = payload.notes.some(note => note.includes('Plan DAG contains'));
    expect(hasDagNote).toBe(true);
  });

  it('status --json reports plan summary, validation states, and integration telemetry', async () => {
    await createValidationArtifacts(runDir);
    await seedRateLimitLedger(runDir, featureId);
    await seedResearchArtifacts(runDir, featureId);
    await seedPRMetadata(runDir);
    await updateManifest(runDir, {
      source: 'linear',
      title: 'ENG-456: CLI Surface Test Feature',
    });

    const { payload } = runCliJSON<StatusCommandPayload>(workspaceDir, [
      'status',
      '--feature',
      featureId,
      '--json',
    ]);

    expect(payload.plan?.plan_exists).toBe(true);
    expect(payload.plan?.total_tasks).toBe(2);
    expect(payload.plan?.entry_tasks).toBe(1);
    expect(payload.plan?.dag_metadata?.parallel_paths).toBeDefined();

    expect(payload.validation?.has_validation_data).toBe(true);
    expect(payload.validation?.queue_valid).toBe(true);
    expect(payload.validation?.plan_valid).toBe(false);

    expect(payload.integrations?.github?.enabled).toBe(true);
    expect(payload.integrations?.github?.rate_limit?.in_cooldown).toBe(true);
    expect(payload.integrations?.github?.pr_status?.number).toBe(42);
    expect(payload.integrations?.github?.warnings.some(msg => msg.includes('cooldown'))).toBe(true);

    expect(payload.integrations?.linear?.enabled).toBe(true);
    expect(payload.integrations?.linear?.issue_status?.identifier).toBe('ENG-456');

    expect(payload.rate_limits?.summary.any_in_cooldown).toBe(true);
    expect(payload.rate_limits?.providers.github.manual_ack_required).toBe(true);
    expect(payload.rate_limits?.warnings.some(msg => msg.toLowerCase().includes('github'))).toBe(true);

    expect(payload.research?.total_tasks).toBe(3);
    expect(payload.research?.pending_tasks).toBe(1);
    expect(payload.research?.completed_tasks).toBe(1);
    expect(payload.research?.cached_tasks).toBe(1);
    expect(payload.research?.stale_tasks).toBe(1);
    expect(payload.research?.research_dir).toContain(path.join(runDir, 'research'));
    expect(payload.research?.tasks_file).toContain('tasks.jsonl');
  });

  it('resume --dry-run --json includes plan summary, warnings, and blockers', async () => {
    const tasks = [
      createExecutionTask('task-1', featureId, 'Generate PRD', 'documentation'),
      createExecutionTask('task-2', featureId, 'Generate Code', 'code_generation', {
        dependencyIds: ['task-1'],
      }),
    ];

    await appendToQueue(runDir, tasks);
    await setLastStep(runDir, 'task-1');
    await setCurrentStep(runDir, 'task-2');
    await updateManifest(runDir, {
      status: 'in_progress',
      execution: {
        last_step: 'task-1',
        current_step: 'task-2',
        completed_steps: 1,
        total_steps: tasks.length,
        last_error: null,
      },
    });
    await markApprovalRequired(runDir, 'code');
    await seedRateLimitLedger(runDir, featureId);
    await seedBranchProtectionReport(runDir, featureId);

    const { payload } = runCliJSON<ResumeCommandPayload>(workspaceDir, [
      'resume',
      '--feature',
      featureId,
      '--json',
      '--dry-run',
    ]);

    expect(payload.plan_summary?.total_tasks).toBe(2);
    expect(payload.plan_summary?.entry_tasks).toBe(1);
    expect(payload.plan_summary?.next_tasks).toContain('I3-REQ-1');

    expect(payload.resume_instructions?.checkpoint).toBe('task-1');
    expect(payload.resume_instructions?.next_step).toBe('task-2');
    expect(payload.resume_instructions?.pending_approvals).toContain('code');
    expect(payload.pending_approvals).toContain('code');

    expect(payload.rate_limit_warnings?.some(warning => warning.provider === 'github' && warning.manual_ack_required)).toBe(true);
    expect(payload.integration_blockers?.github?.some(blocker => blocker.toLowerCase().includes('cooldown'))).toBe(true);
    expect(payload.branch_protection_blockers).toContain('Missing required check: lint');
  });
});

async function copyRepoConfig(targetDir: string): Promise<void> {
  const configContent = await fs.readFile(ROOT_CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(configContent) as Record<string, unknown>;
  const serialized = JSON.stringify(parsed, null, 2);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'config.json'), serialized, 'utf-8');
}

async function enableIntegrations(pipelineDir: string): Promise<void> {
  const configPath = path.join(pipelineDir, 'config.json');
  const content = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(content) as {
    github?: { enabled?: boolean };
    linear?: { enabled?: boolean };
  };

  if (config.github) {
    config.github.enabled = true;
  }
  if (config.linear) {
    config.linear.enabled = true;
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

async function seedPlanArtifacts(runDir: string, featureId: string): Promise<string> {
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const specDocument = {
    feature_id: featureId,
    title: 'Test Feature',
    test_plan: [
      {
        test_id: 'REQ-1',
        description: 'Implement authentication',
        test_type: 'unit',
        priority: 'high',
      },
      {
        test_id: 'REQ-2',
        description: 'Add integration tests',
        test_type: 'integration',
        priority: 'medium',
        depends_on: ['REQ-1'],
      },
    ],
  };

  const specPath = path.join(artifactsDir, 'spec.json');
  const specMetadataPath = path.join(artifactsDir, 'spec_metadata.json');

  await fs.writeFile(specPath, JSON.stringify(specDocument, null, 2), 'utf-8');
  await fs.writeFile(
    specMetadataPath,
    JSON.stringify(
      {
        specHash: 'spec-hash-initial',
        approvalStatus: 'approved',
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  const logger = createCliLogger('test-plan', featureId, runDir, {
    minLevel: LogLevel.ERROR,
    mirrorToStderr: false,
  });
  const metrics = createRunMetricsCollector(runDir, featureId);

  await generateExecutionPlan(
    {
      runDir,
      featureId,
      iterationId: 'I3',
    },
    logger,
    metrics
  );

  await logger.flush();
  await metrics.flush();

  return specMetadataPath;
}

async function createValidationArtifacts(runDir: string): Promise<void> {
  await fs.writeFile(
    path.join(runDir, 'queue_validation.json'),
    JSON.stringify(
      {
        valid: true,
        totalTasks: 2,
        corruptedTasks: 0,
        errors: [],
      },
      null,
      2
    ),
    'utf-8'
  );

  await fs.writeFile(
    path.join(runDir, 'plan_validation.json'),
    JSON.stringify(
      {
        valid: false,
        errors: ['Plan checksum mismatch detected'],
      },
      null,
      2
    ),
    'utf-8'
  );
}

async function seedRateLimitLedger(runDir: string, featureId: string): Promise<void> {
  const ledgerPath = path.join(runDir, 'rate_limits.json');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const cooldownUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const githubEnvelopes = [
    0,
    1,
    2,
  ].map(index => ({
    provider: 'github',
    remaining: 0,
    reset: nowSeconds + 3600,
    retryAfter: 60,
    timestamp: new Date(Date.now() - index * 1000).toISOString(),
    requestId: `github-limit-${index}`,
    endpoint: '/graphql',
    statusCode: 429,
    errorMessage: 'Primary rate limit exceeded',
  }));
  githubEnvelopes.push({
    provider: 'github',
    remaining: 25,
    reset: nowSeconds + 3600,
    retryAfter: 0,
    timestamp: nowIso,
    requestId: 'github-ok',
    endpoint: '/graphql',
    statusCode: 200,
  });

  const ledger: RateLimitLedgerData = {
    schema_version: '1.0.0',
    feature_id: featureId,
    providers: {
      github: {
        provider: 'github',
        state: {
          remaining: 42,
          reset: nowSeconds + 3600,
          inCooldown: true,
          cooldownUntil,
        },
        lastError: {
          timestamp: githubEnvelopes[0].timestamp,
          message: 'Primary rate limit exceeded',
          requestId: githubEnvelopes[0].requestId,
        },
        recentEnvelopes: githubEnvelopes,
        lastUpdated: nowIso,
      },
      linear: {
        provider: 'linear',
        state: {
          remaining: 1200,
          reset: nowSeconds + 1800,
          inCooldown: false,
        },
        recentEnvelopes: [
          {
            provider: 'linear',
            remaining: 1200,
            reset: nowSeconds + 1800,
            retryAfter: 0,
            timestamp: nowIso,
            requestId: 'linear-ok',
            endpoint: '/graphql',
            statusCode: 200,
          },
        ],
        lastUpdated: nowIso,
      },
    },
    metadata: {
      created_at: nowIso,
      updated_at: nowIso,
    },
  };

  await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
}

async function seedResearchArtifacts(runDir: string, featureId: string): Promise<void> {
  const researchDir = path.join(runDir, 'research');
  const tasksDir = path.join(researchDir, 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });

  const pendingTask = {
    ...createResearchTask('RT-PENDING', featureId, 'Identify auth unknowns', ['List OAuth scopes']),
  };

  const staleTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const completedTask = {
    ...createResearchTask('RT-COMPLETED', featureId, 'Document GitHub limits', ['Check docs']),
    status: 'completed',
    updated_at: staleTimestamp,
    completed_at: staleTimestamp,
    results: {
      summary: 'GitHub REST API primary limit documented',
      details: 'Remaining requests captured for CLI display',
      confidence_score: 0.9,
      timestamp: staleTimestamp,
      sources_consulted: [],
    },
    freshness_requirements: {
      max_age_hours: 4,
      force_fresh: false,
    },
  };

  const cachedTask = {
    ...createResearchTask('RT-CACHED', featureId, 'Track Linear collections', ['List rate limits']),
    status: 'cached',
  };

  const tasks = [pendingTask, completedTask, cachedTask];
  for (const task of tasks) {
    const taskPath = path.join(tasksDir, `${task.task_id}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf-8');
  }

  const tasksLogPath = path.join(researchDir, 'tasks.jsonl');
  await fs.writeFile(tasksLogPath, '', 'utf-8');
}

async function seedPRMetadata(runDir: string): Promise<void> {
  const prPath = path.join(runDir, 'pr.json');
  const now = new Date().toISOString();
  const metadata = {
    pr_number: 42,
    url: 'https://github.com/test/repo/pull/42',
    branch: 'feature/cli-status',
    base_branch: 'main',
    state: 'open',
    mergeable: true,
    created_at: now,
    reviewers_requested: ['reviewer@example.com'],
    auto_merge_enabled: false,
    status_checks: [
      {
        context: 'lint',
        state: 'pending',
        conclusion: null,
      },
    ],
    merge_ready: false,
    blockers: ['Missing required check: lint'],
    last_updated: now,
  };

  await fs.writeFile(prPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

async function seedBranchProtectionReport(runDir: string, featureId: string): Promise<void> {
  const statusDir = path.join(runDir, 'status');
  await fs.mkdir(statusDir, { recursive: true });

  const report: BranchProtectionReport = {
    schema_version: '1.0.0',
    feature_id: featureId,
    branch: 'feature/cli-status',
    sha: 'abc123',
    base_sha: 'main',
    pull_number: 42,
    protected: true,
    compliant: false,
    required_checks: ['lint'],
    checks_passing: false,
    failing_checks: ['lint'],
    reviews_required: 2,
    reviews_count: 1,
    reviews_satisfied: false,
    up_to_date: true,
    stale_commit: false,
    allows_auto_merge: false,
    allows_force_push: false,
    blockers: ['Missing required check: lint'],
    evaluated_at: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(statusDir, 'branch_protection.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );
}

function runCliJSON<TPayload>(cwd: string, args: string[]): { payload: TPayload; raw: string } {
  const result = spawnSync('node', [CLI_BIN_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.stdout !== 'string') {
    throw new Error('CLI did not produce textual output');
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    throw new Error(`CLI exited with code ${result.status}: ${stderr}`);
  }

  const stdout = result.stdout;
  const trimmed = stdout.trim();
  const parsed: unknown = JSON.parse(trimmed);
  const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
  expect(stdout).toBe(normalized);

  return {
    payload: parsed as TPayload,
    raw: stdout,
  };
}
