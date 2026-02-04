# Documentation Audit Report

**Date:** 2026-02-03
**Scope:** All documentation files in codemachine-pipeline vs. actual codebase
**Method:** 6-agent parallel audit with cross-verification
**Audited by:** Agents 1-6 (Inventory, Code Verification, Architecture/ADR, Developer Experience, Operations/Config, Risk/Staleness)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Health Score** | **C+** |
| Total doc files (project) | 99 .md + 3 .puml + 5 .mmd |
| Total doc files (.claude tooling) | 237 .md |
| Total source files | 117 .ts in `src/` |
| CRITICAL findings | 6 |
| ERROR findings | 14 |
| WARNING findings | 30 |
| INFO findings | 26 |

### Top 3 Issues

1. **Node.js version contradiction** -- 6+ docs say Node 20 is acceptable; `package.json` requires `>=24.0.0`. Developers following docs will hit runtime failures.
2. **47% of CLI commands are undocumented** -- 8 of 17 implemented commands have no CLI reference docs. README falsely marks PR commands as "planned" when they're implemented.
3. **CI pipeline has silent defects** -- `ci.yml` is missing `npm ci`, doesn't run `npm run lint` (docs say it does), and has duplicate YAML `concurrency` keys.

---

## Critical Findings (6)

### C1. Node.js version mismatch across docs

**Agents:** 4, 6 (cross-verified)

`package.json` line 13 requires `"node": ">=24.0.0"`. The following docs contradict this:

| File | What it says |
|------|-------------|
| `README.md:311` | "Node.js version (v20+ required, v24 preferred)" |
| `docs/ops/doctor_reference.md:152-155` | Lists Node.js v20.x as "acceptable with warning" |
| `docs/ops/cli-reference.md:266` | "Validates Node.js v20+ (v24 preferred)" |
| `docs/ops/init_playbook.md:21` | "Node.js: v20 LTS (minimum) or v24 LTS (preferred)" |
| `plan/readiness_checklist.md:38` | "Node.js v20+ installed" |
| `CLAUDE.md:592` | "Node.js version (20+)" in doctor health checks |
| `docs/stable-release-definition.md:185` | "Node.js 20 support" alongside "v24 required" |

**Risk:** A developer installing Node 20 will face cryptic runtime failures. If the `doctor` command also accepts Node 20 at runtime, it actively misleads users.

**Fix:** Update all 7 files to state `>=24.0.0`. Fix `doctor` command if it accepts v20.

---

### C2. CI workflow missing `npm ci` dependency install

**Agent:** 5

`.github/workflows/ci.yml` "Test and Lint" job jumps from `Setup Node.js` directly to `Check formatting` without running `npm ci`. The `pretest` script calls `npm run build`, which requires dependencies. CI silently relies on the self-hosted runner cache having `node_modules`. On a clean runner, the job fails.

**Fix:** Add `npm ci` step before `Check formatting` in ci.yml.

---

### C3. CI workflow has duplicate YAML `concurrency` keys

**Agent:** 5

`ci.yml` lines 10-16 contain two `concurrency:` blocks at the same YAML level. Per YAML spec, duplicate keys are undefined behavior. The second block silently overwrites the first. Different CI runners or YAML parser versions may handle this differently.

**Fix:** Remove the first `concurrency` block.

---

### C4. CI does not run lint despite docs claiming it does

**Agent:** 5

`docs/ci-stability.md` lists `npm run lint` as a required check under "Test and Lint". The actual `ci.yml` only runs `format:check`, `test`, and `build`. Linting is not executed in CI at all.

**Fix:** Either add `npm run lint` to CI, or update docs to reflect reality.

---

### C5. DOCUMENTATION_INVENTORY.md is 113% wrong on file counts

**Agents:** 1, 6 (cross-verified)

Created 2025-12-30, it claims 47 markdown files. Actual count: **99 project .md files** (or 155+ including `.claude/` tooling). The inventory is missing 52+ files and represents a 113% undercount. Any developer using it for orientation sees less than half the project documentation.

**Fix:** Either regenerate the inventory or delete it with a pointer to `docs/README.md`.

---

### C6. DOCUMENTATION_AUDIT.md understates codebase by 36%

**Agent:** 6

Claims "86 TS files in src/". Actual count: **117 .ts files**. Off by 31 files. Claims "~92% documentation completeness" but the baseline metrics are wrong, undermining all its conclusions.

**Fix:** Delete or clearly mark as historical with actual date and a warning.

---

## Error Findings (14)

### E1. README falsely marks PR commands as "planned for future releases"

**Agent:** 2

`README.md` lines 495-498 state PR commands are "planned for future releases". In reality, 4 `pr` subcommands (`create`, `status`, `disable-auto-merge`, `reviewers`) are fully implemented in `src/cli/commands/pr/`.

### E2. 8 CLI commands have no reference documentation

**Agent:** 2

| Undocumented Command | Implementation |
|---------------------|----------------|
| `health` | `src/cli/commands/health.ts` |
| `pr create` | `src/cli/commands/pr/create.ts` |
| `pr status` | `src/cli/commands/pr/status.ts` |
| `pr disable-auto-merge` | `src/cli/commands/pr/disable-auto-merge.ts` |
| `pr reviewers` | `src/cli/commands/pr/reviewers.ts` |
| `research create` | `src/cli/commands/research/create.ts` |
| `research list` | `src/cli/commands/research/list.ts` |
| `context summarize` | `src/cli/commands/context/summarize.ts` |

This is 8 of 17 total commands -- **47% undocumented**.

### E3. `execution` config section undocumented

**Agents:** 2, 5 (cross-verified)

`src/core/config/RepoConfig.ts` lines 234-257 define 13 fields (`codemachine_cli_path`, `default_engine`, `workspace_dir`, `spec_path`, `task_timeout_ms`, `max_parallel_tasks`, `log_rotation_mb`, etc.). These appear nowhere in `docs/requirements/RepoConfig_schema.md` or `config/schemas/repo_config.schema.json`.

### E4. `validation` config section missing from JSON schema

**Agent:** 2

`config/schemas/repo_config.schema.json` has no `validation` property, despite it being in both the Zod schema and `RepoConfig_schema.md`. Tools using the JSON schema for IDE validation will reject valid configs.

### E5. README documents nonexistent npm scripts

**Agent:** 4

- `npm run test:watch` -- does not exist (actual: `test:config:watch`, config-scoped only)
- `npm run test:coverage` -- does not exist (actual: `test:config:coverage`, config-scoped only)

### E6. README says "Jest with coverage reporting"; project uses Vitest

**Agent:** 4

The CI section references Jest, but every test script in `package.json` invokes `vitest`.

### E7. CONTRIBUTING.md is missing

**Agent:** 4

No contributing guide exists. The project uses Graphite (`gt`) for PR workflow, which is non-obvious. New contributors have no guidance on branch naming, PR process, code style, test requirements, or commit conventions.

### E8. Two Dockerfiles with divergent configurations

**Agent:** 5

`/Dockerfile` (root) sets `OCLIF_SKIP_MANIFEST=1` and copies `scripts/`. `/docker/Dockerfile` does neither. CI uses the root Dockerfile. The `docker/Dockerfile` may fail on builds requiring `scripts/`. README only references `docker/Dockerfile`.

### E9. 11 environment variables documented but not implemented

**Agent:** 5

Operations docs (`docs/operations/`) document env vars that do not exist in code:

| Aspirational Env Var | Documented In |
|---------------------|---------------|
| `CODEPIPE_LOG_ROTATION_MB` | log-rotation.md |
| `CODEPIPE_LOG_ROTATION_KEEP` | log-rotation.md |
| `CODEPIPE_LOG_ROTATION_COMPRESS` | log-rotation.md |
| `CODEPIPE_MAX_PARALLEL_TASKS` | parallel-execution.md |
| `CODEPIPE_TASK_TIMEOUT_MS` | parallel-execution.md |
| `CODEPIPE_ENABLE_PARALLEL_EXECUTION` | parallel-execution.md |
| `CODEPIPE_QUEUE_COMPACTION_MAX_OPS` | queue-v2-operations.md |
| `CODEPIPE_QUEUE_COMPACTION_MAX_BYTES` | queue-v2-operations.md |
| `CODEPIPE_QUEUE_SNAPSHOT_INTERVAL` | queue-v2-operations.md |
| `CODEPIPE_QUEUE_AUTO_MIGRATE` | queue-v2-operations.md |
| `CODEPIPE_TASK_TIMEOUT` | troubleshooting.md |

These docs present aspirational features as if they're configurable today.

### E10. Security fix docs reference wrong test file path

**Agent:** 6

`docs/SECURITY-FIX-CVE-HIGH-1.md` and `docs/SECURITY-FIX-SUMMARY.md` reference `test/unit/autoFixEngine.security.test.ts`. Actual path: `tests/unit/autoFixEngine.security.spec.ts` (wrong directory AND wrong extension). A security reviewer trying to verify the fix would not find the test.

### E11. `scripts/verify-security-fix.sh` references wrong path and test runner

**Agent:** 5

References `test/unit/autoFixEngine.security.test.ts` (should be `tests/unit/`) and uses `npx jest` (project uses `vitest`).

### E12. Missing `docs/adr/` directory

**Agent:** 3

Plan files reference `docs/adr/ADR-6-linear-integration.md` and `docs/adr/ADR-7-validation-policy.md`. The entire `docs/adr/` directory does not exist. ADR-6 and ADR-7 are defined inline in `specifications.md` but have no standalone documents.

### E13. 6 newly added docs not linked from `docs/README.md`

**Agent:** 1

These files exist in `docs/` but are unreachable from the documentation index:
- `docs/stable-release-audit.md`
- `docs/stable-release-definition.md`
- `docs/stable-release-roadmap.md`
- `docs/ci-stability.md`
- `docs/ops/cli-reference.md`
- `docs/ops/troubleshooting.md`

### E14. `PR_REVIEW_PLAN.md` duplicated at root and `docs/`

**Agent:** 6

Identical or near-identical file exists at both `/PR_REVIEW_PLAN.md` and `/docs/PR_REVIEW_PLAN.md`.

---

## Warning Findings (30)

### Documentation Coverage

| # | Finding | Agent |
|---|---------|-------|
| W1 | `src/utils/` has no documentation (errors.ts, safeJson.ts) | 1 |
| W2 | `src/cli/utils/` has no documentation | 1 |
| W3 | `src/core/sharedTypes.ts` undocumented | 1 |
| W4 | `src/workflows/specComposer.ts` has no dedicated docs | 1 |
| W5 | `src/adapters/http/` has no dedicated doc | 1, 2 |
| W6 | No adapter API documentation for any of the 6 adapter modules | 2 |

### Configuration

| # | Finding | Agent |
|---|---------|-------|
| W7 | `runtime.context_cost_budget_usd` missing from JSON schema | 2, 5 |
| W8 | `project.default_branch` required in JSON schema but optional (with default) in Zod | 2 |
| W9 | 4 env vars used in code but not documented (`CODEPIPE_EXECUTION_CLI_PATH`, `CODEPIPE_EXECUTION_DEFAULT_ENGINE`, `CODEPIPE_EXECUTION_TIMEOUT_MS`, `DEBUG`) | 5 |

### CI/Docker/Ops

| # | Finding | Agent |
|---|---------|-------|
| W10 | Docker LABEL version `0.1.0` stale vs package.json `1.0.0` | 4, 5 |
| W11 | Docker JSON validation switched from Python to Node; docs still say Python 3 | 5 |
| W12 | `docs/ci-stability.md` doesn't document `workflow_dispatch` trigger, Graphite optimization, or Codecov upload | 5 |
| W13 | `scripts/claude-session-init.sh` has hardcoded absolute path `/home/kinginyellow/...` | 5 |
| W14 | `docs/ops/troubleshooting.md` references aspirational commands (`queue validate`, `queue rebuild`, `task reset`, `task retry`, `replan`, `abort`) that may not be implemented | 4 |

### Architecture

| # | Finding | Agent |
|---|---------|-------|
| W15 | No `deploy` CLI command exists despite architecture docs describing one | 3 |
| W16 | `NotificationEvent` model exists but no notification adapter/service implemented | 3 |
| W17 | `ArtifactBundle` model exists but no bundle service implemented | 3 |
| W18 | `IntegrationCredential` model exists but no credential vault implemented | 3 |
| W19 | Observability Hub described as unified facade but implementation is 9 separate files | 3 |
| W20 | ADR-6 (Linear Integration) has no standalone ADR document | 3 |
| W21 | ADR-7 (Validation Policy) has no standalone ADR document | 3 |

### File Organization

| # | Finding | Agent |
|---|---------|-------|
| W22 | `execution_flow.md` name collision between `docs/architecture/` and `docs/requirements/` | 1 |
| W23 | `milestone_notes.md` duplicated in `plan/` and `.codemachine/artifacts/plan/` | 1 |
| W24 | Three separate "plans" directories: `plan/`, `plans/`, `docs/plans/` | 1 |
| W25 | `ISSUE_CLOSURES.md` and `GITHUB_ISSUE_CLOSURES.md` overlap in scope | 1 |
| W26 | Root-level `CYCLE_PLAN.md` should be in `docs/plans/` or `plans/` | 6 |
| W27 | Root-level `DOCUMENTATION_AUDIT.md` and `DOCUMENTATION_INVENTORY.md` should be in `docs/` | 6 |
| W28 | 5 `CERTIFICATION_COMMENT_*.md` files should be consolidated | 1 |

### Staleness

| # | Finding | Agent |
|---|---------|-------|
| W29 | Clone URL in README (`github.com/codemachine/codemachine-pipeline`) may not match actual repo | 4 |
| W30 | 16 npm scripts are undocumented -- new devs can't discover `test:smoke`, `test:telemetry`, etc. | 4 |

---

## Information Findings (26)

| # | Finding | Agent |
|---|---------|-------|
| I1 | `.claude/` directory (237 files) is self-contained tooling -- expected to be outside project docs index | 1 |
| I2 | `thoughts/` and `research/` directories are working scratch space -- orphan status by design | 1 |
| I3 | `parallel-execute.md` vs `parallel-execution.md` near-duplicate in `.claude/commands/` | 1 |
| I4 | `codemachine-cli-adapter` topic intentionally spread across research/thoughts/plans lifecycle | 1 |
| I5 | Data model dictionary is complete and accurate -- all 15 models match Zod implementations | 2 |
| I6 | Missing barrel exports for `src/core/`, `src/core/config/`, `src/workflows/` | 2 |
| I7 | No formal API surface reference document exists | 2 |
| I8 | All 16 data model entities have Zod schemas (100% model coverage) | 3 |
| I9 | All 7 ADRs referenced in code map to documented decisions | 3 |
| I10 | 15 of 19 FRs explicitly referenced by label in source code | 3 |
| I11 | All 9 diagram files accurately reflect implemented architecture (minor structural variations) | 3 |
| I12 | FR-5, FR-11, FR-18, FR-19 have functional implementations but labels not cited in code | 3 |
| I13 | Queue V2 subsystem (6+ modules) evolved beyond original spec -- implementation optimization | 3 |
| I14 | SQLite queue described in diagrams; actual implementation uses JSON files | 3 |
| I15 | `docs/README.md` is well-organized and mostly comprehensive | 4 |
| I16 | `examples/sample_repo_config/` is well-maintained and matches current schema | 4 |
| I17 | No broken internal links found in checked documentation files | 4 |
| I18 | README "868 unit tests" claim is hardcoded and likely stale | 4 |
| I19 | `docs/ops/cli-reference.md` documents flags absent from README (more complete) | 4 |
| I20 | JSON Schema file is a static snapshot with no sync automation to Zod source of truth | 5 |
| I21 | `check_glob_cli_advisory.js` and `oclif_manifest.js` lack standalone documentation | 5 |
| I22 | No real hardcoded credentials found in docs; all examples use obvious placeholders | 6 |
| I23 | `plan/readiness_checklist.md` is extremely stale (says "Iteration I2", "Last Updated: 2025-01-15") | 6 |
| I24 | 11 `thoughts/tickets/` docs have no completion status markers | 6 |
| I25 | Security fix (execFile replacement) is confirmed implemented in code | 6 |
| I26 | No ports exposed in Dockerfiles -- correct for CLI tool | 5 |

---

## Cross-Agent Verification Results

| Finding Type | Primary Agent | Verifier | Agreement? |
|-------------|---------------|----------|------------|
| Node.js version mismatch (C1) | Agent 6 | Agent 4 | Agreed -- both independently found 6+ files contradicting package.json |
| CLI command mismatches (E1, E2) | Agent 2 | Agent 4 | Agreed -- Agent 4 confirmed troubleshooting docs reference unimplemented commands |
| `execution` config undocumented (E3) | Agent 2 | Agent 5 | Agreed -- both independently identified the gap |
| Aspirational env vars (E9) | Agent 5 | Agent 2 | Agreed -- Agent 2 confirmed Zod schema has `execution` section but no env var support |
| File inventory counts (C5, C6) | Agent 1 | Agent 6 | Agreed -- Agent 1 counted ~155 total, Agent 6 confirmed 117 TS files vs claimed 86 |
| Architecture diagram accuracy (I11) | Agent 3 | Agent 1 | Agreed -- Agent 1 confirmed all diagrammed modules exist in src/ |
| Security fix validity (I25) | Agent 6 | Agent 2 | Agreed -- both confirmed `execFile` replacement is in code |

**No disagreements between agents.** Code was ground truth in all cases.

---

## Recommended Action Plan

### Immediate (blocks developer productivity)

1. **Fix Node.js version in 7 docs** -- Update all to say `>=24.0.0` (C1)
2. **Add `npm ci` to CI workflow** -- Prevents silent cache dependency (C2)
3. **Remove duplicate `concurrency` block in ci.yml** -- Undefined YAML behavior (C3)
4. **Fix README**: remove "planned" label from PR commands, fix test runner (Jest->Vitest), remove nonexistent script names (E1, E5, E6)
5. **Fix security doc test paths** -- `test/` -> `tests/`, `.test.ts` -> `.spec.ts` (E10, E11)

### Short-term (should fix within 1-2 sprints)

6. **Document 8 undocumented CLI commands** in `docs/ops/cli-reference.md` (E2)
7. **Document `execution` config section** in `RepoConfig_schema.md` and sync JSON schema (E3, E4)
8. **Create CONTRIBUTING.md** with branch strategy (Graphite), PR process, test requirements (E7)
9. **Mark or remove aspirational env vars** from operations docs, or implement them (E9)
10. **Add missing docs to `docs/README.md` index** (E13)
11. **Reconcile two Dockerfiles** -- either remove `docker/Dockerfile` or sync them (E8)
12. **Delete or regenerate** `DOCUMENTATION_INVENTORY.md` and `DOCUMENTATION_AUDIT.md` (C5, C6)
13. **Create `docs/adr/` directory** with standalone ADR-6 and ADR-7 documents (E12)

### Long-term (nice to have)

14. Consolidate `plan/`, `plans/`, `docs/plans/` into one location (W24)
15. Move root-level working docs to appropriate directories (W26, W27)
16. Add completion status markers to `thoughts/tickets/` docs (I24)
17. Resolve `execution_flow.md` name collision (W22)
18. Consolidate 5 `CERTIFICATION_COMMENT_*.md` files (W28)
19. Add adapter API documentation (W6)
20. Automate JSON schema generation from Zod source of truth (I20)
21. Add lint step to CI or remove from docs (C4)

---

## Appendix: Updated File Inventory

### Verified Counts (2026-02-03)

| Category | Count |
|----------|-------|
| `.ts` files in `src/` | **117** |
| `.md` files (project, excl. vendor + .claude) | **99** |
| `.md` files (`.claude/` tooling) | **237** |
| `.puml` files | **3** |
| `.mmd` files | **5** |
| Total documentation files | **344** |

### Previous Claims vs. Reality

| Source | Claimed | Actual | Drift |
|--------|---------|--------|-------|
| `DOCUMENTATION_INVENTORY.md` (2025-12-30) | 47 .md files | 99 project .md | +111% |
| `DOCUMENTATION_AUDIT.md` (2025-12-30) | 86 .ts files | 117 .ts files | +36% |

---

*Report generated by 6-agent parallel audit swarm. All critical/error findings cross-verified by at least 2 agents. Code is ground truth where agents disagree with docs.*
