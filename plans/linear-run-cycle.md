# Feature: `/linear:run-cycle` — Sequential Cycle Runner

## Overview

Add a new `/linear:run-cycle` command to the yellow-linear plugin that
sequentially processes all issues in a Linear cycle. The user kicks off a single
command and the runner fetches each issue, invokes `/linear:work` (which chains
to `/workflows:plan` and `/workflows:work`), updates Linear status, and moves
to the next issue until the cycle is complete.

This fills the gap between `/linear:plan-cycle` (selects issues into a cycle)
and `/linear:work` (works on a single issue). The cycle runner is the sequential
automation layer that chains existing primitives together.

## Problem Statement

### Current Pain Points

- After sprint planning (`/linear:plan-cycle`), each issue must be started
  manually with `/linear:work <issue-id>`. For a 10-issue cycle, that means 10
  manual invocations with context switching between each.
- No way to "fire and forget" a cycle — the user must babysit each transition.
- No dependency-aware ordering — the user must manually determine which issues
  to work first based on blockers.

### User Impact

A single command replaces 10+ manual invocations per sprint, enabling hands-off
autonomous implementation of an entire cycle.

### Business Value

Maximizes throughput of the codemachine-pipeline by automating the last manual
step in the sprint execution workflow.

## Proposed Solution

### High-Level Architecture

A new plugin command (`run-cycle.md`) in `yellow-linear/commands/linear/` that:

1. Resolves the target cycle and fetches its issues via MCP
2. Computes a dependency-aware, priority-sorted execution order
3. Loops through issues, invoking `/linear:work` per issue via the Skill tool
4. Renders a live-updating progress dashboard between iterations
5. Uses Linear-as-source-of-truth for skip logic and implicit resumability

The command is purely additive — no core TypeScript codebase changes needed.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — no existing command in yellow-linear implements
> sequential cycle execution. The plugin command format is verified: `.md`
> files with YAML frontmatter (`name`, `description`, `argument-hint`,
> `allowed-tools`) at `commands/linear/`. The Skill tool invocation pattern
> for chaining commands is established in `/linear:work` (line 182-188) and
> `/linear:plan-cycle` (step 8). The CLAUDE.md at the plugin root registers
> all commands and will need a new entry for `/linear:run-cycle`.
<!-- /deepen-plan -->

### Key Design Decisions

1. **Plugin command (Approach A)** over core pipeline extension — all
   Linear-specific logic belongs in the plugin, and the Skill invocation chain
   is proven.
2. **Configurable execution mode** — `--plan-only` for brainstorm + plan docs
   only; full execution by default.
3. **Configurable error handling** — skip-and-continue by default; `--fail-fast`
   to stop on first failure.
4. **Priority + dependency ordering** — topological sort on blocks/blocked-by
   relationships, falling back to priority order for unrelated issues.
5. **Linear-as-source-of-truth** — no local state file; skip Done/In Review
   issues on each iteration; re-running resumes implicitly.
6. **Rich terminal dashboard** — live-updating table showing per-issue status,
   timing, and running totals.

### Trade-offs Considered

| Decision | Alternative | Why chosen |
|----------|------------|------------|
| Plugin command | Core CLI command | YAGNI — no second consumer yet; plugin can iterate independently |
| Linear-as-source-of-truth | Local checkpoint file | Simpler; resumability is implicit; no state file management |
| Sequential processing | Parallel worktrees | Sequential is simpler, avoids branch conflicts; `--parallel N` deferred to v2 |
| Best-effort dependency ordering | Strict topological enforcement | `list_issues` MCP tool may not expose relationships; graceful fallback is safer |

## Implementation Plan

### Phase 1: Command Scaffold and Cycle Resolution

- [ ] 1.1: Create `commands/linear/run-cycle.md` with frontmatter (name,
  description, argument-hint, allowed-tools)
- [ ] 1.2: Implement argument parsing — accept cycle name or default to current
  active cycle
- [ ] 1.3: Implement team auto-detection (reuse pattern from `plan-cycle.md`)
- [ ] 1.4: Resolve cycle via `list_cycles` MCP tool — match by name
  (case-insensitive substring)
- [ ] 1.5: Fetch all issues in the resolved cycle via `list_issues`
- [ ] 1.6: Parse CLI flags: `--plan-only`, `--fail-fast`, `--max-issues N`,
  `--pacing-seconds N`

### Phase 2: Issue Ordering

- [ ] 2.1: Implement priority-based sorting (Urgent > High > Medium > Low > None)
- [ ] 2.2: Attempt dependency-aware ordering — for each issue, call `get_issue`
  to check for `relations` field containing blocks/blocked-by data
- [ ] 2.3: If relationship data is available, build a topological sort; if a
  cycle exists in dependencies, warn and fall back to priority-only
- [ ] 2.4: If relationship data is unavailable, fall back gracefully to
  priority-only ordering with a note in the dashboard

<!-- deepen-plan: external -->
> **Research:** The Linear GraphQL API exposes first-class `blocks` and
> `blockedBy` connection fields on the `Issue` type, returning
> `IssueConnection` with `nodes`, `edges`, and `pageInfo`. However, the
> Linear MCP server (`mcp.linear.app/mcp`) may not surface these fields in
> `get_issue` responses. **Action:** Test `get_issue` output for a known
> blocked issue before implementing. If absent, the MCP tool `list_issues`
> with `cycle` filter is confirmed available for fetching cycle issues, but
> dependency data will require either a future MCP tool or direct GraphQL
> queries.
>
> For topological sort, **Kahn's algorithm (BFS-based)** is recommended over
> DFS because it naturally detects cycles — any nodes remaining unprocessed
> after the algorithm completes are in cycles. It produces a valid ordering
> of the acyclic portion without extra work. Implementation is ~40 lines
> inline; no library dependency needed (existing libraries like `toposort`
> throw on cycles rather than returning partial results).
>
> See: [Linear API Schema — Issue type](https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/types/Issue)
<!-- /deepen-plan -->

### Phase 3: Skip Logic and Status Filtering

- [ ] 3.1: Before processing each issue, query Linear for current status via
  `get_issue`
- [ ] 3.2: Implement skip rules:
  - Done / Cancelled → skip (already handled)
  - In Review → skip (PR submitted)
  - In Progress (assigned to someone else) → warn and skip by default
  - In Progress (self or unassigned) / Backlog / Todo / Triage → process
- [ ] 3.3: Respect `--max-issues` cap — stop after N issues processed
  (skipped issues don't count toward the cap)

### Phase 4: Per-Issue Execution Loop

- [ ] 4.1: For each issue in the computed order, invoke `/linear:work` via the
  Skill tool with the issue ID as args
- [ ] 4.2: In `--plan-only` mode, modify the invocation to only produce
  brainstorm doc + plan (stop before `/workflows:work`). This requires the
  loop to invoke `/linear:work` and then `/workflows:plan` directly rather
  than letting `/linear:work` route to full execution

<!-- deepen-plan: codebase -->
> **Codebase:** `/linear:work` (step 5) presents routing options via
> `AskUserQuestion` — the user chooses between plan, stack, or "just load
> context." In `--plan-only` mode, the cycle runner cannot use
> `AskUserQuestion` interactively per issue (defeats automation). **Two
> options:** (1) Bypass `/linear:work` entirely and replicate steps 1-4
> (validate, display, write brainstorm doc) inline, then invoke
> `/workflows:plan` directly. (2) Invoke `/linear:work` but instruct it to
> auto-select "Plan this issue" without prompting. Option 1 is more
> reliable since it avoids depending on `/linear:work`'s interactive flow.
<!-- /deepen-plan -->
- [ ] 4.3: Capture per-issue outcome: success, skipped (with reason), or
  failed (with error message)
- [ ] 4.4: Add configurable pacing delay between issues (default: 2 seconds)
  for rate-limit safety
- [ ] 4.5: Implement `--fail-fast` behavior — if set and an issue fails, stop
  the loop immediately

### Phase 5: Progress Dashboard

- [ ] 5.1: Render an initial dashboard showing cycle name, team, and the full
  issue queue with statuses
- [ ] 5.2: Update the dashboard after each issue completes — show status
  (Done/Skipped/Failed/Working/Queued), elapsed time per issue, and running
  totals
- [ ] 5.3: Show estimated remaining time based on average per-issue duration
- [ ] 5.4: Display a final summary at completion with:
  - Total completed / skipped / failed counts
  - "Needs attention" list for failed issues (with error + brainstorm/plan
    doc path)
  - Total elapsed time
  - Suggested next steps

### Phase 6: Error Handling and Edge Cases

- [ ] 6.1: Handle empty cycle (no issues) — report and stop
- [ ] 6.2: Handle all issues already Done/In Review — report and stop
- [ ] 6.3: Handle Skill invocation failure (yellow-core not installed) —
  report install command and manual alternative
- [ ] 6.4: Handle rate limiting (429 from MCP) — pause with exponential backoff,
  surface in dashboard
- [ ] 6.5: Handle context window pressure for large cycles — recommend batching
  at >15 issues, hard-cap at 30

## Technical Specifications

### File to Create

- `yellow-linear/commands/linear/run-cycle.md` — the command definition

### Command Frontmatter

```yaml
---
name: linear:run-cycle
description: "Run through an entire Linear cycle sequentially. Use when user
  says 'run the cycle', 'process all issues', 'execute the sprint', or wants
  batch cycle execution."
argument-hint: '[cycle-name] [--plan-only] [--fail-fast] [--max-issues N]
  [--pacing-seconds N]'
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - ToolSearch
  - Skill
  - mcp__plugin_yellow-linear_linear__list_cycles
  - mcp__plugin_yellow-linear_linear__list_issues
  - mcp__plugin_yellow-linear_linear__get_issue
  - mcp__plugin_yellow-linear_linear__list_teams
  - mcp__plugin_yellow-linear_linear__list_issue_statuses
  - mcp__plugin_yellow-linear_linear__list_comments
  - mcp__plugin_yellow-linear_linear__update_issue
---
```

### Command Workflow Structure

```
Step 1: Parse Arguments and Flags
Step 2: Resolve Team Context (auto-detect from git remote)
Step 3: Resolve Cycle (match by name or use active cycle)
Step 4: Fetch and Order Issues (priority + dependency-aware)
Step 5: Render Initial Dashboard
Step 6: Execution Loop
  For each issue:
    6a: Check status (skip logic)
    6b: Update dashboard → "Working"
    6c: Invoke /linear:work (or plan-only variant)
    6d: Update dashboard → outcome
    6e: Pacing delay
Step 7: Final Summary (completed/skipped/failed + needs-attention list)
```

### Dashboard Rendering

```
Cycle: Sprint 42  |  Team: codemachine-pipeline
============================================================
 #  Issue       Title                     Status     Time
------------------------------------------------------------
 1  CDMCH-240   Add auth middleware        Done       3m 12s
 2  CDMCH-241   Fix rate limit header      Done       2m 45s
 3  CDMCH-242   Refactor error types    -> Working    1m 03s
 4  CDMCH-243   Update API docs            Queued     -
 5  CDMCH-244   Add integration tests      Queued     -
------------------------------------------------------------
Progress: 2/5 complete  |  1 in progress  |  0 failed
Elapsed: 7m 00s  |  Est. remaining: ~9m
```

Rendered as markdown-formatted text output between Skill invocations. The
dashboard is reprinted after each issue completes (not a true TUI — just
sequential text output that shows the current state).

<!-- deepen-plan: external -->
> **Research:** Since this is a plugin command (LLM prompt, not compiled
> TypeScript), libraries like `listr2` or `log-update` are not applicable.
> The dashboard is plain text output between Skill invocations — this is the
> correct approach. For reference, the existing codebase uses section-based
> rendering with Unicode box-drawing chars (`\u2500`), check/cross marks
> (`\u2713`/`\u2717`), and 2-space indentation (see
> `src/cli/status/renderers.ts` and `src/cli/resumeOutput.ts`). Follow these
> conventions for visual consistency.
<!-- /deepen-plan -->

### MCP Tools Required

| Tool | Usage |
|------|-------|
| `list_teams` | Team auto-detection |
| `list_cycles` | Resolve cycle by name |
| `list_issues` | Fetch issues in cycle |
| `get_issue` | Validate each issue, check status, check relations |
| `list_issue_statuses` | Resolve status IDs dynamically |
| `update_issue` | Status transitions (Tier 1: auto-apply for In Progress) |
| `list_comments` | Issue context loading (via /linear:work) |

### Dependencies on Other Commands

| Command | Required? | Usage |
|---------|-----------|-------|
| `/linear:work` | Yes | Per-issue entry point (brainstorm + routing) |
| `/workflows:plan` | Yes (via /linear:work) | Plan generation |
| `/workflows:work` | No (only in full execution mode) | Implementation execution |

## Testing Strategy

This is a plugin command (a `.md` prompt file), not TypeScript code. Testing is
done via manual execution against a real Linear cycle.

### Manual Testing Checklist

- [ ] Run against a cycle with 3-5 issues — verify all are processed in order
- [ ] Run with `--plan-only` — verify only brainstorm + plan docs are created
- [ ] Run with `--fail-fast` — verify it stops on first failure
- [ ] Run against a cycle with some Done/In Review issues — verify they're skipped
- [ ] Interrupt mid-run and re-run — verify it resumes from where it left off
- [ ] Run against an empty cycle — verify clean error message
- [ ] Run against a cycle with >15 issues — verify warning is shown
- [ ] Run with `--max-issues 3` — verify it caps at 3 processed issues
- [ ] Verify dashboard renders correctly with mixed statuses
- [ ] Verify "needs attention" summary lists failed issues with paths

## Acceptance Criteria

1. `/linear:run-cycle` command processes all issues in a Linear cycle
   sequentially without manual intervention between issues
2. Issues are ordered by priority (Urgent first) with best-effort dependency
   awareness
3. `--plan-only` flag produces brainstorm + plan docs only (no implementation)
4. `--fail-fast` flag stops execution on first issue failure
5. Already-completed issues (Done/In Review) are automatically skipped
6. Re-running the command after interruption resumes from where it left off
   (implicit via Linear status)
7. A progress dashboard shows per-issue status, timing, and running totals
8. A final summary shows completed/skipped/failed counts and a "needs
   attention" list for failures
9. Rate limiting is respected with configurable pacing between issues

## Edge Cases and Error Handling

| Scenario | Behavior |
|----------|----------|
| Empty cycle | Report "Cycle has no issues" and stop |
| All issues Done/In Review | Report "All issues already completed" and stop |
| No active cycle found | Report and suggest creating one in Linear UI |
| MCP rate limit (429) | Pause with exponential backoff, surface in dashboard |
| `/linear:work` fails for an issue | Log error, mark as failed, continue to next (or stop if `--fail-fast`) |
| yellow-core not installed | Report install command, describe manual workflow |
| Cycle has >30 issues | Hard-cap at 30, warn about rate limits |
| Issue moved by someone else mid-run | Re-check status before processing; skip if now Done/In Review |
| Dependency cycle detected | Warn and fall back to priority-only ordering |
| Context window pressure | Recommend batching at >15 issues |

<!-- deepen-plan: codebase -->
> **Codebase:** The existing `linear-workflows` skill (lines 249-256)
> documents bulk operation rate limiting: add delay between writes for
> batches >5 items, exponential backoff on 429, and report partial failures
> with offer to retry remaining items. The cycle runner should follow this
> same pattern. Also note: the `plan-cycle.md` command (step 6) implements
> C1+H1 validation (re-fetch before write) which the cycle runner should
> replicate in its skip logic — re-fetch each issue status via `get_issue`
> before processing to detect concurrent changes.
<!-- /deepen-plan -->

## Security Considerations

- **C1 validation:** Every issue ID is validated via `get_issue` before
  operations
- **Input validation:** Cycle name validated (alphanumeric, spaces, hyphens,
  max 100 chars) before MCP tool use
- **Tier 1 auto-apply:** Only "In Progress" transitions are auto-applied
  (reversible, non-destructive)
- **Prompt injection protection:** Issue descriptions and comments are wrapped
  in `--- begin/end ---` reference-only delimiters (inherited from
  `/linear:work`)
- **No shell interpolation:** All arguments passed as MCP tool parameters, never
  interpolated into shell commands

## Performance Considerations

- **Rate limits:** ~6-10 MCP calls per issue (get_issue, list_comments,
  update_issue, etc.). For 15 issues, ~90-150 calls against Linear's
  API limit.
- **Pacing:** Default 2-second delay between issues to stay within rate budgets

<!-- deepen-plan: external -->
> **Research:** The actual Linear API rate limit is **5,000 requests/hour**
> (API key or OAuth), not 1,500. The 1,500 figure in the codebase
> (`LinearAdapter.ts:155`) is a conservative client-side cap. Additionally,
> Linear enforces a **complexity limit of 3,000,000 points/hour** (2M for
> OAuth apps). Each property costs 0.1 points, each object 1 point, and
> connections multiply by the pagination argument. A typical 15-issue cycle
> run (~90-150 requests) is well under both limits. Monitor via response
> headers: `X-RateLimit-Requests-Remaining` and
> `X-RateLimit-Complexity-Remaining`. Rate limit errors return HTTP 400 with
> `errors[].extensions.code === "RATELIMITED"`.
>
> See: [Linear Developers — Rate Limiting](https://linear.app/developers/rate-limiting)
<!-- /deepen-plan -->
- **Throughput estimates:**
  - Plan-only mode: ~30 issues/hour (API-bound)
  - Full execution mode: ~5-8 issues/hour (implementation time)
- **Context window:** Each `/linear:work` invocation via Skill tool gets a
  scoped sub-context. The outer loop maintains only the issue list, statuses,
  and error log.

## Future Considerations (v2)

- `--parallel N` flag for parallel issue processing in separate worktrees
- `--delegate-label <label>` for mixed mode (some issues to Devin, others local)
- `list_issue_relations` MCP tool for proper dependency graph (if MCP server
  adds it)
- Persistent run log written to `docs/cycle-runs/` for audit trail

## References

<!-- deepen-plan: external -->
> **Research — additional references:**
> - [Linear API — Issue Relations docs](https://linear.app/docs/issue-relations)
> - [Linear Developers — GraphQL Getting Started](https://linear.app/developers/graphql)
> - [Kahn's Algorithm — practical walkthrough](https://gaultier.github.io/blog/kahns_algorithm.html)
> - [xavd.id — dependency tree CLI using Linear's API](https://xavd.id/blog/post/perfect-project-management-with-linear/)
<!-- /deepen-plan -->

- Brainstorm: `docs/brainstorms/2026-03-19-cycle-runner-brainstorm.md`
- `/linear:work` command: `yellow-linear/commands/linear/work.md`
- `/linear:plan-cycle` command: `yellow-linear/commands/linear/plan-cycle.md`
- `linear-workflows` skill: `yellow-linear/skills/linear-workflows/SKILL.md`
- `/workflows:plan` command: `yellow-core/commands/workflows/plan.md`
- `/workflows:work` command: `yellow-core/commands/workflows/work.md`
- Plugin CLAUDE.md: `yellow-linear/CLAUDE.md`
