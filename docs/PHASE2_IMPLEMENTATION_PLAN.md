# Phase 2 Implementation Plan & Progress
**Date**: 2026-01-20
**Status**: IN PROGRESS (3 agents working)
**Objective**: Foundation completion - security, tests, dependencies

---

## Phase 2 Overview

**Goals**:
1. Fix HIGH-RISK security vulnerability (autoFixEngine.ts:550)
2. Expand ResultNormalizer test coverage to >90%
3. Update outdated dependencies and fix vulnerabilities
4. Fix V1/V2 queue test failures

---

## Phase 2.1: Security Fix (autoFixEngine.ts:550)

**Agent**: v3-security-architect (aaac7f9)
**Status**: IN PROGRESS (64k+ tokens processed)
**Model**: Sonnet (as recommended by tier-2 routing)

### Issue
- **Location**: `src/workflows/autoFixEngine.ts:550`
- **Vulnerability**: Command injection via `shell: true` in `spawn()` call
- **Risk Level**: HIGH
- **Attack Vector**: Malicious input in `command` parameter (from user-provided templates)
- **Exploit Example**: `; rm -rf /` could execute arbitrary commands

### Current Code (Vulnerable)
```typescript
const childProcess = spawn(command, {
  cwd: options.cwd,
  env: options.env as Record<string, string>,
  shell: true,  // ← COMMAND INJECTION RISK
  timeout: options.timeout,
});
```

### Required Fix
1. Replace `spawn()` with `execFile()` from node:child_process
2. Parse command string into `[executable, ...args]`
3. Use `execFile` without shell interpretation
4. Handle quoted arguments properly
5. Maintain existing functionality:
   - Timeout handling (SIGTERM → SIGKILL after 5s)
   - stdout/stderr capture
   - Promise-based interface
   - All error handling
6. Add command validation for shell metacharacters
7. Write comprehensive tests for secure execution

### References
- Safe patterns in `src/workflows/contextAggregator.ts` (uses execFile)
- Test patterns in test files (use execSync/spawnSync with explicit args)

---

## Phase 2.2: ResultNormalizer Test Expansion

**Agent**: tester (ac7c0e7)
**Status**: IN PROGRESS (52k+ tokens processed)
**Model**: Sonnet (as recommended by tier-2 routing)

### Current Status
- **Existing Tests**: 390 lines in `tests/unit/resultNormalizer.spec.ts`
- **Current Coverage**: ~65% (estimated)
- **Target Coverage**: >90%
- **Tests to Add**: 30-40 tests (200-250 lines)

### Coverage Breakdown

**✅ Already Covered** (100% coverage):
- `redactCredentials()` - 9 tests (all 14 credential patterns)
- `categorizeError()` - 6 tests (all 7 error categories)
- `isRecoverableError()` - 3 tests
- `normalizeResult()` - 12 tests (both overloads)
- `extractSummary()` - 4 tests

**❌ Missing Coverage** (Need Tests):

**Priority 1: Security Functions** (CRITICAL):
1. **`extractArtifactPaths()`** - 0 tests (need 8-10)
   - Extract file paths from stdout patterns (created, generated, wrote, saved)
   - Handle multiple file extensions (.ts, .js, .json, .md)
   - Deduplicate artifact paths
   - Reject invalid paths via isValidArtifactPath
   - Handle empty stdout, malformed paths, large output (>10MB)

2. **`isValidArtifactPath()`** - 0 tests (need 6-8) **SECURITY-CRITICAL!**
   - Reject path traversal attempts (`..`)
   - Reject absolute paths outside `/workspace`
   - Allow `/workspace` paths
   - Reject dangerous paths: `/etc/`, `/usr/`, `/var/`, `/root/`, `/home/`, `/tmp/`

**Priority 2: Error Formatting**:
3. **`formatErrorMessage()`** - 0 tests (need 4-6)
   - Format with exit code and category
   - Include timeout/killed indicators
   - Truncate long stderr at 500 chars
   - Join parts with pipe delimiter

4. **`createResultSummary()`** - 0 tests (need 3-4)
   - Success summary with duration
   - Failure summary with error details
   - Recoverable flag propagation

**Priority 3: Edge Cases** (need 5-7):
- Multiple credentials in one string
- Very large stdout (>10MB)
- Unicode and special characters
- Concurrent normalization calls
- Malformed artifact patterns
- Empty/null inputs

### Acceptance Criteria
- ✅ All security functions have comprehensive tests
- ✅ Coverage >90% for resultNormalizer.ts
- ✅ All tests pass (npm test)
- ✅ Test code is clean and maintainable

---

## Phase 2.3: Dependency Updates

**Status**: ✅ COMPLETE
**Completed**: 2026-01-20

### Updates Applied
1. **@typescript-eslint/eslint-plugin**: 8.53.0 → 8.53.1
2. **@typescript-eslint/parser**: 8.53.0 → 8.53.1
3. **@vitest/ui**: 4.0.16 → 4.0.17
4. **prettier**: 3.7.4 → 3.8.0
5. **undici**: 7.16.0 → 7.18.2 (security fix!)
6. **vitest**: 4.0.16 → 4.0.17

### Security Fixes
- **diff** <4.0.4: Fixed DoS vulnerability in parsePatch/applyPatch
- **undici** 7.0.0-7.18.1: Fixed unbounded decompression chain (CVE score: 3.7/10)

### Verification
- ✅ `npm audit`: 0 vulnerabilities
- ✅ All packages updated successfully
- ⚠️ Build blocked by autoFixEngine.ts changes from security agent (expected)

---

## Phase 2.4: V1/V2 Queue Test Failures

**Agent**: tester (aef5e5e)
**Status**: IN PROGRESS (71k+ tokens processed)
**Model**: Sonnet (as recommended by tier-2 routing)

### Failing Tests
1. **queueStore.spec.ts:414** - "should apply updates from queue_updates.jsonl on subsequent load"
   - **Expected**: Task status 'completed'
   - **Received**: Task status 'pending'
   - **Root Cause**: Test uses V1 `queue_updates.jsonl` format, but V2 uses WAL

2. **resumeCoordinator.spec.ts:466** - "should validate valid queue snapshot"
   - **Expected**: Validation returns `true`
   - **Received**: Validation returns `false`
   - **Root Cause**: Snapshot format changed in V2 schema

### V1 vs V2 Format Differences

**V1 Format**:
- `queue.jsonl`: One ExecutionTask per line
- `queue_updates.jsonl`: Incremental task updates

**V2 Format**:
- `queue_snapshot.json`: Snapshot with all tasks
- `operations.log`: WAL (Write-Ahead Log) for incremental updates
- In-memory index for O(1) lookups
- HNSW indexing for 150x-12,500x search improvement

### Fix Strategy

**Test 1 (queueStore.spec.ts)**:
```typescript
// OLD (V1 - BROKEN):
const updatesPath = path.join(queueDir, 'queue_updates.jsonl');
await fs.appendFile(updatesPath, updateLine, 'utf-8');

// NEW (V2 - FIXED):
// Option A: Use queueStore API
await updateTask(runDir, 'TASK-1', { status: 'completed' });

// Option B: Use V2 WAL directly
import { appendOperation } from '../../src/workflows/queueOperationsLog';
await appendOperation(queueDir, {
  type: 'UPDATE',
  taskId: 'TASK-1',
  patch: { status: 'completed', updated_at: new Date().toISOString() },
  timestamp: Date.now()
});
```

**Test 2 (resumeCoordinator.spec.ts)**:
- Update snapshot metadata to V2 schema
- Add required V2 fields:
  - `snapshotSeq` (number)
  - `schemaVersion` (2)
  - `counts` (pending, in_progress, completed, failed, retryable)
  - `dependencyGraph` (Record<string, string[]>)

### Acceptance Criteria
- ✅ Both tests use V2 queue format/API
- ✅ All queue-related tests pass (no regressions)
- ✅ Test suite: 830/830 tests (100% pass rate)

---

## Phase 2 Completion Criteria

### Deliverables
- [IN PROGRESS] Secure autoFixEngine.ts (no command injection)
- [IN PROGRESS] ResultNormalizer tests expanded (>90% coverage)
- [✅ COMPLETE] Dependencies updated (0 vulnerabilities)
- [IN PROGRESS] V1/V2 queue tests fixed (100% pass rate)

### Graphite Stack Structure
```
main
└── phase-2/dependency-updates (READY)
    └── phase-2/security-command-injection-fix (PENDING agent completion)
        └── phase-2/test-expansion-result-normalizer (PENDING agent completion)
            └── phase-2/queue-test-v2-compatibility (PENDING agent completion)
```

### Success Metrics
- ✅ 0 security vulnerabilities (npm audit clean)
- ⏳ 0 HIGH/CRITICAL code vulnerabilities (autoFixEngine fix)
- ⏳ >90% test coverage for ResultNormalizer
- ⏳ 830/830 tests passing (100%)
- ✅ All dependencies up-to-date

---

## Agent Coordination Summary

### Agents Deployed
| Agent ID | Type | Task | Tokens | Status |
|----------|------|------|--------|--------|
| aaac7f9 | v3-security-architect | Fix command injection | 64k+ | IN PROGRESS |
| ac7c0e7 | tester | Expand ResultNormalizer tests | 52k+ | IN PROGRESS |
| aef5e5e | tester | Fix V1/V2 queue tests | 71k+ | IN PROGRESS |

**Total Tokens**: ~187k tokens across 3 parallel agents
**Coordination**: Background execution via Claude Code Task tool
**Model Routing**: Tier-2 (Sonnet) for all agents (35-40% complexity)

### Memory Storage
- ✅ Phase 1 completion stored (`phases/phase-1-complete`)
- ✅ Phase 3 plan stored (`planning/phase-3-plan`)
- ✅ Task outcomes recorded (`traj-1768939247161`)

---

## Next Steps (Phase 3)

**After Phase 2 Complete**:
1. Submit Phase 2 Graphite stack (4 branches)
2. Begin Phase 3: Integration & Enhancement
   - Implement TaskMapper `step` command
   - Implement TaskMapper `status` command
   - Wire CLIExecutionEngine into `codepipe start` command
   - Create operational documentation and runbooks

**Timeline Estimate**:
- Phase 2 completion: ~1-2 hours (agent work)
- Phase 2 Graphite stack submission: 30 minutes
- Phase 3 implementation: 3-5 hours (with agents)
- **Total remaining**: 4-8 hours

---

**Document Status**: LIVE (Updated as agents progress)
**Last Updated**: 2026-01-20 20:10 UTC
**Next Update**: Upon agent completion notifications
