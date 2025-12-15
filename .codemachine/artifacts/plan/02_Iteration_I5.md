<!-- anchor: iteration-5-plan -->
### Iteration 5: Deployment Automation, Reliability Hardening, and Compliance Bundles

*   **Iteration ID:** `I5`
*   **Goal:** Finalize deployment workflows, rate-limit resilience, compliance-ready exports, telemetry dashboards, and operational runbooks ensuring homelab-friendly automation.
*   **Prerequisites:** `I1`–`I4`
*   **Key Deliverables:** Deployment trigger module, branch protection diagnostics, auto-merge controls, status check monitoring, rate-limit playbooks, observability metrics dashboard, compliance/export bundles, policy documentation, cleanup automation tests.
*   **Key Risks:** Merge loops due to stale checks, inaccurate deployment reporting, rate-limit storms, incomplete compliance bundles, missing cleanup/backups.
*   **Coordination Plan:** Work with ops + security on policy docs, confirm GitHub workflow IDs with repo owners, rehearse deployment on sample repo.
*   **Success Metrics:** Deploy command handles blocked/passed scenarios, rate-limit ledger alerts recorded, exports validated by `ai-feature export`, cleanup/observe commands produce actionable KPIs, compliance docs aligned with Section 5.2 scope.
*   **Exit Criteria:** CLI ready for pilot usage with deployment automation, reliability docs, and compliance artifacts; backlog triaged.

<!-- anchor: task-i5-t1 -->
*   **Task 5.1:**
    *   **Task ID:** `I5.T1`
    *   **Description:** Implement deployment trigger module (service) orchestrating GitHub branch protection queries, status check polling, merge attempts, workflow dispatch, and auto-merge toggles with logging.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** GitHub adapter, requirements FR-15/FR-16, IR-5.
    *   **Input Files:** [`src/services/deployment/trigger.ts`, `tests/integration/deployment_trigger.test.ts`]
    *   **Target Files:** [`src/services/deployment/trigger.ts`, `tests/integration/deployment_trigger.test.ts`, `docs/guides/deployment_module.md`]
    *   **Deliverables:** Deployment module, tests simulating blocked/passed states, documentation describing behavior.
    *   **Acceptance Criteria:** Module inspects required checks vs latest SHA, respects retry-after, optionally registers auto-merge; tests cover blocked statuses + merges.
    *   **Dependencies:** [`I3.T2`, `I3.T7`]
    *   **Parallelizable:** No

<!-- anchor: task-i5-t2 -->
*   **Task 5.2:**
    *   **Task ID:** `I5.T2`
    *   **Description:** Create rate-limit + deployment playbooks (Markdown) detailing GitHub/Linear headers, retry strategies, manual override process, and compliance tie-ins.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Requirements IR-6/IR-9, Section 4 directives.
    *   **Input Files:** [`docs/guides/rate_limit_playbook.md`, `docs/guides/deployment_runbook.md`]
    *   **Target Files:** [`docs/guides/rate_limit_playbook.md`, `docs/guides/deployment_runbook.md`]
    *   **Deliverables:** Updated playbooks referencing ledger fields, human action steps, GitHub documentation links.
    *   **Acceptance Criteria:** Playbooks cite Accept header, API version, `retry-after`, `x-ratelimit-reset`; include tables for GitHub vs Linear; cross-linked to CLI docs.
    *   **Dependencies:** [`I3.T1`, `I5.T1`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t3 -->
*   **Task 5.3:**
    *   **Task ID:** `I5.T3`
    *   **Description:** Harden export bundle builder to include trace.json, approvals, API transcripts, diff stats, telemetry, plus optional JSON signature for compliance.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Export CLI, artifact bundle service.
    *   **Input Files:** [`src/services/export/bundle_builder.ts`, `docs/templates/export_manifest.json`]
    *   **Target Files:** [`src/services/export/bundle_builder.ts`, `tests/integration/export_bundle.test.ts`, `docs/guides/compliance_bundle.md`]
    *   **Deliverables:** Enhanced builder, tests ensuring manifest completeness, compliance doc.
    *   **Acceptance Criteria:** Bundle includes manifest/docs/logs/traces/rate-limits/diffs/approvals; optional signature stored; tests verify hash coverage.
    *   **Dependencies:** [`I4.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i5-t4 -->
*   **Task 5.4:**
    *   **Task ID:** `I5.T4`
    *   **Description:** Build KPI/metrics exporter summarizing queue depth, retry counts, validation pass rates, cost telemetry, writing to `.ai-feature-pipeline/reports/kpi.json` for dashboards.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Observability hub, context aggregator metrics, execution queue.
    *   **Input Files:** [`src/services/telemetry/kpi_exporter.ts`, `tests/unit/kpi_exporter.test.ts`]
    *   **Target Files:** [`src/services/telemetry/kpi_exporter.ts`, `tests/unit/kpi_exporter.test.ts`, `docs/guides/telemetry.md`]
    *   **Deliverables:** Exporter module, tests, doc describing KPIs + scheduling via observe command.
    *   **Acceptance Criteria:** Exporter produces JSON with counts/durations/costs; observe command includes path; doc outlines KPIs + thresholds.
    *   **Dependencies:** [`I1.T7`, `I4.T7`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t5 -->
*   **Task 5.5:**
    *   **Task ID:** `I5.T5`
    *   **Description:** Implement compliance checklist + SOC-style evidence mapping referencing artifacts, approvals, tokens, and ADRs for Section 5 + 9 controls.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Requirements Section 5/9, export bundle guide.
    *   **Input Files:** [`docs/guides/compliance_checklist.md`, `docs/adr/0001-foundation.md`]
    *   **Target Files:** [`docs/guides/compliance_checklist.md`, `docs/guides/governance_notes.md`]
    *   **Deliverables:** Checklist linking requirements to artifacts + commands; governance note template.
    *   **Acceptance Criteria:** Checklist lists FR/IR/NFR references, evidence (file paths/commands), owners; doc added to README.
    *   **Dependencies:** [`I3.T11`, `I5.T3`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t6 -->
*   **Task 5.6:**
    *   **Task ID:** `I5.T6`
    *   **Description:** Add rate-limit alerting hooks (CLI warnings + optional notification) triggered when ledger remaining < threshold or repeated secondary limits occur.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** HTTP client ledger, notification adapter.
    *   **Input Files:** [`src/services/telemetry/rate_limit_monitor.ts`, `tests/unit/rate_limit_monitor.test.ts`]
    *   **Target Files:** [`src/services/telemetry/rate_limit_monitor.ts`, `tests/unit/rate_limit_monitor.test.ts`, `docs/guides/rate_limit_playbook.md`]
    *   **Deliverables:** Monitor hooking to logs + notifications, tests, doc update.
    *   **Acceptance Criteria:** Monitor triggers once thresholds crossed, logs action, optionally notifies; tests simulate exhaustion.
    *   **Dependencies:** [`I3.T1`, `I4.T6`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t7 -->
*   **Task 5.7:**
    *   **Task ID:** `I5.T7`
    *   **Description:** Extend deployment logging + notification pipeline to capture status-check details, reviewer states, workflow URLs, storing them inside `deployment.json` and optional notification messages.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Deployment module, notification adapter, docs.
    *   **Input Files:** [`src/services/deployment/trigger.ts`, `docs/guides/deployment_module.md`]
    *   **Target Files:** [`src/services/deployment/trigger.ts`, `docs/guides/deployment_module.md`, `tests/integration/deployment_logging.test.ts`]
    *   **Deliverables:** Logging enhancements, doc updates, tests verifying data recorded + notifications throttled.
    *   **Acceptance Criteria:** Deployment record stores status checks + reviewer list + workflow URL; notifications throttle and include severity.
    *   **Dependencies:** [`I5.T1`, `I4.T6`]
    *   **Parallelizable:** No

<!-- anchor: task-i5-t8 -->
*   **Task 5.8:**
    *   **Task ID:** `I5.T8`
    *   **Description:** Build `ai-feature diagnostics` command capturing logs, metrics, traces, config info, and bundling for support along with instructions for redaction.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Run directories, export builder, observability hub.
    *   **Input Files:** [`src/cli/commands/diagnostics.ts`, `docs/guides/diagnostics.md`]
    *   **Target Files:** [`src/cli/commands/diagnostics.ts`, `tests/smoke/diagnostics_command.test.ts`, `docs/guides/diagnostics.md`]
    *   **Deliverables:** Diagnostics ZIP generator, CLI help, doc describing when/how to share.
    *   **Acceptance Criteria:** Command collects sanitized data, prompts for confirmation, writes manifest; tests verify excludes secrets.
    *   **Dependencies:** [`I4.T8`, `I5.T3`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t9 -->
*   **Task 5.9:**
    *   **Task ID:** `I5.T9`
    *   **Description:** Automate cleanup + archival integration tests ensuring `cleanup` command respects retention, verifies exports, and writes audit logs before deletion.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Cleanup command, export builder.
    *   **Input Files:** [`tests/integration/cleanup_retention.test.ts`, `scripts/cleanup_runs.sh`]
    *   **Target Files:** [`tests/integration/cleanup_retention.test.ts`, `docs/guides/cleanup_command.md`]
    *   **Deliverables:** Integration tests, doc updates describing retention + archive process.
    *   **Acceptance Criteria:** Tests simulate runs with/without bundles, ensure cleanup refuses incomplete exports; doc lists recommended retention.
    *   **Dependencies:** [`I4.T11`, `I5.T3`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i5-t10 -->
*   **Task 5.10:**
    *   **Task ID:** `I5.T10`
    *   **Description:** Execute pilot dry-run covering start→deploy on sample repo, capture metrics, tune docs, file backlog issues, and produce release notes for CLI beta.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Entire pipeline, documentation.
    *   **Input Files:** [`scripts/smoke_cli.sh`, `.codemachine/reports/`]
    *   **Target Files:** [`docs/releases/beta_notes.md`, `.codemachine/reports/pilot_run.md`, `docs/guides/iteration_retrospectives.md`]
    *   **Deliverables:** Report summarizing metrics, release notes, backlog issue list.
    *   **Acceptance Criteria:** Dry-run populates run directory, merges sample PR via mocks, release notes highlight features + known gaps, backlog issues filed.
    *   **Dependencies:** [`I5.T1`–`I5.T9`]
    *   **Parallelizable:** No

*   **Iteration Reporting:** Store `.codemachine/reports/I5_summary.md` summarizing deployment success, rate-limit incidents, compliance readiness, and pilot outcomes.
*   **Carryover Handling:** Document remaining enterprise features (GitHub App auth, TUIs) for future roadmap; note in `docs/releases/beta_notes.md`.
*   **Retro Notes:** Capture reliability lessons, metric thresholds, and recommended watch schedules inside `docs/guides/iteration_retrospectives.md`.
