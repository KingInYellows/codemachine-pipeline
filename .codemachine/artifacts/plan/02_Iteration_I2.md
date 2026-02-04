<!-- anchor: iteration-2-plan -->
### Iteration 2: Context Intelligence & Specification Workflows

*   **Iteration ID:** `I2`
*   **Goal:** Build repository context discovery, summarization, and caching pipelines; implement ResearchTask orchestration; deliver PRD/spec authoring engines with approval gates; and formalize traceability/agent manifest flows so planning outputs remain deterministic and actionable.
*   **Prerequisites:** Completion of `I1` (CLI foundation, RepoConfig schema, run directory manager, data models, init/doctor commands) plus sample configs to exercise context discovery.
*   **Key Deliverables:** Context aggregator module, context manifest manifest, ResearchTask service + sequence diagram, PRD template + playbook, Specification composer blueprint, approval CLI UX, traceability map generator, agent manifest loader with cost telemetry.
*   **Exit Criteria:** CLI can gather ranked context from repo globs, create ResearchTasks for unknowns, generate PRD/spec drafts referencing templates, enforce approvals, and emit traceability maps linking goals to requirements.
*   **Tasks:**

<!-- anchor: task-i2-t1 -->
    *   **Task 2.1:**
        *   **Task ID:** `I2.T1`
        *   **Description:** Implement the Context Aggregator that crawls configured globs, README, docs, and git history, collecting file metadata, contents, and scoring heuristics while respecting token budgets defined in ADR-4.
            Support incremental hashing to skip unchanged files, integrate with run directory storage, and expose CLI options for manual inclusion/exclusion.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 2.1 (Context artifact), FR-7/FR-8, ADR-4.
        *   **Input Files**: ["docs/requirements/context_rules.md", "docs/adr/ADR-4-context-gathering.md", "docs/requirements/run_directory_schema.md"]
        *   **Target Files:** ["src/workflows/contextAggregator.ts", "src/workflows/contextRanking.ts", "tests/unit/contextAggregator.spec.ts", "docs/requirements/context_manifest.md"]
        *   **Deliverables:** Aggregator service with configuration-driven globs, scoring/ranking functions, CLI hooks for `start`, and documentation describing context manifest fields.
        *   **Acceptance Criteria:** Unit tests cover deduplication, hashing, ranking; CLI summarises contexts under `context/` folder; doc lists default globs, token thresholds, and fallback ordering.
        *   **Dependencies:** `I1.T3`, `I1.T7`
        *   **Parallelizable:** Yes

<!-- anchor: task-i2-t2 -->
    *   **Task 2.2:**
        *   **Task ID:** `I2.T2`
        *   **Description:** Add summarization pipeline that chunks large files, feeds them to configured agent/provider, stores compressed summaries, and records costs/tokens to telemetry, while enforcing redaction rules from Section 4.
            Provide CLI commands/options to re-summarize specific files and to view summary preview in `status` command.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Technology Stack), Section 4 (Directives), FR-8, NFR-3.
        *   **Input Files**: ["docs/requirements/context_rules.md", "docs/ops/observability_baseline.md", "docs/requirements/data_model_dictionary.md"]
        *   **Target Files:** ["src/workflows/contextSummarizer.ts", "src/telemetry/costTracker.ts", "docs/requirements/context_summarization.md", "tests/unit/contextSummarizer.spec.ts"]
        *   **Deliverables:** Summarization service with streaming support, telemetry integration, doc describing budgets/redaction, and automated tests verifying chunk heuristics.
        *   **Acceptance Criteria:** Telemetry file records tokens/cost per summary; summaries stored with SHAs and chunk IDs; CLI `status --json` includes summarized context entries and warnings when budgets exceeded.
        *   **Dependencies:** `I2.T1`
        *   **Parallelizable:** Yes

<!-- anchor: task-i2-t3 -->
    *   **Task 2.3:**
        *   **Task ID:** `I2.T3`
        *   **Description:** Build the ResearchTask coordinator that identifies unknowns from prompts/specs, queues tasks with objectives/sources/cache keys, and records outputs; document the process via the Context & Research Sequence Diagram promised in Section 2.1.
            Integrate caching/refresh policies (freshness required), CLI commands to list tasks, and storage under run directory.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2.1 (Sequence Diagram), FR-6, FR-7, ADR-4.
        *   **Input Files**: ["docs/requirements/research_tasks.md", "docs/adr/ADR-4-context-gathering.md"]
        *   **Target Files:** ["src/workflows/researchCoordinator.ts", "docs/diagrams/context_research_sequence.mmd", "docs/requirements/research_playbook.md", "tests/unit/researchCoordinator.spec.ts"]
        *   **Deliverables:** ResearchTask service with caching, Mermaid sequence diagram, documentation covering CLI usage and fallback flows when Linear offline.
        *   **Acceptance Criteria:** Diagram renders; CLI can create/list ResearchTasks; tasks include `cache_key`, `freshness_required`, and `sources`; doc references mitigation for rate limits/offline scenarios.
        *   **Dependencies:** `I2.T1`
        *   **Parallelizable:** No

<!-- anchor: task-i2-t4 -->
    *   **Task 2.4:**
        *   **Task ID:** `I2.T4`
        *   **Description:** Create PRD template (Markdown) and PRD authoring engine that uses context + research to draft PRDs, supports iterative editing, records approvals, and maps goals to trace IDs.
            Document the flow via PRD Template & Approval Playbook artifact and integrate gating prompts executed in CLI.
        *   **Agent Type Hint:** `DocumentationAgent`
        *   **Inputs:** Section 2.1 (PRD template), FR-4/FR-9, ADR-5.
        *   **Input Files**: ["docs/requirements/prd_requirements.md", "docs/ops/init_playbook.md", "docs/requirements/traceability_map.md"]
        *   **Target Files:** ["src/workflows/prdAuthoringEngine.ts", "docs/templates/prd_template.md", "docs/ops/prd_playbook.md", "plan/readiness_checklist.md"]
        *   **Deliverables:** PRD authoring module, template, approvals playbook, and CLI wiring for editing/approval flows.
        *   **Acceptance Criteria:** PRD template includes problem/goal/non-goal/acceptance/risk sections; CLI `start` generates `prd.md` referencing context; approvals recorded with hash; doc instructs editors how to request revisions.
        *   **Dependencies:** `I2.T1`, `I2.T2`, `I2.T3`
        *   **Parallelizable:** No

<!-- anchor: task-i2-t5 -->
    *   **Task 2.5:**
        *   **Task ID:** `I2.T5`
        *   **Description:** Implement Specification Composer that converts approved PRD + research data into structured `spec.md` covering constraints, rollout, test plan, and risks; create blueprint doc/diagram referenced in Section 2.1.
            Support CLI editing loops, highlight unknowns requiring more research, and store change logs for review.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 2.1 (Specification blueprint), FR-10, ADR-5.
        *   **Input Files**: ["docs/requirements/spec_requirements.md", "docs/templates/prd_template.md", "docs/requirements/traceability_map.md"]
        *   **Target Files:** ["src/workflows/specComposer.ts", "docs/requirements/spec_blueprint.md", "docs/diagrams/spec_flow.mmd", "tests/unit/specComposer.spec.ts"]
        *   **Deliverables:** Spec composer, blueprint doc, diagram, and tests verifying constraint/test-plan coverage.
        *   **Acceptance Criteria:** `spec.md` includes constraint/test/rollout sections, change log, and referenced file globs; CLI enforces approval; doc ties blueprint to ExecutionTask mapping.
        *   **Dependencies:** `I2.T4`
        *   **Parallelizable:** No

<!-- anchor: task-i2-t6 -->
    *   **Task 2.6:**
        *   **Task ID:** `I2.T6`
        *   **Description:** Design approval UX for PRD/spec stages, including CLI prompts, `--json` outputs for automation, human-in-the-loop documentation, and `approvals.json` updates with signatures.
            Provide offline editing guidance and escalate missing approvals via Notification stubs for later iterations.
        *   **Agent Type Hint:** `FrontendAgent`
        *   **Inputs:** Section 1 (Key Assumptions), Section 4 (Directives), ADR-5.
        *   **Input Files**: ["docs/ops/approval_gates.md", "docs/ops/init_playbook.md", "docs/templates/prd_template.md"]
        *   **Target Files:** ["src/cli/commands/approve.ts", "src/workflows/approvalRegistry.ts", "docs/ops/approval_playbook.md", "tests/integration/approvalFlows.spec.ts"]
        *   **Deliverables:** CLI approval command, registry service, doc describing gates/timeouts, and integration test verifying gating for `start`/`resume`.
        *   **Acceptance Criteria:** Approvals capture signer/time/hash; CLI `status` highlights pending gates; doc explains interactive + automation-friendly flows; tests simulate timeouts and resumption.
        *   **Dependencies:** `I2.T4`, `I2.T5`
        *   **Parallelizable:** Yes

<!-- anchor: task-i2-t7 -->
    *   **Task 2.7:**
        *   **Task ID:** `I2.T7`
        *   **Description:** Implement traceability map generator that links PRD goals → spec requirements → planned ExecutionTasks using models defined in I1, storing results in `trace.json` and surfacing summary in CLI.
            Provide Markdown guidance referencing FR-9/FR-10 so later teams can reason about completeness.
        *   **Agent Type Hint:** `StructuralDataAgent`
        *   **Inputs:** Section 2 (Data Model Overview), Section 2.1 (Trace artifacts), FR-9/FR-10, ADR-7.
        *   **Input Files**: ["docs/requirements/traceability_map.md", "docs/requirements/data_model_dictionary.md"]
        *   **Target Files:** ["src/workflows/traceabilityMapper.ts", "docs/requirements/traceability_playbook.md", "tests/unit/traceabilityMapper.spec.ts"]
        *   **Deliverables:** Mapper module, doc describing mapping conventions, and unit tests ensuring determinism.
        *   **Acceptance Criteria:** `trace.json` generated after PRD/spec approval; CLI `status --json` includes trace summary; doc outlines update process when spec changes; tests verify duplicates prevented.
        *   **Dependencies:** `I2.T4`, `I2.T5`
        *   **Parallelizable:** No

<!-- anchor: task-i2-t8 -->
    *   **Task 2.8:**
        *   **Task ID:** `I2.T8`
        *   **Description:** Introduce Agent Manifest loader (JSON Schema) covering provider metadata, rate limits, tool support, and cost hints; integrate with PRD/spec generators to pick appropriate providers and log spend per call.
            Update CLI docs on how to register manifests and verify compatibility.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2.1 (Agent adapter contract), ADR-1, ADR-4, ADR-7.
        *   **Input Files**: ["docs/requirements/agent_manifests.md", "docs/adr/ADR-1-agent-execution.md", "docs/ops/logging_playbook.md"]
        *   **Target Files:** ["src/adapters/agents/manifestLoader.ts", "docs/requirements/agent_manifest_schema.json", "docs/ops/agent_manifest_guide.md", "tests/unit/agentManifest.spec.ts"]
        *   **Deliverables:** Manifest loader, JSON Schema, guide describing provider onboarding, and tests validating schema compliance/cost logging.
        *   **Acceptance Criteria:** CLI rejects manifests missing rate-limit metadata; cost telemetry integrates with summarizer/PRD/spec calls; doc outlines manifest distribution workflow and fallback scenarios.
        *   **Dependencies:** `I1.T6`, `I2.T2`
        *   **Parallelizable:** Yes

*   **Iteration Risks & Mitigations:**
    - Risk: Context scans could overload large repos; Mitigation: configurable glob allowlists, chunked summarization, and progress logs; doc outlines safe defaults and warns before scanning >20k files.
    - Risk: PRD/spec approvals stall schedule; Mitigation: `approval_playbook.md` describes escalation/timeout handling and `--json` outputs enable automation reminders.
    - Risk: Agent manifest errors disrupt drafting; Mitigation: schema validation + sample manifests checked into `.codepipe/agents/`, plus fallback templates documented for offline editing.
*   **Hand-off Checklist to I3:**
    - Provide sample `context_manifest.json`, ResearchTask outputs, `prd.md`, `spec.md`, and `trace.json` generated against dummy repo for Execution Engine testing.
    - Confirm `docs/diagrams/context_research_sequence.mmd` and `spec_flow.mmd` render in CI and are linked from README + `plan/milestone_notes.md`.
    - Log approval events in `approvals.json` and include CLI transcripts demonstrating gating/resume flows for I3 reference.
    - Store representative agent manifests, cost telemetry, and summarization logs in `.codepipe/templates/` for automated regression tests.
*   **Iteration Metrics Targets & Recording Plan:**
    - Capture context-gather duration, number of files summarized, and token costs inside `metrics/prometheus.txt` plus `telemetry/costs.json` for regression tracking.
    - Track approval wait times and ResearchTask throughput to identify bottlenecks before execution iteration.
    - Document anomalies (e.g., summarization retries, manifest load failures) in `plan/milestone_notes.md` to inform validation commands planned for I3.
*   **Iteration Validation Hooks:**
    - Add `tests/integration/context_to_prd.spec.ts` ensuring aggregated context flows into PRD/spec creation deterministically.
    - Extend `codepipe status --json` to include context + research summaries verified during CI to guarantee contracts for I3 queue builder.
    - Schedule smoke test script `scripts/tooling/smoke_context_prd.sh` to run nightly, verifying summarization budgets and approvals remain healthy.
    - Publish summarized context + PRD/spec fixtures under  and document how I3 smoke tests should consume them.
    - Publish summarized context plus PRD/spec fixtures under '.codepipe/samples/' and document how I3 smoke tests should consume them.

