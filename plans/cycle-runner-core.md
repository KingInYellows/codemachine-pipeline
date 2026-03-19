# Feature: `codepipe cycle` — Core Cycle Runner

## Overview

Add a `codepipe cycle` CLI command that fetches all issues from a Linear cycle,
orders them by dependency and priority, then runs each through the existing
`PipelineOrchestrator` sequentially. The command extends `TelemetryCommand`,
produces per-issue run directories under a shared cycle directory, writes a
JSON report, and renders a rich terminal dashboard during execution.

## Problem Statement

### Current Pain Points

- The pipeline processes one feature at a time via `codepipe start`. Running an
  entire sprint's worth of issues requires manual invocation per issue.
- No dependency-aware ordering — the user must determine which issues to work
  first based on blocking relationships.
- No batch progress tracking — each `codepipe start` is an isolated run with
  no cycle-level view.

### User Impact

A single `codepipe cycle` command replaces 10+ manual `codepipe start`
invocations per sprint, with automatic ordering and progress tracking.

### Business Value

Maximizes pipeline throughput by automating sequential sprint execution.

## Proposed Solution

### High-Level Architecture

```
codepipe cycle [--cycle <id>] [--plan-only] [--fail-fast] [--dry-run]
       │
       ├─ LinearAdapter.fetchActiveCycle(teamId)    ← resolve cycle
       ├─ LinearAdapter.fetchCycleIssues(cycleId)   ← fetch issues + relations
       ├─ CycleIssueOrderer.order(issues)           ← topological + priority sort
       │
       └─ CycleOrchestrator.run(orderedIssues)      ← sequential loop
              │
              ├─ For each issue:
              │   ├─ Skip if Done/Cancelled/In Review
              │   ├─ Create per-issue runDir
              │   ├─ PipelineOrchestrator.execute()
              │   ├─ Collect CycleIssueResult
              │   └─ Update terminal dashboard
              │
              └─ Write report.json + render summary
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command base | `TelemetryCommand` | Gets telemetry lifecycle, consistent with `resume`, `doctor` |
| Orchestration | Sequential, one `PipelineOrchestrator` at a time | Simple, predictable, avoids resource contention |
| Issue source | Linear cycle ID, defaults to active cycle | Natural UX; extends LinearAdapter with 2 new methods |
| Resumability | Linear-as-source-of-truth | Skip Done/In Review issues; re-run implicitly resumes |
| Error handling | Skip-and-continue default, `--fail-fast` flag | One broken issue shouldn't block the entire sprint |
| Results | JSON report + terminal summary table | Machine-readable + human-readable |
| Ordering | Kahn's algorithm (topological) + priority | Respects blockers; falls back to priority when no relations |

## Implementation Plan

### Phase 1: LinearAdapter Extensions

- [ ] 1.1: Add `LinearIssueRelation`, `LinearCycleIssue`, `LinearCycle`, and
  `CycleSnapshot` types to `src/adapters/linear/LinearAdapterTypes.ts` with
  Zod schemas
- [ ] 1.2: Add `CYCLE_ISSUES_QUERY` GraphQL query to `LinearAdapter` — fetches
  cycle by ID with all issues, their states, priorities, and `relations` (for
  `blocks`/`duplicate`/`related`)

<!-- deepen-plan: external -->
> **Research:** Linear's `IssueRelationType` enum has exactly 3 values:
> `blocks`, `duplicate`, `related`. There is NO `is_blocked_by` value — that
> is a UI concept only. Relations are directional: when A blocks B, a relation
> exists with `type: "blocks"`, `issue: A`, `relatedIssue: B`. To build a
> complete dependency graph, query both `relations` and `inverseRelations`
> connections on each issue, or iterate all relations and build edges from
> the `issue`/`relatedIssue` fields.
>
> See: [Linear Docs — Issue Relations](https://linear.app/docs/issue-relations)
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** `executeGraphQL()` is a **private** method on `LinearAdapter`
> (`LinearAdapter.ts:559`). New `fetchCycleIssues()` and `fetchActiveCycle()`
> must be instance methods inside the `LinearAdapter` class body — they cannot
> be external wrappers. Follow the pattern of `fetchIssue()` and
> `fetchIssueSnapshot()`: define GraphQL const at module scope, add public
> method that calls `this.executeGraphQL<T>()`.
<!-- /deepen-plan -->
- [ ] 1.3: Add `ACTIVE_CYCLE_QUERY` GraphQL query — fetches the active cycle
  for a given team ID
- [ ] 1.4: Add `fetchCycleIssues(cycleId: string): Promise<CycleSnapshot>`
  method to `LinearAdapter`
- [ ] 1.5: Add `fetchActiveCycle(teamId: string): Promise<{id, name, number} | null>`
  method to `LinearAdapter`
- [ ] 1.6: Add `CYCLE_NOT_FOUND` and `CYCLE_FETCH_FAILED` to `CliErrorCode`
  enum in `src/cli/utils/cliErrors.ts`
- [ ] 1.7: Add unit tests for new adapter methods in
  `tests/unit/linearAdapter.spec.ts`

### Phase 2: Issue Ordering

- [ ] 2.1: Create `src/workflows/cycleIssueOrderer.ts` with `orderCycleIssues()`
  function
- [ ] 2.2: Implement Kahn's algorithm for topological sort on `blocks` /
  `is_blocked_by` relations from the issues' `relations` array
- [ ] 2.3: Within each topological level, sort by priority descending
  (4=Urgent, 3=High, 2=Medium, 1=Low, 0=None)
- [ ] 2.4: On cycle detection in dependency graph, log a warning and append
  cycle-involved issues at the end sorted by priority
- [ ] 2.5: If no relations data is returned by the API, fall back to
  priority-only sort gracefully
- [ ] 2.6: Add unit tests in `tests/unit/cycleIssueOrderer.spec.ts` covering:
  linear chain, diamond dependency, cycle detection, priority-only fallback,
  empty input

### Phase 3: Cycle Orchestrator

- [ ] 3.1: Create `src/workflows/cycleTypes.ts` with `CycleOrchestratorConfig`,
  `CycleIssueResult`, and `CycleResult` interfaces
- [ ] 3.2: Create `src/workflows/cycleOrchestrator.ts` with `CycleOrchestrator`
  class
- [ ] 3.3: Implement skip logic — before processing each issue, check
  `state.type`:
  - `completed` (Done) → skip
  - `canceled` → skip (note: one "l", American spelling)
  - `started` with state name containing "review" → skip (In Review)
  - All others (`triage`, `backlog`, `unstarted`, `started`) → process

<!-- deepen-plan: external -->
> **Research:** `WorkflowState.type` is a fixed 6-value enum consistent
> across all Linear teams: `triage`, `backlog`, `unstarted`, `started`,
> `completed`, `canceled`. The `type` is system-defined and cannot be
> customized. The `name` field is team-customizable (e.g., "In Review" is a
> `started` type). For skip logic, use:
> ```typescript
> function isTerminal(type: string): boolean {
>   return type === 'completed' || type === 'canceled';
> }
> ```
> "In Review" must be detected by state name, not type, since it shares the
> `started` type with "In Progress".
>
> See: [Rasayel API Reference — LinearStatusEnum](https://developers.rasayel.io/types/linearstatusenum)
<!-- /deepen-plan -->
- [ ] 3.4: Implement per-issue execution loop:
  - Create cycle parent dir first, then call `createRunDirectory(cycleIssuesDir,
    issueIdentifier, options)` — `featureId` cannot contain `/`
  - Create per-issue `ExecutionTelemetry` via `createExecutionTelemetry()` scoped
    to the issue's runDir (cannot share across issues)
  - Create `PipelineOrchestrator` with standard config
  - Call `execute()` with `linearContextText` from `formatLinearContext()`
    (reuse from `src/cli/startHelpers.ts`), `skipExecution` respecting
    `--plan-only`, and `maxParallel: 1` (required field)

<!-- deepen-plan: codebase -->
> **Codebase:** Key integration details:
> - `createRunDirectory(baseDir, featureId, opts)` at
>   `persistence/runLifecycle.ts:260` — pass the cycle issues dir as
>   `baseDir`. `featureId` is validated to reject `/` and `\\`.
> - `PipelineInput.maxParallel` is **required** (not optional). Default to 1.
> - `ExecutionTelemetry` must be constructed per-issue via
>   `createExecutionTelemetry({logger, metrics, runDir, runId})` — it is
>   scoped to a `runDir` and cannot be shared.
> - Reuse `formatLinearContext()` from `src/cli/startHelpers.ts:175-229` to
>   produce the `linearContextText` markdown string for each issue.
> - `TelemetryContext` fields (`logger`, `metrics`, etc.) are all typed as
>   `T | undefined` — use non-null assertion after ensuring `runDirPath` is set.
<!-- /deepen-plan -->
  - Catch errors per-issue; if `failFast`, re-throw; otherwise collect as
    failed result
- [ ] 3.5: Implement progress callback — `CycleOrchestrator` accepts an
  `onIssueComplete(result: CycleIssueResult)` callback for dashboard updates
- [ ] 3.6: Write `CycleResult` JSON to `cycle-<id>/report.json` on completion
- [ ] 3.7: Add unit tests in `tests/unit/cycleOrchestrator.spec.ts` covering:
  skip logic, fail-fast, skip-and-continue, plan-only mode, progress callbacks

### Phase 4: CLI Command

- [ ] 4.1: Create `src/cli/commands/cycle.ts` extending `TelemetryCommand`
- [ ] 4.2: Define flags:
  - `--cycle` / `-c`: Linear cycle ID or name (optional, defaults to active)
  - `--plan-only`: Generate PRDs without task execution (maps to
    `PipelineInput.skipExecution`)
  - `--fail-fast`: Stop on first issue failure
  - `--dry-run` / `-d`: Show ordered issue list without processing
  - `--json`: JSON output mode
  - `--verbose` / `-v`: Detailed per-issue output
  - `--max-issues`: Cap number of issues to process (default: 30)
- [ ] 4.3: Implement command flow:
  1. Parse flags, load `RepoConfig`, validate `linear.enabled` and
     `linear.team_id`
  2. Resolve cycle: use `--cycle` flag or `fetchActiveCycle(teamId)`
  3. Fetch issues: `fetchCycleIssues(cycleId)`
  4. Order issues: `orderCycleIssues(issues)`
  5. Filter terminal-state issues
  6. If `--dry-run`: render ordered list and exit
  7. Create cycle run directory: `.codepipe/runs/cycle-<cycleId>/`
  8. Initialize and run `CycleOrchestrator`
  9. Write report, render summary
- [ ] 4.4: Wire telemetry via `runWithTelemetry()` with
  `featureId: 'cycle-<cycleId>'`
- [ ] 4.5: Add `src/cli/cycleTypes.ts` for `CycleFlags` and `CyclePayload`

### Phase 5: Output Rendering

- [ ] 5.1: Create `src/cli/cycleOutput.ts` with rendering functions
- [ ] 5.2: Implement `renderCycleDashboard()` — live-updating table when stdout
  is TTY (using ANSI cursor-up + clear-line), single-line status updates when
  not TTY

<!-- deepen-plan: external -->
> **Research:** For zero-dependency terminal dashboards in Node.js, use ANSI
> escape codes with `process.stdout.write()`:
> - `\x1b[nA` cursor up n rows, `\x1b[2K` clear entire line
> - `\x1b[?25l` / `\x1b[?25h` hide/show cursor during renders
> - Or use Node.js built-in `readline.moveCursor()`, `readline.clearLine()`
> - Check `process.stdout.isTTY` before using ANSI codes
> - Batch all output into a single `write()` call to avoid flicker
> - Register SIGINT/SIGTERM handlers to restore cursor visibility on exit
>
> See: [Li Haoyi — Build Your Own Command Line with ANSI Escape Codes](https://www.lihaoyi.com/post/BuildyourownCommandLinewithANSIescapecodes.html)
<!-- /deepen-plan -->
  ```
  Cycle: Sprint 14 (cycle-abc123)
  Issues: 12 total | 3 done | 1 running | 0 failed | 8 pending

    #  Issue       Title                          Status      Duration
    1  CDMCH-101   Add OAuth2 flow                done        2m 34s
    2  CDMCH-102   Fix rate limiter bug            done        1m 12s
    3  CDMCH-103   Update error messages        -> running     0m 22s
    4  CDMCH-104   Refactor adapter layer          pending     -
    ...

  Elapsed: 4m 08s | Rate limit: 1,412 / 1,500 remaining
  ```
- [ ] 5.3: Implement `renderCycleSummary()` — final static table with totals
  and "needs attention" list for failed issues
- [ ] 5.4: Implement JSON output mode — emit full `CycleResult` to stdout
- [ ] 5.5: Follow existing conventions: Unicode box-drawing chars, check/cross
  marks, 2-space indentation (per `src/cli/status/renderers.ts` patterns)

### Phase 6: Testing

- [ ] 6.1: Unit tests for `LinearAdapter` cycle methods — mock GraphQL
  responses, test rate limit integration
- [ ] 6.2: Unit tests for `CycleIssueOrderer` — topological sort with various
  graph shapes, cycle detection, priority fallback
- [ ] 6.3: Unit tests for `CycleOrchestrator` — mock `PipelineOrchestrator`,
  test skip/fail-fast/skip-and-continue/plan-only
- [ ] 6.4: Unit tests for `Cycle` command — flag parsing, dry-run output,
  error handling (cycle not found, no active cycle, linear not configured)
- [ ] 6.5: Integration test — subprocess test via `execSync` for `--dry-run`
  and `--json` modes (following `doctor.spec.ts` pattern)

## Technical Specifications

### Files to Create

| File | Purpose |
|------|---------|
| `src/cli/commands/cycle.ts` | CLI command extending `TelemetryCommand` |
| `src/cli/cycleOutput.ts` | Dashboard and summary rendering |
| `src/cli/cycleTypes.ts` | `CycleFlags`, `CyclePayload` types |
| `src/workflows/cycleOrchestrator.ts` | Sequential issue processing loop |
| `src/workflows/cycleIssueOrderer.ts` | Topological sort + priority ordering |
| `src/workflows/cycleTypes.ts` | `CycleOrchestratorConfig`, `CycleResult`, `CycleIssueResult` |
| `tests/unit/commands/cycle.spec.ts` | Command tests |
| `tests/unit/cycleOrchestrator.spec.ts` | Orchestrator tests |
| `tests/unit/cycleIssueOrderer.spec.ts` | Ordering tests |

### Files to Modify

| File | Change |
|------|--------|
| `src/adapters/linear/LinearAdapter.ts` | Add `fetchCycleIssues()`, `fetchActiveCycle()`, 2 GraphQL queries |
| `src/adapters/linear/LinearAdapterTypes.ts` | Add `LinearIssueRelation`, `LinearCycleIssue`, `LinearCycle`, `CycleSnapshot` + Zod schemas |
| `src/cli/utils/cliErrors.ts` | Add `CYCLE_NOT_FOUND`, `CYCLE_FETCH_FAILED` error codes |
| `src/adapters/index.ts` | Add barrel exports for new cycle types (lines 39-49) |
| `tests/unit/linearAdapter.spec.ts` | Add tests for new cycle methods |

<!-- deepen-plan: codebase -->
> **Codebase:** When adding to `CliErrorCode` enum, you must update three
> maps atomically: the enum itself, `EXIT_CODE_MAP` (exhaustive
> `Record<CliErrorCode, number>`), and optionally `DOCS_ANCHOR_MAP`. Suggested
> mappings: `CYCLE_NOT_FOUND → 10` (validation-class), `CYCLE_FETCH_FAILED → 1`
> (same as `LINEAR_API_FAILED`). Also update `src/adapters/index.ts` (lines
> 39-49) barrel exports for new Linear types.
<!-- /deepen-plan -->

### Files NOT Modified

| File | Reason |
|------|--------|
| `src/workflows/pipelineOrchestrator.ts` | Used as-is; Approach A requires no interface changes |
| `src/persistence/runLifecycle.ts` | `createRunDirectory()` works for per-issue dirs |
| `src/cli/telemetryCommand.ts` | `runWithTelemetry()` works as-is |

### Key Type Definitions

```typescript
// src/adapters/linear/LinearAdapterTypes.ts (new types)
interface LinearIssueRelation {
  type: 'blocks' | 'duplicate' | 'related';
  issue: { id: string; identifier: string };
  relatedIssue: { id: string; identifier: string };
}

interface LinearCycleIssue extends LinearIssue {
  relations: LinearIssueRelation[];
}

interface LinearCycle {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  issues: LinearCycleIssue[];
}

interface CycleSnapshot {
  cycle: LinearCycle;
  metadata: { retrievedAt: string; teamId: string; issueCount: number };
}
```

```typescript
// src/workflows/cycleTypes.ts
interface CycleOrchestratorConfig {
  repoRoot: string;
  cycleBaseDir: string;
  cycleId: string;
  cycleName: string;
  repoConfig: RepoConfig;
  logger: StructuredLogger;
  metrics: MetricsCollector;
  failFast: boolean;
  planOnly: boolean;
  maxIssues: number;
  onIssueComplete?: (result: CycleIssueResult) => void;
}

interface CycleIssueResult {
  issueId: string;
  identifier: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped';
  skipReason?: string;
  runDir?: string;
  durationMs: number;
  error?: string;
}

interface CycleResult {
  cycleId: string;
  cycleName: string;
  startedAt: string;
  completedAt: string;
  totalIssues: number;
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  issues: CycleIssueResult[];
  durationMs: number;
}
```

### GraphQL Queries

```graphql
# CYCLE_ISSUES_QUERY
query GetCycleIssues($cycleId: String!) {
  cycle(id: $cycleId) {
    id
    name
    number
    startsAt
    endsAt
    issues {
      nodes {
        id identifier title description
        state { id name type }
        priority
        labels { nodes { id name color } }
        assignee { id name email }
        team { id name key }
        project { id name }
        createdAt updatedAt url
        relations {
          nodes {
            type
            relatedIssue { id identifier }
          }
        }
      }
    }
  }
}

# ACTIVE_CYCLE_QUERY
query GetActiveCycle($teamId: String!) {
  team(id: $teamId) {
    activeCycle { id name number }
  }
}
```

### Run Directory Structure

```
.codepipe/runs/
  cycle-<cycleId>/
    manifest.json           # Cycle-level metadata
    report.json             # Final CycleResult
    issues/
      CDMCH-101/            # Standard per-issue run directory
        manifest.json
        artifacts/
        logs/
        queue/
      CDMCH-102/
        ...
```

### Command Signature

```
codepipe cycle [--cycle <id>] [--plan-only] [--fail-fast] [--dry-run]
               [--json] [--verbose] [--max-issues <n>]
```

## Testing Strategy

- **Unit tests** (vitest, mocked): Adapter methods, orderer algorithm,
  orchestrator loop logic, command flag parsing
- **Integration tests** (subprocess via `execSync`): `--dry-run` and `--json`
  flag output, error handling for missing config
- **Pattern**: Follow `tests/unit/commands/doctor.spec.ts` for command tests,
  `tests/unit/pipelineOrchestrator.spec.ts` for orchestrator tests

## Acceptance Criteria

1. `codepipe cycle` processes all issues in the active Linear cycle sequentially
2. `codepipe cycle --cycle "Sprint 14"` resolves a specific cycle by name
3. Issues are ordered by dependency (blocked issues after their blockers) then
   by priority
4. Issues in Done/Cancelled/In Review states are automatically skipped
5. Re-running after interruption skips already-completed issues
6. `--plan-only` generates PRDs without task execution for each issue
7. `--fail-fast` stops on the first issue failure
8. `--dry-run` shows the ordered issue list without processing
9. A JSON report is written to `.codepipe/runs/cycle-<id>/report.json`
10. A terminal summary table shows completed/skipped/failed counts
11. `--json` outputs the full CycleResult to stdout

## Edge Cases and Error Handling

| Scenario | Behavior |
|----------|----------|
| No active cycle | `CliError(CYCLE_NOT_FOUND)` with remediation |
| Cycle has no issues | Report empty and exit 0 |
| All issues already Done | Report "all completed" and exit 0 |
| `linear.enabled` is false | `CliError(CONFIG_INVALID)` with remediation |
| `linear.team_id` not set | `CliError(CONFIG_INVALID)` — suggest `codepipe init` |
| GraphQL rate limit (429) | `assertRateLimitHeadroom()` handles backoff transparently |
| Issue pipeline fails | Log error, mark failed, continue (or stop if fail-fast) |
| Dependency cycle in issues | Warn, append cycle-involved issues at end by priority |
| `--max-issues` exceeded | Stop after N processed issues, note remaining in summary |
| Approval required per PRD | Skip issue, report in summary as "approval required" |

## Performance Considerations

- **Rate limits:** ~2-4 Linear API calls per issue + 1-2 for cycle fetch.
  15-issue cycle = ~32-62 requests against 1,500/hr budget. Well within limits.
- **Context aggregation:** Repeated per issue (Approach A tradeoff). Typically
  5-15s per issue. Acceptable for cycles of 5-20 issues.
- **Run directory size:** Each issue creates a standard run dir (~100KB-1MB).
  A 20-issue cycle = ~2-20MB total.

## Security Considerations

- Linear API key read from env var specified in `RepoConfig.linear.api_key_env_var`
- Issue ID validation via existing `validateIssueId()` in LinearAdapter
- No user input interpolated into GraphQL queries (parameterized)
- Cycle ID validated as UUID format before API call

<!-- deepen-plan: codebase -->
> **Codebase:** `validateIssueId()` (`LinearAdapter.ts:529`) accepts
> `TEAM-123` format or UUID format. Cycle IDs in Linear are UUIDs only — a
> new `validateCycleId()` method (or reuse the UUID branch of
> `validateIssueId`) is needed. Do not pass cycle names to `validateIssueId()`
> as they will fail validation.
<!-- /deepen-plan -->

## References

- Brainstorm: `docs/brainstorms/2026-03-19-cycle-runner-core-brainstorm.md`
- Previous brainstorm: `docs/brainstorms/2026-03-19-cycle-runner-brainstorm.md`
- Previous plan (superseded): `plans/linear-run-cycle.md`
- `src/cli/telemetryCommand.ts` — TelemetryCommand base class
- `src/workflows/pipelineOrchestrator.ts` — PipelineOrchestrator (used per-issue)
- `src/adapters/linear/LinearAdapter.ts` — LinearAdapter (to be extended)
- `src/cli/commands/resume.ts` — Modern TelemetryCommand example
- `src/cli/utils/cliErrors.ts` — Error code registry
- Linear API: [Rate Limiting](https://linear.app/developers/rate-limiting)
- Linear API: [Issue Relations](https://linear.app/docs/issue-relations)

## Stack Decomposition
<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. feat/cycle-adapter-types
- **Type:** feat
- **Description:** Add cycle and relation types to LinearAdapter
- **Scope:** src/adapters/linear/LinearAdapterTypes.ts, src/adapters/index.ts
- **Tasks:** 1.1
- **Depends on:** (none)

### 2. feat/cycle-adapter-queries
- **Type:** feat
- **Description:** Add fetchCycleIssues and fetchActiveCycle to LinearAdapter
- **Scope:** src/adapters/linear/LinearAdapter.ts, src/cli/utils/cliErrors.ts, tests/unit/linearAdapter.spec.ts
- **Tasks:** 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- **Depends on:** #1

### 3. feat/cycle-issue-orderer
- **Type:** feat
- **Description:** Add topological sort for cycle issue ordering
- **Scope:** src/workflows/cycleIssueOrderer.ts, tests/unit/cycleIssueOrderer.spec.ts
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- **Depends on:** #1

### 4. feat/cycle-orchestrator
- **Type:** feat
- **Description:** Add CycleOrchestrator for sequential issue processing
- **Scope:** src/workflows/cycleTypes.ts, src/workflows/cycleOrchestrator.ts, tests/unit/cycleOrchestrator.spec.ts
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
- **Depends on:** #2, #3

### 5. feat/cycle-output
- **Type:** feat
- **Description:** Add cycle dashboard and summary rendering
- **Scope:** src/cli/cycleOutput.ts, src/cli/cycleTypes.ts
- **Tasks:** 4.5, 5.1, 5.2, 5.3, 5.4, 5.5
- **Depends on:** #4

### 6. feat/cycle-command
- **Type:** feat
- **Description:** Add codepipe cycle CLI command
- **Scope:** src/cli/commands/cycle.ts, tests/unit/commands/cycle.spec.ts
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 6.5
- **Depends on:** #4, #5

## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. feat/cycle-adapter-types (completed 2026-03-19)
- [x] 2. feat/cycle-adapter-queries (completed 2026-03-19)
- [x] 3. feat/cycle-issue-orderer (completed 2026-03-19)
- [x] 4. feat/cycle-orchestrator (completed 2026-03-19)
- [x] 5. feat/cycle-output (completed 2026-03-19)
- [x] 6. feat/cycle-command (completed 2026-03-19)
