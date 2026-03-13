import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  acquireLock,
  releaseLock,
  isLocked,
  withLock,
  _resetInProcessQueue,
} from '../../../src/persistence/lockManager';
import {
  readManifest,
  writeManifest,
  updateManifest,
  setLastStep,
  setLastError,
  clearLastError,
  getRunState,
  markApprovalRequired,
  markApprovalCompleted,
} from '../../../src/persistence/manifestManager';
import {
  createRunDirectory,
  getRunDirectoryPath,
  generateHashManifest,
  verifyRunDirectoryIntegrity,
  registerCleanupHook,
  isEligibleForCleanup,
  runDirectoryExists,
  listRunDirectories,
  type CreateRunDirectoryOptions,
} from '../../../src/persistence/runLifecycle';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    open: vi.fn(actual.open),
  };
});

/**
 * Unit tests for Run Directory Manager
 *
 * Tests cover:
 * - Directory creation and structure
 * - Manifest persistence and updates
 * - Concurrent access via file locking
 * - State tracking (last_step, last_error)
 * - Hash manifest integrity
 * - Cleanup hooks
 */

describe('Run Directory Manager', () => {
  let testBaseDir: string;
  let testFeatureId: string;

  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepipe-test-'));
    testFeatureId = `01JFTEST${Date.now()}`;
  });

  afterEach(async () => {
    _resetInProcessQueue();
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Directory Creation', () => {
    it('should create run directory with standard structure', async () => {
      const options: CreateRunDirectoryOptions = {
        title: 'Test Feature',
        source: 'manual:test',
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
      };

      const runDir = await createRunDirectory(testBaseDir, testFeatureId, options);

      const stats = await fs.stat(runDir);
      expect(stats.isDirectory()).toBe(true);

      const subdirs = ['artifacts', 'logs', 'queue', 'telemetry', 'approvals', 'context'];
      for (const subdir of subdirs) {
        const subdirPath = path.join(runDir, subdir);
        const subdirStats = await fs.stat(subdirPath);
        expect(subdirStats.isDirectory()).toBe(true);
      }

      const manifestPath = path.join(runDir, 'manifest.json');
      const manifestStats = await fs.stat(manifestPath);
      expect(manifestStats.isFile()).toBe(true);
    });

    it('should create manifest with correct initial state', async () => {
      const options: CreateRunDirectoryOptions = {
        title: 'Test Feature',
        source: 'linear:PROJ-123',
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
        metadata: { priority: 'high' },
      };

      const runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
      const manifest = await readManifest(runDir);

      expect(manifest.schema_version).toBe('1.0.0');
      expect(manifest.feature_id).toBe(testFeatureId);
      expect(manifest.title).toBe('Test Feature');
      expect(manifest.source).toBe('linear:PROJ-123');
      expect(manifest.status).toBe('pending');
      expect(manifest.execution.completed_steps).toBe(0);
      expect(manifest.approvals.pending).toEqual([]);
      expect(manifest.approvals.completed).toEqual([]);
      expect(manifest.metadata?.priority).toBe('high');
    });

    it('should check if run directory exists', async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };

      expect(await runDirectoryExists(testBaseDir, testFeatureId)).toBe(false);

      await createRunDirectory(testBaseDir, testFeatureId, options);

      expect(await runDirectoryExists(testBaseDir, testFeatureId)).toBe(true);
    });

    it('should list all run directories', async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };

      const featureId1 = `01JFTEST${Date.now()}A`;
      const featureId2 = `01JFTEST${Date.now()}B`;

      await createRunDirectory(testBaseDir, featureId1, options);
      await createRunDirectory(testBaseDir, featureId2, options);

      const runDirs = await listRunDirectories(testBaseDir);

      expect(runDirs).toContain(featureId1);
      expect(runDirs).toContain(featureId2);
      expect(runDirs.length).toBeGreaterThanOrEqual(2);
    });

    it('should seed sqlite indexes when requested', async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
        seedSqlite: true,
      };

      const runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
      const manifest = await readManifest(runDir);

      expect(manifest.queue.sqlite_index).toBeDefined();
      expect(manifest.metadata?.sqlite_seeded).toBe(true);

      const sqliteIndex = manifest.queue.sqlite_index;
      if (!sqliteIndex) {
        throw new Error('Expected manifest.queue.sqlite_index to be defined');
      }
      expect(sqliteIndex.database).toBe('sqlite/run_queue.db');
      expect(sqliteIndex.wal).toBe('sqlite/run_queue.db-wal');
      expect(sqliteIndex.shm).toBe('sqlite/run_queue.db-shm');

      await expect(fs.stat(path.join(runDir, sqliteIndex.database))).resolves.toBeDefined();
      await expect(fs.stat(path.join(runDir, sqliteIndex.wal))).resolves.toBeDefined();
      await expect(fs.stat(path.join(runDir, sqliteIndex.shm))).resolves.toBeDefined();
    });
  });

  describe('Manifest Management', () => {
    let runDir: string;

    beforeEach(async () => {
      const options: CreateRunDirectoryOptions = {
        title: 'Test Feature',
        repoUrl: 'https://github.com/test/repo.git',
      };
      runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
    });

    it('should update manifest fields', async () => {
      await updateManifest(runDir, {
        status: 'in_progress',
      });

      const manifest = await readManifest(runDir);
      expect(manifest.status).toBe('in_progress');
      expect(manifest.timestamps.updated_at).toBeDefined();
    });

    it('should set last step', async () => {
      await setLastStep(runDir, 'prd_generation');

      const manifest = await readManifest(runDir);
      expect(manifest.execution.last_step).toBe('prd_generation');
      expect(manifest.execution.current_step).toBeUndefined();
    });

    it('should set and clear last error', async () => {
      await setLastError(runDir, 'code_generation', 'Agent timeout', true);

      let manifest = await readManifest(runDir);
      expect(manifest.status).toBe('paused');
      expect(manifest.execution.last_error).toBeDefined();
      expect(manifest.execution.last_error?.step).toBe('code_generation');
      expect(manifest.execution.last_error?.message).toBe('Agent timeout');
      expect(manifest.execution.last_error?.recoverable).toBe(true);

      await clearLastError(runDir);

      manifest = await readManifest(runDir);
      expect(manifest.execution.last_error).toBeUndefined();
    });

    it('should set status to failed for unrecoverable errors', async () => {
      await setLastError(runDir, 'deployment', 'Critical failure', false);

      const manifest = await readManifest(runDir);
      expect(manifest.status).toBe('failed');
      expect(manifest.execution.last_error?.recoverable).toBe(false);
    });

    it('should get run state snapshot', async () => {
      await updateManifest(runDir, {
        status: 'in_progress',
        execution: {
          last_step: 'spec_generation',
          current_step: 'code_generation',
          completed_steps: 3,
          total_steps: 10,
        },
      });

      const state = await getRunState(runDir);

      expect(state.status).toBe('in_progress');
      expect(state.last_step).toBe('spec_generation');
      expect(state.current_step).toBe('code_generation');
      expect(state.completed_steps).toBe(3);
      expect(state.total_steps).toBe(10);
    });

    it('should track approvals', async () => {
      await markApprovalRequired(runDir, 'prd');
      await markApprovalRequired(runDir, 'plan');

      let manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).toContain('prd');
      expect(manifest.approvals.pending).toContain('plan');

      await markApprovalCompleted(runDir, 'prd');

      manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).not.toContain('prd');
      expect(manifest.approvals.completed).toContain('prd');
      expect(manifest.approvals.pending).toContain('plan');
    });

    it('should not duplicate pending approvals', async () => {
      await markApprovalRequired(runDir, 'prd');
      await markApprovalRequired(runDir, 'prd');

      const manifest = await readManifest(runDir);
      expect(manifest.approvals.pending.filter((a) => a === 'prd').length).toBe(1);
    });

    it('should not duplicate completed approvals', async () => {
      await markApprovalRequired(runDir, 'spec');
      await markApprovalCompleted(runDir, 'spec');
      await markApprovalCompleted(runDir, 'spec');

      const manifest = await readManifest(runDir);
      expect(manifest.approvals.completed.filter((a) => a === 'spec').length).toBe(1);
    });
  });

  describe('File Locking', () => {
    let runDir: string;

    beforeEach(async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };
      runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
    });

    it('should acquire and release lock', async () => {
      expect(await isLocked(runDir)).toBe(false);

      await acquireLock(runDir, { operation: 'test' });
      expect(await isLocked(runDir)).toBe(true);

      await releaseLock(runDir);
      expect(await isLocked(runDir)).toBe(false);
    });

    it('should fail to acquire lock when already locked', async () => {
      await acquireLock(runDir);

      await expect(acquireLock(runDir, { timeout: 500 })).rejects.toThrow(/Failed to acquire lock/);

      await releaseLock(runDir);
    });

    it('should execute function with lock', async () => {
      let executed = false;

      await withLock(runDir, async () => {
        expect(await isLocked(runDir)).toBe(true);
        executed = true;
      });

      expect(executed).toBe(true);
      expect(await isLocked(runDir)).toBe(false);
    });

    it('should allow reentrant withLock calls in the same async chain', async () => {
      let nestedExecuted = false;

      await withLock(runDir, async () => {
        await withLock(runDir, async () => {
          nestedExecuted = true;
          expect(await isLocked(runDir)).toBe(true);
        });

        expect(await isLocked(runDir)).toBe(true);
      });

      expect(nestedExecuted).toBe(true);
      expect(await isLocked(runDir)).toBe(false);
    });

    it('should serialize equivalent runDir strings within the same process', async () => {
      const phases: string[] = [];

      const first = withLock(runDir, async () => {
        phases.push('first-start');
        await new Promise((resolve) => setTimeout(resolve, 50));
        phases.push('first-end');
      });

      const second = withLock(`${runDir}${path.sep}`, async () => {
        phases.push('second-start');
      });

      await Promise.all([first, second]);

      expect(phases).toEqual(['first-start', 'first-end', 'second-start']);
    });

    it('should apply timeout while waiting for the in-process queue', async () => {
      let releaseHolder!: () => void;
      let markHolderEntered!: () => void;
      const holderEntered = new Promise<void>((resolve) => {
        markHolderEntered = resolve;
      });

      const holder = withLock(
        runDir,
        async () => {
          markHolderEntered();
          await new Promise<void>((resolve) => {
            releaseHolder = resolve;
          });
        },
        { timeout: 500 }
      );

      await holderEntered;

      await expect(
        withLock(path.join(runDir, '.'), async () => undefined, { timeout: 20 })
      ).rejects.toThrow(/Failed to acquire lock/);

      releaseHolder();
      await holder;
    });

    it('should release lock even if function throws', async () => {
      await expect(
        withLock(runDir, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(await isLocked(runDir)).toBe(false);
    });

    it('should handle concurrent lock attempts', async () => {
      const results: boolean[] = [];

      const process1 = (async () => {
        await acquireLock(runDir);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await releaseLock(runDir);
        results.push(true);
      })();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const process2 = (async () => {
        try {
          await acquireLock(runDir, { timeout: 1000 });
          await releaseLock(runDir);
          results.push(true);
        } catch {
          results.push(false);
        }
      })();

      await Promise.all([process1, process2]);

      expect(results).toEqual([true, true]);
    });
  });

  describe('Concurrent Manifest Updates', () => {
    let runDir: string;

    beforeEach(async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };
      runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
    });

    it('should handle concurrent updates without corruption', async () => {
      const updates = Array.from({ length: 10 }, (_, i) =>
        updateManifest(runDir, {
          metadata: { [`update_${i}`]: true },
        })
      );

      await Promise.all(updates);

      const manifest = await readManifest(runDir);

      expect(manifest.schema_version).toBe('1.0.0');

      const metadataKeys = Object.keys(manifest.metadata || {});
      expect(metadataKeys.length).toBeGreaterThan(0);
    });

    it('should maintain manifest integrity during parallel writes', async () => {
      await Promise.all([
        setLastStep(runDir, 'step_1'),
        markApprovalRequired(runDir, 'approval_1'),
        updateManifest(runDir, { status: 'in_progress' }),
      ]);

      const manifest = await readManifest(runDir);

      expect(manifest.schema_version).toBe('1.0.0');
      expect(manifest.feature_id).toBe(testFeatureId);

      const manifestJson = JSON.stringify(manifest);
      expect(() => JSON.parse(manifestJson)).not.toThrow();
    });

    it('should not clobber execution counters when updating last step', async () => {
      await updateManifest(runDir, (manifest) => ({
        execution: {
          ...manifest.execution,
          completed_steps: 5,
        },
      }));

      await Promise.all([
        setLastStep(runDir, 'plan_generation'),
        updateManifest(runDir, (manifest) => ({
          execution: {
            ...manifest.execution,
            completed_steps: manifest.execution.completed_steps + 1,
          },
        })),
      ]);

      const manifest = await readManifest(runDir);
      expect(manifest.execution.completed_steps).toBe(6);
      expect(manifest.execution.last_step).toBe('plan_generation');
    });
  });

  describe('Hash Manifest Integration', () => {
    let runDir: string;

    beforeEach(async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };
      runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
    });

    it('should generate hash manifest for artifacts', async () => {
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const specPath = path.join(runDir, 'artifacts', 'spec.md');

      await fs.writeFile(prdPath, '# PRD Content', 'utf-8');
      await fs.writeFile(specPath, '# Spec Content', 'utf-8');

      await generateHashManifest(runDir, ['artifacts/prd.md', 'artifacts/spec.md']);

      const manifest = await readManifest(runDir);
      expect(manifest.artifacts.hash_manifest).toBe('hash_manifest.json');

      const hashManifestPath = path.join(runDir, 'hash_manifest.json');
      const hashManifestStats = await fs.stat(hashManifestPath);
      expect(hashManifestStats.isFile()).toBe(true);
    });

    it('should verify run directory integrity', async () => {
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      await fs.writeFile(prdPath, '# Original Content', 'utf-8');

      await generateHashManifest(runDir, ['artifacts/prd.md']);

      let result = await verifyRunDirectoryIntegrity(runDir);
      expect(result.valid).toBe(true);
      expect(result.passed).toContain(path.join(runDir, 'artifacts', 'prd.md'));

      await fs.writeFile(prdPath, '# Modified Content', 'utf-8');

      result = await verifyRunDirectoryIntegrity(runDir);
      expect(result.valid).toBe(false);
      expect(result.failed.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup Hooks', () => {
    let runDir: string;

    beforeEach(async () => {
      const options: CreateRunDirectoryOptions = {
        repoUrl: 'https://github.com/test/repo.git',
      };
      runDir = await createRunDirectory(testBaseDir, testFeatureId, options);
    });

    it('should register cleanup hook', async () => {
      const hook = {
        eligibility: {
          min_age_days: 30,
          required_status: ['completed' as const],
        },
        actions: {
          remove_logs: true,
          archive_artifacts: true,
        },
      };

      await registerCleanupHook(runDir, hook);

      const manifest = await readManifest(runDir);
      expect(manifest.metadata?.cleanup_hook).toEqual(hook);
    });

    it('should check cleanup eligibility based on age', async () => {
      const hook = {
        eligibility: {
          min_age_days: 0,
          required_status: ['completed' as const],
        },
        actions: {
          remove_logs: true,
        },
      };

      await registerCleanupHook(runDir, hook);
      await updateManifest(runDir, { status: 'completed' });

      const eligible = await isEligibleForCleanup(runDir);
      expect(eligible).toBe(true);
    });

    it('should reject cleanup if status does not match', async () => {
      const hook = {
        eligibility: {
          min_age_days: 0,
          required_status: ['completed' as const],
        },
        actions: {
          remove_logs: true,
        },
      };

      await registerCleanupHook(runDir, hook);
      await updateManifest(runDir, { status: 'in_progress' });

      const eligible = await isEligibleForCleanup(runDir);
      expect(eligible).toBe(false);
    });

    it('should reject cleanup if too recent', async () => {
      const hook = {
        eligibility: {
          min_age_days: 365,
          required_status: ['completed' as const],
        },
        actions: {
          remove_logs: true,
        },
      };

      await registerCleanupHook(runDir, hook);
      await updateManifest(runDir, { status: 'completed' });

      const eligible = await isEligibleForCleanup(runDir);
      expect(eligible).toBe(false);
    });
  });

  describe('Stale lock threshold (CDMCH-71)', () => {
    it('should be 5 minutes (300000ms)', async () => {
      // Import and test the constant directly instead of source inspection
      const { STALE_LOCK_THRESHOLD_MS } = await import('../../../src/persistence/lockManager.js');
      expect(STALE_LOCK_THRESHOLD_MS).toBe(300000);
    });
  });

  describe('Manifest write durability (CDMCH-67)', () => {
    it('should call handle.sync() when writing manifest', async () => {
      const runDir = getRunDirectoryPath(testBaseDir, testFeatureId);
      await fs.mkdir(runDir, { recursive: true });

      const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const openMock = vi.mocked(fs.open);
      let syncSpy = vi.spyOn({ sync: async () => undefined }, 'sync');
      openMock.mockImplementation(async (...args) => {
        const handle = await actualFs.open(...args);
        syncSpy.mockRestore();
        syncSpy = vi.spyOn(handle, 'sync');
        return handle;
      });

      try {
        await writeManifest(runDir, {
          schema_version: '1.0.0',
          feature_id: testFeatureId,
          repo: { url: 'https://example.com', default_branch: 'main' },
          status: 'pending',
          execution: { completed_steps: 0 },
          timestamps: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          approvals: { pending: [], completed: [] },
          queue: { queue_dir: 'queue', pending_count: 0, completed_count: 0, failed_count: 0 },
          artifacts: {},
          telemetry: { logs_dir: 'logs' },
        });

        // Verify handle.sync() was called for durability
        expect(syncSpy).toHaveBeenCalled();
      } finally {
        openMock.mockImplementation(actualFs.open);
        syncSpy.mockRestore();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing manifest gracefully', async () => {
      const runDir = getRunDirectoryPath(testBaseDir, testFeatureId);
      await fs.mkdir(runDir, { recursive: true });

      await expect(readManifest(runDir)).rejects.toThrow(/Failed to read manifest/);
    });

    it('should handle corrupted manifest JSON', async () => {
      const runDir = getRunDirectoryPath(testBaseDir, testFeatureId);
      await fs.mkdir(runDir, { recursive: true });

      const manifestPath = path.join(runDir, 'manifest.json');
      await fs.writeFile(manifestPath, 'invalid json{', 'utf-8');

      await expect(readManifest(runDir)).rejects.toThrow();
    });

    it('should handle empty run directory list', async () => {
      const emptyBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-'));

      try {
        const runDirs = await listRunDirectories(emptyBaseDir);
        expect(runDirs).toEqual([]);
      } finally {
        await fs.rm(emptyBaseDir, { recursive: true, force: true });
      }
    });
  });
});
