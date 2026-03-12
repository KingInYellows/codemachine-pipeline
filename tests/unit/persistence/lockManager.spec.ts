import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, vi } from 'vitest';
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

  afterEach(() => {
    vi.resetModules();
    vi.unmock('node:fs/promises');
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

  it('treats corrupted lock files as stale and replaces them', async () => {
    const lockPath = path.join(runDir, 'run.lock');
    await fs.writeFile(
      lockPath,
      '{"pid":"not-a-number","hostname":"bad-host","acquired_at":"broken"}',
      'utf-8'
    );

    await acquireLock(runDir, { operation: 'replacement-operation' });

    const lockData = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as {
      pid: number;
      operation?: string;
    };

    expect(lockData.pid).toBe(process.pid);
    expect(lockData.operation).toBe('replacement-operation');

    await releaseLock(runDir);
  });

  it('does not delete a replacement lock when stale-check sees an ENOENT gap', async () => {
    vi.resetModules();

    let lockOwner: 'process-A' | 'process-C' | null = 'process-A';
    const enoentError = (): NodeJS.ErrnoException => {
      const error = new Error('missing lock') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      return error;
    };
    const eexistError = (): NodeJS.ErrnoException => {
      const error = new Error('lock exists') as NodeJS.ErrnoException;
      error.code = 'EEXIST';
      return error;
    };

    const writeFile = vi.fn(
      async (_path: string, _content: string, options?: { flag?: string }) => {
        if (options?.flag === 'wx') {
          if (lockOwner !== null) {
            throw eexistError();
          }
          lockOwner = 'process-A';
        }
      }
    );
    const readFile = vi.fn(async () => {
      lockOwner = 'process-C';
      throw enoentError();
    });
    const unlink = vi.fn(async () => {
      lockOwner = null;
    });
    vi.doMock('node:fs/promises', () => ({
      readFile,
      unlink,
      writeFile,
    }));

    const { acquireLock: acquireMockedLock } = await import('../../../src/persistence/lockManager');

    await expect(
      acquireMockedLock(runDir, {
        timeout: 20,
        pollInterval: 1,
        operation: 'process-B',
      })
    ).rejects.toThrow();

    expect(readFile).toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(lockOwner).toBe('process-C');
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
