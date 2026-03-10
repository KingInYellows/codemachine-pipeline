import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { analyzeResumeState, prepareResume } from '../../src/workflows/resumeCoordinator';
import {
  createRunDirectory,
  setLastError,
  setLastStep,
  setCurrentStep,
  markApprovalRequired,
  markApprovalCompleted,
  generateHashManifest,
  updateManifest,
} from '../../src/persistence/runDirectoryManager';
import {
  initializeQueue,
  appendToQueue,
  createQueueSnapshot,
  validateQueue,
  getNextTask,
  updateTaskInQueue,
  loadQueue,
} from '../../src/workflows/queue/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';

type ResumeState = Awaited<ReturnType<typeof analyzeResumeState>>;

/**
 * Integration Tests: Resume Flow
 *
 * These tests simulate end-to-end resume scenarios including:
 * - Crash recovery with queue restoration
 * - Hash integrity verification failures
 * - Approval workflow integration
 * - Corrupted queue handling
 */

describe('Resume Flow Integration Tests', () => {
  let testDir: string;
  let runDir: string;
  const featureId = 'integration-test-feature';

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-flow-test-'));
    runDir = await createRunDirectory(testDir, featureId, {
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
      title: 'Integration Test Feature',
    });
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Scenario: Successful Crash Recovery', () => {
    it('should resume execution after unexpected crash', async () => {
      // Step 1: Simulate normal execution start
      await setCurrentStep(runDir, 'planning');
      await updateManifest(runDir, { status: 'in_progress' });

      const task1 = createExecutionTask('task-1', featureId, 'Generate PRD', 'documentation');
      const task2 = createExecutionTask('task-2', featureId, 'Generate Spec', 'documentation', {
        dependencyIds: ['task-1'],
      });
      const task3 = createExecutionTask('task-3', featureId, 'Generate Code', 'code_generation', {
        dependencyIds: ['task-2'],
      });

      await appendToQueue(runDir, [task1, task2, task3]);

      // Step 2: Complete first task
      await updateTaskInQueue(runDir, 'task-1', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'task-1');

      // Step 3: Start second task, then crash
      await updateTaskInQueue(runDir, 'task-2', {
        status: 'running',
        started_at: new Date().toISOString(),
      });
      await setCurrentStep(runDir, 'task-2');

      // Simulate crash - process terminates without cleanup
      // Status remains in_progress, current_step is task-2

      // Step 4: Resume analysis detects crash
      const analysis: ResumeState = await analyzeResumeState(runDir);

      expect(analysis.status).toBe('in_progress');
      expect(analysis.currentStep).toBe('task-2');
      expect(analysis.lastStep).toBe('task-1');
      expect(analysis.queueState.pending).toBe(1); // task-3
      expect(analysis.queueState.completed).toBe(1); // task-1
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'UNEXPECTED_INTERRUPT',
          severity: 'warning',
        })
      );
      expect(analysis.canResume).toBe(true);

      // Step 5: Prepare resume
      await prepareResume(runDir);

      // Step 6: Verify resumption point
      const nextTask = await getNextTask(runDir);
      expect(nextTask).toBeDefined();
      expect(nextTask?.task_id).toBe('task-2'); // Should retry running task
    });

    it('should restore queue from snapshot after crash', async () => {
      // Create and populate queue
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createExecutionTask(`task-${i}`, featureId, `Task ${i}`, 'code_generation')
      );
      await appendToQueue(runDir, tasks);

      // Create snapshot
      await createQueueSnapshot(runDir);

      // Complete some tasks
      await updateTaskInQueue(runDir, 'task-0', { status: 'completed' });
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });
      await updateTaskInQueue(runDir, 'task-2', { status: 'running' });

      // Simulate crash
      await updateManifest(runDir, { status: 'in_progress' });
      await setLastStep(runDir, 'task-1');

      // Resume and verify queue state
      const analysis: ResumeState = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);

      const loadedQueue = await loadQueue(runDir);
      expect(loadedQueue.size).toBe(10);
      expect(loadedQueue.get('task-0')?.status).toBe('completed');
      expect(loadedQueue.get('task-2')?.status).toBe('running');
    });
  });

  describe('Scenario: Hash Integrity Failure', () => {
    it('should block resume when artifacts are corrupted', async () => {
      // Step 1: Create artifacts and hash manifest
      const artifactsDir = path.join(runDir, 'artifacts');
      await fs.mkdir(artifactsDir, { recursive: true });

      const prdPath = path.join(artifactsDir, 'prd.md');
      const specPath = path.join(artifactsDir, 'spec.md');

      await fs.writeFile(prdPath, '# Product Requirements\n\nOriginal content', 'utf-8');
      await fs.writeFile(specPath, '# Technical Spec\n\nOriginal content', 'utf-8');

      await generateHashManifest(runDir, ['artifacts/prd.md', 'artifacts/spec.md']);

      // Step 2: Set up partial execution
      await setLastStep(runDir, 'spec_generation');
      await setLastError(runDir, 'code_generation', 'Agent timeout', true);
      await updateManifest(runDir, { status: 'paused' });

      // Step 3: External modification (simulate corruption)
      await fs.writeFile(specPath, '# Technical Spec\n\nTAMPERED CONTENT', 'utf-8');

      // Step 4: Resume analysis detects corruption
      const analysis: ResumeState = await analyzeResumeState(runDir);

      expect(analysis.canResume).toBe(false);
      expect(analysis.integrityCheck?.valid).toBe(false);
      expect(analysis.integrityCheck?.failed).toContainEqual(
        expect.objectContaining({
          path: expect.stringContaining('spec.md') as unknown as string,
          reason: 'Hash mismatch',
        })
      );
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_HASH_MISMATCH',
          severity: 'blocker',
        })
      );

      // Step 5: Verify resume is blocked
      await expect(prepareResume(runDir)).rejects.toThrow(/Cannot resume/);
    });

    it('should allow force resume with warning', async () => {
      // Set up corrupted state (same as above)
      const artifactsDir = path.join(runDir, 'artifacts');
      await fs.mkdir(artifactsDir, { recursive: true });
      const specPath = path.join(artifactsDir, 'spec.md');
      await fs.writeFile(specPath, 'Original', 'utf-8');
      await generateHashManifest(runDir, ['artifacts/spec.md']);
      await fs.writeFile(specPath, 'Modified', 'utf-8');

      await setLastError(runDir, 'test', 'Error', true);
      await updateManifest(runDir, { status: 'paused' });

      // Force resume despite corruption
      const analysis: ResumeState = await analyzeResumeState(runDir, { force: true });

      expect(analysis.canResume).toBe(true);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_HASH_MISMATCH',
          severity: 'warning', // Downgraded from blocker
        })
      );

      // Should not throw
      await expect(prepareResume(runDir, { force: true })).resolves.toBeDefined();
    });

    it('should handle missing artifacts', async () => {
      // Create hash manifest with non-existent file
      await generateHashManifest(runDir, []);

      // Manually add missing file to hash manifest
      const hashManifestPath = path.join(runDir, 'hash_manifest.json');
      const hashManifestContent = await fs.readFile(hashManifestPath, 'utf-8');
      const hashManifest = JSON.parse(hashManifestContent) as {
        files: Record<
          string,
          {
            path: string;
            hash: string;
            size: number;
            timestamp: string;
          }
        >;
      };
      hashManifest.files['artifacts/missing.md'] = {
        path: 'artifacts/missing.md',
        hash: 'fake-hash',
        size: 100,
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(hashManifestPath, JSON.stringify(hashManifest, null, 2));

      await setLastError(runDir, 'test', 'Error', true);
      await updateManifest(runDir, { status: 'paused' });

      const analysis: ResumeState = await analyzeResumeState(runDir);

      expect(analysis.integrityCheck?.valid).toBe(false);
      expect(analysis.integrityCheck?.missing).toContain('artifacts/missing.md');
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_MISSING_FILES',
          severity: 'blocker',
        })
      );
    });
  });

  describe('Scenario: Corrupted Queue Recovery', () => {
    it('should detect and report corrupted queue entries', async () => {
      // Step 1: Create valid queue
      const tasks = [
        createExecutionTask('task-1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Task 2', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      // Step 2: Corrupt queue file by injecting invalid JSON
      const queuePath = path.join(runDir, 'queue', 'queue.jsonl');
      await fs.appendFile(queuePath, '\n{invalid json}\n', 'utf-8');
      await fs.appendFile(queuePath, '\n{"task_id": "incomplete-task"', 'utf-8'); // Missing closing brace

      // Step 3: Validate queue
      const validation = await validateQueue(runDir);

      expect(validation.valid).toBe(false);
      expect(validation.corruptedTasks).toBe(2);
      expect(validation.errors).toHaveLength(2);
      expect(validation.totalTasks).toBe(4); // 2 valid + 2 corrupted

      // Step 4: Resume should halt until queue is fixed
      const analysis: ResumeState = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(false);
      expect(analysis.queueValidation?.valid).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_CORRUPTED',
          severity: 'blocker',
        })
      );
      await expect(prepareResume(runDir)).rejects.toThrow(/Cannot resume/);
    });

    it('should handle queue with validation schema errors', async () => {
      // Create task with invalid schema (missing required fields)
      const invalidTask = {
        task_id: 'invalid',
        // Missing schema_version, feature_id, title, etc.
      };

      const queuePath = path.join(runDir, 'queue', 'queue.jsonl');
      await fs.appendFile(queuePath, JSON.stringify(invalidTask) + '\n', 'utf-8');

      const analysis: ResumeState = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(false);
      expect(analysis.queueValidation?.valid).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_CORRUPTED',
        })
      );
    });

    it('should provide safe halt when queue is entirely corrupted', async () => {
      // Completely corrupt queue file
      const queuePath = path.join(runDir, 'queue', 'queue.jsonl');
      await fs.writeFile(queuePath, 'This is not JSON at all!\n', 'utf-8');

      const validation = await validateQueue(runDir);

      expect(validation.valid).toBe(false);
      expect(validation.totalTasks).toBe(1);
      expect(validation.corruptedTasks).toBe(1);

      // Resume should block until queue is rebuilt
      const analysis: ResumeState = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_CORRUPTED',
          severity: 'blocker',
        })
      );
    });
  });

  describe('Scenario: Approval Workflow Integration', () => {
    it('should block resume until approvals granted', async () => {
      // Step 1: Set up execution requiring approval
      await setLastStep(runDir, 'spec_generation');
      await markApprovalRequired(runDir, 'spec_review');
      await updateManifest(runDir, { status: 'paused' });

      // Step 2: Verify resume is blocked
      const analysis1: ResumeState = await analyzeResumeState(runDir);
      expect(analysis1.canResume).toBe(false);
      expect(analysis1.pendingApprovals).toContain('spec_review');

      await expect(prepareResume(runDir)).rejects.toThrow(/Cannot resume/);

      // Step 3: Grant approval
      await markApprovalCompleted(runDir, 'spec_review');

      // Step 4: Resume should now succeed
      const analysis2: ResumeState = await analyzeResumeState(runDir);
      expect(analysis2.canResume).toBe(true);
      expect(analysis2.pendingApprovals).not.toContain('spec_review');

      await expect(prepareResume(runDir)).resolves.toBeDefined();
    });

    it('should handle multiple approvals sequentially', async () => {
      await markApprovalRequired(runDir, 'prd_review');
      await markApprovalRequired(runDir, 'spec_review');
      await markApprovalRequired(runDir, 'code_review');
      await updateManifest(runDir, { status: 'paused' });

      // Block with 3 pending approvals
      let analysis = await analyzeResumeState(runDir);
      expect(analysis.pendingApprovals).toHaveLength(3);
      expect(analysis.canResume).toBe(false);

      // Approve one at a time
      await markApprovalCompleted(runDir, 'prd_review');
      analysis = await analyzeResumeState(runDir);
      expect(analysis.pendingApprovals).toHaveLength(2);
      expect(analysis.canResume).toBe(false);

      await markApprovalCompleted(runDir, 'spec_review');
      analysis = await analyzeResumeState(runDir);
      expect(analysis.pendingApprovals).toHaveLength(1);
      expect(analysis.canResume).toBe(false);

      await markApprovalCompleted(runDir, 'code_review');
      analysis = await analyzeResumeState(runDir);
      expect(analysis.pendingApprovals).toHaveLength(0);
      expect(analysis.canResume).toBe(true);
    });
  });

  describe('Scenario: Recoverable Error Resume', () => {
    it('should clear recoverable error and resume', async () => {
      // Step 1: Simulate rate limit failure
      await setLastStep(runDir, 'planning');
      await setLastError(runDir, 'code_generation', 'Rate limit exceeded: 429', true);
      await updateManifest(runDir, { status: 'paused' });

      // Step 2: Verify error is present
      const analysis1: ResumeState = await analyzeResumeState(runDir);
      expect(analysis1.lastError).toBeDefined();
      expect(analysis1.lastError?.recoverable).toBe(true);
      expect(analysis1.canResume).toBe(true);

      // Step 3: Prepare resume (should clear error)
      await prepareResume(runDir);

      // Step 4: Verify error was cleared
      const analysis2: ResumeState = await analyzeResumeState(runDir);
      expect(analysis2.lastError).toBeUndefined();
    });

    it('should not clear non-recoverable error', async () => {
      await setLastError(runDir, 'critical', 'Fatal agent failure', false);
      await updateManifest(runDir, { status: 'failed' });

      const analysis1: ResumeState = await analyzeResumeState(runDir);
      expect(analysis1.canResume).toBe(false);

      await expect(prepareResume(runDir)).rejects.toThrow();

      // Error should still be present
      const analysis2: ResumeState = await analyzeResumeState(runDir);
      expect(analysis2.lastError).toBeDefined();
      expect(analysis2.lastError?.recoverable).toBe(false);
    });
  });

  describe('Scenario: Queue Task Dependencies', () => {
    it('should resume with correct task ordering based on dependencies', async () => {
      // Create DAG: task-1 → task-2 → task-3
      //                    ↘ task-4 ↗
      const task1 = createExecutionTask('task-1', featureId, 'Base', 'code_generation');
      const task2 = createExecutionTask('task-2', featureId, 'Depends on 1', 'testing', {
        dependencyIds: ['task-1'],
      });
      const task3 = createExecutionTask('task-3', featureId, 'Depends on 2,4', 'deployment', {
        dependencyIds: ['task-2', 'task-4'],
      });
      const task4 = createExecutionTask('task-4', featureId, 'Depends on 1', 'review', {
        dependencyIds: ['task-1'],
      });

      await appendToQueue(runDir, [task1, task2, task3, task4]);

      // Complete task-1
      await updateTaskInQueue(runDir, 'task-1', { status: 'completed' });
      await setLastStep(runDir, 'task-1');

      // Crash before task-2 and task-4
      await updateManifest(runDir, { status: 'in_progress' });

      // Resume and verify task-2 or task-4 is next (both depend only on task-1)
      await prepareResume(runDir);
      const nextTask = await getNextTask(runDir);

      expect(nextTask).toBeDefined();
      expect(['task-2', 'task-4']).toContain(nextTask?.task_id);

      // task-3 should NOT be next (depends on task-2 AND task-4)
      expect(nextTask?.task_id).not.toBe('task-3');
    });
  });

  describe('Scenario: End-to-End Happy Path', () => {
    it('should complete full resume cycle successfully', async () => {
      // Step 1: Initialize execution
      const tasks = [
        createExecutionTask('prd', featureId, 'Generate PRD', 'documentation'),
        createExecutionTask('spec', featureId, 'Generate Spec', 'documentation', {
          dependencyIds: ['prd'],
        }),
        createExecutionTask('code', featureId, 'Generate Code', 'code_generation', {
          dependencyIds: ['spec'],
        }),
      ];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      // Step 2: Complete first task
      await updateTaskInQueue(runDir, 'prd', { status: 'completed' });
      await setLastStep(runDir, 'prd');
      await updateManifest(runDir, { status: 'in_progress' });

      // Step 3: Crash during second task
      await updateTaskInQueue(runDir, 'spec', { status: 'running' });
      await setCurrentStep(runDir, 'spec');
      await setLastError(runDir, 'spec', 'Network timeout', true);
      await updateManifest(runDir, { status: 'paused' });

      // Step 4: Analyze resume state
      let analysis = await analyzeResumeState(runDir);
      expect(analysis.canResume).toBe(true);
      expect(analysis.lastStep).toBe('prd');
      expect(analysis.currentStep).toBe('spec');
      expect(analysis.queueState.completed).toBe(1);
      expect(analysis.queueState.pending).toBe(1);

      // Step 5: Prepare resume
      await prepareResume(runDir);
      analysis = await analyzeResumeState(runDir);
      expect(analysis.lastError).toBeUndefined(); // Cleared

      // Step 6: Get next task (should be 'spec' for retry)
      const nextTask = await getNextTask(runDir);
      expect(nextTask?.task_id).toBe('spec');

      // Step 7: Complete remaining tasks
      await updateTaskInQueue(runDir, 'spec', { status: 'completed' });
      await updateTaskInQueue(runDir, 'code', { status: 'completed' });
      await updateManifest(runDir, { status: 'completed' });

      // Step 8: Final analysis shows completion
      analysis = await analyzeResumeState(runDir);
      expect(analysis.status).toBe('completed');
      expect(analysis.canResume).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ALREADY_COMPLETED',
        })
      );
    });
  });

  describe('Scenario: Concurrent Resume Prevention', () => {
    it('should prevent concurrent resume operations via locking', async () => {
      await setLastError(runDir, 'test', 'Error', true);
      await updateManifest(runDir, { status: 'paused' });

      // Attempt concurrent prepareResume
      const promise1 = prepareResume(runDir);
      const promise2 = prepareResume(runDir);

      // Both should succeed due to lock serialization
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Verify state is consistent
      const analysis: ResumeState = await analyzeResumeState(runDir);
      expect(analysis.lastError).toBeUndefined(); // Cleared exactly once
    });
  });
});
