# CodeMachine Pipeline Current Cycle Plan

**PRD Reference:** `thoughts/prds/2026-01-02-codemachine-cli-adapter.md`
**Linear Project:** CodeMachine CLI Execution Engine Adapter
**Created:** 2026-01-02
**Updated:** 2026-01-02
**Status:** Implemented
**Review Status:** Complete
**Implemented Date:** 2026-01-03

---

## Context

- Team: codemachine-pipeline
- Current cycle: Codemachine Core v1 (2026-01-02 to 2026-01-16)
- Capacity: 1 engineer, 16 points
- Source: Linear backlog for CodeMachine CLI Execution Engine Adapter project

## Assumptions

- Cycle runs for two weeks with a single owner.
- Target completion of core v1 bring-up only.

## Scope Recommendation (Core v1 Bring-up)

- CDMCH-1: Fix HIGH severity glob command injection vulnerability (M)
- CDMCH-15: Add execution settings to RepoConfig schema (S/M)
- CDMCH-16: CodeMachineRunner utility (M)
- CDMCH-17: TaskMapper implementation (S/M)
- CDMCH-18: ResultNormalizer implementation (M)
- CDMCH-19: initializeQueueFromPlan wiring (S)

### Rationale

These unlock the v1 execution adapter foundation without committing to execution engine wiring, telemetry, or test-heavy work. It is the lowest-risk slice that still delivers integration value.

## Dependencies

- CDMCH-15 blocks CDMCH-16/17/18 (execution config surface needed).
- CDMCH-16/17/18 are parallelizable after CDMCH-15.
- CDMCH-19 can follow once task schema usage is stable.
- CDMCH-1 can run in parallel (security fix).

## Files to Modify (Planned)

- `package.json`
- `package-lock.json`
- `src/core/config/RepoConfig.ts`
- `src/core/config/repoConfigEnv.ts`
- `src/adapters/agents/`
- `src/workflows/`
- `src/persistence/`
- `src/telemetry/`
- `tests/`
- `test/`

## Execution Phases

### Phase 1: CDMCH-1 Security Fix ✓

**Changes**

- Update or remove vulnerable dependency chain for glob.
- Validate CLI behavior after dependency changes.

**Success Criteria**

- Vulnerability resolved or mitigated.
- CI passes with updated dependency chain.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:**

- Removed `@oclif/plugin-plugins` (unused dependency)
- Eliminated 221 packages from dependency tree
- `npm audit` shows 0 vulnerabilities
- All 194 tests passing

---

### Phase 2: CDMCH-15 Execution Settings (RepoConfig) ✓

**Changes**

- Add execution settings to RepoConfig schema and defaults.
- Add environment variable overrides.

**Success Criteria**

- Config validates with execution section and defaults.
- Env overrides apply correctly.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:** Already implemented prior to plan execution. ExecutionConfigSchema exists in RepoConfig.ts with all required fields and env overrides.

---

### Phase 3: CDMCH-16 CodeMachineRunner Utility ✓

**Changes**

- Implement CLI spawn utility with timeout, log streaming, validation, safe env handling.

**Success Criteria**

- Reliable CLI invocation with safe env handling.
- Timeout and kill behavior consistent with requirements.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:** Already implemented prior to plan execution. `src/workflows/codeMachineRunner.ts` (231 lines) with full spawn utility, timeout handling, env filtering.

---

### Phase 4: CDMCH-17 TaskMapper ✓

**Changes**

- Implement mapping for ExecutionTaskType with engine helpers.
- Add mapping coverage tests.

**Success Criteria**

- All task types map deterministically.
- Unsupported engines rejected.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:** Already implemented prior to plan execution. `src/workflows/taskMapper.ts` (326 lines) with TASK_TYPE_TO_AGENT mapping for all 8 task types.

---

### Phase 5: CDMCH-18 ResultNormalizer ✓

**Changes**

- Implement NormalizedResult with exit code mapping, redaction utilities, summary extraction.

**Success Criteria**

- Exit codes mapped correctly.
- Secret patterns redacted consistently.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:** Already implemented prior to plan execution. `src/workflows/resultNormalizer.ts` (188 lines) with 15 credential patterns for redaction.

---

### Phase 6: CDMCH-19 initializeQueueFromPlan ✓

**Changes**

- Initialize queue from TaskPlan with ExecutionTask mapping.
- Handle empty plan case.

**Success Criteria**

- Queue initializes and appends tasks correctly.
- Empty plan handled gracefully.

**Verification (Automated)**

- `npm test`
- `npm run lint`

**Completion Notes:** Already implemented prior to plan execution. `src/workflows/queueStore.ts` has initializeQueueFromPlan (lines 165-216).

## Deviations from Plan

### Discovery: Phases 2-6 Already Implemented

- **Original**: Plan assumed CDMCH-15 through CDMCH-19 needed implementation
- **Actual**: All implementations already existed in codebase
- **Reason**: Work completed in prior sessions before plan was written
- **Impact**: Only CDMCH-1 (security fix) required execution; other phases verified as complete

### CDMCH-1: Fix Approach

- **Original**: "Update or remove vulnerable dependency chain"
- **Actual**: Removed `@oclif/plugin-plugins` entirely (Option A from research)
- **Reason**: Dependency was unused (no code references, `plugins` command not registered)
- **Impact**: Cleaner fix, reduced 221 packages from dependency tree

---

## Out of Scope (Deferred)

- CLIExecutionEngine and start wiring: CDMCH-20, CDMCH-21
- Telemetry and artifacts: CDMCH-22, CDMCH-24, CDMCH-25
- Tests and CI: CDMCH-26, CDMCH-27, CDMCH-28, CDMCH-29, CDMCH-30
- Docs: CDMCH-32, CDMCH-33, CDMCH-34
- v2: CDMCH-35, CDMCH-37, CDMCH-38, CDMCH-39, CDMCH-40

## Risks

- Missing active cycle will block assignment until created.
- CDMCH-1 may require dependency updates with CI impact.

## Linear Sync Preview

- Cycle: Codemachine Core v1 (2026-01-02 to 2026-01-16)
- CDMCH-1: estimate M (5)
- CDMCH-15: estimate S/M (3)
- CDMCH-16: estimate M (5)
- CDMCH-17: estimate S/M (3)
- CDMCH-18: estimate M (5)
- CDMCH-19: estimate S (2)

## Next Steps

1. Create the current cycle in Linear (name/date range above).
2. Assign core v1 issues to the cycle.
