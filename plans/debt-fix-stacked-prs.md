# Plan: Fix Remaining 37 Technical Debt Findings via Stacked PRs

## Overview

37 debt findings remain unfixed across 3 categories: **ai-patterns** (16),
**complexity** (19), and **architecture** (2). This plan organizes them into 6
stacked PRs ordered by dependency and risk — noise removal first (safest), then
utility extraction, architecture fixes, and complexity reduction last (riskiest).

## Stack Order (bottom → top)

```
PR 6  ← complexity: low-severity (170-171)
PR 5  ← complexity: medium-severity (156-169)
PR 4  ← complexity: high-severity (148-154)
PR 3  ← architecture fixes (138, 143)
PR 2  ← extract atomicWriteFile utility (200)
PR 1  ← AI-pattern noise removal (192-196, 198, 201-209)  ← merges first
```

---

## PR 1: `chore: remove remaining AI-pattern noise (findings 192-196, 198, 201-209)`

**Category:** ai-patterns | **Effort:** small | **Risk:** low
**Findings:** 192, 193, 194, 195, 196, 198, 201, 202, 203, 204, 205, 206, 207, 208, 209

### What

- **192**: Remove `// ===` and `// ---` section banners in queue module (6 files)
- **193**: Remove section banners in core/persistence/telemetry files (5 files)
- **194**: Remove boilerplate factory functions on adapter/telemetry classes (5 files)
- **195**: Remove symmetric before/after logger calls on adapters (3 files)
- **196**: Remove redundant step-numbering comments in CLI commands (6 files)
- **198**: Remove verbose JSDoc on interface fields in writeActionQueueTypes.ts
- **201**: Remove redundant "ensure directory exists" inline comments (4 files)
- **202**: Remove redundant "clean up temp file" comments (5 files)
- **203**: Remove obvious inline comments in contextRanking.ts
- **204**: Remove verbose redundant JSDoc param blocks in runDirectoryManager.ts
- **205**: Remove dead `implements FR` reference comments (6 files)
- **206**: Remove boilerplate error class constructors with identical super() (3 files)
- **207**: Remove narrating comments in approvalRegistry.ts
- **208**: Remove over-specified JSDoc on trivial private methods in LinearAdapter.ts
- **209**: Remove redundant inline comments on ENOENT catch blocks (2 files)

### Files touched (deduplicated)

```
src/adapters/github/GitHubAdapter.ts
src/adapters/github/branchProtection.ts
src/adapters/linear/LinearAdapter.ts
src/adapters/linear/LinearAdapterTypes.ts
src/cli/commands/init.ts
src/core/config/RepoConfig.ts
src/core/models/Feature.ts
src/persistence/runDirectoryManager.ts
src/telemetry/costTracker.ts
src/telemetry/metrics.ts
src/telemetry/rateLimitLedger.ts
src/telemetry/traces.ts
src/workflows/approvalRegistry.ts
src/workflows/branchManager.ts
src/workflows/branchProtectionReporter.ts
src/workflows/contextAggregator.ts
src/workflows/contextRanking.ts
src/workflows/planDiffer.ts
src/workflows/prdAuthoringEngine.ts
src/workflows/queueCompactionEngine.ts
src/workflows/queueMemoryIndex.ts
src/workflows/queueOperationsLog.ts
src/workflows/queueSnapshotManager.ts
src/workflows/queueStore.ts
src/workflows/queueTypes.ts
src/workflows/specComposer.ts
src/workflows/taskPlanner.ts
src/workflows/validationRegistry.ts
src/workflows/writeActionQueueTypes.ts
```

### Implementation

1. For each file, remove: `// ===...===` banners, `// --- Section ---` dividers,
   redundant JSDoc blocks, narrating comments, dead `implements` references,
   obvious inline comments, step-numbering comments
2. Remove boilerplate factory functions that just call `new ClassName()`
3. Remove symmetric before/after logger calls that add no diagnostic value
4. Simplify error class constructors where they just forward to `super()`
5. Run `npm run build && npm test` to verify no breakage

---

## PR 2: `refactor: extract shared atomicWriteFile utility (finding 200)`

**Category:** ai-patterns (duplication) | **Effort:** medium | **Risk:** low
**Findings:** 200

### What

Extract the duplicated write-temp-then-rename pattern from 7 files into a single
`atomicWriteFile()` utility in `src/utils/`.

### Files touched

```
src/utils/atomicWrite.ts                    (new)
src/persistence/runDirectoryManager.ts
src/workflows/queueStore.ts
src/workflows/approvalRegistry.ts
src/workflows/queueSnapshotManager.ts
src/workflows/validationRegistry.ts
src/telemetry/metrics.ts
```

### Implementation

1. Create `src/utils/atomicWrite.ts` with `atomicWriteFile(filePath, content)`:
   write to `${filePath}.tmp`, `fsync`, rename, cleanup on error
2. Replace all 7 inline implementations with calls to the shared utility
3. Add unit test in `src/utils/atomicWrite.test.ts`
4. Run `npm run build && npm test`

### Depends on

PR 1 (touches overlapping files: runDirectoryManager, queueStore, metrics,
approvalRegistry, queueSnapshotManager, validationRegistry)

---

## PR 3: `refactor: fix architecture layer violations (findings 138, 143)`

**Category:** architecture | **Effort:** small | **Risk:** low
**Findings:** 138, 143

### What

- **138**: Split branchProtectionReporter.ts — move persistence logic to
  `src/persistence/`, keep report generation in `src/workflows/`
- **143**: Move `validateCliPath` from `src/adapters/codemachine/types.ts` to
  `src/validation/` to decouple workflows from adapter internals

### Files touched

```
src/workflows/branchProtectionReporter.ts
src/persistence/branchProtectionPersistence.ts  (new)
src/adapters/codemachine/types.ts
src/validation/cliPathValidation.ts             (new)
src/workflows/codeMachineRunner.ts
```

### Implementation

1. Extract file read/write operations from branchProtectionReporter.ts into a new
   persistence module; update imports
2. Move `validateCliPath` to `src/validation/cliPathValidation.ts`; update imports
   in codeMachineRunner.ts and adapter
3. Verify no circular dependencies: `npm run deps:check`
4. Run `npm run build && npm test`

### Depends on

PR 1 (touches branchProtectionReporter.ts)

---

## PR 4: `fix: reduce complexity in high-severity functions (findings 148-154)`

**Category:** complexity | **Effort:** medium | **Risk:** medium
**Findings:** 148, 149, 150, 151, 152, 153, 154

### What

- **148**: Extract telemetry lifecycle + execution wiring from `resume.run()` (~280 lines)
- **149**: Extract nested diagnostic checks from `doctor.run()` (~158 lines)
- **150**: Extract artifact refresh logic from `refreshBranchProtectionArtifact`
- **151**: Reduce cyclomatic complexity in `evaluateCompliance`
- **152**: Deduplicate rate-limit loading in `loadIntegrationsStatus`
- **153**: Simplify `handleFailure` — 6 return paths → strategy pattern or early returns
- **154**: Simplify `executeWithFallback` — 6 throw paths → cleaner error flow

### Files touched

```
src/cli/commands/resume.ts
src/cli/commands/doctor.ts
src/cli/status/data.ts
src/adapters/github/branchProtection.ts
src/workflows/cliExecutionEngine.ts
src/adapters/agents/AgentAdapter.ts
```

### Implementation

1. For each god function: identify distinct concerns, extract private methods or
   helper functions, consolidate duplicate telemetry flush paths
2. For evaluateCompliance: break into sub-evaluators per compliance dimension
3. For handleFailure/executeWithFallback: consolidate error paths, use early returns
4. Run `npm run build && npm test`

### Depends on

PR 1 (touches branchProtection.ts), PR 3 (touches branchProtection reporter layer)

---

## PR 5: `fix: reduce complexity in medium-severity functions (findings 156-169)`

**Category:** complexity | **Effort:** medium | **Risk:** medium
**Findings:** 156, 157, 158, 161, 163, 164, 165, 166, 168, 169

### What

- **156**: Simplify `checkRunStatus` switch statement in resumeCoordinator.ts
- **157**: Break up `composeSpecification` god function (~180 lines) in specComposer.ts
- **158**: Break up `generateSpecMarkdown` (~170 lines) in specComposer.ts
- **161**: Replace string-based exit code in `determineExitCode` (doctor.ts)
- **163**: Simplify `validatePrerequisites` in cliExecutionEngine.ts
- **164**: Simplify `recordSpecApproval` 120-line withLock call in specComposer.ts
- **165**: Reduce 4-level nesting in init.ts telemetry initialization
- **166**: Simplify `analyzeResumeState` orchestrating 7 sub-checks
- **168**: Simplify `executeValidationWithAutofix` (~170 lines) in autoFixEngine.ts
- **169**: Simplify `isLockStale` file-read-parse-validate chain in runDirectoryManager.ts

### Files touched

```
src/workflows/resumeCoordinator.ts
src/workflows/specComposer.ts
src/cli/commands/doctor.ts
src/workflows/cliExecutionEngine.ts
src/cli/commands/init.ts
src/workflows/autoFixEngine.ts
src/persistence/runDirectoryManager.ts
```

### Implementation

1. Extract sub-functions from each god function
2. Replace string-based exit code with enum
3. Flatten deep nesting with early returns or extracted helpers
4. Run `npm run build && npm test`

### Depends on

PR 4 (touches doctor.ts, cliExecutionEngine.ts)

---

## PR 6: `fix: simplify low-complexity functions (findings 170-171)`

**Category:** complexity | **Effort:** quick | **Risk:** low
**Findings:** 170, 171

### What

- **170**: Simplify `isProcessRunning` kill-signal sentinel in runDirectoryManager.ts
- **171**: Simplify `generateRiskAssessments` regex string matching in specComposer.ts

### Files touched

```
src/persistence/runDirectoryManager.ts
src/workflows/specComposer.ts
```

### Implementation

1. Replace kill(0) sentinel with a cleaner process check
2. Simplify regex matching to use a lookup map
3. Run `npm run build && npm test`

### Depends on

PR 5 (touches same files)

---

## Execution Checklist

For each PR in order:

- [ ] Create branch from previous PR's branch (stacked)
- [ ] Implement fixes
- [ ] `npm run build && npm test && npm run lint && npm run deps:check`
- [ ] Mark debt findings as complete (rename `ready` → `complete` in todos/debt/)
- [ ] `gt submit` to create/update PR via Graphite
- [ ] Move to next PR

## Verification

After all PRs merged:

- [ ] `npm run build && npm test` pass on main
- [ ] `npm run deps:check` — no circular dependencies
- [ ] `npm run lint` — clean
- [ ] All 37 findings marked complete in todos/debt/
- [ ] Zero "ready" findings remaining
