# Cycle 8 Sprint Execution Plan

## Overview

Execute as many of the 18 High-priority backlog issues as possible in a single
agentic session. 7 issues are already resolved and need closure. 6 issues are
actionable quick wins. 2 issues are good Devin delegation candidates. 3 issues
need further discussion.

## Issue Triage (based on codebase validation)

### Already Resolved — Close as Done (7 issues)

These issues have been fixed in prior work but were never moved out of Backlog:

| ID | Title | Evidence |
|----|-------|----------|
| CDMCH-125 | GitHubAdapterError/LinearAdapterError identical | `AdapterError` base exists in `src/utils/errors.ts:129`; all subclasses extend it |
| CDMCH-131 | Pervasive section-separator comment blocks | 0 occurrences of `// ====` across src/ |
| CDMCH-133 | God function renderHumanReadable 370 lines | Refactored to 22-line dispatcher with 11 helper functions |
| CDMCH-150 | Deployment outcome construction repeated 8 times | All outcomes use `buildOutcome()` factory in `deployment/execution.ts` |
| CDMCH-138 | Circular dep adapters-codemachine → workflows | Types moved to `adapters/codemachine/types.ts`; no workflow imports remain |
| CDMCH-167 | Boundary violation workflows → cli-pr-shared | No `src/cli/pr/shared.ts` imports found in `src/workflows/` |
| CDMCH-172 | Circular dep telemetry → adapters-http | No `adapters/http` imports found in `src/telemetry/rateLimitLedger.ts` |

**Action:** Mark all 7 as Done. ~5 min total.

### Quick Wins — Claude Code Session (5 issues)

| ID | Title | Effort | Notes |
|----|-------|--------|-------|
| CDMCH-119 | Remove redundant build hooks (prepare + prepack) | 5 min | Remove `prepare` script from package.json |
| CDMCH-118 | Add .npmrc to .dockerignore | 5 min | Add `.npmrc` to `.dockerignore`, remove `COPY .npmrc ./` from Dockerfile |
| CDMCH-135 | executeValidationCommand takes 8 parameters | 30 min | Group into `TelemetryContext` + `AttemptContext` objects |
| CDMCH-126 | Quadruplicated isFileNotFound utility | 20 min | Remove duplicates, import from `src/utils/safeJson.ts` (file may have moved to writeActionStore.ts) |
| CDMCH-191 | Feature envy executionMetrics redefines domain enums | 15 min | Import `ExecutionTaskStatus` from `core/models` instead of redefining |

**Action:** Implement all 5 sequentially with tests. ~75 min total.

### Close as Not Applicable (1 issue)

| ID | Title | Reason |
|----|-------|--------|
| CDMCH-120 | Simplify E2E test report (366 lines) | File `docs/testing/e2e-test-report-v1.0.0.md` does not exist — already removed |

**Action:** Mark as Done with comment. ~2 min.

### Delegate to Devin (2 issues)

| ID | Title | Why Devin? |
|----|-------|-----------|
| CDMCH-127 | CLI boilerplate duplicated across 16 commands | Large mechanical refactor: extract `TelemetryCommand` base class, update 16 command files. Well-defined pattern, low ambiguity, high file count. |
| CDMCH-122 | Add eslint-disable comments for Record\<string, unknown\> | 63 instances across 19 files. Tedious but mechanical: review each usage, add eslint-disable with reason. |

**Action:** Delegate via `/devin:delegate` with detailed prompts after approval.

### Defer to Next Session (3 issues)

| ID | Title | Reason |
|----|-------|--------|
| CDMCH-163 | God function Start run 270 lines | Still 254 lines. Large refactor with complex orchestration logic. Needs careful decomposition. |
| CDMCH-169 | God function Doctor run 230 lines | Reduced to 137 lines with helpers extracted. May be acceptable now — reassess priority. |
| CDMCH-170 | God function executeTask 200 lines | Appears partially decomposed. Needs deeper verification before acting. |
| CDMCH-121 | Flaky parallel execution test | Investigation-heavy. Test still `.skip()`'d. Needs CI environment access to reproduce. |

## Execution Order

```
Phase 1: Close resolved issues (7 + 1 = 8 issues)     ~7 min
Phase 2: Quick wins (5 issues)                         ~75 min
Phase 3: Delegate to Devin (2 issues)                  ~10 min setup
─────────────────────────────────────────────────
Total: 15 issues addressed | 3 deferred               ~90 min
```

## Expected Cycle Impact

| Metric | Before | After |
|--------|--------|-------|
| Cycle 8 total | 63 | 63 |
| Completed | 24 | 37 (+13 closed/fixed) |
| In Progress | — | 2 (Devin) |
| Remaining | 39 | 24 |
| Completion % | 38% | **59%** |

## Devin Delegation Prompts

### CDMCH-127: Extract TelemetryCommand Base Class

> Extract a shared `TelemetryCommand` base class in `src/cli/commands/base.ts`
> that encapsulates the duplicated telemetry lifecycle found in all 16 CLI
> commands. The pattern is: parse flags → setJsonOutputMode → create logger,
> metrics, traceManager, commandSpan → try/catch with flushTelemetrySuccess/
> flushTelemetryError. Each command should call `super.runWithTelemetry()` or
> use a template method pattern. See `src/cli/commands/doctor.ts` and
> `src/cli/commands/init.ts` for the canonical pattern. Run `npm test` and
> `npm run lint` after changes. Branch: `fix/cdmch-127-telemetry-base-class`.

### CDMCH-122: Add eslint-disable Comments

> Add `// eslint-disable-next-line @typescript-eslint/no-restricted-types`
> comments with reasons for all 63 legitimate `Record<string, unknown>` usages
> in `src/`. Each comment must include a `-- intentional: <reason>` suffix.
> See `docs/solutions/linting/eslint-no-restricted-types-index-signature-evasion.md`
> for guidance. Run `npm run lint` to verify warnings are suppressed. Branch:
> `fix/cdmch-122-record-eslint-disable`.
