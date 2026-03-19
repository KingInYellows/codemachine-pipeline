# Feature: Documentation Audit Remediation

## Problem Statement

The 2026-03-18 documentation audit scored **0/100** due to structural gaps and
staleness, despite substantial documentation volume (87 markdown files, 91%
JSDoc coverage). Three categories of issues drive the score down:

1. **No per-module READMEs** — all 8 `src/` modules lack discoverable entry
   points explaining purpose, exports, and dependencies (P1-1)
2. **10 stale reference docs and playbooks** — source code changed 5-17 days
   after the doc was last updated (P2-1 through P2-10)
3. **15 source files with zero JSDoc** on public exports, and stale doc indexes
   (P1-2, P1-4)

## Current State

- 87 markdown files in `docs/` covering architecture, playbooks, ADRs, references
- MkDocs Material site with full nav, git-revision-date plugin, search
- `npm run docs:validate` CI gate (links, commands, examples, security)
- Auto-generated CLI reference via `npm run docs:cli`
- JSDoc coverage: 152/167 export files (91%), but 15 files at 0%
- `docs/index.md` last updated Feb 17; `docs/README.md` last updated Feb 24
- Existing doc conventions in `docs/README.md` (taxonomy) and ADR-009

## Proposed Solution

Three-phase documentation remediation, ordered by impact. All work is docs-only
(markdown + JSDoc) with no runtime code changes.

<!-- deepen-plan: codebase -->
> **Codebase:** The `src/` READMEs will live outside `docs_dir: docs` (set in
> `mkdocs.yml` line 9), so they will **not** appear in the MkDocs site. These
> READMEs serve as GitHub-browsable module docs. If MkDocs visibility is desired
> later, either add symlinks into `docs/` or use `extra_docs_dirs`. ADR-009
> does not address in-source READMEs, so this plan introduces a new pattern —
> consider noting it as a minor ADR amendment.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Cross-module dependency map (validated via import analysis) —
> use this to populate the "Dependencies" section in each module README:
>
> | Module | Depends On | Depended On By |
> |---|---|---|
> | `utils` | `core` | `adapters`, `persistence`, `telemetry`, `workflows` |
> | `validation` | (none) | `core`, `persistence`, `telemetry`, `adapters` |
> | `core` | `utils`, `validation` | `adapters`, `cli`, `persistence`, `telemetry`, `workflows` |
> | `telemetry` | `core`, `utils`, `validation` | `adapters`, `cli`, `workflows` |
> | `persistence` | `core`, `utils`, `validation` | `cli`, `workflows` |
> | `adapters` | `core`, `utils`, `validation`, `telemetry` | `cli`, `workflows` |
> | `workflows` | `core`, `utils`, `validation`, `telemetry`, `persistence`, `adapters` | `cli` |
> | `cli` | `core`, `adapters`, `persistence`, `telemetry`, `workflows`, `utils` | (top layer) |
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Per-Module READMEs (P1-1)

Create a README.md in each of the 8 `src/` top-level directories. Each README
should follow the project's existing JSDoc module-level pattern (title, blank
line, purpose paragraph, key exports list) adapted to markdown.

**Template structure for each module README:**

```markdown
# <Module Name>

<1-2 sentence purpose statement>

## Key Exports

- `ClassName` — brief description
- `functionName()` — brief description

## Structure

- `subdir/` — what it contains
- `fileName.ts` — what it does

## Dependencies

Which other `src/` modules this module imports from.
```

**Modules to document (ordered by complexity, largest first):**

- [ ] 1.1: `src/workflows/README.md` — 68 files, 3 subdirs (deployment/, queue/, summarizerClients/). Core orchestration: execution strategies, context aggregation, spec parsing, write actions, resume coordination, task planning

<!-- deepen-plan: codebase -->
> **Codebase:** The `workflows/` barrel (`index.ts`) only exports 3 types
> (`ExecutionStrategy`, `ExecutionContext`, `ExecutionStrategyResult`),
> `CodeMachineCLIStrategy`/`createCodeMachineCLIStrategy`, and
> `CodeMachineEngineTypeSchema`/`CODEMACHINE_STRATEGY_NAMES`. The vast majority
> of internals are imported by direct path. The README should note this pattern
> and organize key files by functional area: execution engine
> (`cliExecutionEngine`, `executionDependencyResolver`,
> `executionTelemetryRecorder`, `executionArtifactCapture`), resume
> (`resumeCoordinator`, `runStateVerifier`, `resumeIntegrityChecker`,
> `resumeQueueRecovery`), context (`contextAggregator`, `contextSummarizer`,
> `contextBudget`, `contextRanking`), queue (`queue/` — 8 files), spec
> (`specComposer`, `specParsing`, `specMetadata`, `specMarkdown`), task
> planning (`taskPlanner`, `plannerDAG`, `plannerPersistence`).
<!-- /deepen-plan -->

- [ ] 1.2: `src/cli/README.md` — 42 files + 4 subdirs (commands/, pr/, status/, utils/). oclif command definitions, status rendering, PR workflows

<!-- deepen-plan: codebase -->
> **Codebase:** The barrel exports only `run` from `@oclif/core`. Individual
> commands are loaded by oclif convention-based discovery, not barrel-exported.
> Notable internal modules: `startHelpers.ts`, `startOutput.ts`,
> `resumePayloadBuilder.ts`, `resumeOutput.ts`, `telemetryCommand.ts`,
> `diagnostics.ts`, `status/renderers.ts`, `status/data/*` (10 data-loading
> functions). The `commands/` subdir has sub-commands: `pr/`, `research/`,
> `context/`, `status/`.
<!-- /deepen-plan -->

- [ ] 1.3: `src/adapters/README.md` — 16 files + 5 subdirs (agents/, codemachine/, github/, http/, linear/). External service boundaries: GitHub API, Linear API, HTTP client, agent orchestration

<!-- deepen-plan: codebase -->
> **Codebase:** Key exports from barrel: `GitHubAdapter`,
> `BranchProtectionAdapter`, `LinearAdapter`, `AgentAdapter`, `ManifestLoader`,
> `HttpClient`, `CodeMachineCLIAdapter`, `resolveBinary`, plus error classes
> (`GitHubAdapterError`, `BranchProtectionError`, `LinearAdapterError`,
> `AgentAdapterError`, `HttpError`) and ~40 exported types for config, params,
> and result shapes.
<!-- /deepen-plan -->

- [ ] 1.4: `src/telemetry/README.md` — 10 files, flat. Logging, metrics, traces, cost tracking, rate limit ledger

<!-- deepen-plan: codebase -->
> **Codebase:** Key exports: `createCliLogger`/`StructuredLogger`/`LogLevel`,
> `MetricsCollector`/`StandardMetrics`/`MetricType`,
> `TraceManager`/`withSpan`/`SpanKind`/`SpanStatusCode`,
> `CostTracker`/`loadOrCreateCostTracker`, `ExecutionTelemetry`,
> `createRateLimitLedger`, `RateLimitReporter`.
<!-- /deepen-plan -->

- [ ] 1.5: `src/persistence/README.md` — 7 files, flat. Run lifecycle, manifests, locks, branch protection store, research store

<!-- deepen-plan: codebase -->
> **Codebase:** Key exports: `acquireLock`/`releaseLock`/`withLock`,
> `writeManifest`/`readManifest`/`updateManifest`/`setLastStep`/`setCurrentStep`/`setLastError`,
> `createRunDirectory`/`getRunDirectoryPath`/`generateHashManifest`/`verifyRunDirectoryIntegrity`,
> `saveTask`/`loadTask`/`listTaskIds`/`findCachedTask`,
> `computeFileHash`/`createHashManifest`/`verifyHashManifest`.
<!-- /deepen-plan -->

- [ ] 1.6: `src/core/README.md` — 34 files + 3 subdirs (config/, models/, validation/). Shared types, errors, config schema, domain models

<!-- deepen-plan: codebase -->
> **Codebase:** The `models/` barrel re-exports via 5 sub-barrels:
> `feature-types`, `task-types`, `artifact-types`, `deployment-types`,
> `integration-types`. Also: `sharedTypes.ts` (SerializedError, LogContext,
> ErrorType, Provider), `errors.ts` (HttpError), `config/RepoConfig.ts`,
> `config/RepoConfigLoader.ts`. All models use Zod schemas for validation.
<!-- /deepen-plan -->

- [ ] 1.7: `src/utils/README.md` — 9 files, flat. Atomic writes, redaction, process runner, safe JSON, env filtering

<!-- deepen-plan: codebase -->
> **Codebase:** The barrel only exports error-related utilities (`classifyError`,
> `getErrorMessage`, `serializeError`, `wrapError`, `isProcessRunning`). Most
> files (`safeJson.ts`, `redaction.ts`, `atomicWrite.ts`, `envFilter.ts`,
> `processRunner.ts`, `githubApiUrl.ts`) are imported directly by path, not
> through the barrel. The README should note both barrel exports and
> direct-import files.
<!-- /deepen-plan -->

- [ ] 1.8: `src/validation/README.md` — 3 files, flat. CLI path validation, error types, validation helpers

<!-- deepen-plan: codebase -->
> **Codebase:** No barrel `index.ts` exists — consumers import files directly.
> Key exports: `ValidationError`, `fromZodError`,
> `ValidationSuccess`/`ValidationFailure`/`ValidationResult`,
> `validateOrThrow`, `validateOrResult`, `validateCliPath`.
<!-- /deepen-plan -->

### Phase 2: Refresh Stale Docs (P2-1 through P2-10)

Update 10 documentation files whose corresponding source code has changed since
the doc was last written. For each, diff the source changes and update the doc
to reflect the current state.

**Prioritized by staleness gap (largest first):**

- [ ] 2.1: `docs/playbooks/resume_playbook.md` — 17 days behind `src/workflows/resumeCoordinator.ts` (Mar 13)

<!-- deepen-plan: codebase -->
> **Codebase:** Resume coordinator was decomposed into 4 modules (PR #628):
> `resumeCoordinator.ts`, `runStateVerifier.ts`, `resumeIntegrityChecker.ts`,
> `resumeQueueRecovery.ts`. The playbook does not document the multi-module
> architecture, integrity verification, or queue-specific recovery logic.
> Additionally, queue backward-compat shims were removed (Mar 13, CDMCH-188).
<!-- /deepen-plan -->

- [ ] 2.2: `docs/reference/rate_limit_dashboard.md` — 15 days behind `src/telemetry/rateLimitLedger.ts` (Mar 11)

<!-- deepen-plan: codebase -->
> **Codebase:** TelemetryCommand was refactored (Mar 8, CDMCH-127). Verify
> that the dashboard doc reflects the current `RateLimitReporter` and
> `rateLimitLedger` APIs.
<!-- /deepen-plan -->

- [ ] 2.3: `docs/reference/config/github_adapter.md` — 14 days behind `src/adapters/github/GitHubAdapter.ts` (Mar 16)

<!-- deepen-plan: codebase -->
> **Codebase:** GitHubAdapter received path param validation (Mar 7,
> CDMCH-174) and public readiness hardening (Mar 15). The doc should
> reflect the new validation rules and any API surface changes.
<!-- /deepen-plan -->

- [ ] 2.4: `docs/reference/parallel-execution.md` — 14 days behind `src/workflows/executionDependencyResolver.ts` (Mar 10)

<!-- deepen-plan: codebase -->
> **Codebase:** `executionDependencyResolver.ts` was extracted from the
> execution engine (PR #632). Lock manager was also extracted (Mar 8,
> CDMCH-175) and `processExists` was extracted (Mar 9, CDMCH-183). The
> doc still describes a pre-refactor architecture. Additionally, the
> `max-parallel` flag was added to the `start` command.
<!-- /deepen-plan -->

- [ ] 2.5: `docs/playbooks/init_playbook.md` — 14 days behind `src/cli/commands/init.ts` (Mar 10)

<!-- deepen-plan: codebase -->
> **Codebase:** `Init.run()` was decomposed (Mar 10, CDMCH-160) and
> `PipelineOrchestrator` was extracted (Mar 9, CDMCH-177). The playbook
> should reflect the new initialization flow.
<!-- /deepen-plan -->

- [ ] 2.6: `docs/reference/cli/doctor_reference.md` — 12 days behind `src/cli/commands/doctor.ts` (Mar 8)

<!-- deepen-plan: codebase -->
> **Codebase:** Public readiness hardening (Mar 15) may have added new
> diagnostic checks. Verify the doc covers all current `doctor` checks.
<!-- /deepen-plan -->

- [ ] 2.7: `docs/reference/config/linear_adapter.md` — 8 days behind `src/adapters/linear/LinearAdapter.ts` (Mar 10)

<!-- deepen-plan: codebase -->
> **Codebase:** `LinearAdapterTypes` was extracted (Mar 6, CDMCH-203).
> The doc should reflect the type extraction and any new type exports.
<!-- /deepen-plan -->

- [ ] 2.8: `docs/reference/config/RepoConfig_schema.md` — 6 days behind `src/core/config/RepoConfigSchema.ts` (Mar 13)

<!-- deepen-plan: codebase -->
> **Codebase:** `RepoConfigLoader` was extracted (Mar 6, CDMCH-213) and
> execution plan helpers were extracted (Mar 7, CDMCH-178). The schema
> doc should reflect the current field set and any new config options.
<!-- /deepen-plan -->

- [ ] 2.9: `docs/reference/queue-v2-operations.md` — 6 days behind `src/workflows/queue/queueV2Api.ts` (Mar 2)

<!-- deepen-plan: codebase -->
> **Codebase:** Queue files were consolidated into `workflows/queue/`
> sub-directory (PR #624) with 8 dedicated files: `queueStore.ts`,
> `queueTaskManager.ts`, `queueV2Api.ts`, `queueMemoryIndex.ts`,
> `queueOperationsLog.ts`, `queueSnapshotManager.ts`,
> `queueCompactionEngine.ts`, `queueTypes.ts`. Backward-compat shims were
> removed (PR #790). The doc references pre-consolidation file paths and
> does not describe the current 8-file architecture.
<!-- /deepen-plan -->

- [ ] 2.10: `docs/reference/cli/cli-reference.md` — 5 days behind. **Auto-generated**: run `npm run docs:cli` and commit the output. Do NOT edit manually.

### Phase 3: JSDoc + Index Updates (P1-2, P1-4)

Add JSDoc to 15 undocumented export files and update the docs landing pages.

<!-- deepen-plan: codebase -->
> **Codebase — high-impact JSDoc targets:**
> - `src/workflows/executionStrategy.ts` (24 lines) — defines `ExecutionStrategy`,
>   `ExecutionContext`, `ExecutionStrategyResult`. This is the **core abstraction**
>   for the strategy pattern. The `status` field enum values, `recoverable`
>   semantics, and `canHandle` contract are completely undocumented.
> - `src/cli/status/types.ts` (196 lines) — defines `StatusPayload` and 8
>   sub-payload interfaces (~80 fields total). This is the **primary
>   machine-readable API** for `codepipe status --json`. CI consumers have no
>   documentation of the payload shape, field semantics, or nullability.
> - `src/utils/githubApiUrl.ts` (67 lines) — the `resolveGitHubApiBaseUrl`
>   function throws 3 different errors and has a **security-sensitive** env-var
>   gate (`ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV`). The validation rules
>   (rejects embedded credentials, requires opt-in for custom hosts) must be
>   documented.
> - `src/cli/commands/start.ts` (313 lines) — exit code contract is
>   undocumented: 0 = success, 1 = failed tasks, 30 = approval required.
>   Exit code 30 is non-standard and critical for CI consumers.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase — missing from JSDoc target list:** `src/cli/status/renderers.ts`
> (459 lines) is the **largest** status-subsystem file with zero JSDoc on any
> public exports (`renderHumanReadable`, `RenderCallbacks`, etc.). Consider
> adding it as task 3.6a or replacing the current 3.6 entry with accurate
> export count. The file has more public exports than the plan's "3 exports"
> suggests.
<!-- /deepen-plan -->

**JSDoc additions (ordered by export count, highest first):**

- [ ] 3.1: `src/cli/status/types.ts` — 13 exports (interfaces/types for status dashboard)
- [ ] 3.2: `src/cli/status/data/planData.ts` — 4 exports
- [ ] 3.3: `src/workflows/codeMachineStrategy.ts` — 3 exports
- [ ] 3.4: `src/workflows/executionStrategy.ts` — 3 exports
- [ ] 3.5: `src/workflows/summaryOrchestration.ts` — 3 exports
- [ ] 3.6: `src/cli/status/renderers.ts` — 3 exports
- [ ] 3.7: `src/cli/status/data/telemetryData.ts` — 3 exports
- [ ] 3.8: `src/utils/githubApiUrl.ts` — 2 exports
- [ ] 3.9: `src/cli/commands/start.ts` — 1 export (main start command)
- [ ] 3.10: `src/cli/status/data/branchData.ts` — 1 export
- [ ] 3.11: `src/cli/status/data/integrationsData.ts` — 1 export
- [ ] 3.12: `src/cli/status/data/prMetadataData.ts` — 1 export
- [ ] 3.13: `src/cli/status/data/rateLimitsData.ts` — 1 export
- [ ] 3.14: `src/cli/status/data/researchData.ts` — 1 export
- [ ] 3.15: `src/cli/status/data/validationData.ts` — 1 export

**JSDoc conventions to follow:**
- Module-level: title line, blank line, purpose paragraph, key features list
- Interface properties: inline `/** description */` on each property
- Functions: `@param name - Description` (dash separator), `@returns`, `@throws`
- Simple getters/checkers: one-line `/** description */`

<!-- deepen-plan: codebase -->
> **Codebase — JSDoc convention examples from this project:**
>
> Module-level (from `src/telemetry/logger.ts`):
> ```typescript
> /**
>  * Structured Logger
>  *
>  * Provides consistent JSON-line logging with:
>  * - Log levels (debug, info, warn, error, fatal)
>  * - Structured context fields (run_id, component, trace_id)
>  * - Secret redaction (GitHub tokens, API keys, JWTs)
>  * - NDJSON file persistence + optional stderr mirroring
>  */
> ```
>
> Interface properties (from `src/telemetry/logger.ts`):
> ```typescript
> export interface LogEntry {
>   /** ISO 8601 timestamp */
>   timestamp: string;
>   /** Severity level */
>   level: LogLevel;
>   /** Run identifier (feature_id) */
>   run_id?: string;
> }
> ```
>
> Functions (from `src/persistence/hashManifest.ts`):
> ```typescript
> /**
>  * Write manifest to disk atomically
>  *
>  * Uses write-to-temp-then-rename pattern for atomicity
>  *
>  * @param runDir - Run directory path
>  * @param manifest - Manifest to write
>  */
> ```
<!-- /deepen-plan -->

**Index updates:**

- [ ] 3.16: Update `docs/index.md` — expand from current 15-line minimal landing page into a proper project overview with architecture summary, prerequisites link, and navigation guidance

<!-- deepen-plan: codebase -->
> **Codebase:** `docs/index.md` is currently only 15 lines with 3 links (Quick
> Start, Playbooks, Reference) and a note about TODOs. It provides no project
> overview, architecture summary, or onboarding path. Git log shows **no new
> playbooks were added since March 15** — the original plan's claim about
> "approval_gates, execution_telemetry, pr_playbook, prd_playbook,
> traceability_playbook" needs verification. The update should focus on making
> `index.md` a proper landing page rather than just adding links.
<!-- /deepen-plan -->

- [ ] 3.17: Update `docs/README.md` — add links to the same new playbooks and any new reference docs; ensure consistency with `docs/index.md`

<!-- deepen-plan: codebase -->
> **Codebase:** `docs/README.md` (263 lines) is comprehensive but **not
> included in `mkdocs.yml` nav**, making it unreachable from the MkDocs site.
> It has stale links (references a 5-week-old plan), missing content (no
> mention of ADR-9, brainstorms/, archive/, MIGRATION-MAP.md), and structural
> drift from `mkdocs.yml` nav (Solutions section lists 3 items vs ~15 in nav).
> Consider either merging its content into `docs/index.md` or adding it to
> the mkdocs nav.
<!-- /deepen-plan -->

## Technical Details

### Files to Modify

| File | Change |
|---|---|
| `docs/index.md` | Expand into proper landing page |
| `docs/README.md` | Update links, add to mkdocs nav or merge into index |
| `docs/playbooks/resume_playbook.md` | Refresh from source (multi-module resume architecture) |
| `docs/reference/rate_limit_dashboard.md` | Refresh from source |
| `docs/reference/config/github_adapter.md` | Refresh from source (path validation, public readiness) |
| `docs/reference/parallel-execution.md` | Refresh from source (dependency resolver extraction) |
| `docs/playbooks/init_playbook.md` | Refresh from source (Init.run decomposition) |
| `docs/reference/cli/doctor_reference.md` | Refresh from source |
| `docs/reference/config/linear_adapter.md` | Refresh from source (type extraction) |
| `docs/reference/config/RepoConfig_schema.md` | Refresh from source (loader extraction) |
| `docs/reference/queue-v2-operations.md` | Refresh from source (8-file queue architecture) |
| `docs/reference/cli/cli-reference.md` | Regenerate via `npm run docs:cli` |
| 15 source files in `src/` | Add JSDoc comments |

### Files to Create

| File | Purpose |
|---|---|
| `src/adapters/README.md` | Module overview |
| `src/cli/README.md` | Module overview |
| `src/core/README.md` | Module overview |
| `src/persistence/README.md` | Module overview |
| `src/telemetry/README.md` | Module overview |
| `src/utils/README.md` | Module overview |
| `src/validation/README.md` | Module overview |
| `src/workflows/README.md` | Module overview |

### Validation

After all changes, run:
- `npm run docs:validate` — link check, command check, example safety, security
- `npm run docs:cli:check` — CLI reference drift detection
- `npx tsc --noEmit` — ensure JSDoc additions don't break TypeScript

<!-- deepen-plan: codebase -->
> **Codebase:** `docs:links:check` requires `markdown-link-check` to be
> installed. The validation script silently exits 0 if the tool is missing.
> Run `npm install` before validation to ensure `markdown-link-check` is
> available, otherwise the link check will appear to pass even with broken
> links.
<!-- /deepen-plan -->

## Acceptance Criteria

1. All 8 `src/` modules have a README.md with purpose, key exports, structure, and dependencies
2. All 10 stale docs reflect the current source code state
3. All 15 undocumented export files have JSDoc on every public symbol
4. `docs/index.md` and `docs/README.md` link to all playbooks and references added since Mar 15
5. `npm run docs:validate` passes
6. `npm run docs:cli:check` passes (no CLI reference drift)
7. `npx tsc --noEmit` passes

## Edge Cases

- `docs/reference/cli/cli-reference.md` is auto-generated — must use `npm run docs:cli`, not manual edits
- Stale doc refresh must preserve existing structure/sections; only update content that diverged from source
- JSDoc additions must not change runtime behavior — comments only
- Module READMEs should not duplicate JSDoc already in source files; focus on module-level overview and navigation

<!-- deepen-plan: codebase -->
> **Codebase — additional edge cases identified:**
> - `src/validation/` has no barrel `index.ts` — consumers import files
>   directly. The README should document this pattern explicitly.
> - `src/workflows/summaryOrchestration.ts` has two 10-parameter functions
>   (`processSingleChunk`, `processMultipleChunks`) with non-obvious params
>   (e.g., `redactor`, `costTracker`, `warnings` as a mutable output array).
>   JSDoc for these functions must document all 10 parameters.
> - `src/cli/status/data/branchRefreshData.ts` and `src/cli/status/data/types.ts`
>   already have partial JSDoc (3 and 2 comments respectively). These are NOT
>   zero-JSDoc files — they should be excluded from the "15 files with zero
>   JSDoc" count or treated as partial-coverage targets.
<!-- /deepen-plan -->

## References

- Audit report: 2026-03-18 `/docs:audit` run (this session)
- Doc conventions: `docs/README.md` (taxonomy section)
- Architecture source of truth: `docs/adr/adr-009-documentation-architecture.md`
- MkDocs config: `mkdocs.yml`
- CLI reference generator: `scripts/tooling/generate_cli_reference.js`
- Doc validation: `npm run docs:validate`
