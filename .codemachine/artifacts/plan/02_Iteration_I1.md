<!-- anchor: iteration-plan-overview -->
## 5. Iteration Plan

*   **Total Iterations Planned:** 5
*   **Iteration Dependencies:** `I1` establishes the CLI shell, configuration schema, persistence, HTTP plumbing, and architectural documentation; `I2` layers context gathering plus PRD/spec flows atop those foundations; `I3` implements execution engines, validation loops, and queue management; `I4` finalizes GitHub/Linear/agent adapters plus PR automation; `I5` delivers deployment orchestration, exports, observability hardening, and operational runbooks.

<!-- anchor: iteration-1-plan -->
### Iteration 1: Foundation & State Primitives

*   **Iteration ID:** `I1`
*   **Goal:** Bootstrap the Node.js/TypeScript CLI workspace, define RepoConfig schemas, implement deterministic run directory management, wire the HTTP/rate-limit layer, and capture initial architecture diagrams so every later iteration can build against stable contracts.
*   **Prerequisites:** None; this iteration seeds the repo and authoritative documentation.
*   **Key Deliverables:** CLI scaffold with lint/test tooling, RepoConfig validator + templates, run directory manager + schema doc, HTTP client with ledger, component diagram, telemetry baseline, data model ERD, and `ai-feature init/doctor` commands with readiness checklist.
*   **Exit Criteria:** Commands compile and run locally, documentation and diagrams stored under `docs/`, automated tests cover config and persistence modules, and readiness checklist is published for I2 hand-off.
*   **Tasks:**

<!-- anchor: task-i1-t1 -->
    *   **Task 1.1:**
        *   **Task ID:** `I1.T1`
        *   **Description:** Scaffold the `oclif` CLI workspace with strict TypeScript settings, shared lint/test scripts, and stub commands for `init`, `start`, and `status` so downstream agents inherit a predictable developer experience.
            Include ESLint/Prettier configuration, npm scripts for lint/test/smoke, Dockerfile boilerplate, and Git hooks template entries documented in the README so contributors can reproduce builds locally or via Docker.
        *   **Agent Type Hint:** `SetupAgent`
        *   **Inputs:** Section 2 (Core Architecture), Section 3 (Directory Structure), ADR-1 (Agent Execution Model).
        *   **Input Files**: ["docs/requirements/project_spec.md", "docs/adr/ADR-1-agent-execution.md"]
        *   **Target Files:** ["package.json", "tsconfig.json", "src/cli/index.ts", "src/cli/commands/start.ts", "src/cli/commands/status.ts", "docker/Dockerfile", "README.md"]
        *   **Deliverables:** Bootstrapped CLI with version banner, shared TypeScript config, lint/test scripts, Dockerfile entry, and README updates describing the new commands.
        *   **Acceptance Criteria:** `npm run lint` and `npm run test -- --runInBand` pass on Node v24; running `bin/run --version` prints the semantic version; git diff limited to declared files with no leftover scaffolding; README lists prerequisites and installation hints plus `--json` usage.
        *   **Dependencies:** None
        *   **Parallelizable:** No

<!-- anchor: task-i1-t2 -->
    *   **Task 1.2:**
        *   **Task ID:** `I1.T2`
        *   **Description:** Define the RepoConfig schema using `zod`, include governance fields, integration toggles, runtime safety defaults, and `config_history` tracking so future migrations can be reasoned about deterministically.
            Provide typed helpers that load/validate `.ai-feature-pipeline/config.json`, emit actionable error messages, render default configs, and integrate with CLI commands needing config resolution.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Technology Stack & Key Components), Section 2.1 (Run Directory artifact), ADR-2 (State Persistence), ADR-5 (Approval workflow).
        *   **Input Files**: ["docs/requirements/data_models.md", "docs/adr/ADR-2-state-persistence.md", "docs/adr/ADR-5-approval-workflow.md"]
        *   **Target Files:** ["src/core/config/RepoConfig.ts", "src/core/config/validator.ts", "docs/requirements/RepoConfig_schema.md", ".ai-feature-pipeline/templates/config.example.json", "docs/requirements/config_migrations.md"]
        *   **Deliverables:** Typed RepoConfig module, validation helper, schema documentation, example config referencing environment variables, and migration checklist template.
        *   **Acceptance Criteria:** `vitest src/core/config` suite reports 100% pass; CLI errors on invalid config with actionable hints; doc enumerates each field with default, data type, ADR reference, and description of CLI overrides; template file loads without mutation; migration checklist stored for future iterations.
        *   **Dependencies:** `I1.T1`
        *   **Parallelizable:** No

<!-- anchor: task-i1-t3 -->
    *   **Task 1.3:**
        *   **Task ID:** `I1.T3`
        *   **Description:** Implement the Run Directory Manager that provisions `.ai-feature-pipeline/<feature_id>/`, writes manifests, enforces file locks, and optionally seeds SQLite WAL indexes, then document the structure in Markdown + Mermaid per Section 2.1.
            Include helpers for hash manifests, `last_step` tracking, `last_error`, approvals, queue storage, manifest integrity checks, and cleanup hooks invoked by future `cleanup` command.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 3 (Directory Structure), Section 2 (Data Model overview), ADR-2 (State Persistence).
        *   **Input Files**: ["docs/requirements/run_directory.md", "docs/adr/ADR-2-state-persistence.md"]
        *   **Target Files:** ["src/persistence/runDirectoryManager.ts", "src/persistence/hashManifest.ts", "docs/diagrams/run_directory_schema.mmd", ".ai-feature-pipeline/templates/run_manifest.json", "docs/requirements/run_directory_schema.md"]
        *   **Deliverables:** TypeScript module with file-lock helpers, sample manifest JSON, Mermaid diagram plus Markdown narrative describing directories, queues, telemetry, and state machine transitions.
        *   **Acceptance Criteria:** Persistence unit tests simulate concurrent access without corruption; diagram renders in CI; doc explains retention metadata and links to cleanup tasks; CLI dry-run command `bin/run status --json` references the manifest layout and prints `last_step/last_error` fields.
        *   **Dependencies:** `I1.T2`
        *   **Parallelizable:** Yes

<!-- anchor: task-i1-t4 -->
    *   **Task 1.4:**
        *   **Task ID:** `I1.T4`
        *   **Description:** Build the shared `undici`-based HTTP client that injects Accept and `X-GitHub-Api-Version` headers, enforces idempotency keys, handles exponential backoff, records rate-limit envelopes, and surfaces structured errors for the adapter layer.
            Provide typed error taxonomy (transient/permanent/human-action) and log sanitized request metadata for observability while writing ledger entries into run directories.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Technology Stack, Communication Patterns), FR/IR requirements list, ADR-6 (Linear Integration), IR-1..IR-7.
        *   **Input Files**: ["docs/requirements/integration_constraints.md", "docs/adr/ADR-6-linear-integration.md", "docs/requirements/rate_limit_playbook.md"]
        *   **Target Files:** ["src/adapters/http/client.ts", "src/telemetry/rateLimitLedger.ts", "tests/unit/httpClient.spec.ts", "docs/ops/rate_limit_reference.md"]
        *   **Deliverables:** HTTP client module, ledger writer, unit tests covering headers/retry logic, schema for ledger JSON, and documentation describing how envelopes are persisted and consumed.
        *   **Acceptance Criteria:** Contract tests verify Accept + API headers on GitHub calls; logging demonstrates sanitized payloads plus request IDs; ledger JSON stored in run directory during smoke test; doc explains `retry-after` handling, cooldown states, and failure escalation guidance.
        *   **Dependencies:** `I1.T1`
        *   **Parallelizable:** Yes

<!-- anchor: task-i1-t5 -->
    *   **Task 1.5:**
        *   **Task ID:** `I1.T5`
        *   **Description:** Author the PlantUML Component Diagram plus supporting Markdown narration that map CLI, orchestration services, adapters, persistence, and observability components called out in Section 2, enabling downstream agents to reason about boundaries.
            Align diagram swim-lanes with ADR responsibilities, call out extension points, and include references to planned sequence diagrams in later iterations.
        *   **Agent Type Hint:** `DiagrammingAgent`
        *   **Inputs:** Section 2 (Key Components/Services), Section 2.1 artifact list, ADR-1..ADR-4.
        *   **Input Files**: ["docs/architecture/overview.md", "docs/adr/ADR-1-agent-execution.md", "docs/adr/ADR-4-context-gathering.md"]
        *   **Target Files:** ["docs/diagrams/component_overview.puml", "docs/diagrams/component_overview.md", "docs/architecture/component_index.md"]
        *   **Deliverables:** PlantUML source plus Markdown commentary referencing anchors, exported preview (if scripted), and checklist for updating diagrams when new adapters land.
        *   **Acceptance Criteria:** Diagram renders via CI; Markdown enumerates each component with responsibilities, dependencies, and ADR references; manifest entry ready for downstream agents; reviewers can navigate from documentation to PlantUML source quickly.
        *   **Dependencies:** `I1.T1`, `I1.T3`, `I1.T4`
        *   **Parallelizable:** Yes

<!-- anchor: task-i1-t6 -->
    *   **Task 1.6:**
        *   **Task ID:** `I1.T6`
        *   **Description:** Establish baseline logging, metrics, and trace instrumentation plus documentation describing log schemas, redaction rules, and Prometheus textfile outputs so observability is consistent from the first run.
            Implement shared logger with structured JSON lines, metrics writer for queue/rate-limit stats, OpenTelemetry file exporter wiring, and redaction utilities that scan for token patterns across CLI output and saved artifacts.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Observability tools), Section 4 directives, NFR-6..NFR-10.
        *   **Input Files**: ["docs/requirements/non_functional.md", "docs/ops/logging_playbook.md", "docs/ops/telemetry_matrix.md"]
        *   **Target Files:** ["src/telemetry/logger.ts", "src/telemetry/metrics.ts", "src/telemetry/traces.ts", "docs/ops/observability_baseline.md", "tests/unit/logger.spec.ts"]
        *   **Deliverables:** Shared telemetry utilities, metrics schema doc, redaction helper, sample log excerpts proving redaction plus severity tagging, and instructions for toggling verbosity.
        *   **Acceptance Criteria:** `npm run test telemetry` passes; running `bin/run status --json` emits structured log lines and writes `metrics/prometheus.txt`; doc references log fields, metrics names, trace export locations, and redaction guarantees; telemetry components integrate with CLI dependency injection container.
        *   **Dependencies:** `I1.T1`, `I1.T4`
        *   **Parallelizable:** No

<!-- anchor: task-i1-t7 -->
    *   **Task 1.7:**
        *   **Task ID:** `I1.T7`
        *   **Description:** Formalize Feature/RepoConfig/RunArtifact/PlanArtifact/ResearchTask/Specification/ExecutionTask/etc. interfaces in TypeScript, add serialization helpers, and produce the Mermaid ERD described in Section 2.1.
            Ensure schemas capture telemetry fields (cost, rate limits), approvals, and resume metadata, integrating with `zod` validators where needed and documenting trace IDs.
        *   **Agent Type Hint:** `StructuralDataAgent`
        *   **Inputs:** Section 2 (Data Model Overview), Section 2.1 (ERD artifact), FR-1..FR-3, ADR-7 (Validation Policy).
        *   **Input Files**: ["docs/requirements/data_models.md", "docs/adr/ADR-7-validation-policy.md", "docs/requirements/traceability_map.md"]
        *   **Target Files:** ["src/core/models/Feature.ts", "src/core/models/ExecutionTask.ts", "src/core/models/index.ts", "docs/diagrams/data_model.mmd", "docs/requirements/data_model_dictionary.md", "tests/fixtures/model_samples.json"]
        *   **Deliverables:** Strongly typed interfaces with serialization tests, ERD diagram, dictionary describing every field with units and ADR reference, plus `trace.json` schema outline and fixture set for later automated verifications.
        *   **Acceptance Criteria:** Model tests ensure immutability/serialization; ERD renders and lists cardinalities; dictionary cross-links FR/IR IDs and CLI commands referencing each model; sample JSON fixtures checked into `tests/fixtures` and validated against schemas.
        *   **Dependencies:** `I1.T2`, `I1.T3`
        *   **Parallelizable:** Yes

<!-- anchor: task-i1-t8 -->
    *   **Task 1.8:**
        *   **Task ID:** `I1.T8`
        *   **Description:** Implement `ai-feature init` (RepoConfig scaffolding + integration checks) and `ai-feature doctor` (environment diagnostics), including documentation of exact prompts, approvals, and safety nets so future runs start consistently.
            Integrate telemetry to record command invocations, produce readiness checklist stored under `plan/readiness_checklist.md`, and describe exit codes for CI/homelab operators.
        *   **Agent Type Hint:** `DocumentationAgent`
        *   **Inputs:** Section 1 (Key Assumptions), Section 3 (Directory Structure), ADR-5 (Approval workflow).
        *   **Input Files**: ["docs/requirements/cli_surface.md", "docs/ops/init_playbook.md", "plan/readiness_checklist.md"]
        *   **Target Files:** ["src/cli/commands/init.ts", "src/cli/commands/doctor.ts", "docs/ops/init_playbook.md", "plan/readiness_checklist.md", "docs/ops/doctor_reference.md"]
        *   **Deliverables:** CLI commands with interactive + `--yes` flows, documentation outlining prerequisites, outputs, and failure taxonomy, plus checklist template consumed by later iterations.
        *   **Acceptance Criteria:** Running `bin/run init --dry-run --json` produces deterministic output; `bin/run doctor` inspects Node version, git, Docker, and token presence; docs explain exit codes (0/10/20/30), approvals, and next steps when checks fail; readiness checklist enumerates gating questions with status columns and references to RepoConfig fields.
        *   **Dependencies:** `I1.T2`, `I1.T6`, `I1.T7`
        *   **Parallelizable:** No

*   **Iteration Risks & Mitigations:**
    - Risk: Toolchain drift or missing Node/gcc dependencies on target machines could block CLI scaffolding; Mitigation: `ai-feature doctor` enumerates required binaries and provides Docker instructions plus fallback offline doc references.
    - Risk: Early HTTP client bugs could leak secrets; Mitigation: redaction unit tests, code review checklist, and telemetry verification ensure tokens are masked before logging.
    - Risk: Data model churn may cascade into later iterations; Mitigation: `data_model_dictionary.md` records schema ownership and change-control process anchored in ADRs.
*   **Hand-off Checklist to I2:**
    - Run `bin/run init --dry-run` and `bin/run doctor` inside sample repo to confirm deterministic output captured in `plan/readiness_checklist.md`.
    - Ensure `docs/diagrams/component_overview.puml`, `run_directory_schema.mmd`, and `data_model.mmd` render in CI and are linked from README sections referenced by I2 tasks.
    - Provide sample `.ai-feature-pipeline/config.json`, hashed manifest fixture, and telemetry logs to context/PRD teams so they can simulate feature runs without revisiting foundational work.
    - Archive `docs/ops/observability_baseline.md` preview plus logger sample output in `.ai-feature-pipeline/templates/` for reuse in context gathering smoke tests.
*   **Iteration Metrics Targets & Recording Plan:**
    - Track CLI bootstrap duration, lint/test runtimes, and HTTP client benchmark results within `metrics/prometheus.txt` so later iterations can detect regressions.
    - Record rate-limit ledger samples even in synthetic mode to validate schema before real API calls.
    - Document manual review outcomes (diagram approvals, schema sign-off) in `plan/milestone_notes.md` to create an auditable baseline for I2+ retrospectives.
