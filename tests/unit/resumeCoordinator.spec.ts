import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  analyzeResumeState,
  prepareResume,
  formatResumeAnalysis,
  validateQueueSnapshot,
  getResumableTasks,
  type QueueSnapshotMetadata,
} from '../../src/workflows/resumeCoordinator';
import { setLastError, setLastStep, markApprovalRequired, type RunManifest } from '../../src/persistence/manifestManager';
import { createRunDirectory, generateHashManifest } from '../../src/persistence/runLifecycle';
import {
  initializeQueue,
  appendToQueue,
  createQueueSnapshot,
  updateTaskInQueue,
} from '../../src/workflows/queue/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';

describe('ResumeCoordinator', () => {
  let testDir: string;
  let runDir: string;
  const featureId = 'test-feature-001';
  type ResumeState = Awaited<ReturnType<typeof analyzeResumeState>>;
  const runAnalysis = (options?: Parameters<typeof analyzeResumeState>[1]): Promise<ResumeState> =>
    analyzeResumeState(runDir, options);

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-coordinator-test-'));

    // Create run directory
    runDir = await createRunDirectory(testDir, featureId, {
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
      title: 'Test Feature',
    });

    // Initialize queue
    await initializeQueue(runDir, featureId);
  });

  afterEach(async () => {
    // Cleanup test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('analyzeResumeState', () => {
    it('should analyze pending run successfully', async () => {
      const analysis = await runAnalysis();

      expect(analysis.canResume).toBe(true);
      expect(analysis.featureId).toBe(featureId);
      expect(analysis.status).toBe('pending');
      expect(analysis.pendingApprovals).toHaveLength(0);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'NOT_STARTED',
          severity: 'info',
        })
      );
    });

    it('should detect completed run', async () => {
      // Manually update manifest to completed status
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as RunManifest;
      manifest.status = 'completed';
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      const analysis = await runAnalysis();

      expect(analysis.canResume).toBe(false);
      expect(analysis.status).toBe('completed');
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ALREADY_COMPLETED',
          severity: 'info',
        })
      );
    });

    it('should detect paused run with recoverable error', async () => {
      await setLastError(runDir, 'code_generation', 'Rate limit exceeded', true);
      await setLastStep(runDir, 'planning');

      const analysis = await runAnalysis();

      expect(analysis.canResume).toBe(true);
      expect(analysis.status).toBe('paused');
      expect(analysis.lastStep).toBe('planning');
      expect(analysis.lastError).toBeDefined();
      expect(analysis.lastError?.recoverable).toBe(true);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PAUSED',
          severity: 'info',
        })
      );
    });

    it('should block resume for non-recoverable error', async () => {
      await setLastError(runDir, 'code_generation', 'Critical agent failure', false);

      const analysis = await runAnalysis();

      expect(analysis.canResume).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'NON_RECOVERABLE_ERROR',
          severity: 'blocker',
        })
      );
    });

    it('should block resume for pending approvals', async () => {
      await markApprovalRequired(runDir, 'spec_review');
      await markApprovalRequired(runDir, 'code_review');

      const analysis = await runAnalysis();

      expect(analysis.canResume).toBe(false);
      expect(analysis.pendingApprovals).toEqual(['spec_review', 'code_review']);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'APPROVALS_PENDING',
          severity: 'blocker',
        })
      );
    });

    it('should classify rate limit errors correctly', async () => {
      await setLastError(runDir, 'agent_execution', 'Rate limit exceeded: 429', true);

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ERROR_RATE_LIMIT',
        })
      );
    });

    it('should classify network errors correctly', async () => {
      await setLastError(runDir, 'api_call', 'Network timeout: ECONNREFUSED', true);

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ERROR_NETWORK',
        })
      );
    });

    it('should classify validation errors correctly', async () => {
      await setLastError(runDir, 'spec_generation', 'Validation failed: invalid schema', true);

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ERROR_VALIDATION',
        })
      );
    });

    it('should classify git errors correctly', async () => {
      await setLastError(runDir, 'commit', 'Git merge conflict in src/app.ts', true);

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ERROR_GIT',
        })
      );
    });

    it('should handle queue state correctly', async () => {
      // Add some tasks to queue
      const tasks = [
        createExecutionTask('task-1', featureId, 'Generate code', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Run tests', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      const analysis = await runAnalysis();

      expect(analysis.queueState.pending).toBe(2);
      expect(analysis.queueState.completed).toBe(0);
      expect(analysis.queueState.failed).toBe(0);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_HAS_PENDING',
        })
      );
    });

    it('should block resume when queue validation fails', async () => {
      const tasks = [createExecutionTask('task-1', featureId, 'Generate code', 'code_generation')];
      await appendToQueue(runDir, tasks);

      const queuePath = path.join(runDir, 'queue', 'queue.jsonl');
      await fs.appendFile(queuePath, '\n{invalid json}\n', 'utf-8');

      const analysis = await runAnalysis();

      expect(analysis.queueValidation?.valid).toBe(false);
      expect(analysis.canResume).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_CORRUPTED',
          severity: 'blocker',
        })
      );
    });

    it('should handle missing hash manifest gracefully', async () => {
      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_NO_MANIFEST',
          severity: 'warning',
        })
      );
    });

    it('should verify hash manifest integrity when present', async () => {
      // Create test artifact
      const artifactPath = path.join(runDir, 'artifacts', 'test.txt');
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, 'test content', 'utf-8');

      // Generate hash manifest
      await generateHashManifest(runDir, ['artifacts/test.txt']);

      const analysis = await runAnalysis();

      expect(analysis.integrityCheck).toBeDefined();
      expect(analysis.integrityCheck?.valid).toBe(true);
      expect(analysis.integrityCheck?.passed.length).toBeGreaterThan(0);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_OK',
          severity: 'info',
        })
      );
    });

    it('should detect hash integrity failures', async () => {
      // Create artifact and generate hash
      const artifactPath = path.join(runDir, 'artifacts', 'test.txt');
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, 'original content', 'utf-8');
      await generateHashManifest(runDir, ['artifacts/test.txt']);

      // Modify artifact after hash generation
      await fs.writeFile(artifactPath, 'modified content', 'utf-8');

      const analysis = await runAnalysis();

      expect(analysis.integrityCheck).toBeDefined();
      expect(analysis.integrityCheck?.valid).toBe(false);
      expect(analysis.integrityCheck?.failed.length).toBeGreaterThan(0);
      expect(analysis.canResume).toBe(false);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_HASH_MISMATCH',
          severity: 'blocker',
        })
      );
    });

    it('should allow force resume with integrity warnings', async () => {
      // Create corrupted state
      const artifactPath = path.join(runDir, 'artifacts', 'test.txt');
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, 'original', 'utf-8');
      await generateHashManifest(runDir, ['artifacts/test.txt']);
      await fs.writeFile(artifactPath, 'modified', 'utf-8');

      const analysis = await runAnalysis({ force: true });

      expect(analysis.canResume).toBe(true);
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INTEGRITY_HASH_MISMATCH',
          severity: 'warning', // Downgraded from blocker
        })
      );
    });

    it('should skip hash verification when requested', async () => {
      const analysis = await runAnalysis({ skipHashVerification: true });

      expect(analysis.integrityCheck).toBeUndefined();
      expect(analysis.diagnostics).not.toContainEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^INTEGRITY_/) as unknown as string,
        })
      );
    });

    it('should generate helpful recommendations for blockers', async () => {
      await markApprovalRequired(runDir, 'spec_review');

      const analysis = await runAnalysis();

      expect(analysis.recommendations.some((rec) => rec.includes('Resume is blocked'))).toBe(true);
      expect(
        analysis.recommendations.some((rec) =>
          rec.includes('Complete pending approvals: spec_review')
        )
      ).toBe(true);
      expect(analysis.recommendations.some((rec) => rec.includes('resume_playbook.md'))).toBe(true);
    });

    it('should provide recovery hints for rate limit errors', async () => {
      await setLastError(runDir, 'api', 'Rate limit exceeded', true);

      const analysis = await runAnalysis();

      expect(
        analysis.recommendations.some((rec) => rec.includes('Wait for rate limit reset'))
      ).toBe(true);
    });

    it('should provide recovery hints for network errors', async () => {
      await setLastError(runDir, 'fetch', 'Network timeout', true);

      const analysis = await runAnalysis();

      expect(
        analysis.recommendations.some((rec) => rec.includes('Check network connectivity'))
      ).toBe(true);
    });
  });

  describe('prepareResume', () => {
    it('should prepare resume successfully for valid state', async () => {
      await setLastError(runDir, 'generation', 'Temporary failure', true);
      await setLastStep(runDir, 'planning');

      const analysis = await prepareResume(runDir);

      expect(analysis.canResume).toBe(true);
      expect(analysis.lastStep).toBe('planning');
    });

    it('should throw error when resume is blocked', async () => {
      await markApprovalRequired(runDir, 'spec_review');

      await expect(prepareResume(runDir)).rejects.toThrow(/Cannot resume/);
    });

    it('should allow force resume when blocked', async () => {
      await markApprovalRequired(runDir, 'spec_review');

      const analysis = await prepareResume(runDir, { force: true });

      expect(analysis.canResume).toBe(true);
    });

    it('should clear recoverable errors during preparation', async () => {
      await setLastError(runDir, 'test', 'Recoverable error', true);

      await prepareResume(runDir);

      // Re-analyze to check if error was cleared
      const analysis = await runAnalysis();
      expect(analysis.lastError).toBeUndefined();
    });

    it('should not clear non-recoverable errors', async () => {
      await setLastError(runDir, 'critical', 'Fatal error', false);

      await expect(prepareResume(runDir)).rejects.toThrow();
    });
  });

  describe('formatResumeAnalysis', () => {
    it('should format basic analysis output', async () => {
      const analysis = await runAnalysis();
      const formatted = formatResumeAnalysis(analysis);

      expect(formatted).toContain(`Feature: ${featureId}`);
      expect(formatted).toContain('Status: pending');
      expect(formatted).toContain('Queue State:');
      expect(formatted).toContain('Pending:   0');
    });

    it('should format diagnostics with icons', async () => {
      await setLastError(runDir, 'test', 'Test error', true);
      await markApprovalRequired(runDir, 'review');

      const analysis = await runAnalysis();
      const formatted = formatResumeAnalysis(analysis);

      expect(formatted).toContain('🚫'); // Blocker icon
      expect(formatted).toContain('⚠️'); // Warning icon
      expect(formatted).toContain('Diagnostics:');
    });

    it('should include integrity check results', async () => {
      const artifactPath = path.join(runDir, 'artifacts', 'test.txt');
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, 'content', 'utf-8');
      await generateHashManifest(runDir, ['artifacts/test.txt']);

      const analysis = await runAnalysis();
      const formatted = formatResumeAnalysis(analysis);

      expect(formatted).toContain('Integrity Check:');
      expect(formatted).toContain('✓ Passed:');
    });

    it('should show recommendations section', async () => {
      const analysis = await runAnalysis();
      const formatted = formatResumeAnalysis(analysis);

      expect(formatted).toContain('Recommendations:');
      expect(formatted).toContain('Resume is safe to proceed');
    });

    it('should show last step information', async () => {
      await setLastStep(runDir, 'code_generation');

      const analysis = await runAnalysis();
      const formatted = formatResumeAnalysis(analysis);

      expect(formatted).toContain('Last Completed Step: code_generation');
    });
  });

  describe('validateQueueSnapshot', () => {
    it('should validate valid queue snapshot', async () => {
      // Create snapshot
      const tasks = [createExecutionTask('task-1', featureId, 'Task 1', 'code_generation')];
      await appendToQueue(runDir, tasks);
      await createQueueSnapshot(runDir);

      const snapshotRaw = await fs.readFile(
        path.join(runDir, 'queue', 'queue_snapshot.json'),
        'utf-8'
      );
      const snapshotData = JSON.parse(snapshotRaw) as {
        tasks: Record<string, unknown>;
        checksum: string;
        timestamp: string;
        schemaVersion?: string;
        schema_version?: string;
        snapshotSeq?: number;
        counts?: unknown;
        dependencyGraph?: Record<string, string[]>;
        dependency_graph?: Record<string, string[]>;
      };

      // Build QueueSnapshotMetadata from the actual snapshot file
      // Works for both V1 (schema_version: '1.0.0') and V2 (schemaVersion: '2.0.0') formats
      const snapshot: QueueSnapshotMetadata = {
        taskCount: Object.keys(snapshotData.tasks).length,
        checksum: snapshotData.checksum,
        timestamp: snapshotData.timestamp,
        queueFile: 'queue.jsonl',
      };

      const isValid = await validateQueueSnapshot(runDir, snapshot);
      expect(isValid).toBe(true);
    });
  });

  describe('getResumableTasks', () => {
    it('should prioritize running, pending, then retryable tasks', async () => {
      const tasks = [
        createExecutionTask('task-1', featureId, 'Task 1', 'code_generation'),
        createExecutionTask('task-2', featureId, 'Task 2', 'documentation'),
        createExecutionTask('task-3', featureId, 'Task 3', 'testing'),
      ];
      await appendToQueue(runDir, tasks);

      await updateTaskInQueue(runDir, 'task-1', {
        status: 'running',
        started_at: new Date().toISOString(),
      });

      await updateTaskInQueue(runDir, 'task-3', {
        status: 'failed',
        last_error: {
          message: 'Network blip',
          timestamp: new Date().toISOString(),
          recoverable: true,
        },
      });

      const resumable = await getResumableTasks(runDir);
      expect(resumable.map((task) => task.task_id)).toEqual(['task-1', 'task-2', 'task-3']);
    });
  });

  describe('edge cases', () => {
    it('should handle empty queue state', async () => {
      const analysis = await runAnalysis();

      expect(analysis.queueState.pending).toBe(0);
      expect(analysis.queueState.completed).toBe(0);
      expect(analysis.queueState.failed).toBe(0);
    });

    it('should handle multiple concurrent blockers', async () => {
      await markApprovalRequired(runDir, 'spec_review');
      await markApprovalRequired(runDir, 'code_review');
      await setLastError(runDir, 'fatal', 'Non-recoverable', false);

      const analysis = await runAnalysis();

      const blockers = analysis.diagnostics.filter((d) => d.severity === 'blocker');
      expect(blockers.length).toBeGreaterThanOrEqual(2);
      expect(analysis.canResume).toBe(false);
    });

    it('should handle unexpected interrupt scenario', async () => {
      // Simulate crash by setting status to in_progress without current_step
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as RunManifest;
      manifest.status = 'in_progress';
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      const analysis = await runAnalysis();

      expect(analysis.status).toBe('in_progress');
      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'UNEXPECTED_INTERRUPT',
          severity: 'warning',
        })
      );
    });

    it('should handle missing queue directory configuration', async () => {
      // Corrupt manifest by removing queue_dir
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as RunManifest;
      manifest.queue.queue_dir = '';
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'QUEUE_DIR_MISSING',
          severity: 'error',
        })
      );
    });

    it('should handle unknown error classification', async () => {
      await setLastError(runDir, 'mystery', 'Some unknown error occurred', true);

      const analysis = await runAnalysis();

      expect(analysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ERROR_UNKNOWN',
        })
      );
    });
  });

  describe('concurrent access', () => {
    it('should handle lock acquisition during analysis', async () => {
      // Analysis should not require lock (read-only)
      const promise1 = runAnalysis();
      const promise2 = runAnalysis();

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.featureId).toBe(featureId);
      expect(result2.featureId).toBe(featureId);
    });

    it('should serialize prepareResume calls with locks', async () => {
      await setLastError(runDir, 'test', 'Recoverable', true);

      // These should not conflict due to locking
      const promise1 = prepareResume(runDir);
      const promise2 = prepareResume(runDir);

      await expect(Promise.all([promise1, promise2])).resolves.toBeDefined();
    });
  });
});
