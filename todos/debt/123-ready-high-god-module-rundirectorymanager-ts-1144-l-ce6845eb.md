# God Module runDirectoryManager ts 1144 Lines 30 Exports

**ID:** 123
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** medium
**Confidence:** 0.95
**Scanner:** architecture-scanner

## Affected Files

- `src/persistence/runDirectoryManager.ts` lines 1-1144

## Description

runDirectoryManager.ts is 1144 lines with 30 exported functions and interfaces, well above both the 500-line and 20-export thresholds. It conflates at least four responsibilities: directory lifecycle (createRunDirectory, listRunDirectories), manifest I/O (readManifest, writeManifest, updateManifest), lock management (acquireLock, releaseLock, withLock, isLocked), and step/state tracking (setCurrentStep, setLastError, markApprovalRequired).

## Suggested Remediation

Split into at minimum three modules: (1) src/persistence/lockManager.ts for lock acquire/release/withLock, (2) src/persistence/manifestManager.ts for read/write/update manifest operations, (3) src/persistence/runLifecycle.ts for create/list/exists/cleanup directory operations. Keep runDirectoryManager.ts as a thin barrel re-exporting for backward compatibility.
