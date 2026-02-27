# Technical Debt Audit Report — 2026-02-24

## Executive Summary

Five scanners completed successfully across 148-150 source files. After deduplication and merging (2 cross-scanner overlaps resolved), this audit surfaces **109 net findings** across five categories. The codebase carries a high concentration of security debt (5 high-severity shell-injection and unvalidated-deserialization findings), architecture debt (2 confirmed circular dependencies, 10 god modules exceeding 500 LOC), and systemic AI-generated code patterns that inflate comment noise without informational value.

| Metric                       | Value                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Total findings (pre-dedup)   | 105 raw (19 + 24 + 17 + 25 + 20)                      |
| Findings after deduplication | 109 net (2 merges resolved into consolidated entries) |
| Critical                     | 2                                                     |
| High                         | 28                                                    |
| Medium                       | 55                                                    |
| Low                          | 24                                                    |
| Estimated total effort       | ~47 person-days                                       |
| New todo files created       | 109 (IDs 101-209)                                     |

---

## Scanner Status

| Scanner               | Status  | Files Scanned | Findings | Duration |
| --------------------- | ------- | ------------- | -------- | -------- |
| ai-patterns-scanner   | success | 148           | 19       | 180s     |
| complexity-scanner    | success | 146           | 24       | 90s      |
| duplication-scanner   | success | 97            | 17       | 120s     |
| architecture-scanner  | success | 150           | 25       | 180s     |
| security-debt-scanner | success | 97            | 20       | 180s     |

All five scanners reported schema version 1.0 and completed without error.

**Deduplication notes:**

- `patchManager getCurrentGitRef shell pipeline` appeared in both security-debt-scanner (high) and as a separate medium finding. Merged; retained as a single high-severity entry (todo 103).
- `loadIntegrationsStatus` duplication appeared in both complexity-scanner (high) and duplication-scanner (medium). Merged; retained as a single high-severity entry (todo 152).

---

## Category Breakdown

### Security (todos 101-120) — 5 high, 9 medium, 6 low

The most urgent findings. Three shell-injection vectors in `branchManager.ts` and `patchManager.ts` use `exec()` with template-literal command strings instead of `execFile()` with argument arrays. Ten call sites throughout the codebase deserialize JSON from run-directory files using bare TypeScript `as` casts, bypassing the Zod `validateOrThrow` infrastructure that already exists and is used correctly elsewhere.

**Critical path items:**

- **101 (high)**: Six `exec()` template-literal calls in `branchManager.ts` — active shell injection risk on branch operations
- **102 (high)**: Commit message shell injection in `createSafeCommit`
- **104 (high)**: 10-site unvalidated JSON deserialization — covers `approvalRegistry`, `costTracker`, `deployment/context`, `resumeCoordinator`
- **105 (high)**: Patch files written to world-writable `/tmp` without secure permissions or stdin alternative
- **108 (medium)**: Approval registry deserialization controls gate authorization — highest business impact of the medium-severity JSON findings

### Architecture (todos 121-147) — 2 critical, 10 high, 13 medium, 2 low

Two **confirmed circular dependencies** detected by madge are the only critical findings in this audit. All other architecture findings are high or medium but involve significant refactoring effort.

**Critical:**

- **121 (critical)**: `taskPlanner` ↔ `taskPlannerGraph` cycle — confirmed by madge. Fix: extract `taskPlannerTypes.ts`
- **122 (critical)**: `queueStore` ↔ `queueTaskManager` cycle — confirmed by madge, acknowledged in a code comment

**God modules (10 total):**

| Todo | File                                  | LOC  | Exports |
| ---- | ------------------------------------- | ---- | ------- |
| 123  | `persistence/runDirectoryManager.ts`  | 1144 | 30      |
| 129  | `workflows/specComposer.ts`           | 921  | 9       |
| 124  | `cli/status/data.ts`                  | 934  | 15      |
| 130  | `workflows/resumeCoordinator.ts`      | 816  | 10      |
| 131  | `workflows/writeActionQueue.ts`       | 813  | —       |
| 128  | `core/config/RepoConfig.ts`           | 805  | 23      |
| 145  | `adapters/github/branchProtection.ts` | 769  | 12      |
| 141  | `workflows/contextSummarizer.ts`      | 765  | 12      |
| 144  | `workflows/prdAuthoringEngine.ts`     | 681  | 12      |
| 142  | `workflows/contextAggregator.ts`      | 678  | 6       |
| 140  | `workflows/cliExecutionEngine.ts`     | 731  | 4       |
| 132  | `workflows/validationRegistry.ts`     | 570  | 19      |

**Boundary violations:**

- **125**: `utils/errors.ts` imports from `adapters/http/client.ts` — inverted layering
- **126**: `resume.ts` imports business logic from sibling command `start.ts`
- **127**: 11 queue files (3410 LOC total) scattered at `workflows/` root instead of a `workflows/queue/` subdirectory

### Complexity (todos 148-173) — 7 high, 15 medium, 4 low

Seven god functions exceed 100 lines or have cyclomatic complexity above 10. The most impactful are in the CLI command layer where telemetry lifecycle management has not been fully extracted despite the `telemetryLifecycle.ts` helper existing.

**Top complexity hotspots:**

| Todo | Function                         | File                                  | LOC / CC                    |
| ---- | -------------------------------- | ------------------------------------- | --------------------------- |
| 148  | `Resume.run()`                   | `cli/commands/resume.ts`              | ~280 lines, 5+ return paths |
| 151  | `evaluateCompliance()`           | `adapters/github/branchProtection.ts` | ~180 lines, CC~18           |
| 157  | `composeSpecification()`         | `workflows/specComposer.ts`           | ~188 lines, 12 steps        |
| 164  | `recordSpecApproval()`           | `workflows/specComposer.ts`           | ~134 lines, 5 I/O ops       |
| 154  | `executeWithFallback()`          | `adapters/agents/AgentAdapter.ts`     | 103 lines, CC~10            |
| 152  | `loadIntegrationsStatus()`       | `cli/status/data.ts`                  | 60+60 duplicated lines      |
| 168  | `executeValidationWithAutoFix()` | `workflows/autoFixEngine.ts`          | ~172 lines                  |

A recurring pattern is the O(3n) queue iteration in `getReadyTasks` (todo 167) — three passes over the same Map where one pass would suffice.

### Duplication (todos 174-190) — 3 high, 10 medium, 4 low

Systemic duplication of three kinds: telemetry flush boilerplate (not migrated to shared helper), feature-ID validation guards (copy-pasted across 9 commands), and JSON error-handling patterns.

**Highest-confidence duplications (>= 0.95 confidence):**

| Todo | Pattern                               | Sites                             |
| ---- | ------------------------------------- | --------------------------------- |
| 178  | Oclif error re-throw guard            | 12 commands                       |
| 176  | PR feature-ID validation preamble     | 4 PR subcommands                  |
| 175  | Execution engine setup                | `start.ts`, `resume.ts`           |
| 174  | Inline telemetry flush                | `pr/status.ts` vs shared helper   |
| 177  | Feature-not-found guard               | 9 commands                        |
| 187  | `REPO_NOT_INITIALIZED` string literal | 3 files                           |
| 188  | Reviewer list parsing                 | `pr/create.ts`, `pr/reviewers.ts` |

The `rethrowIfOclifError` pattern (todo 178) has 0.98 confidence and appears in 12 command files — the single highest-impact quick-win in this category.

### AI Patterns (todos 191-209) — 0 high, 10 medium, 9 low

All findings are medium or low severity. The most impactful medium-severity item is the duplicated atomic write pattern (todo 200, 7+ sites) which overlaps with the duplication category. Section-banner dividers total 527 occurrences across 56 files (todo 193). Step-numbering comments total 96 instances across 10 files (todo 196).

The safeJson.ts comment ratio of 56% (todo 197) is the highest in the codebase — a 5-line function body accompanied by an 18-line documentation block.

---

## Effort Estimation

| Effort tier | Count | Est. days each | Total |
| ----------- | ----- | -------------- | ----- |
| quick       | 30    | 0.25           | 7.5   |
| small       | 44    | 0.5            | 22    |
| medium      | 30    | 1.5            | 45    |
| large       | 1     | 5              | 5     |

**Estimated total: ~47 person-days** (does not account for test updates or review cycles).

The single `large` effort item is todo 127 (queue subsystem relocation to `workflows/queue/` subdirectory) which also resolves the circular dependency in todo 122.

---

## Hotspot Files

Files appearing in the most findings across all scanners:

| File                                      | Finding count | Categories                            |
| ----------------------------------------- | ------------- | ------------------------------------- |
| `src/cli/status/data.ts`                  | 8             | complexity, duplication, architecture |
| `src/workflows/specComposer.ts`           | 6             | complexity, architecture              |
| `src/workflows/resumeCoordinator.ts`      | 5             | complexity, architecture, security    |
| `src/persistence/runDirectoryManager.ts`  | 5             | complexity, architecture, ai-patterns |
| `src/workflows/branchManager.ts`          | 4             | security (3 findings), ai-patterns    |
| `src/workflows/cliExecutionEngine.ts`     | 3             | complexity (3 findings)               |
| `src/adapters/github/branchProtection.ts` | 3             | complexity, architecture, ai-patterns |
| `src/workflows/approvalRegistry.ts`       | 3             | security, ai-patterns                 |
| `src/workflows/writeActionQueue.ts`       | 3             | security, architecture                |
| `src/workflows/contextAggregator.ts`      | 3             | security, architecture, complexity    |

---

## Severity-Weighted Score Summary

Scores calculated as `severity_weight × confidence`, sorted descending:

| Rank | Todo | Score | Finding                                      |
| ---- | ---- | ----- | -------------------------------------------- |
| 1    | 121  | 4.00  | Circular dep: taskPlanner ↔ taskPlannerGraph |
| 2    | 122  | 4.00  | Circular dep: queueStore ↔ queueTaskManager  |
| 3    | 178  | 1.96  | Oclif re-throw guard in 12 commands          |
| 4    | 176  | 1.92  | PR feature-ID preamble in 4 commands         |
| 5    | 175  | 1.90  | Execution engine setup duplication           |
| 6    | 174  | 1.94  | Telemetry flush not migrated in pr/status.ts |
| 7    | 101  | 2.76  | Shell injection exec() in branchManager      |
| 8    | 125  | 2.85  | Boundary violation utils→adapters            |
| 9    | 126  | 2.85  | Boundary violation resume→start              |
| 10   | 123  | 2.85  | God module runDirectoryManager 1144 LOC      |

---

## Next Steps

1. **Run `/debt:triage`** to prioritize findings for the current sprint.
2. **Address criticals first** (todos 121, 122) — both circular dependencies can be resolved in under a day and unblock the queue subdirectory migration (todo 127).
3. **Security sprint** — todos 101, 102, 103, 104, 105 are the most urgent. The `execFile` migration for `branchManager.ts` (todo 101) and the `validateOrThrow` rollout for the 10 unvalidated JSON sites (todo 104) should be treated as a single focused PR.
4. **Quick wins** — todos 178 (oclif re-throw), 176 (PR preamble), 187 (REPO_NOT_INITIALIZED constant), 188 (reviewer list parser), 193 (section-banner removal) are all under 2 hours each and can be batched.
5. **God module decomposition** — start with `cli/status/data.ts` (todo 124) since it also resolves 4 complexity findings (todos 150, 152, 162, 186) in the same file.

---

_Generated by debt synthesizer on 2026-02-24. Source: `.debt/scanner-output/` (5 scanners, schema v1.0)._
_Todo files: `todos/debt/101-pending-_.md`through`todos/debt/209-pending-_.md`_
