import { AsyncLocalStorage } from 'node:async_hooks';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { wrapError } from '../utils/errors.js';
import { isProcessRunning } from '../utils/processExists.js';
import { isFileNotFound } from '../utils/safeJson.js';

/**
 * Lock file metadata
 */
interface LockFile {
  /** Process ID that acquired the lock */
  pid: number;
  /** Hostname where process is running */
  hostname: string;
  /** When the lock was acquired */
  acquired_at: string;
  /** Lock purpose or operation */
  operation?: string;
}

type LockFileReadResult =
  | { kind: 'valid'; lockData: LockFile }
  | { kind: 'missing' }
  | { kind: 'invalid' };

/**
 * Lock acquisition options
 */
export interface LockOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Poll interval in milliseconds */
  pollInterval?: number;
  /** Lock operation description */
  operation?: string;
}

const LOCK_FILE_NAME = 'run.lock';
const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
const DEFAULT_POLL_INTERVAL = 100; // 100ms

// Export for testing (CDMCH-71)
export const STALE_LOCK_THRESHOLD_MS = 300000; // 5 minutes - sufficient for long operations while still recovering from crashes

/**
 * In-memory per-directory promise chain to serialize same-process callers.
 *
 * The filesystem lock (wx flag) handles cross-process exclusion, but under
 * same-process Promise.all concurrency the unlink/writeFile race between
 * release and the next acquire can lose updates. This map ensures callers
 * targeting the same runDir execute sequentially within a single process.
 */
const inProcessQueue = new Map<string, Promise<void>>();
const lockContextStorage = new AsyncLocalStorage<Map<string, number>>();

/**
 * Reset in-process queue state. For testing only.
 * @internal
 */
export function _resetInProcessQueue(): void {
  inProcessQueue.clear();
}

function getLockKey(runDir: string): string {
  return resolve(runDir);
}

function createInProcessQueueTimeoutError(runDir: string, timeout: number): Error {
  return new Error(
    `Failed to acquire in-process lock turn for ${runDir} within ${timeout}ms. ` +
      `Another concurrent operation in this process is holding the lock.`
  );
}

function createFsLockTimeoutError(runDir: string, timeout: number): Error {
  return new Error(
    `Failed to acquire lock for ${runDir} within ${timeout}ms. ` +
      `Another process may be modifying this run directory.`
  );
}

async function waitForInProcessTurn(
  prev: Promise<void>,
  runDir: string,
  timeout: number,
  startTime: number
): Promise<void> {
  const remaining = timeout - (Date.now() - startTime);
  if (remaining <= 0) {
    throw createInProcessQueueTimeoutError(runDir, timeout);
  }

  await new Promise<void>((resolveWait, rejectWait) => {
    const timeoutId = setTimeout(() => {
      rejectWait(createInProcessQueueTimeoutError(runDir, timeout));
    }, remaining);

    prev.then(
      () => {
        clearTimeout(timeoutId);
        resolveWait();
      },
      (error) => {
        clearTimeout(timeoutId);
        rejectWait(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Type guard ensuring value matches LockFile shape
 */
function isLockFilePayload(value: unknown): value is LockFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { pid?: unknown; hostname?: unknown; acquired_at?: unknown };
  return (
    typeof candidate.pid === 'number' &&
    typeof candidate.hostname === 'string' &&
    typeof candidate.acquired_at === 'string'
  );
}

/**
 * Read and validate lock file contents.
 * Missing files are reported separately from invalid/corrupt contents so
 * stale-lock handling can distinguish TOCTOU gaps from corrupted lockfiles.
 */
async function readLockFile(lockPath: string): Promise<LockFileReadResult> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isLockFilePayload(parsed)) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', lockData: parsed };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { kind: 'missing' };
    }
    if (error instanceof SyntaxError) {
      return { kind: 'invalid' };
    }
    throw error;
  }
}

/**
 * Pure staleness check given already-loaded lock data.
 */
function isLockDataStale(lockData: LockFile): boolean {
  if (Date.now() - new Date(lockData.acquired_at).getTime() > STALE_LOCK_THRESHOLD_MS) {
    return true;
  }
  return isProcessRunning(lockData.pid) === 'stopped';
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const lockState = await readLockFile(lockPath);
    if (lockState.kind === 'missing') {
      // Lock file was removed between the EEXIST check and here — not stale,
      // just gone. Returning false causes the caller to sleep and retry
      // tryWriteLockFile, which will succeed (or another call wins first).
      // Returning true here would cause removeStaleLock to delete a valid lock
      // acquired by a concurrent caller (TOCTOU race).
      return false;
    }
    if (lockState.kind === 'invalid') {
      return true;
    }
    return isLockDataStale(lockState.lockData);
  } catch {
    // Unexpected error reading lock file — treat as stale so callers can recover
    return true;
  }
}

/**
 * Remove a stale lock file, tolerating concurrent removal (ENOENT).
 */
async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw wrapError(error, 'remove stale lock');
    }
    // ENOENT: already removed by another process — that's fine
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check whether an error is an EEXIST filesystem error.
 */
function isFileExists(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

/**
 * Attempt to create the lock file with exclusive mode (`wx`).
 *
 * Returns `true` if the file was created (lock acquired).
 * Returns `false` if the file already exists (EEXIST).
 * Re-throws any other filesystem error.
 */
async function tryWriteLockFile(lockPath: string, lockData: LockFile): Promise<boolean> {
  try {
    await writeFile(lockPath, JSON.stringify(lockData, null, 2), {
      flag: 'wx',
      encoding: 'utf-8',
    });
    return true;
  } catch (error: unknown) {
    if (isFileExists(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Handle an existing lock file: remove it if stale, otherwise wait.
 *
 * Returns `true` if a stale lock was removed (caller should retry immediately).
 * Returns `false` if the lock is held by a live process (caller should poll).
 */
async function handleLockConflict(lockPath: string): Promise<boolean> {
  if (await isLockStale(lockPath)) {
    await removeStaleLock(lockPath);
    return true;
  }
  return false;
}

/**
 * Acquire an exclusive lock on a run directory
 *
 * Uses file-based locking with stale lock detection.
 * Lock file contains process metadata for debugging.
 *
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(runDir: string, options: LockOptions = {}): Promise<void> {
  const {
    timeout = DEFAULT_LOCK_TIMEOUT,
    pollInterval = DEFAULT_POLL_INTERVAL,
    operation = 'unknown',
  } = options;

  const lockPath = join(runDir, LOCK_FILE_NAME);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const lockData: LockFile = {
      pid: process.pid,
      hostname: hostname(),
      acquired_at: new Date().toISOString(),
      operation,
    };

    let acquired: boolean;
    try {
      acquired = await tryWriteLockFile(lockPath, lockData);
    } catch (error: unknown) {
      throw wrapError(error, `acquire lock for ${runDir}`);
    }

    if (acquired) {
      return;
    }

    const staleLockRemoved = await handleLockConflict(lockPath);
    if (staleLockRemoved) {
      continue;
    }

    await sleep(pollInterval);
  }

  throw createFsLockTimeoutError(runDir, timeout);
}

/**
 * Release a lock on a run directory
 *
 */
export async function releaseLock(runDir: string): Promise<void> {
  const lockPath = join(runDir, LOCK_FILE_NAME);

  try {
    await unlink(lockPath);
  } catch (error) {
    // Ignore errors if lock file doesn't exist
    if (isFileNotFound(error)) {
      return;
    }
    throw wrapError(error, `release lock for ${runDir}`);
  }
}

/**
 * Check if a run directory is currently locked
 *
 */
export async function isLocked(runDir: string): Promise<boolean> {
  const lockPath = join(runDir, LOCK_FILE_NAME);

  try {
    await access(lockPath);
    const isStale = await isLockStale(lockPath);
    return !isStale;
  } catch (error) {
    // If lock file doesn't exist (ENOENT), not locked
    if (isFileNotFound(error)) {
      return false;
    }
    throw wrapError(error, `check lock status for ${runDir}`);
  }
}

/**
 * Execute a function while holding a lock
 *
 */
export async function withLock<T>(
  runDir: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const lockKey = getLockKey(runDir);
  const activeContext = lockContextStorage.getStore();
  const activeDepth = activeContext?.get(lockKey);

  if (activeContext && activeDepth) {
    activeContext.set(lockKey, activeDepth + 1);
    try {
      return await fn();
    } finally {
      activeContext.set(lockKey, activeDepth);
    }
  }

  // Serialize same-process callers via promise chain before touching the
  // filesystem lock, preventing the unlink/writeFile('wx') TOCTOU race.
  const prev = inProcessQueue.get(lockKey) ?? Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  inProcessQueue.set(lockKey, current);

  const timeout = options?.timeout ?? DEFAULT_LOCK_TIMEOUT;
  const startTime = Date.now();

  try {
    // Wait for the previous same-process caller to finish
    await waitForInProcessTurn(prev, runDir, timeout, startTime);

    const remainingTimeout = timeout - (Date.now() - startTime);
    if (remainingTimeout <= 0) {
      throw createInProcessQueueTimeoutError(runDir, timeout);
    }

    const lockContext = new Map(activeContext ?? []);
    lockContext.set(lockKey, 1);

    await acquireLock(runDir, { ...options, timeout: remainingTimeout });
    try {
      return await lockContextStorage.run(lockContext, fn);
    } finally {
      await releaseLock(runDir);
    }
  } finally {
    resolveCurrent();
    // Clean up the map entry if we're the last in the chain
    if (inProcessQueue.get(lockKey) === current) {
      inProcessQueue.delete(lockKey);
    }
  }
}
