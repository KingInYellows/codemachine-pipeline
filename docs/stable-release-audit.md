# Tech Debt Audit Report - Stable Release v1.0.0

**Date:** 2026-01-27
**Auditor:** Claude Code
**Project:** ai-feature-pipeline
**Version:** 0.1.0 (pre-alpha) -> 1.0.0 (target)

---

## Executive Summary

This document provides a comprehensive tech debt audit for the ai-feature-pipeline project, identifying risks that must be addressed before the stable v1.0.0 release. The audit focuses on **data safety**, **crash recovery**, and **operator experience** for reliable homelab operation.

### Key Findings

| Priority | Count | Category |
|----------|-------|----------|
| P0 (Critical) | 4 | Data safety, silent failures |
| P1 (High) | 4 | Reliability, test coverage |
| P2 (Medium) | 7 | Operator experience, observability |

**Linear Project:** [Stable Release](https://linear.app/kinginyellow/project/stable-release-27784972aa31)

---

## P0 - Critical Issues (Data Safety)

### 1. No fsync After Critical Writes

**Issue:** [CDMCH-67](https://linear.app/kinginyellow/issue/CDMCH-67)

**Evidence:**
```typescript
// src/workflows/queueStore.ts:488
await fs.writeFile(manifestPath, content, 'utf-8');
// No fsync! Power loss here = corruption

// src/persistence/runDirectoryManager.ts:639
await fs.writeFile(tempPath, content, 'utf-8');
await fs.rename(tempPath, manifestPath);
// Atomic rename is good, but fsync needed before rename
```

**Impact:** Power loss during write corrupts queue state. User loses task progress.

**Mitigation:**
```typescript
import { open } from 'node:fs/promises';

async function writeFileWithFsync(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync(); // Force to disk
  } finally {
    await handle.close();
  }
}
```

---

### 2. Silent Catch Blocks

**Issue:** [CDMCH-68](https://linear.app/kinginyellow/issue/CDMCH-68)

**Evidence:**
```bash
$ grep -rn "catch {" src/ | wc -l
52
```

Examples found:
```typescript
// src/cli/commands/doctor.ts:102
} catch {
  telemetryReady = false;  // Error silently swallowed
}

// src/workflows/queueMigration.ts:133
} catch {
  // Skip corrupted lines - but no logging!
}

// src/persistence/runDirectoryManager.ts:415
} catch {
  // Unreadable lock file treated as stale - silent
  return true;
}
```

**Impact:** Errors are silently swallowed, making production debugging impossible.

**Mitigation:** Each catch block must either:
1. Log the error: `logger.warn('Operation failed', { error })`
2. Re-throw if unrecoverable
3. Add explicit comment explaining why silence is intentional

---

### 3. No Queue Integrity Verification on Startup

**Issue:** [CDMCH-69](https://linear.app/kinginyellow/issue/CDMCH-69)

**Evidence:**
```typescript
// src/workflows/queueStore.ts:519-527
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
  const v2Cache = await getV2IndexCache(runDir);
  const tasks = new Map<string, ExecutionTask>();
  // No integrity check! Just loads whatever is there.
  for (const [taskId, taskData] of v2Cache.state.tasks) {
    tasks.set(taskId, toExecutionTask(taskData));
  }
  return tasks;
}
```

The queue manifest has a `queue_checksum` field (line 76) but it's only checked during validation, not on load.

**Impact:** Corrupted queue data is silently used, leading to:
- Duplicate task execution
- Skipped tasks
- Infinite retry loops

**Mitigation:** Add integrity verification in `loadQueue()`:
```typescript
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
  const v2Cache = await getV2IndexCache(runDir);

  // Verify snapshot integrity
  const integrityResult = await verifyQueueIntegrity(v2Cache.queueDir);
  if (!integrityResult.valid) {
    throw new QueueCorruptionError(
      `Queue integrity check failed: ${integrityResult.errors.join(', ')}. ` +
      `Run 'ai-feature queue repair ${v2Cache.featureId}' to attempt recovery.`
    );
  }
  // ... rest of function
}
```

---

### 4. Queue Migration Rollback Untested

**Issue:** [CDMCH-70](https://linear.app/kinginyellow/issue/CDMCH-70)

**Evidence:**
```typescript
// src/workflows/queueMigration.ts:347-386
export async function rollbackMigration(queueDir: string): Promise<boolean> {
  // This function exists but has NO test coverage
  // No integration test exercises this code path
}
```

No test file found for migration rollback:
```bash
$ find tests -name "*migration*"
# (no results)
```

**Impact:** If migration fails mid-way, recovery is untested. Data loss possible.

**Mitigation:** Add integration test:
```typescript
describe('queueMigration rollback', () => {
  it('should restore V1 state after failed migration', async () => {
    // 1. Create V1 queue with known tasks
    // 2. Corrupt V2 snapshot mid-migration
    // 3. Call rollbackMigration()
    // 4. Verify V1 backup restored
    // 5. Verify all tasks intact
  });
});
```

---

## P1 - High Priority Issues (Reliability)

### 5. 5-Minute Stale Lock Threshold

**Issue:** [CDMCH-71](https://linear.app/kinginyellow/issue/CDMCH-71)

**Evidence:**
```typescript
// src/persistence/runDirectoryManager.ts:199
const STALE_LOCK_THRESHOLD = 300000; // 5 minutes
```

**Impact:** After crash, user waits 5 minutes before they can resume work.

**Recommendation:** Reduce to 60 seconds for homelab use.

---

### 6. CLI Commands Not Tested

**Issue:** [CDMCH-72](https://linear.app/kinginyellow/issue/CDMCH-72)

**Evidence:**
```typescript
// vitest.config.ts (coverage exclusion)
exclude: ['src/cli/**']
```

**Impact:** CLI crashes on edge cases go undetected.

---

### 7. Memory Cache Not Invalidated on Migration

**Issue:** [CDMCH-73](https://linear.app/kinginyellow/issue/CDMCH-73)

**Evidence:**
```typescript
// src/workflows/queueStore.ts:179
const v2IndexCache = new Map<string, V2IndexCache>();

// src/workflows/queueMigration.ts:446
// After migration, cache should be invalidated but isn't:
const result = await migrateV1ToV2(queueDir, featureId);
// Missing: invalidateV2Cache(queueDir);
```

**Impact:** Stale V1 data served from cache after migration.

---

### 8. No Crash Recovery E2E Test

**Issue:** [CDMCH-74](https://linear.app/kinginyellow/issue/CDMCH-74)

**Evidence:** No E2E test validates the core FR-3 (Resumability) requirement.

---

## P2 - Medium Priority Issues (Operator Experience)

### 9. No Log Rotation

**Issue:** [CDMCH-75](https://linear.app/kinginyellow/issue/CDMCH-75)

**Evidence:**
```typescript
// src/telemetry/logger.ts:451
await fs.appendFile(this.logFilePath, `${line}\n`, 'utf-8');
// No size check, no rotation
```

**Impact:** Disk fills up over time.

---

### 10. Sync File Reads in Config Loader

**Issue:** [CDMCH-76](https://linear.app/kinginyellow/issue/CDMCH-76)

**Evidence:**
```typescript
// src/core/config/RepoConfig.ts:327
if (!fs.existsSync(configPath)) {
// src/core/config/RepoConfig.ts:341
const rawContent = fs.readFileSync(configPath, 'utf-8');
```

**Impact:** Hangs on NFS mounts.

---

### 11-15. Documentation & Release Prep

- [CDMCH-77](https://linear.app/kinginyellow/issue/CDMCH-77): Add health check command
- [CDMCH-78](https://linear.app/kinginyellow/issue/CDMCH-78): Create homelab quickstart guide
- [CDMCH-79](https://linear.app/kinginyellow/issue/CDMCH-79): Run full readiness checklist
- [CDMCH-80](https://linear.app/kinginyellow/issue/CDMCH-80): Update CHANGELOG and tag v1.0.0
- [CDMCH-81](https://linear.app/kinginyellow/issue/CDMCH-81): Add Docker smoke test to CI

---

## Codebase Health Metrics

### Current State

| Metric | Value | Target |
|--------|-------|--------|
| Test Files | 52+ | - |
| Tests Passing | 82+ | 100% |
| Test Coverage | ~60-70% | 65% |
| CLI Coverage | 0% (excluded) | 70% |
| Silent Catches | 52 | 0 |
| npm Vulnerabilities | 0 | 0 |
| Runtime Dependencies | 5 | - |

### Dependencies (Minimal)

```json
{
  "@oclif/core": "^4.x",
  "picomatch": "^4.x",
  "undici": "^7.x",
  "zod": "^3.x"
}
```

No known vulnerabilities as of audit date.

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Queue corruption on power loss | Medium | Critical | Add fsync (CDMCH-67) |
| Silent error masking bugs | High | High | Audit catches (CDMCH-68) |
| Corrupted queue loaded silently | Low | Critical | Add integrity check (CDMCH-69) |
| Migration failure loses data | Low | Critical | Test rollback (CDMCH-70) |
| Disk fills with logs | Medium | Medium | Add rotation (CDMCH-75) |

---

## Recommendations

### Immediate (Before v1.0.0)

1. **Fix all P0 issues** - These are data safety critical
2. **Fix P1 issues** - Reliability for daily use
3. **Document recovery procedures** - Troubleshooting guide exists, ensure it covers all scenarios

### Post-v1.0.0

1. Consider adding SQLite-based queue for better crash consistency
2. Add metrics/Prometheus endpoint for monitoring
3. Consider structured error codes for programmatic handling

---

## Appendix: Files Audited

| File | Lines | Issues Found |
|------|-------|--------------|
| `src/workflows/queueStore.ts` | 1090 | 3 (fsync, cache, integrity) |
| `src/persistence/runDirectoryManager.ts` | 1048 | 2 (fsync, lock threshold) |
| `src/telemetry/logger.ts` | 647 | 1 (rotation) |
| `src/workflows/queueMigration.ts` | 449 | 2 (cache invalidation, silent catches) |
| `src/core/config/RepoConfig.ts` | 744 | 1 (sync reads) |
| `src/cli/commands/doctor.ts` | 700+ | 10+ (silent catches) |

---

**Document Control**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-27 | Claude Code | Initial audit |
