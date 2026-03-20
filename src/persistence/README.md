# Persistence

File-system persistence for run state. Manages run directories, manifest I/O,
file locks, hash manifests, branch protection storage, and research task caching.

## Key Exports

From the barrel (`index.ts`):

### Lock Management

- `acquireLock` / `releaseLock` / `withLock` / `isLocked` — file-based locking with stale lock detection

### Manifest I/O

- `writeManifest` / `readManifest` / `updateManifest` — run manifest persistence
- `setLastStep` / `setCurrentStep` / `setLastError` / `clearLastError` — manifest state helpers
- `getRunState` / `markApprovalRequired` / `markApprovalCompleted` — run state queries

### Run Directory Lifecycle

- `createRunDirectory` / `getRunDirectoryPath` / `getSubdirectoryPath` — directory management
- `ensureSubdirectories` / `runDirectoryExists` / `listRunDirectories` — directory utilities
- `generateHashManifest` / `verifyRunDirectoryIntegrity` — integrity verification
- `registerCleanupHook` / `isEligibleForCleanup` — cleanup lifecycle

### Research Store

- `saveTask` / `loadTask` / `listTaskIds` / `findCachedTask` — research task caching
- `isCachedTaskFresh` — cache freshness check

### Hash Manifest

- `computeFileHash` / `createHashManifest` / `verifyHashManifest` — file integrity verification
- `saveHashManifest` / `loadHashManifest` — manifest persistence

## Structure

- `lockManager.ts` — file-based lock acquisition with stale detection
- `manifestManager.ts` — run manifest read/write/update
- `runLifecycle.ts` — run directory creation, path resolution, cleanup
- `researchStore.ts` — research task file storage and caching
- `hashManifest.ts` — file hash computation and verification
- `branchProtectionStore.ts` — branch protection report persistence

## Dependencies

Imports from: `core`, `utils`, `validation`

Depended on by: `cli`, `workflows`
