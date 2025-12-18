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

  it('status --json reports plan summary and validation states', async () => {
    await createValidationArtifacts(runDir);

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
  });

  it('resume --dry-run --json includes plan summary and resume instructions', async () => {
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
  });
});

async function copyRepoConfig(targetDir: string): Promise<void> {
  const configContent = await fs.readFile(ROOT_CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(configContent) as Record<string, unknown>;
  const serialized = JSON.stringify(parsed, null, 2);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'config.json'), serialized, 'utf-8');
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
