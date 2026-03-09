/**
 * Process existence utility.
 *
 * Provides a platform-aware check for whether an OS process is still running.
 * Extracted from lockManager (CDMCH-183) so the logic can be reused and
 * independently tested.
 */

import { wrapError } from './errors.js';

/**
 * Result of a process-existence probe.
 *
 * - `'running'`  — the process exists (kill(pid, 0) succeeded or returned EPERM).
 * - `'stopped'`  — the process does not exist (ESRCH).
 * - `'unknown'`  — existence cannot be determined (e.g. Windows, where signal 0
 *                   does not behave per POSIX).
 */
export type ProcessStatus = 'running' | 'stopped' | 'unknown';

/**
 * Check whether an OS process is alive.
 *
 * Uses POSIX signal 0 as a sentinel — `kill(pid, 0)` does not deliver a signal
 * but checks process existence (POSIX.1-2017, §2.4).
 *
 * On Windows the check is not available and the function returns `'unknown'`.
 *
 * @param pid - The process ID to probe.
 * @returns `'running'`, `'stopped'`, or `'unknown'`.
 * @throws Re-throws unexpected OS errors (anything other than ESRCH / EPERM).
 */
export function isProcessRunning(pid: number): ProcessStatus {
  if (process.platform === 'win32') return 'unknown';

  try {
    process.kill(pid, 0);
    return 'running';
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return 'stopped';
      if (code === 'EPERM') return 'running'; // process exists but we lack permission
    }
    throw wrapError(error, `check if process ${pid} exists`);
  }
}
