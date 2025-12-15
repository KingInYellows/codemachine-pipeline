<!-- anchor: iteration-3-plan -->
### Iteration 3: Execution Engine, Validation & Resume Orchestration

*   **Iteration ID:** `I3`
*   **Goal:** Translate specifications into actionable ExecutionTasks, build the queue/plan orchestration engine, manage patch application + git safety rails, codify validation and auto-fix loops, and extend resume/status commands so code generation is deterministic and auditable.
*   **Prerequisites:** Completion of `I1` and `I2`, including traceability maps, approved PRD/spec artifacts, agent manifests, telemetry baseline, and context/ResearchTask outputs stored within run directories.
*   **Key Deliverables:** Execution DAG builder + flow diagram, patch application/branch manager, validation command registry with auto-fix policy, agent adapter contract + JSON Schema, queue persistence tests, execution observability wiring, enhanced CLI plan/status/resume experiences, and run directory recovery tooling.
*   **Exit Criteria:** CLI can generate ExecutionTasks from specs, apply patches with allowlist enforcement, run validations with auto-fix retries, record plan/queue state, and resume successfully after failures using deterministic artifacts.
*   **Tasks:**

<!-- anchor: task-i3-t1 -->
    *   **Task 3.1:**
        *   **Task ID:** `I3.T1`
        *   **Description:** Implement Task Planner upgrades that convert spec requirements + traceability entries into ExecutionTask DAGs, persist `plan.json`, manage dependencies, and render the Execution Engine Flow Diagram (PlantUML) committed under `docs/diagrams/execution_flow.puml`.
            Include CLI outputs summarizing queue states, statuses, and blockers while referencing FR-12..FR-14.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 2.1 (Execution Flow diagram), FR-9..FR-14, ADR-7.
        *   **Input Files**: ["docs/requirements/traceability_map.md", "docs/requirements/spec_blueprint.md", "docs/diagrams/spec_flow.mmd"]
        *   **Target Files:** ["src/workflows/taskPlanner.ts", "docs/diagrams/execution_flow.puml", "docs/requirements/execution_flow.md", "tests/unit/taskPlanner.spec.ts"]
        *   **Deliverables:** Planner module, PlantUML diagram, narrative doc describing DAG semantics, and tests verifying dependency/resume logic.
        *   **Acceptance Criteria:** `plan.json` includes nodes/edges with stable IDs; CLI `plan --json` prints DAG summary; diagram renders; tests confirm deterministic ordering and detection of cycles.
        *   **Dependencies:** `I2.T5`, `I2.T7`
        *   **Parallelizable:** No

<!-- anchor: task-i3-t2 -->
    *   **Task 3.2:**
        *   **Task ID:** `I3.T2`
        *   **Description:** Build Patch Application + Git Manager covering branch creation, patch previews (`git apply --check`), allowlist/denylist enforcement from RepoConfig constraints, and safe commit logging aligned with FR-12/FR-13.
            Provide rollback snapshots and diff summaries stored within run directories for export.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), FR-12/FR-13, Section 3 (Directory structure), ADR-3.
        *   **Input Files**: ["docs/requirements/git_policies.md", "docs/requirements/constraints.md", "docs/ops/run_directory_schema.md"]
        *   **Target Files:** ["src/workflows/patchManager.ts", "src/workflows/branchManager.ts", "docs/ops/patch_playbook.md", "tests/unit/patchManager.spec.ts"]
        *   **Deliverables:** Patch manager, branch manager, docs describing dry-run/diff preview flows, and tests verifying constraint enforcement plus rollback behavior.
        *   **Acceptance Criteria:** CLI `start` can apply sample patch with dry-run; blocklist paths cause errors; branch created per feature; doc details conflict handling/resume instructions.
        *   **Dependencies:** `I3.T1`
        *   **Parallelizable:** Yes

<!-- anchor: task-i3-t3 -->
    *   **Task 3.3:**
        *   **Task ID:** `I3.T3`
        *   **Description:** Implement Validation Command Registry (lint/test/typecheck/build) plus auto-fix loop per ADR-7, including configuration ingestion, command templating, retry/backoff policy, and error summarization piped into run logs.
            Add CLI command `ai-feature validate` for manual re-runs and doc covering exit codes.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Technology stack), Section 3 (Tests/ scripts), ADR-7, FR-14.
        *   **Input Files**: ["docs/requirements/validation_matrix.md", "docs/adr/ADR-7-validation-policy.md", "docs/ops/approval_playbook.md"]
        *   **Target Files:** ["src/workflows/validationRegistry.ts", "src/workflows/autoFixEngine.ts", "src/cli/commands/validate.ts", "docs/requirements/validation_playbook.md", "tests/unit/validationRegistry.spec.ts"]
        *   **Deliverables:** Registry service, auto-fix orchestrator, CLI command, documentation describing configuration, and tests covering success/failure/resume flows.
        *   **Acceptance Criteria:** Registry loads from RepoConfig; auto-fix attempts logged with capped retries; CLI command prints summary + writes to logs; doc explains manual overrides.
        *   **Dependencies:** `I3.T1`
        *   **Parallelizable:** Yes

<!-- anchor: task-i3-t4 -->
    *   **Task 3.4:**
        *   **Task ID:** `I3.T4`
        *   **Description:** Finalize Agent Adapter contract for execution contexts (code generation, review, test suggestions), produce JSON Schema for manifests, and update adapter implementations with capability routing, tool negotiation, and error taxonomy alignment.
            Provide documentation referencing Section 2.1 artifact and sample manifests for code/test/review models.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2.1 (Agent adapter contract), I2 manifest loader, ADR-1, ADR-7.
        *   **Input Files**: ["docs/requirements/agent_manifests.md", "docs/requirements/spec_blueprint.md", "docs/requirements/validation_matrix.md"]
        *   **Target Files:** ["src/adapters/agents/AgentAdapter.ts", "docs/requirements/agent_capability_contract.md", "docs/requirements/agent_manifest_schema.json", "tests/unit/agentAdapter.spec.ts"]
        *   **Deliverables:** Adapter interface, schema updates, doc describing capability negotiation and fallback logic, plus tests verifying contract enforcement.
        *   **Acceptance Criteria:** Execution tasks specify capability needs and adapter chooses matching provider; schema validated during CI; doc outlines cost tracking and failure remediation strategies.
        *   **Dependencies:** `I2.T8`
        *   **Parallelizable:** Yes

<!-- anchor: task-i3-t5 -->
    *   **Task 3.5:**
        *   **Task ID:** `I3.T5`
        *   **Description:** Enhance Resume Coordinator and queue persistence so failed tasks can resume precisely, including hashed input verification, queue snapshots, and CLI `resume` improvements showing remediation hints.
            Document failure taxonomy with mapping to human/agent actions.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 2.1 (Run directory schema), FR-3, ADR-2.
        *   **Input Files**: ["docs/requirements/run_directory_schema.md", "docs/ops/logging_playbook.md", "plan/milestone_notes.md"]
        *   **Target Files:** ["src/workflows/resumeCoordinator.ts", "src/workflows/queueStore.ts", "docs/requirements/resume_playbook.md", "tests/unit/resumeCoordinator.spec.ts", "tests/integration/resume_flow.spec.ts"]
        *   **Deliverables:** Resume enhancements, queue serialization/test coverage, playbook describing failure classes, and integration test simulating crash/resume path.
        *   **Acceptance Criteria:** CLI `resume` inspects `last_step/last_error`, verifies hashes, and restarts queue; tests inject corrupted queue and ensure safe halt; doc maps errors to required actions.
        *   **Dependencies:** `I3.T1`, `I3.T3`
        *   **Parallelizable:** No

<!-- anchor: task-i3-t6 -->
    *   **Task 3.6:**
        *   **Task ID:** `I3.T6`
        *   **Description:** Instrument Execution Engine telemetry: per-task logs, diff stats, validation timing, agent cost usage, and queue depth metrics; integrate with Observability hub and ensure `logs.ndjson`, `metrics/prometheus.txt`, and `traces.json` capture necessary context.
            Provide documentation describing new metrics and log fields for later iterations.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Observability), I1 telemetry baseline, Section 4 directives.
        *   **Input Files**: ["docs/ops/observability_baseline.md", "docs/ops/telemetry_matrix.md"]
        *   **Target Files:** ["src/telemetry/executionMetrics.ts", "src/telemetry/logWriters.ts", "docs/ops/execution_telemetry.md", "tests/unit/executionMetrics.spec.ts"]
        *   **Deliverables:** Metrics/logging helpers, documentation, tests verifying counters/histograms, and CLI integration.
        *   **Acceptance Criteria:** `metrics/prometheus.txt` includes queue depth, validation durations, agent cost counters; logs capture patch IDs/diff stats; doc describes label names + retention.
        *   **Dependencies:** `I3.T1`, `I3.T2`, `I3.T3`
        *   **Parallelizable:** Yes

<!-- anchor: task-i3-t7 -->
    *   **Task 3.7:**
        *   **Task ID:** `I3.T7`
        *   **Description:** Update CLI surfaces (`plan`, `status`, `resume`, `validate`) to display ExecutionTask DAGs, patch previews, validation states, and resume instructions in both human and `--json` formats, ensuring anchors align with documentation.
            Add plan diffing to highlight when specs change and tasks need regeneration.
        *   **Agent Type Hint:** `FrontendAgent`
        *   **Inputs:** Section 1 (Goal), Section 2 (Key Components), Section 4 (Directives), outputs from `I3.T1`..`I3.T5`.
        *   **Input Files**: ["docs/requirements/cli_surface.md", "docs/requirements/execution_flow.md", "docs/ops/approval_playbook.md"]
        *   **Target Files:** ["src/cli/commands/plan.ts", "src/cli/commands/status.ts", "src/cli/commands/resume.ts", "docs/ui/cli_patterns.md", "tests/integration/cli_status_plan.spec.ts"]
        *   **Deliverables:** CLI enhancements, documentation describing layout/tokens, integration tests verifying JSON output, and plan diffing helper.
        *   **Acceptance Criteria:** Commands display DAG summary, pending tasks, validation states; `--json` output matches schema; doc references anchors for CLI components; tests ensure deterministic ordering.
        *   **Dependencies:** `I3.T1`, `I3.T5`
        *   **Parallelizable:** Yes

<!-- anchor: task-i3-t8 -->
    *   **Task 3.8:**
        *   **Task ID:** `I3.T8`
        *   **Description:** Create automated execution smoke tests covering context→PRD→spec→plan→patch apply→validation→resume flows, using fixture repo plus sample manifests to confirm reproducibility.
            Update `plan/milestone_notes.md` with findings and ensure export bundle contains diff summaries.
        *   **Agent Type Hint:** `TestingAgent`
        *   **Inputs:** Sections 2 & 3, outputs from `I2` tasks, FR-9..FR-15, ADR-7.
        *   **Input Files**: ["tests/fixtures/sample_repo/README.md", "docs/templates/prd_template.md", "docs/requirements/validation_playbook.md"]
        *   **Target Files:** ["tests/integration/smoke_execution.spec.ts", "scripts/tooling/smoke_execution.sh", "plan/milestone_notes.md", "docs/ops/smoke_test_guide.md"]
        *   **Deliverables:** Automated integration test, shell script for local smoke runs, doc describing how to interpret results, and milestone notes summarizing issues.
        *   **Acceptance Criteria:** Smoke suite runs via `npm run test:smoke`; outputs stored in run directory; doc teaches developers how to run/triage; milestone notes link failures to remediation tasks.
        *   **Dependencies:** `I3.T1`..`I3.T7`
        *   **Parallelizable:** No

*   **Iteration Risks & Mitigations:**
    - Risk: Auto-fix loops may produce infinite retries; Mitigation: enforce ADR-7 retry caps, log attempts, and surface gating instructions when limits reached.
    - Risk: Patch conflicts could corrupt run directory; Mitigation: snapshots + rollback utilities plus docs guiding manual interventions.
    - Risk: Resume logic may skip necessary steps; Mitigation: hash verification + integration tests ensure consistency before run restarts.
*   **Hand-off Checklist to I4:**
    - Provide sample `plan.json`, queue snapshots, `trace.json`, and execution logs to adapter team for GitHub PR integration tests.
    - Ensure Execution Flow diagram and CLI documentation reference anchors consumed by GitHub/Linear tasks.
    - Export smoke test results + milestone notes summarizing open issues and mark items requiring GitHub API data.
*   **Iteration Metrics Targets & Recording Plan:**
    - Track average task runtime, validation success rate, auto-fix attempt counts, and resume success metrics in telemetry.
    - Monitor branch management outcomes (number of conflicts, rollbacks) to inform GitHub adapter heuristics.
    - Log smoke test duration and flake rate for context in PR automation planning.
*   **Iteration Validation Hooks:**
    - Expand CI pipeline to run `npm run test:smoke-execution` nightly with fixtures.
    - Add `ai-feature status --json | jq` schema validation to ensure CLI outputs remain backward compatible.
    - Archive smoke artifacts in `.ai-feature-pipeline/templates/` to be reused by `I4` when simulating GitHub workflows.
    - Capture git patch snapshots and validation transcripts in  so GitHub adapter tests inherit deterministic fixtures.
    - Capture git patch snapshots and validation transcripts in .ai-feature-pipeline/samples/execution/ so GitHub adapter tests inherit deterministic fixtures.

