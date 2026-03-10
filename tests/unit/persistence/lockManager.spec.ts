import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { acquireLock, isLocked, releaseLock } from '../../../src/persistence/lockManager';

describe('lockManager', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-manager-test-'));
    runDir = path.join(tempDir, 'run');
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('replaces a stale lock before acquiring a new lock', async () => {
    const lockPath = path.join(runDir, 'run.lock');
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          hostname: 'stale-host',
          acquired_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          operation: 'stale-operation',
        },
        null,
        2
      ),
      'utf-8'
    );

    await acquireLock(runDir, { operation: 'fresh-operation' });

    const lockData = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as {
      pid: number;
      hostname: string;
      acquired_at: string;
      operation?: string;
    };

    expect(lockData.pid).toBe(process.pid);
    expect(lockData.operation).toBe('fresh-operation');
    expect(await isLocked(runDir)).toBe(true);

    await releaseLock(runDir);
  });

  it('retries until an existing live lock is released', async () => {
    const lockPath = path.join(runDir, 'run.lock');
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          hostname: os.hostname(),
          acquired_at: new Date().toISOString(),
          operation: 'existing-operation',
        },
        null,
        2
      ),
      'utf-8'
    );

    setTimeout(() => {
      void fs.rm(lockPath, { force: true });
    }, 50);

    await acquireLock(runDir, {
      timeout: 1000,
      pollInterval: 10,
      operation: 'retried-operation',
    });

    const lockData = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as {
      operation?: string;
    };

    expect(lockData.operation).toBe('retried-operation');

    await releaseLock(runDir);
  });
});
