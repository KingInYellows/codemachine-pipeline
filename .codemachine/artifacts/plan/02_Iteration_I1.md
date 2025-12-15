<!-- anchor: iteration-plan-overview -->
## 5. Iteration Plan

*   **Total Iterations Planned:** 5 iterations spanning foundations, context/intelligence, adapters/execution, workflow UX, and deployment/compliance hardening.
*   **Iteration Dependencies:** Iteration 1 delivers architectural scaffolding; Iteration 2 consumes diagrams/specs from Iteration 1; Iteration 3 builds adapters atop planners; Iteration 4 layers CLI workflows on execution engine; Iteration 5 finalizes deployment/export/ops guardrails.
*   **Planning Cadence:** Two-week sprints with mid-point reviews; diagrams/specs frozen before downstream coding begins.
*   **Collaboration Notes:** Structural architecture SMEs partner with Setup and Documentation agents; security reviewers embedded for schema/log topics.

<!-- anchor: iteration-1-plan -->
### Iteration 1: Foundational Architecture & Deterministic State

*   **Iteration ID:** `I1`
*   **Goal:** Establish project scaffolding, configuration schema, deterministic run-directory patterns, and canonical architectural artifacts needed for downstream autonomous work.
*   **Prerequisites:** None.
*   **Key Deliverables:** oclif skeleton, RepoConfig schema + init flow, PlantUML component diagram, Mermaid ERD + state machine, run-directory and hash-manifest templates, observability schema, ADR + governance notes.
*   **Key Risks:** Misaligned schema versions causing migrations later; insufficient documentation of adapters leading to rework; run-directory design failing to capture resumability metadata; Docker image divergence relative to local environment.
*   **Coordination Plan:** Hold kickoff aligning CLI scaffolding with documentation; share diagrams with agent integrators for review; schedule security check on schema.
*   **Success Metrics:** CLI lint/test pass rate 100%; diagrams validated; init command bootstraps sample repo; run-directory tests cover create/load/lock >90% lines.
*   **Exit Criteria:** Repo builds, config validated, diagrams committed, templates published, init flow proven with smoke test on sample repo, governance ADR merged.

<!-- anchor: task-i1-t1 -->
*   **Task 1.1:**
    *   **Task ID:** `I1.T1`
    *   **Description:** Scaffold oclif CLI, baseline tsconfig/eslint/prettier, Dockerfile (Node v24), and CI smoke test skeleton to guarantee deterministic builds for follow-on iterations.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Architectural overview (Section 2), directory structure (Section 3).
    *   **Input Files:** []
    *   **Target Files:** [`package.json`, `tsconfig.json`, `Dockerfile`, `.github/workflows/ci.yml`, `src/cli/index.ts`]
    *   **Deliverables:** Compiling CLI skeleton with placeholder `init` command, lint/test scripts, Docker build instructions.
    *   **Acceptance Criteria:** `npm run lint` + `npm test` pass; Docker image builds; CI workflow references Node v24; README stub notes commands.
    *   **Dependencies:** []
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t2 -->
*   **Task 1.2:**
    *   **Task ID:** `I1.T2`
    *   **Description:** Define RepoConfig schema (JSON Schema + zod types) and implement `ai-feature init` flow that detects git root, scaffolds `.ai-feature-pipeline/config.json`, and validates credentials stubs.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Requirements FR-1/FR-17, Directory structure.
    *   **Input Files:** [`config/schemas/repo_config.schema.json`, `docs/guides/rate_limit_playbook.md`]
    *   **Target Files:** [`src/cli/commands/init.ts`, `src/core/config/repo_config.ts`, `examples/sample_repo_config/config.json`]
    *   **Deliverables:** Schema-backed config loader, CLI prompt, sample config with feature flags, doc updates.
    *   **Acceptance Criteria:** Running `ai-feature init` in sample repo creates config with schema_version, github/linear/runtime/safety blocks; invalid config surfaces actionable message and exit code 10.
    *   **Dependencies:** [`I1.T1`]
    *   **Parallelizable:** No

<!-- anchor: task-i1-t3 -->
*   **Task 1.3:**
    *   **Task ID:** `I1.T3`
    *   **Description:** Produce PlantUML component diagram aligning with Section 2 components, annotating adapters, orchestration layers, persistence services, and observability.
    *   **Agent Type Hint:** `DiagrammingAgent`
    *   **Inputs:** Section 2 Core Architecture, directory tree.
    *   **Input Files:** [`docs/diagrams/component_overview.puml`]
    *   **Target Files:** [`docs/diagrams/component_overview.puml`, `docs/README.md`]
    *   **Deliverables:** Renderable UML diagram plus doc blurb referencing usage and iteration placement.
    *   **Acceptance Criteria:** Diagram compiles (PlantUML), matches listed modules, includes anchors for adapters/resume/observability, and doc cross-link added.
    *   **Dependencies:** [`I1.T1`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t4 -->
*   **Task 1.4:**
    *   **Task ID:** `I1.T4`
    *   **Description:** Model ERD using Mermaid covering Feature/RepoConfig/RunArtifact/PlanArtifact/ResearchTask/Specification/ExecutionTask/ContextDocument/RateLimitEnvelope/ApprovalRecord.
    *   **Agent Type Hint:** `DatabaseAgent`
    *   **Inputs:** Data model overview (Section 2), requirements Section 3.
    *   **Input Files:** [`docs/diagrams/data_model.mmd`]
    *   **Target Files:** [`docs/diagrams/data_model.mmd`, `docs/guides/data_dictionary.md`]
    *   **Deliverables:** Mermaid ERD plus textual dictionary summarizing each entity and reference.
    *   **Acceptance Criteria:** Diagram renders, includes cardinalities, field lists, and cross-links; dictionary stored under `docs/guides/data_dictionary.md` summarizing attributes/IDs.
    *   **Dependencies:** [`I1.T2`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t5 -->
*   **Task 1.5:**
    *   **Task ID:** `I1.T5`
    *   **Description:** Document feature lifecycle + approvals as Mermaid state machine plus Markdown narrative referencing FR-3, FR-11, FR-15.
    *   **Agent Type Hint:** `DiagrammingAgent`
    *   **Inputs:** Requirements FR-3/FR-11/FR-15, Section 2 communication patterns.
    *   **Input Files:** [`docs/diagrams/feature_state_machine.mmd`]
    *   **Target Files:** [`docs/diagrams/feature_state_machine.mmd`, `docs/guides/state_machine.md`]
    *   **Deliverables:** State machine diagram + explanation of gating + resume hooks.
    *   **Acceptance Criteria:** Diagram passes Mermaid lint, includes states/gates/approvals/resume events; guide maps states to CLI commands.
    *   **Dependencies:** [`I1.T3`, `I1.T4`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t6 -->
*   **Task 1.6:**
    *   **Task ID:** `I1.T6`
    *   **Description:** Design deterministic run-directory layout + hash-manifest format, implement scaffolding helpers, and produce templates for feature.json, plan.json, queue JSONL, logs, metrics.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 3 directory structure, Section 4 directives.
    *   **Input Files:** [`src/persistence/run_directory.ts`, `examples/run_directory_templates/feature.json`]
    *   **Target Files:** [`src/persistence/run_directory.ts`, `src/persistence/hash_manifest.ts`, `docs/guides/run_directory.md`]
    *   **Deliverables:** Code for directory creation, manifest writing, file-lock guidelines, and run-dir guide.
    *   **Acceptance Criteria:** Unit tests cover create/load/lock operations; guide lists required files + sample ULID naming; CLI `ai-feature init` scaffolds `.ai-feature-pipeline` root.
    *   **Dependencies:** [`I1.T2`]
    *   **Parallelizable:** No

<!-- anchor: task-i1-t7 -->
*   **Task 1.7:**
    *   **Task ID:** `I1.T7`
    *   **Description:** Draft observability/logging specification describing logs.ndjson schema, metrics textfile structure, traces.json exporter, and governance of rate-limit ledger.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2 components, Section 4 directives, Requirements Section 7.
    *   **Input Files:** [`docs/guides/observability.md`]
    *   **Target Files:** [`docs/guides/observability.md`, `config/schemas/log_entry.schema.json`, `config/schemas/rate_limit.schema.json`]
    *   **Deliverables:** Document referencing schema + sample log entries; JSON Schemas for telemetry.
    *   **Acceptance Criteria:** Schema validated via npm script; guide includes severity mapping, rotation policy, and instructions for export bundling.
    *   **Dependencies:** [`I1.T6`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t8 -->
*   **Task 1.8:**
    *   **Task ID:** `I1.T8`
    *   **Description:** Capture governance + security ADR outlining approval gates, feature flags, token scopes, and change-control expectations aligned with Section 4 directives.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 4 Directives, Requirements Section 8 & 9.
    *   **Input Files:** [`docs/adr/0001-foundation.md`]
    *   **Target Files:** [`docs/adr/0001-foundation.md`, `docs/guides/security_posture.md`]
    *   **Deliverables:** ADR referencing decision drivers, consequences, and compliance hooks plus security posture overview.
    *   **Acceptance Criteria:** ADR template filled, cross-linked in README; security guide lists PAT scopes, GitHub App roadmap, and log redaction guarantees.
    *   **Dependencies:** [`I1.T2`, `I1.T7`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i1-t9 -->
*   **Task 1.9:**
    *   **Task ID:** `I1.T9`
    *   **Description:** Execute sample dogfood run using placeholder feature to validate init + run-directory scaffolding and document cleanup script for stale runs.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Outputs from Tasks I1.T2/I1.T6, Observability spec.
    *   **Input Files:** [`examples/run_directory_templates/feature.json`, `scripts/smoke_cli.sh`]
    *   **Target Files:** [`scripts/smoke_cli.sh`, `docs/guides/dogfood_run.md`, `scripts/cleanup_runs.sh`]
    *   **Deliverables:** Automated script performing init/start placeholder run, verifying directory contents, and cleanup instructions.
    *   **Acceptance Criteria:** Script creates ULID-based run dir, writes feature.json+plan.json placeholders, verifies logs+metrics files exist, and cleanup script archives & deletes sample run.
    *   **Dependencies:** [`I1.T6`]
    *   **Parallelizable:** No

*   **Iteration Reporting:** Summarize outputs (CLI scaffolding metrics, diagram links, schema versions) inside `.codemachine/reports/I1_summary.md` for downstream teams.
*   **Carryover Handling:** Capture deferred scope or risks in `docs/adr/0001-foundation.md` appendix and tag associated feature flags for Iteration 2 triage.
*   **Retro Notes:** Run retro at close, documenting action items and lessons learned in `docs/guides/iteration_retrospectives.md` with pointers to impacted artifacts.
