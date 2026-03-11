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

// Research store exports
export {
  getResearchDirectory,
  getTasksDirectory,
  getTaskFilePath,
  getTasksLogPath,
  ensureResearchDirectories,
  saveTask,
  loadTask,
  appendTaskLog,
  listTaskIds,
  findCachedTask,
  isCachedTaskFresh,
} from './researchStore.js';

// Hash manifest exports
export {
  computeFileHash,
  createFileHashRecord,
  createHashManifest,
  updateHashManifest,
  removeFromHashManifest,
  verifyHashManifest,
  verifyFileHash,
  saveHashManifest,
  loadHashManifest,
  getManifestFilePaths,
  getManifestTotalSize,
  filterManifest,
  type FileHashRecord,
  type HashManifest,
  type VerificationResult,
  type HashManifestResult,
  type FileHashResult,
} from './hashManifest.js';
