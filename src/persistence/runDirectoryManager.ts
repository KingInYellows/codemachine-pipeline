/**
 * Run Directory Manager — backward-compatibility barrel
 *
 * This module previously contained all run directory logic in a single 1144-line
 * god module. It has been refactored into three focused modules:
 *
 *   - lockManager.ts      — file-based locking (acquireLock, releaseLock, withLock, isLocked)
 *   - manifestManager.ts  — manifest I/O and state helpers (readManifest, writeManifest, updateManifest, …)
 *   - runLifecycle.ts     — directory lifecycle (createRunDirectory, listRunDirectories, …)
 *
 * All public symbols are re-exported here so existing import paths continue to work
 * without change. New code should import directly from the focused modules.
 */

// Lock management
export {
  acquireLock,
  releaseLock,
  isLocked,
  withLock,
  STALE_LOCK_THRESHOLD_MS,
  type LockOptions,
} from './lockManager.js';

// Manifest I/O and state tracking
export {
  writeManifest,
  readManifest,
  updateManifest,
  setLastStep,
  setCurrentStep,
  setLastError,
  clearLastError,
  getRunState,
  markApprovalRequired,
  markApprovalCompleted,
  type RunManifest,
  type ManifestUpdate,
} from './manifestManager.js';

// Directory lifecycle, path resolution, hash manifest integration, cleanup hooks
export {
  getRunDirectoryPath,
  getSubdirectoryPath,
  createRunDirectory,
  ensureSubdirectories,
  runDirectoryExists,
  listRunDirectories,
  generateHashManifest,
  verifyRunDirectoryIntegrity,
  registerCleanupHook,
  isEligibleForCleanup,
  type CreateRunDirectoryOptions,
  type CleanupHook,
} from './runLifecycle.js';
