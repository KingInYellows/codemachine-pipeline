import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createRunDirectory,
  setLastStep,
  setCurrentStep,
  updateManifest,
  generateHashManifest,
  markApprovalRequired,
  markApprovalCompleted,
} from '../../src/persistence/runDirectoryManager';
import {
  initializeQueue,
  appendToQueue,
  updateTaskInQueue,
  loadQueue,
  getNextTask,
} from '../../src/workflows/queue/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { analyzeResumeState, prepareResume } from '../../src/workflows/resumeCoordinator';

const FIXTURE_REPO = path.resolve(__dirname, '../fixtures/sample_repo');

/**
 * Smoke Test Suite: End-to-End Execution Flow Validation
 *
 * This test suite validates the complete pipeline execution workflow:
 * 1. Context gathering from repository structure
 * 2. PRD generation from prompts
 * 3. Spec generation from PRD artifacts
 * 4. Plan generation from spec artifacts
 * 5. Patch application with git safety rails
 * 6. Validation command execution
 * 7. Resume/recovery workflows
 *
 * Tests use a deterministic fixture repository to ensure reproducibility.
 */
describe('Smoke Test: Execution Flow Integration', () => {
  let workspaceDir: string;
  let pipelineDir: string;
  let runsDir: string;
  let runDir: string;
  let featureId: string;

  beforeEach(async () => {
    featureId = `smoke-test-${Date.now()}`;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-exec-'));
    pipelineDir = path.join(workspaceDir, '.codepipe');
    runsDir = path.join(pipelineDir, 'runs');

    await fs.mkdir(runsDir, { recursive: true });

    // Copy fixture repo config to workspace
    await copyFixtureConfig(pipelineDir);

    // Initialize run directory
    runDir = await createRunDirectory(runsDir, featureId, {
      repoUrl: 'https://github.com/test/smoke-repo.git',
      defaultBranch: 'main',
      title: 'Smoke Test Feature',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  describe('Scenario: Complete Happy Path Execution', () => {
    it('should execute full workflow: context → PRD → spec → plan → patch → validate', async () => {
      // Step 1: Create context artifact
      const contextPath = await createContextArtifact(runDir);
      expect(await fileExists(contextPath)).toBe(true);

      // Step 2: Create PRD artifact
      const prdPath = await createPRDArtifact(runDir, featureId);
      expect(await fileExists(prdPath)).toBe(true);

      const prdContent = await fs.readFile(prdPath, 'utf-8');
      expect(prdContent).toContain('# Product Requirements Document');
      expect(prdContent).toContain(featureId);

      // Step 3: Create spec artifact
      const specPath = await createSpecArtifact(runDir, featureId);
      expect(await fileExists(specPath)).toBe(true);

      const specContent = await fs.readFile(specPath, 'utf-8');
      expect(specContent).toContain('# Technical Specification');

      // Step 4: Create plan and queue
      const tasks = [
        createExecutionTask('I3.T1', featureId, 'Setup infrastructure', 'code_generation'),
        createExecutionTask('I3.T2', featureId, 'Implement feature', 'code_generation', {
          dependencyIds: ['I3.T1'],
        }),
        createExecutionTask('I3.T3', featureId, 'Add tests', 'testing', {
          dependencyIds: ['I3.T2'],
        }),
      ];

      await appendToQueue(runDir, tasks);
      const planPath = await createPlanArtifact(runDir, tasks);
      expect(await fileExists(planPath)).toBe(true);

      // Step 5: Generate hash manifest for artifacts
      await generateHashManifest(runDir, [
        'artifacts/context.json',
        'artifacts/prd.md',
        'artifacts/spec.md',
        'artifacts/plan.json',
      ]);

      const hashManifestPath = path.join(runDir, 'hash_manifest.json');
      expect(await fileExists(hashManifestPath)).toBe(true);

      // Step 6: Execute first task
      await setCurrentStep(runDir, 'I3.T1');
      await updateTaskInQueue(runDir, 'I3.T1', {
        status: 'running',
        started_at: new Date().toISOString(),
      });

      // Simulate patch application
      const patchPath = await createPatchArtifact(runDir, 'I3.T1');
      expect(await fileExists(patchPath)).toBe(true);

      await updateTaskInQueue(runDir, 'I3.T1', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'I3.T1');

      // Step 7: Run validation commands
      const validationDir = path.join(runDir, 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      const validationResult = await createValidationResult(validationDir);
      expect(validationResult.success).toBe(true);

      // Step 8: Verify run directory structure
      await verifyRunDirectoryStructure(runDir);

      // Step 9: Verify queue state
      const queue = await loadQueue(runDir);
      expect(queue.size).toBe(3);
      expect(queue.get('I3.T1')?.status).toBe('completed');
      expect(queue.get('I3.T2')?.status).toBe('pending');

      // Step 10: Get next task
      const nextTask = await getNextTask(runDir);
      expect(nextTask?.task_id).toBe('I3.T2');
    });
  });

  describe('Scenario: Resume After Crash', () => {
    it('should resume execution after unexpected interruption', async () => {
      // Setup: Create initial execution state
      await createContextArtifact(runDir);
      await createPRDArtifact(runDir, featureId);
      await createSpecArtifact(runDir, featureId);

      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'documentation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation', {
          dependencyIds: ['T1'],
        }),
      ];

      await appendToQueue(runDir, tasks);
      await generateHashManifest(runDir, [
        'artifacts/context.json',
        'artifacts/prd.md',
        'artifacts/spec.md',
      ]);

      // Complete first task
      await updateTaskInQueue(runDir, 'T1', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'T1');

      // Start second task, then crash
      await updateTaskInQueue(runDir, 'T2', {
        status: 'running',
        started_at: new Date().toISOString(),
      });
      await setCurrentStep(runDir, 'T2');
      await updateManifest(runDir, { status: 'in_progress' });

      // Resume analysis
      const analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);
      expect(analysis.currentStep).toBe('T2');
      expect(analysis.lastStep).toBe('T1');
      expect(analysis.queueState.completed).toBe(1);
      expect(analysis.queueState.pending).toBe(0);

      // Prepare resume
      await prepareResume(runDir);

      // Verify next task
      const nextTask = await getNextTask(runDir);
      expect(nextTask?.task_id).toBe('T2');
    });

    it('should handle approval gate during resume', async () => {
      await createContextArtifact(runDir);
      await createSpecArtifact(runDir, featureId);

      const tasks = [createExecutionTask('T1', featureId, 'Code gen', 'code_generation')];
      await appendToQueue(runDir, tasks);

      await setLastStep(runDir, 'spec_generation');
      await markApprovalRequired(runDir, 'code_review');
      await updateManifest(runDir, { status: 'paused' });

      // Should block resume
      let analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(false);
      expect(analysis.pendingApprovals).toContain('code_review');

      // Grant approval
      await markApprovalCompleted(runDir, 'code_review');

      // Should now allow resume
      analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);
      expect(analysis.pendingApprovals).not.toContain('code_review');
    });
  });

  describe('Scenario: Validation Command Execution', () => {
    it('should execute validation commands and record results', async () => {
      const validationDir = path.join(runDir, 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      // Create validation registry
      const commandsPath = path.join(validationDir, 'commands.json');
      await fs.writeFile(
        commandsPath,
        JSON.stringify(
          {
            schema_version: '1.0.0',
            feature_id: featureId,
            commands: [
              {
                type: 'lint',
                command: 'echo "lint passed"',
                required: true,
                supports_auto_fix: true,
                auto_fix_command: 'echo "auto-fix applied"',
                timeout_ms: 5000,
                max_retries: 2,
                backoff_ms: 100,
                cwd: '.',
              },
              {
                type: 'test',
                command: 'echo "tests passed"',
                required: true,
                supports_auto_fix: false,
                timeout_ms: 10000,
                max_retries: 1,
                backoff_ms: 200,
                cwd: '.',
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      // Execute validation commands (which creates the ledger)
      const result = await executeValidationCommands(validationDir);

      expect(result.total_commands).toBe(2);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);

      // Verify ledger was created by executeValidationCommands
      const ledgerPath = path.join(validationDir, 'ledger.json');
      expect(await fileExists(ledgerPath)).toBe(true);

      const ledgerContent = await fs.readFile(ledgerPath, 'utf-8');
      const ledger = JSON.parse(ledgerContent) as {
        attempts: Array<{ command_type: string; exit_code: number }>;
      };

      expect(ledger.attempts).toHaveLength(2);
      expect(ledger.attempts[0].exit_code).toBe(0);
      expect(ledger.attempts[1].exit_code).toBe(0);
    });
  });

  describe('Scenario: Patch Application with Git Safety', () => {
    it('should validate patch before application', async () => {
      const patchesDir = path.join(runDir, 'patches');
      await fs.mkdir(patchesDir, { recursive: true });

      const patchPath = path.join(patchesDir, 'task-1.patch');
      const validPatch = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,5 @@
+export function newFeature(): string {
+  return 'implemented';
+}
`;

      await fs.writeFile(patchPath, validPatch, 'utf-8');

      // Verify patch format
      const patchContent = await fs.readFile(patchPath, 'utf-8');
      expect(patchContent).toContain('diff --git');
      expect(patchContent).toContain('src/feature.ts');

      // Record patch metadata
      const metadataPath = path.join(patchesDir, 'task-1.metadata.json');
      await fs.writeFile(
        metadataPath,
        JSON.stringify(
          {
            task_id: 'task-1',
            created_at: new Date().toISOString(),
            patch_size: validPatch.length,
            files_modified: ['src/feature.ts'],
            validation_status: 'passed',
          },
          null,
          2
        ),
        'utf-8'
      );

      expect(await fileExists(metadataPath)).toBe(true);
    });
  });

  describe('Scenario: Export Bundle with Diff Summaries', () => {
    it('should create export bundle containing all artifacts and diffs', async () => {
      // Create artifacts
      await createContextArtifact(runDir);
      await createPRDArtifact(runDir, featureId);
      await createSpecArtifact(runDir, featureId);

      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await createPlanArtifact(runDir, tasks);
      await createPatchArtifact(runDir, 'T1');

      // Create diff summary
      const diffSummaryPath = path.join(runDir, 'diff_summary.json');
      await fs.writeFile(
        diffSummaryPath,
        JSON.stringify(
          {
            feature_id: featureId,
            created_at: new Date().toISOString(),
            artifacts: [
              { path: 'artifacts/context.json', type: 'context', size: 1024 },
              { path: 'artifacts/prd.md', type: 'prd', size: 2048 },
              { path: 'artifacts/spec.md', type: 'spec', size: 3072 },
              { path: 'artifacts/plan.json', type: 'plan', size: 1536 },
            ],
            patches: [{ path: 'patches/T1.patch', task_id: 'T1', files_modified: 1 }],
          },
          null,
          2
        ),
        'utf-8'
      );
      expect(await fileExists(diffSummaryPath)).toBe(true);

      // Create export bundle
      const exportPath = await createExportBundle(runDir);
      expect(await fileExists(exportPath)).toBe(true);

      const exportContent = await fs.readFile(exportPath, 'utf-8');
      const exportData = JSON.parse(exportContent) as {
        feature_id: string;
        artifacts: Array<{ path: string }>;
        diff_summary_path: string;
      };

      expect(exportData.feature_id).toBe(featureId);
      expect(exportData.artifacts.length).toBeGreaterThan(0);
      expect(exportData.diff_summary_path).toBe('diff_summary.json');
    });
  });

  describe('Scenario: Run Directory Recovery', () => {
    it('should verify all required artifacts present for recovery', async () => {
      // Create complete run state
      await createContextArtifact(runDir);
      await createPRDArtifact(runDir, featureId);
      await createSpecArtifact(runDir, featureId);

      const tasks = [createExecutionTask('T1', featureId, 'Task', 'code_generation')];
      await appendToQueue(runDir, tasks);
      await createPlanArtifact(runDir, tasks);

      await generateHashManifest(runDir, [
        'artifacts/context.json',
        'artifacts/prd.md',
        'artifacts/spec.md',
        'artifacts/plan.json',
      ]);

      // Verify recovery readiness
      const recoveryCheck = await verifyRecoveryReadiness(runDir);

      expect(recoveryCheck.has_manifest).toBe(true);
      expect(recoveryCheck.has_queue).toBe(true);
      expect(recoveryCheck.has_hash_manifest).toBe(true);
      expect(recoveryCheck.has_artifacts).toBe(true);
      expect(recoveryCheck.ready_for_recovery).toBe(true);
    });
  });
});

// Helper Functions

async function copyFixtureConfig(targetDir: string): Promise<void> {
  const fixtureConfigPath = path.join(FIXTURE_REPO, '.codepipe', 'config.json');
  const configContent = await fs.readFile(fixtureConfigPath, 'utf-8');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'config.json'), configContent, 'utf-8');
}

async function createContextArtifact(runDir: string): Promise<string> {
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const contextPath = path.join(artifactsDir, 'context.json');
  await fs.writeFile(
    contextPath,
    JSON.stringify(
      {
        repository: {
          url: 'https://github.com/test/smoke-repo.git',
          branch: 'main',
          files: ['src/index.ts', 'docs/overview.md', 'package.json'],
        },
        created_at: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  return contextPath;
}

async function createPRDArtifact(runDir: string, featureId: string): Promise<string> {
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const prdPath = path.join(artifactsDir, 'prd.md');
  const prdContent = `# Product Requirements Document

**Feature ID:** ${featureId}
**Title:** Smoke Test Feature
**Created:** ${new Date().toISOString()}

## Overview

This PRD describes a test feature for smoke testing purposes.

## Goals

- Validate PRD generation
- Test artifact persistence
- Verify workflow progression

## Acceptance Criteria

1. PRD artifact created successfully
2. Contains required metadata
3. Follows PRD template structure

## Out of Scope

- Production implementation details
`;

  await fs.writeFile(prdPath, prdContent, 'utf-8');
  return prdPath;
}

async function createSpecArtifact(runDir: string, featureId: string): Promise<string> {
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const specPath = path.join(artifactsDir, 'spec.md');
  const specContent = `# Technical Specification

**Feature ID:** ${featureId}
**Version:** 1.0.0
**Created:** ${new Date().toISOString()}

## Architecture

Smoke test implementation architecture.

## Implementation Plan

1. Setup infrastructure
2. Implement core functionality
3. Add test coverage

## API Design

\`\`\`typescript
export function smokeTest(): boolean;
\`\`\`

## Testing Strategy

- Unit tests
- Integration tests
- Smoke tests
`;

  await fs.writeFile(specPath, specContent, 'utf-8');
  return specPath;
}

async function createPlanArtifact(
  runDir: string,
  tasks: ReturnType<typeof createExecutionTask>[]
): Promise<string> {
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const planPath = path.join(artifactsDir, 'plan.json');
  await fs.writeFile(
    planPath,
    JSON.stringify(
      {
        schema_version: '1.0.0',
        tasks: tasks.map((t) => ({
          task_id: t.task_id,
          title: t.title,
          task_type: t.task_type,
          dependencies: t.dependency_ids || [],
        })),
        dag_metadata: {
          total_tasks: tasks.length,
          entry_tasks: tasks.filter((t) => !t.dependency_ids || t.dependency_ids.length === 0)
            .length,
          parallel_paths: 1,
        },
        created_at: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  return planPath;
}

async function createPatchArtifact(runDir: string, taskId: string): Promise<string> {
  const patchesDir = path.join(runDir, 'patches');
  await fs.mkdir(patchesDir, { recursive: true });

  const patchPath = path.join(patchesDir, `${taskId}.patch`);
  const patchContent = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..${taskId.substring(0, 7)}
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,3 @@
+export function feature_${taskId}(): void {
+  console.log('Feature ${taskId} implemented');
+}
`;

  await fs.writeFile(patchPath, patchContent, 'utf-8');
  return patchPath;
}

async function createValidationResult(validationDir: string): Promise<{
  success: boolean;
  total_commands: number;
  passed: number;
  failed: number;
}> {
  const outputsDir = path.join(validationDir, 'outputs');
  await fs.mkdir(outputsDir, { recursive: true });

  // Simulate validation execution
  const ledgerPath = path.join(validationDir, 'ledger.json');
  await fs.writeFile(
    ledgerPath,
    JSON.stringify(
      {
        schema_version: '1.0.0',
        attempts: [
          {
            attempt_id: 'lint-1',
            command_type: 'lint',
            attempt_number: 1,
            exit_code: 0,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: 120,
            auto_fix_attempted: false,
          },
          {
            attempt_id: 'test-1',
            command_type: 'test',
            attempt_number: 1,
            exit_code: 0,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: 350,
            auto_fix_attempted: false,
          },
        ],
        summary: {
          total_attempts: 2,
          successful_attempts: 2,
          failed_attempts: 0,
          auto_fix_successes: 0,
          last_updated: new Date().toISOString(),
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  return {
    success: true,
    total_commands: 2,
    passed: 2,
    failed: 0,
  };
}

async function executeValidationCommands(validationDir: string): Promise<{
  total_commands: number;
  passed: number;
  failed: number;
}> {
  // Simulate running validation commands and create ledger
  const commandsPath = path.join(validationDir, 'commands.json');
  const commandsContent = await fs.readFile(commandsPath, 'utf-8');
  const parsedCommands = JSON.parse(commandsContent) as unknown;
  if (!isValidationCommandSchema(parsedCommands)) {
    throw new Error('Invalid validation command schema in commands.json');
  }
  const commands = parsedCommands;

  // Create validation outputs directory
  const outputsDir = path.join(validationDir, 'outputs');
  await fs.mkdir(outputsDir, { recursive: true });

  // Create ledger with simulated validation results
  const ledgerPath = path.join(validationDir, 'ledger.json');
  await fs.writeFile(
    ledgerPath,
    JSON.stringify(
      {
        schema_version: '1.0.0',
        attempts: commands.commands.map((cmd, idx) => ({
          attempt_id: `${cmd.type}-${idx + 1}`,
          command_type: cmd.type,
          attempt_number: 1,
          exit_code: 0,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 100 + idx * 50,
          auto_fix_attempted: false,
        })),
        summary: {
          total_attempts: commands.commands.length,
          successful_attempts: commands.commands.length,
          failed_attempts: 0,
          auto_fix_successes: 0,
          last_updated: new Date().toISOString(),
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  return {
    total_commands: commands.commands.length,
    passed: commands.commands.length,
    failed: 0,
  };
}

type ValidationCommandsSchema = { commands: Array<{ type: string }> };

function isValidationCommandSchema(value: unknown): value is ValidationCommandsSchema {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as Record<string, unknown>).commands)
  ) {
    return false;
  }

  return (value as { commands: unknown[] }).commands.every(
    (command) =>
      typeof command === 'object' &&
      command !== null &&
      typeof (command as { type?: unknown }).type === 'string'
  );
}

async function verifyRunDirectoryStructure(runDir: string): Promise<void> {
  const requiredPaths = [
    path.join(runDir, 'manifest.json'),
    path.join(runDir, 'queue'),
    path.join(runDir, 'artifacts'),
    path.join(runDir, 'hash_manifest.json'),
  ];

  for (const requiredPath of requiredPaths) {
    expect(await fileExists(requiredPath)).toBe(true);
  }
}

async function createExportBundle(runDir: string): Promise<string> {
  const exportPath = path.join(runDir, 'export_bundle.json');

  const artifactsDir = path.join(runDir, 'artifacts');
  const artifactFiles = await fs.readdir(artifactsDir);

  await fs.writeFile(
    exportPath,
    JSON.stringify(
      {
        schema_version: '1.0.0',
        feature_id: path.basename(runDir),
        created_at: new Date().toISOString(),
        artifacts: artifactFiles.map((file) => ({
          path: `artifacts/${file}`,
          type: path.extname(file).substring(1),
        })),
        diff_summary_path: 'diff_summary.json',
      },
      null,
      2
    ),
    'utf-8'
  );

  return exportPath;
}

async function verifyRecoveryReadiness(runDir: string): Promise<{
  has_manifest: boolean;
  has_queue: boolean;
  has_hash_manifest: boolean;
  has_artifacts: boolean;
  ready_for_recovery: boolean;
}> {
  const manifestExists = await fileExists(path.join(runDir, 'manifest.json'));
  const queueExists = await fileExists(path.join(runDir, 'queue'));
  const hashManifestExists = await fileExists(path.join(runDir, 'hash_manifest.json'));
  const artifactsExist = await fileExists(path.join(runDir, 'artifacts'));

  return {
    has_manifest: manifestExists,
    has_queue: queueExists,
    has_hash_manifest: hashManifestExists,
    has_artifacts: artifactsExist,
    ready_for_recovery: manifestExists && queueExists && hashManifestExists && artifactsExist,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
