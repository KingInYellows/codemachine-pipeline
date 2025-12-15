<!-- anchor: iteration-2-plan -->
### Iteration 2: Context Intelligence & Artifact Authoring

*   **Iteration ID:** `I2`
*   **Goal:** Build context aggregation, research orchestration, PRD/spec drafting engines, OpenAPI spec, and sequence diagrams that operationalize the architectural blueprint.
*   **Prerequisites:** `I1`
*   **Key Deliverables:** Context manifest service, summarization policies, ResearchTask queue, PRD/spec templates with approval gates, OpenAPI spec draft, prompt-to-deploy sequence diagram, context budgeting guide.
*   **Key Risks:** Token budget overruns, mis-modeled approval flows, inaccurate OpenAPI contracts, missing rate-limit logging from context gatherers, mismatched Linear snapshots.
*   **Coordination Plan:** Collaborate with Documentation + Agent teams to calibrate prompts; schedule review with product stakeholders for PRD template; align with Observability owners for context telemetry.
*   **Success Metrics:** Context aggregator handles >2k-file repo within guidelines; PRD/spec drafts produced deterministically; OpenAPI spec passes lint; ResearchTask orchestration stores sources + freshness metadata.
*   **Quality Gates:** All new services require unit + integration coverage, CLI smoke tests for `start` flows, and doc anchors cross-linking requirements IDs.
*   **Exit Criteria:** CLI commands for context + research run end-to-end, artifacts stored with hashes, OpenAPI & sequence diagrams committed, gating prompts validated with sample run.

<!-- anchor: task-i2-t1 -->
*   **Task 2.1:**
    *   **Task ID:** `I2.T1`
    *   **Description:** Implement context aggregator service to scan configured paths, summarize large files, hash binaries, and record token budgets/hashes into `context-manifest.json` while respecting must_not_touch constraints.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 communication patterns, Section 4 directives.
    *   **Input Files:** [`src/services/context/aggregator.ts`, `docs/guides/context_budgeting.md`]
    *   **Target Files:** [`src/services/context/aggregator.ts`, `tests/integration/context_aggregator.test.ts`]
    *   **Deliverables:** Service module, CLI wiring, tests verifying summarization + hashing, doc updates.
    *   **Acceptance Criteria:** Aggregator stores manifest with path, sha256, summary, token_cost, retrieval timestamps; respects constraints + TTL; tests pass.
    *   **Dependencies:** [`I1.T6`, `I1.T7`]
    *   **Parallelizable:** No

<!-- anchor: task-i2-t2 -->
*   **Task 2.2:**
    *   **Task ID:** `I2.T2`
    *   **Description:** Draft OpenAPI v3.1 spec for optional REST mirror (init/status/resume/export/actions) including headers Accept + X-GitHub-Api-Version, rate-limit metadata, error taxonomy, and JSON schemas referencing Section 2 data models.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2 API style, data model ERD, Task I1.T2.
    *   **Input Files:** [`api/ai_feature_workflow.yaml`]
    *   **Target Files:** [`api/ai_feature_workflow.yaml`, `docs/guides/api_contract.md`]
    *   **Deliverables:** Validated OpenAPI file, contract guide summarizing endpoints/headers.
    *   **Acceptance Criteria:** Passes spectral lint; documents Accept + API version headers; includes artifacts/resume/export endpoints; referenced in README.
    *   **Dependencies:** [`I1.T2`, `I1.T4`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i2-t3 -->
*   **Task 2.3:**
    *   **Task ID:** `I2.T3`
    *   **Description:** Build ResearchTask coordinator managing unknown detection, ResearchTask queue writing, cache_key tracking, and freshness enforcement; integrate with context aggregator outputs.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Requirements FR-6, ResearchTask schema.
    *   **Input Files:** [`src/services/research/coordinator.ts`, `src/persistence/queue/research_tasks.jsonl`]
    *   **Target Files:** [`src/services/research/coordinator.ts`, `tests/unit/research_coordinator.test.ts`, `docs/guides/research_playbook.md`]
    *   **Deliverables:** Coordinator, tests, runbook describing manual/agent assignment, caching.
    *   **Acceptance Criteria:** CLI can list/add/complete ResearchTasks; freshness enforcement triggers refetch when TTL exceeded; doc explains statuses + cache usage.
    *   **Dependencies:** [`I2.T1`]
    *   **Parallelizable:** No

<!-- anchor: task-i2-t4 -->
*   **Task 2.4:**
    *   **Task ID:** `I2.T4`
    *   **Description:** Author PlantUML sequence diagram for prompt-to-deploy flow covering CLI orchestrator, context aggregator, research coordinator, PRD/spec gates, execution queue, adapters, deployment triggers, and resume loops.
    *   **Agent Type Hint:** `DiagrammingAgent`
    *   **Inputs:** Section 2 communication patterns, state machine, OpenAPI spec.
    *   **Input Files:** [`docs/diagrams/sequence_prompt_to_deploy.puml`]
    *   **Target Files:** [`docs/diagrams/sequence_prompt_to_deploy.puml`, `docs/guides/sequence_prompt_to_deploy.md`]
    *   **Deliverables:** Sequence diagram with textual explanation linking to requirements.
    *   **Acceptance Criteria:** Diagram renders, includes rate-limit/resume notes, cross-linked to docs + README.
    *   **Dependencies:** [`I2.T2`, `I2.T3`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i2-t5 -->
*   **Task 2.5:**
    *   **Task ID:** `I2.T5`
    *   **Description:** Produce context budgeting + summarization guidelines (Markdown) with numeric token caps, chunking strategy, binary hashing, and redaction policies for sensitive files.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Requirements FR-8, Section 7 NFRs.
    *   **Input Files:** [`docs/guides/context_budgeting.md`]
    *   **Target Files:** [`docs/guides/context_budgeting.md`, `config/schemas/context_manifest.schema.json`]
    *   **Deliverables:** Guide + schema ensuring automation respects budgets.
    *   **Acceptance Criteria:** Guide lists budgets for <2k files and <20k files, includes chunking instructions, redaction rules, and cross-links to aggregator; schema validated.
    *   **Dependencies:** [`I2.T1`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i2-t6 -->
*   **Task 2.6:**
    *   **Task ID:** `I2.T6`
    *   **Description:** Implement PRD authoring engine hooking to agent adapter (stub) with template sections (problem, goals, acceptance criteria, risks) and gating prompts storing outputs to `prd.md` with hash + approval request.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 components, Requirements FR-4/FR-9/FR-11.
    *   **Input Files:** [`src/services/artifacts/prd_authoring.ts`, `docs/templates/prd_template.md`]
    *   **Target Files:** [`src/services/artifacts/prd_authoring.ts`, `tests/unit/prd_authoring.test.ts`, `docs/guides/prd_workflow.md`]
    *   **Deliverables:** Service, tests, documentation, CLI wiring for `ai-feature start` to produce PRD.
    *   **Acceptance Criteria:** PRD includes traceability mapping; CLI prompts for approval; tests verify idempotent skip when file unchanged.
    *   **Dependencies:** [`I2.T1`, `I2.T3`]
    *   **Parallelizable:** No

<!-- anchor: task-i2-t7 -->
*   **Task 2.7:**
    *   **Task ID:** `I2.T7`
    *   **Description:** Implement spec composer service referencing PRD + research outputs, producing spec/test/rollout sections, constraints, unknowns, and hooking to approval gate before planner executes.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** PRD template, Requirements FR-6/FR-10/FR-11.
    *   **Input Files:** [`src/services/artifacts/spec_composer.ts`, `docs/templates/spec_template.md`]
    *   **Target Files:** [`src/services/artifacts/spec_composer.ts`, `tests/unit/spec_composer.test.ts`, `docs/guides/spec_workflow.md`]
    *   **Deliverables:** Composer code/tests, template updates, doc.
    *   **Acceptance Criteria:** Spec includes constraints/test/rollout/risk sections; CLI enforces approval; idempotent skip logic implemented; doc references gating.
    *   **Dependencies:** [`I2.T6`]
    *   **Parallelizable:** No

<!-- anchor: task-i2-t8 -->
*   **Task 2.8:**
    *   **Task ID:** `I2.T8`
    *   **Description:** Build approval registry module + CLI prompts storing approvals.json with signer ID, artifact hash, timestamp, and method (human/agent) to support gating and audit.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 4 directives, Requirements FR-11.
    *   **Input Files:** [`src/services/governance/approval_registry.ts`, `tests/unit/approval_registry.test.ts`]
    *   **Target Files:** [`src/services/governance/approval_registry.ts`, `docs/guides/approvals.md`]
    *   **Deliverables:** Registry code, CLI prompts, doc referencing gating and CLI flags.
    *   **Acceptance Criteria:** Approvals stored with hash + stage; CLI exposes `ai-feature approve --stage`; doc includes exit codes + automation guidance.
    *   **Dependencies:** [`I1.T8`, `I2.T6`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i2-t9 -->
*   **Task 2.9:**
    *   **Task ID:** `I2.T9`
    *   **Description:** Integrate start flows (`--prompt`, `--linear`, `--spec`) through context aggregator, research coordinator, PRD/spec engines, and approvals with telemetry instrumentation.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Tasks I2.T1–I2.T8, Requirements FR-4/FR-5/FR-6.
    *   **Input Files:** [`src/cli/commands/start.ts`, `tests/smoke/start_prompt.test.ts`, `tests/smoke/start_linear.test.ts`]
    *   **Target Files:** [`src/cli/commands/start.ts`, `tests/smoke/start_prompt.test.ts`, `tests/smoke/start_linear.test.ts`, `docs/guides/start_command.md`]
    *   **Deliverables:** Fully wired start command variants, CLI help text, smoke tests verifying artifact creation, doc updates.
    *   **Acceptance Criteria:** Running start command writes context-manifest, research tasks, PRD/spec awaiting approvals; telemetry captures last_step/last_error; tests pass in CI.
    *   **Dependencies:** [`I2.T1`, `I2.T3`, `I2.T6`, `I2.T7`, `I2.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i2-t10 -->
*   **Task 2.10:**
    *   **Task ID:** `I2.T10`
    *   **Description:** Implement Linear issue snapshot + rate-limit aware fetch helper storing payloads, retries, and caching, degrading gracefully to prompt-only mode when API unavailable.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Requirements FR-5, IR-8/IR-9, Section 2 components.
    *   **Input Files:** [`src/adapters/linear/index.ts`, `docs/guides/linear_integration.md`]
    *   **Target Files:** [`src/adapters/linear/index.ts`, `tests/integration/linear_adapter.test.ts`, `docs/guides/linear_integration.md`]
    *   **Deliverables:** Adapter stub hitting mock APIs, caching snapshots in run directory, doc describing rate-limit behavior.
    *   **Acceptance Criteria:** Snapshot writes include retrieved_at + content_hash; adapter enforces 1,500 req/hr limit; fallback prompt path documented.
    *   **Dependencies:** [`I1.T7`, `I2.T1`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i2-t11 -->
*   **Task 2.11:**
    *   **Task ID:** `I2.T11`
    *   **Description:** Extend `ai-feature status` command to display overview (context counts, PRD/spec status, approvals needed, research backlog) using new services with anchors for automation.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Start command output, approval registry, ResearchTask coordinator.
    *   **Input Files:** [`src/cli/commands/status.ts`, `tests/smoke/status_summary.test.ts`]
    *   **Target Files:** [`src/cli/commands/status.ts`, `tests/smoke/status_summary.test.ts`, `docs/guides/status_command.md`]
    *   **Deliverables:** CLI summary view, JSON output schema, docs describing sections + exit codes.
    *   **Acceptance Criteria:** Status surfaces context counts, pending approvals, research stats; `--json` returns structured DTO; tests cover human-action scenario.
    *   **Dependencies:** [`I2.T1`, `I2.T3`, `I2.T8`]
    *   **Parallelizable:** No

*   **Iteration Reporting:** Add `.codemachine/reports/I2_summary.md` capturing context metrics, OpenAPI changes, and gating coverage for adoption review.
*   **Carryover Handling:** File issues for unresolved token-budget items or API clarifications; flag them in `docs/guides/context_budgeting.md` for I3 follow-up.
*   **Retro Notes:** Document agent prompt tuning learnings in `docs/guides/iteration_retrospectives.md` referencing PRD/spec outputs.
