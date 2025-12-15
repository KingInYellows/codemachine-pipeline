<!-- anchor: iteration-3-plan -->
### Iteration 3: Adapter Layer, Task Planner, and Execution Engine

*   **Iteration ID:** `I3`
*   **Goal:** Implement shared HTTP client with rate-limit ledger, adapter interfaces (GitHub, Linear, Agent), task planner DAG, execution engine enforcing patch workflows, validation registry schemas, and capability manifests.
*   **Prerequisites:** `I1`, `I2`
*   **Key Deliverables:** HTTP module with retry/backoff, GitHub adapter supporting repo/branch/PR/review/status APIs, Linear adapter hardened, Agent capability manifest schema, plan generator, execution queue, validation registry spec + CLI configuration, tests.
*   **Key Risks:** Rate-limit mismanagement leading to 403s, incorrect dependency graphs causing deadlocks, patch application touching forbidden paths, inconsistent agent manifest semantics.
*   **Coordination Plan:** Sync weekly with security for token scopes, hold design review for HTTP client/backoff, align with QA on validation registry default commands.
*   **Success Metrics:** Adapter integration tests pass using recorded fixtures, plan generator builds DAG from spec anchors, execution engine applies dry-run patches safely, validation registry invoked in pipeline.
*   **Exit Criteria:** CLI can plan ExecutionTasks, queue them, and run stub execution with validations hitting GitHub/Linear mocks and logging telemetry.

<!-- anchor: task-i3-t1 -->
*   **Task 3.1:**
    *   **Task ID:** `I3.T1`
    *   **Description:** Build shared HTTP client using undici that injects headers (Accept, X-GitHub-Api-Version, Authorization, Idempotency-Key), records rate-limit data, applies exponential backoff with jitter, and writes entries to `rate_limits.json`.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 communication patterns, Requirements IR-1/IR-6.
    *   **Input Files:** [`src/core/http/client.ts`, `config/schemas/rate_limit.schema.json`]
    *   **Target Files:** [`src/core/http/client.ts`, `tests/unit/http_client.test.ts`, `tests/fixtures/http/`]
    *   **Deliverables:** HTTP module, tests covering retry-after/x-ratelimit-reset, fixture harness.
    *   **Acceptance Criteria:** Client logs headers, respects retry-after, writes ledger entries, surfaces structured errors (transient/permanent/human-action) with metadata.
    *   **Dependencies:** [`I1.T7`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t2 -->
*   **Task 3.2:**
    *   **Task ID:** `I3.T2`
    *   **Description:** Implement GitHub adapter supporting repo info, branch creation, branch protection queries, PR creation, reviewer requests, merge checks, workflow dispatch, status check polling, and auto-merge toggling (feature-flagged).
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Requirements IR-1–IR-7, FR-12–FR-16.
    *   **Input Files:** [`src/adapters/github/index.ts`, `tests/integration/github_adapter.test.ts`, `docs/guides/github_integration.md`]
    *   **Target Files:** [`src/adapters/github/index.ts`, `tests/integration/github_adapter.test.ts`, `docs/guides/github_integration.md`]
    *   **Deliverables:** Adapter implementation, recorded fixtures, documentation referencing required scopes + headers.
    *   **Acceptance Criteria:** Adapter uses HTTP client, honors Accept/API version header, handles primary/secondary rate limits, surfaces blocked reasons, supports reviewer assignments, includes dry-run mode.
    *   **Dependencies:** [`I3.T1`, `I1.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t3 -->
*   **Task 3.3:**
    *   **Task ID:** `I3.T3`
    *   **Description:** Define adapter capability manifest schema (JSON) for agent providers, GitHub/Linear, and optional integrations plus manifest loader/resolver with validation + documentation.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2 components, Section 4 directives.
    *   **Input Files:** [`config/schemas/adapter_manifest.schema.json`, `.ai-feature-pipeline/agents/sample_manifest.json`]
    *   **Target Files:** [`config/schemas/adapter_manifest.schema.json`, `.ai-feature-pipeline/agents/sample_manifest.json`, `docs/guides/agent_manifests.md`]
    *   **Deliverables:** Schema + sample manifests for OpenAI-compatible + local LLMs; doc describing fields (model, tokens, rate limit, cost).
    *   **Acceptance Criteria:** Schema validated; CLI command `ai-feature agents list` (stub) reads manifest; doc references BYO agent behavior + gating.
    *   **Dependencies:** [`I1.T8`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i3-t4 -->
*   **Task 3.4:**
    *   **Task ID:** `I3.T4`
    *   **Description:** Implement Validation Registry (JSON schema + loader + CLI command) capturing lint/test/build/typecheck commands, env vars, failure handling, and gating references.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 4 directives, Requirements FR-14.
    *   **Input Files:** [`config/schemas/validation_registry.schema.json`, `src/services/validation/registry.ts`]
    *   **Target Files:** [`src/services/validation/registry.ts`, `docs/guides/validation_registry.md`, `tests/unit/validation_registry.test.ts`]
    *   **Deliverables:** Schema, loader, doc referencing commands, CLI command `ai-feature validation list`.
    *   **Acceptance Criteria:** Registry enforces required commands, supports overrides per feature, integrates with execution engine gating; tests cover invalid configs.
    *   **Dependencies:** [`I1.T2`, `I1.T7`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i3-t5 -->
*   **Task 3.5:**
    *   **Task ID:** `I3.T5`
    *   **Description:** Build task planner service converting spec anchors + ResearchTasks into ExecutionTasks with dependency graph, retry policies, grouping for concurrency, and plan checksum.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Spec composer outputs, Section 2 components.
    *   **Input Files:** [`src/services/planner/task_planner.ts`, `docs/guides/task_planning.md`, `tests/unit/task_planner.test.ts`]
    *   **Target Files:** [`src/services/planner/task_planner.ts`, `tests/unit/task_planner.test.ts`, `docs/guides/task_planning.md`]
    *   **Deliverables:** Planner, doc describing heuristics, tests verifying DAG + checksum.
    *   **Acceptance Criteria:** Plan JSON captures nodes/edges, checksum updates on change, tasks tagged with spec anchors + dependencies; doc explains concurrency/gating rules.
    *   **Dependencies:** [`I2.T7`, `I2.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t6 -->
*   **Task 3.6:**
    *   **Task ID:** `I3.T6`
    *   **Description:** Implement execution queue store (append-only JSONL) plus orchestrator to dequeue tasks, update statuses, respect dependencies, and persist progress for resumability.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Task planner output, run-directory scaffolding.
    *   **Input Files:** [`src/services/execution/queue.ts`, `tests/unit/execution_queue.test.ts`]
    *   **Target Files:** [`src/services/execution/queue.ts`, `tests/unit/execution_queue.test.ts`, `docs/guides/execution_queue.md`]
    *   **Deliverables:** Queue manager, tests, doc explaining JSONL format + resume semantics.
    *   **Acceptance Criteria:** Queue file append-only, statuses persisted with timestamps, resume coordinator can reconstruct state, tests cover ordering + failure cases.
    *   **Dependencies:** [`I3.T5`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t7 -->
*   **Task 3.7:**
    *   **Task ID:** `I3.T7`
    *   **Description:** Develop execution engine to apply patches via git dry-run, enforce allowlists/denylists, snapshot files, and invoke validation registry prior to PR stage.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Queue manager, validation registry, run-directory, GitHub adapter.
    *   **Input Files:** [`src/services/execution/engine.ts`, `tests/integration/execution_engine.test.ts`]
    *   **Target Files:** [`src/services/execution/engine.ts`, `tests/integration/execution_engine.test.ts`, `docs/guides/execution_engine.md`]
    *   **Deliverables:** Engine orchestrating tasks, hooking to Git operations, validation invocation, logging.
    *   **Acceptance Criteria:** Engine records snapshots/diffs, respects constraints, aborts on validation failure with actionable errors, writes telemetry to logs, tests use fixture repo.
    *   **Dependencies:** [`I3.T2`, `I3.T4`, `I3.T6`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t8 -->
*   **Task 3.8:**
    *   **Task ID:** `I3.T8`
    *   **Description:** Implement agent adapter service orchestrating prompts/responses with capability manifests, supporting streaming or batch, retries, and cost telemetry updates.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Capability manifest schema, PRD/spec/composer requirements.
    *   **Input Files:** [`src/adapters/agents/index.ts`, `.ai-feature-pipeline/agents/sample_manifest.json`]
    *   **Target Files:** [`src/adapters/agents/index.ts`, `tests/integration/agent_adapter.test.ts`, `docs/guides/agent_adapter.md`]
    *   **Deliverables:** Adapter with provider registry, manifest loader, cost reporting, logging.
    *   **Acceptance Criteria:** Adapter chooses provider based on capability + cost, records token use, handles fallback to local models, tests simulate streaming + errors.
    *   **Dependencies:** [`I3.T3`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i3-t9 -->
*   **Task 3.9:**
    *   **Task ID:** `I3.T9`
    *   **Description:** Extend resume coordinator to read queue state, approvals, rate-limit ledger, and determine restart point with guardrails for hash mismatches.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Run-directory design, queue manager, approvals registry.
    *   **Input Files:** [`src/services/resume/coordinator.ts`, `tests/unit/resume_coordinator.test.ts`]
    *   **Target Files:** [`src/services/resume/coordinator.ts`, `tests/unit/resume_coordinator.test.ts`, `docs/guides/resume_flow.md`]
    *   **Deliverables:** Resume logic + doc describing error categories + manual intervention instructions.
    *   **Acceptance Criteria:** Resume handles success/failure/human action states, surfaces instructions referencing artifacts, tests cover collisions + corrupted data.
    *   **Dependencies:** [`I3.T6`, `I2.T8`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i3-t10 -->
*   **Task 3.10:**
    *   **Task ID:** `I3.T10`
    *   **Description:** Wire validation registry + execution engine into CLI `ai-feature plan` and `ai-feature run --task` commands, enabling manual kicks and JSON outputs for automation.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Planner, execution engine, CLI scaffolding.
    *   **Input Files:** [`src/cli/commands/plan.ts`, `src/cli/commands/run.ts`, `tests/smoke/plan_run.test.ts`]
    *   **Target Files:** [`src/cli/commands/plan.ts`, `src/cli/commands/run.ts`, `tests/smoke/plan_run.test.ts`, `docs/guides/plan_command.md`]
    *   **Deliverables:** CLI commands showing DAG, allowing targeted task runs, JSON output schema.
    *   **Acceptance Criteria:** `ai-feature plan` prints nodes/edges, writes JSON; `run --task` executes single task with validation gating; smoke tests pass.
    *   **Dependencies:** [`I3.T5`, `I3.T7`]
    *   **Parallelizable:** No

<!-- anchor: task-i3-t11 -->
*   **Task 3.11:**
    *   **Task ID:** `I3.T11`
    *   **Description:** Create fixture-based contract tests + mocks for GitHub/Linear/Agent adapters using nock/msw, ensuring reproducibility and offline CI runs.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Adapter implementations, HTTP client.
    *   **Input Files:** [`tests/fixtures/http/github/*.json`, `tests/fixtures/http/linear/*.json`, `tests/integration/agent_adapter.test.ts`]
    *   **Target Files:** [`tests/fixtures/http/github/`, `tests/fixtures/http/linear/`, `tests/integration/adapter_contracts.test.ts`, `docs/guides/testing_strategy.md`]
    *   **Deliverables:** Fixture library, contract tests, doc describing fixture refresh workflows.
    *   **Acceptance Criteria:** Tests cover success + rate-limit responses; fixture refresh script documented; CI uses fixtures for deterministic runs.
    *   **Dependencies:** [`I3.T1`, `I3.T2`, `I3.T10`]
    *   **Parallelizable:** Yes

*   **Iteration Reporting:** Publish `.codemachine/reports/I3_summary.md` enumerating adapter coverage, planner metrics, and resume scenarios exercised.
*   **Carryover Handling:** Document unresolved GitHub/Linear API questions or pending scopes in `docs/guides/github_integration.md` to inform Iteration 4 CLI work.
*   **Retro Notes:** Capture execution-engine learnings, patch risk mitigations, and backlog tasks for improved concurrency in `docs/guides/iteration_retrospectives.md`.
