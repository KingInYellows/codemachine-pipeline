<!-- anchor: iteration-4-plan -->
### Iteration 4: Integration Adapters, PR Automation & Branch Protection Intelligence

*   **Iteration ID:** `I4`
*   **Goal:** Wire GitHub and Linear adapters with rate-limit safe HTTP calls, produce OpenAPI specs, add PR automation commands, detect branch protections/reviewer requirements, and ensure CLI status/resume surfaces show real-time integration data.
*   **Prerequisites:** `I1`–`I3` complete with execution engine smoke tests, traceability map, and agent manifests. GitHub/Linear credentials must be available in `.env` or OS keychain for integration testing.
*   **Key Deliverables:** GitHub adapter + OpenAPI spec, Linear MCP adapter, rate-limit telemetry exposures, PR creation/reviewer commands with sequence diagram, branch protection intelligence, CLI status/resume enhancements, write action queue, and integration tests covering rate-limit scenarios.
*   **Exit Criteria:** CLI can create PRs, request reviewers, inspect status checks, handle rate-limit responses, update Linear snapshots, and expose reliable `status`/`resume` information with integration telemetry.
*   **Tasks:**

<!-- anchor: task-i4-t1 -->
    *   **Task 4.1:**
        *   **Task ID:** `I4.T1`
        *   **Description:** Implement GitHub adapter covering repo metadata, branches, PR creation, reviewer requests, status checks, merges, and workflow dispatch, while emitting OpenAPI spec for future remote endpoints (per Section 2.1).
            Handle authentication (PAT or App), Accept/API version headers, error taxonomy, and logging.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 2.1 (OpenAPI artifact), IR-1..IR-7, FR-15.
        *   **Input Files**: ["docs/requirements/github_endpoints.md", "docs/ops/rate_limit_reference.md", "api/codepipe.yaml"]
        *   **Target Files:** ["src/adapters/github/GitHubAdapter.ts", "api/codepipe.yaml", "docs/requirements/github_adapter.md", "tests/integration/githubAdapter.spec.ts"]
        *   **Deliverables:** Adapter implementation, OpenAPI additions, documentation, and integration tests verifying PR creation/reviewer requests/merge readiness under mocked responses.
        *   **Acceptance Criteria:** REST calls include required headers; rate-limit retries invoked when headers indicate; tests assert correct payloads; doc explains configuration for Accept/Version, status-check endpoints, and branch creation.
        *   **Dependencies:** `I3.T2`, `I3.T6`
        *   **Parallelizable:** No

<!-- anchor: task-i4-t2 -->
    *   **Task 4.2:**
        *   **Task ID:** `I4.T2`
        *   **Description:** Build Linear integration via MCP server, covering issue fetch/snapshot, optional updates, and graceful degradation when preview APIs differ, referencing ADR-6.
            Provide caching rules and CLI options for offline replays.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), IR-8..IR-11, ADR-6.
        *   **Input Files**: ["docs/requirements/linear_integration.md", "docs/adr/ADR-6-linear-integration.md"]
        *   **Target Files:** ["src/adapters/linear/LinearAdapter.ts", "docs/requirements/linear_adapter.md", "tests/integration/linearAdapter.spec.ts"]
        *   **Deliverables:** MCP-driven Linear adapter, documentation describing offline mode and rate-limit handling, and integration tests with mocked MCP responses.
        *   **Acceptance Criteria:** CLI `start --linear` loads snapshots, records metadata, caches responses; adapter respects 1,500 req/hour; doc covers developer preview toggles.
        *   **Dependencies:** `I2.T3`, `I3.T1`
        *   **Parallelizable:** Yes

<!-- anchor: task-i4-t3 -->
    *   **Task 4.3:**
        *   **Task ID:** `I4.T3`
        *   **Description:** Expand rate-limit ledger + telemetry to surface integration-specific cooldown timers, backlog states, and CLI warnings; add Prometheus metrics for GitHub/Linear budgets, and CLI command `codepipe rate-limits` for manual inspection.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Observability), Section 4 (Directives), outputs from `I3.T6`.
        *   **Input Files**: ["docs/ops/rate_limit_reference.md", "docs/ops/execution_telemetry.md"]
        *   **Target Files:** ["src/telemetry/rateLimitReporter.ts", "src/cli/commands/rate-limits.ts", "docs/requirements/rate_limit_dashboard.md", "tests/unit/rateLimitReporter.spec.ts"]
        *   **Deliverables:** Reporter module, CLI command, dashboards doc, tests verifying formatting.
        *   **Acceptance Criteria:** CLI prints remaining/reset times; metrics include gauges per provider; doc ties warnings to required operator actions.
        *   **Dependencies:** `I4.T1`, `I4.T2`
        *   **Parallelizable:** Yes

<!-- anchor: task-i4-t4 -->
    *   **Task 4.4:**
        *   **Task ID:** `I4.T4`
        *   **Description:** Implement PR automation CLI surfaces (`codepipe pr create`, `pr status`, `pr reviewers`, `pr disable-auto-merge`) plus GitHub PR automation sequence diagram (Mermaid) detailing request flow, write action queue, and branch protection feedback loops.
        *   **Agent Type Hint:** `FrontendAgent`
        *   **Inputs:** Section 2 (Communication Patterns), Section 2.1 (PR diagram), FR-15, ADR-3.
        *   **Input Files**: ["docs/requirements/github_endpoints.md", "docs/ops/approval_playbook.md", "docs/diagrams/execution_flow.puml"]
        *   **Target Files:** ["src/cli/commands/pr/create.ts", "src/cli/commands/pr/status.ts", "src/cli/commands/pr/reviewers.ts", "docs/diagrams/pr_automation_sequence.mmd", "docs/requirements/pr_playbook.md", "tests/integration/pr_commands.spec.ts"]
        *   **Deliverables:** CLI commands, sequence diagram, documentation, tests verifying JSON output and blocked states.
        *   **Acceptance Criteria:** CLI can create PR, request reviewers, show status-check summary; doc explains gating vs auto-merge; diagram renders.
        *   **Dependencies:** `I4.T1`, `I4.T3`
        *   **Parallelizable:** No

<!-- anchor: task-i4-t5 -->
    *   **Task 4.5:**
        *   **Task ID:** `I4.T5`
        *   **Description:** Build branch-protection intelligence module that fetches required status checks, review requirements, dismissal rules, and auto-merge eligibility, surfacing results in CLI `status` and `deploy` flows.
            Include integration with ExecutionTask outputs to highlight missing validations or stale commits.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), FR-15, IR-5.
        *   **Input Files**: ["docs/requirements/github_branch_protection.md", "docs/requirements/validation_playbook.md"]
        *   **Target Files:** ["src/adapters/github/branchProtection.ts", "src/workflows/branchProtectionReporter.ts", "docs/requirements/branch_protection_playbook.md", "tests/unit/branchProtection.spec.ts"]
        *   **Deliverables:** Branch protection module, doc explaining statuses, tests verifying translation to CLI output, and integration with plan/resume.
        *   **Acceptance Criteria:** CLI surfaces missing checks/reviews; doc explains how to interpret results; tests cover outdated commit detection and up-to-date requirements.
        *   **Dependencies:** `I4.T1`, `I4.T4`
        *   **Parallelizable:** Yes

<!-- anchor: task-i4-t6 -->
    *   **Task 4.6:**
        *   **Task ID:** `I4.T6`
        *   **Description:** Extend CLI `status`/`resume` to include GitHub/Linear integration state, rate-limit warnings, branch protection blockers, and links to ResearchTask snapshots, ensuring JSON schema remains stable.
            Provide documentation for automation consumers parsing these responses.
        *   **Agent Type Hint:** `FrontendAgent`
        *   **Inputs:** Section 1 (Target Audience), Section 2 (Communication patterns), outputs from `I4.T1`..`I4.T5`.
        *   **Input Files**: ["docs/requirements/cli_surface.md", "docs/requirements/github_adapter.md", "docs/requirements/linear_adapter.md"]
        *   **Target Files:** ["src/cli/commands/status.ts", "src/cli/commands/resume.ts", "docs/ui/cli_patterns.md", "tests/integration/cli_status_plan.spec.ts"]
        *   **Deliverables:** Enhanced CLI outputs, documentation, tests verifying JSON schema, and sample transcripts for automation training.
        *   **Acceptance Criteria:** JSON schema includes integration sections; human output highlights rate-limit warnings; doc enumerates fields for Graphite/CodeMachine ingestion.
        *   **Dependencies:** `I4.T4`, `I4.T5`
        *   **Parallelizable:** Yes

<!-- anchor: task-i4-t7 -->
    *   **Task 4.7:**
        *   **Task ID:** `I4.T7`
        *   **Description:** Build write action queue for GitHub (PR comments, labels, review requests) to throttle writes per IR-7, including serialization, retry/backoff, and telemetry.
            Provide scenario tests hitting secondary limits to verify pause/resume logic.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), IR-6/IR-7, Section 4 (Rate-limit directives).
        *   **Input Files**: ["docs/requirements/integration_constraints.md", "docs/ops/rate_limit_reference.md"]
        *   **Target Files:** ["src/workflows/writeActionQueue.ts", "docs/requirements/write_action_playbook.md", "tests/integration/writeActionQueue.spec.ts"]
        *   **Deliverables:** Queue implementation, documentation describing usage, test suite simulating rate-limit responses, and CLI instrumentation linking actions to logs.
        *   **Acceptance Criteria:** Secondary limit simulation triggers cooldown; queue persists to run directory; doc explains concurrency knobs; tests confirm deduping/idempotency keys.
        *   **Dependencies:** `I4.T1`, `I4.T3`
        *   **Parallelizable:** Yes

<!-- anchor: task-i4-t8 -->
    *   **Task 4.8:**
        *   **Task ID:** `I4.T8`
        *   **Description:** Create integration regression tests + fixtures covering GitHub/Linear success, rate-limit, and error paths, running via mocked HTTP servers and recorded responses; update milestone notes with coverage map.
            Provide README instructions for updating fixtures.
        *   **Agent Type Hint:** `TestingAgent`
        *   **Inputs:** Section 2 (Technology Stack), FR/IR list, outputs from `I4.T1`..`I4.T7`.
        *   **Input Files**: ["tests/fixtures/github/*.json", "tests/fixtures/linear/*.json", "docs/ops/rate_limit_reference.md"]
        *   **Target Files:** ["tests/integration/github_linear_regression.spec.ts", "scripts/tooling/update_fixtures.sh", "plan/milestone_notes.md", "docs/ops/integration_testing.md"]
        *   **Deliverables:** Regression test suite, fixture updater script, documentation, milestone notes summarizing coverage + outstanding gaps.
        *   **Acceptance Criteria:** Tests simulate success, 403 secondary, 429 primary, missing scopes; fixtures stored with hashed metadata; doc teaches contributors how to refresh fixtures; milestone notes call out remaining manual scenarios.
        *   **Dependencies:** `I4.T1`..`I4.T7`
        *   **Parallelizable:** No

*   **Iteration Risks & Mitigations:**
    - Risk: GitHub API schema changes; Mitigation: OpenAPI spec + contract tests highlight drift, and adapters log request IDs for support tickets.
    - Risk: Linear MCP downtime; Mitigation: offline snapshot cache + ResearchTask fallback documented in `linear_adapter.md`.
    - Risk: Rate-limit storms; Mitigation: write action queue with telemetry/warnings plus `codepipe rate-limits` command instructing operators to pause.
*   **Hand-off Checklist to I5:**
    - Provide working PR/resume/deploy transcripts, OpenAPI spec, and integration fixture bundles for deployment automation work.
    - Confirm CLI `status --json` schema updates documented and exported for Graphite/CodeMachine consumption.
    - Populate `plan/milestone_notes.md` with integration coverage and TODOs for deployment/export stages.
*   **Iteration Metrics Targets & Recording Plan:**
    - Track API call counts, rate-limit wait durations, PR creation latency, reviewer assignment success, and Linear snapshot freshness.
    - Export metrics to Prometheus textfiles plus `telemetry/costs.json` for referencing integration costs.
    - Document integration incidents (403/429, schema drift) to inform future governance.
*   **Iteration Validation Hooks:**
    - Schedule nightly GitHub/Linear contract tests using recorded fixtures to catch API drift early.
    - Add CLI smoke script `scripts/tooling/smoke_pr.sh` verifying PR creation + reviewer assignment run end-to-end.
    - Archive rate-limit ledger samples plus CLI transcripts in `.codepipe/templates/integration/` for deployment team reference.
    - Provide example GitHub Action workflow file in docs/ops/pr_playbook.md demonstrating how CLI output feeds status checks, ensuring deployment iteration has reproducible references.
    - Capture write-action queue depth and GitHub/Linear latency histograms inside metrics/prometheus.txt so deployment auto-merge heuristics can reuse the data.
    - Store sanitized API transcripts for successful and rate-limited calls under run_directory/api/ so I5 export tooling has representative payloads.

