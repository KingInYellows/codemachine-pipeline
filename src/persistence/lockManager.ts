import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { wrapError } from '../utils/errors.js';
import { isFileNotFound } from '../utils/safeJson.js';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

const LOCK_FILE_NAME = 'run.lock';
const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
const DEFAULT_POLL_INTERVAL = 100; // 100ms

// Export for testing (CDMCH-71)
export const STALE_LOCK_THRESHOLD_MS = 300000; // 5 minutes - sufficient for long operations while still recovering from crashes

// ============================================================================
// Internal helpers
// ============================================================================

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
 * Check if a process exists (Unix-like systems only).
 * Uses POSIX signal 0 as a sentinel — kill(pid, 0) does not send a signal
 * but checks process existence (POSIX.1-2017, §2.4).
 *
 * Returns:
 * - 'running' if the process exists (kill succeeds or fails with EPERM).
 * - 'stopped' if the process does not exist (ESRCH).
 * - 'unknown' on Windows, where process existence cannot be checked this way.
 */
function isProcessRunning(pid: number): 'running' | 'stopped' | 'unknown' {
  if (process.platform === 'win32') return 'unknown';
  try {
    process.kill(pid, 0);
    return 'running';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return 'stopped';
      if (code === 'EPERM') return 'running'; // process exists but we can't signal it
    }
    throw wrapError(error, `check if lock process ${pid} exists`);
  }
}

/**
 * Read and validate lock file contents. Returns the typed lock data or null
 * when the file is missing or has an unexpected format.
 * Re-throws errors that are not ENOENT (e.g. permission errors).
 */
async function readLockFile(lockPath: string): Promise<LockFile | null> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    return isLockFilePayload(parsed) ? parsed : null;
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
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
    const lockData = await readLockFile(lockPath);
    if (!lockData) {
      return true;
    }
    return isLockDataStale(lockData);
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Acquire an exclusive lock on a run directory
 *
 * Uses file-based locking with stale lock detection.
 * Lock file contains process metadata for debugging.
 *
 * @param runDir - Run directory path
 * @param options - Lock acquisition options
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
    try {
      const lockData: LockFile = {
        pid: process.pid,
        hostname: hostname(),
        acquired_at: new Date().toISOString(),
        operation,
      };
      await writeFile(lockPath, JSON.stringify(lockData, null, 2), {
        flag: 'wx',
        encoding: 'utf-8',
      });
      return;
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw wrapError(error, `acquire lock for ${runDir}`);
      }

      if (await isLockStale(lockPath)) {
        await removeStaleLock(lockPath);
        continue;
      }

      await sleep(pollInterval);
    }
  }

  throw new Error(
    `Failed to acquire lock for ${runDir} within ${timeout}ms. Another process may be modifying this run directory.`
  );
}

/**
 * Release a lock on a run directory
 *
 * @param runDir - Run directory path
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
 * @param runDir - Run directory path
 * @returns True if locked, false otherwise
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
 * @param runDir - Run directory path
 * @param fn - Function to execute
 * @param options - Lock options
 * @returns Result of function execution
 */
export async function withLock<T>(
  runDir: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  await acquireLock(runDir, options);

  try {
    return await fn();
  } finally {
    await releaseLock(runDir);
  }
}
