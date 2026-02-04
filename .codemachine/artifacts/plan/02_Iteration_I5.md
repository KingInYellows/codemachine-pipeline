<!-- anchor: iteration-5-plan -->
### Iteration 5: Deployment Automation, Export Bundles & Operational Hardening

*   **Iteration ID:** `I5`
*   **Goal:** Finalize deployment orchestration (status-check polling, auto-merge toggles, workflow dispatch), implement export bundles + manifest schemas, deliver observability/cleanup commands, codify ops/compliance documentation, and ensure glossary/verification sections remain current.
*   **Prerequisites:** Integrations operational (`I4`), execution pipeline stable (`I3`), context/spec flows ready (`I2`), and CLI foundation complete (`I1`). GitHub repo must support protected branches and workflow dispatch for testing.
*   **Key Deliverables:** Deployment trigger module + state diagram, export bundler + schema, `codepipe observe` & `cleanup`, notification adapter baseline, e2e deploy/resume tests, verification strategy updates, glossary refresh, and compliance/security docs.
*   **Exit Criteria:** CLI can detect merge blockers, request approvals, enable auto-merge when allowed, trigger deployment workflows, generate export bundles, run observe/cleanup tasks, and document verification + glossary updates for downstream teams.
*   **Tasks:**

<!-- anchor: task-i5-t1 -->
    *   **Task 5.1:**
        *   **Task ID:** `I5.T1`
        *   **Description:** Implement Deployment Trigger module controlling merge readiness, status-check polling, auto-merge toggles, and workflow dispatch, plus create the Deployment & Resume State Diagram (PlantUML) for Section 2.1.
            Ensure module works with branch protection data from `I4.T5`, integrates with approvals, and records deployment records.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2.1 (Deployment Diagram), FR-15/FR-16, ADR-3.
        *   **Input Files**: ["docs/requirements/github_branch_protection.md", "docs/requirements/deploy_flows.md", "docs/diagrams/pr_automation_sequence.mmd"]
        *   **Target Files:** ["src/workflows/deploymentTrigger.ts", "docs/diagrams/deployment_resume_state.puml", "docs/requirements/deployment_playbook.md", "tests/integration/deploymentTrigger.spec.ts"]
        *   **Deliverables:** Deployment module, PlantUML diagram, doc covering auto-merge/manual flows, and tests verifying branch protection detection.
        *   **Acceptance Criteria:** CLI `deploy` reports blockers, can enable auto-merge when allowed, triggers workflow dispatch, updates `deployment.json`; diagram renders; doc outlines manual override path.
        *   **Dependencies:** `I4.T1`..`I4.T5`
        *   **Parallelizable:** No

<!-- anchor: task-i5-t2 -->
    *   **Task 5.2:**
        *   **Task ID:** `I5.T2`
        *   **Description:** Build Export Bundle service packaging prompts, context manifest, PRD/spec, plan, logs, metrics, diffs, approvals, rate-limit ledger, deployment records, and API transcripts; define JSON Schema + Markdown playbook per Section 2.1.
            Support formats `json` and `md`, with CLI `codepipe export` enhancements.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2.1 (Export schema), Section 3 (Directory structure), NFR-10.
        *   **Input Files**: ["docs/requirements/export_bundles.md", "docs/requirements/run_directory_schema.md", "docs/requirements/traceability_playbook.md"]
        *   **Target Files:** ["src/workflows/exportService.ts", "src/cli/commands/export.ts", "docs/requirements/export_manifest_schema.json", "docs/ops/export_playbook.md", "tests/integration/exportBundles.spec.ts"]
        *   **Deliverables:** Export service, CLI updates, schema, documentation, and integration tests verifying completeness and redaction.
        *   **Acceptance Criteria:** Bundles include manifest with hashes; CLI `export --format json` writes zipped folder; doc describes verifying signatures; schema validated in CI.
        *   **Dependencies:** `I3.T6`, `I4.T4`
        *   **Parallelizable:** Yes

<!-- anchor: task-i5-t3 -->
    *   **Task 5.3:**
        *   **Task ID:** `I5.T3`
        *   **Description:** Deliver Observability operations: `codepipe observe` command summarizing run health, KPIs, rate-limit events, plus operations runbook per Section 2.1; include metrics ingest instructions for homelab dashboards.
            Integrate with telemetry files and schedule-friendly output.
        *   **Agent Type Hint:** `OpsAgent`
        *   **Inputs:** Section 2 (Observability), docs from `I1.T6` and `I3.T6`.
        *   **Input Files**: ["docs/ops/observability_baseline.md", "docs/ops/execution_telemetry.md", "plan/milestone_notes.md"]
        *   **Target Files:** ["src/cli/commands/observe.ts", "docs/ops/observe_playbook.md", "tests/integration/observe_command.spec.ts"]
        *   **Deliverables:** CLI command, documentation detailing KPIs and scheduling, tests verifying JSON output, and instructions for storing reports under `.codepipe/reports/`.
        *   **Acceptance Criteria:** Command enumerates active runs, blocked states, rate-limit warnings, KPIs; doc explains cron usage and retention; tests confirm deterministic JSON schema.
        *   **Dependencies:** `I3.T6`, `I4.T3`
        *   **Parallelizable:** Yes

<!-- anchor: task-i5-t4 -->
    *   **Task 5.4:**
        *   **Task ID:** `I5.T4`
        *   **Description:** Implement `codepipe cleanup` for run directories, honoring retention metadata, verifying export bundles before deletion, archiving artifacts optionally, and documenting safe usage with sample automation scripts.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 3 (Directory structure), Section 4 (Directives), ADR-2.
        *   **Input Files**: ["docs/requirements/run_directory_schema.md", "docs/ops/cleanup_policy.md"]
        *   **Target Files:** ["src/cli/commands/cleanup.ts", "docs/ops/cleanup_playbook.md", "tests/integration/cleanup_command.spec.ts"]
        *   **Deliverables:** Cleanup command, doc describing retention policies, test verifying safe deletion/archival.
        *   **Acceptance Criteria:** Command rejects directories lacking exported bundles; doc outlines dry-run mode; tests ensure sample data archived appropriately.
        *   **Dependencies:** `I5.T2`
        *   **Parallelizable:** Yes

<!-- anchor: task-i5-t5 -->
    *   **Task 5.5:**
        *   **Task ID:** `I5.T5`
        *   **Description:** Create end-to-end deployment/resume integration tests simulating blocked checks, approvals, auto-merge, workflow dispatch, and resume after failure; log outputs for documentation and export bundler verification.
        *   **Agent Type Hint:** `TestingAgent`
        *   **Inputs:** FR-15/FR-16, outputs from `I5.T1`..`I5.T4`.
        *   **Input Files**: ["tests/fixtures/github/*.json", "docs/requirements/deployment_playbook.md", "docs/requirements/export_manifest_schema.json"]
        *   **Target Files:** ["tests/integration/deploy_resume.spec.ts", "scripts/tooling/smoke_deploy.sh", "plan/milestone_notes.md"]
        *   **Deliverables:** Integration tests, smoke script, milestone notes capturing reliability metrics.
        *   **Acceptance Criteria:** Tests simulate required check failure + success; CLI logs show appropriate gating; milestone notes record flake rate and action items.
        *   **Dependencies:** `I5.T1`, `I5.T2`
        *   **Parallelizable:** No

<!-- anchor: task-i5-t6 -->
    *   **Task 5.6:**
        *   **Task ID:** `I5.T6`
        *   **Description:** Implement Notification adapter skeleton (Slack/email/webhook) for deployment success/failure and long-running approvals; integrate with approvals + observe command with feature flags for optional use.
        *   **Agent Type Hint:** `BackendAgent`
        *   **Inputs:** Section 2 (Key Components), Section 4 (Directives), FR-11.
        *   **Input Files**: ["docs/requirements/notification_channels.md", "docs/ops/approval_playbook.md"]
        *   **Target Files:** ["src/adapters/notifications/NotificationAdapter.ts", "src/workflows/notificationBridge.ts", "docs/requirements/notification_playbook.md", "tests/unit/notificationBridge.spec.ts"]
        *   **Deliverables:** Adapter interface + minimal implementation, documentation describing opt-in behavior, tests verifying deduplication and gating.
        *   **Acceptance Criteria:** Feature flags control notifications; CLI logs when notifications queued/delivered; doc warns about secrets/logging; tests ensure throttle windows honored.
        *   **Dependencies:** `I4.T7`, `I5.T3`
        *   **Parallelizable:** Yes

<!-- anchor: task-i5-t7 -->
    *   **Task 5.7:**
        *   **Task ID:** `I5.T7`
        *   **Description:** Update Verification & Integration Strategy (Section 6) and operations docs to reflect new deployment/export/observe flows; align with compliance requirements (token handling, PAT scopes, auto-merge governance) and include checklists for audits.
        *   **Agent Type Hint:** `DocumentationAgent`
        *   **Inputs:** Section 6 template, Section 4 directives, ADR-3/ADR-5/ADR-7.
        *   **Input Files**: ["docs/requirements/verifications.md", "docs/ops/deployment_playbook.md", "docs/ops/export_playbook.md"]
        *   **Target Files:** [".codemachine/artifacts/plan/03_Verification_and_Glossary.md", "docs/ops/security_runbook.md", "docs/ops/compliance_checklist.md"]
        *   **Deliverables:** Updated Verification strategy, security/compliance runbooks, audit checklist referencing artifacts.
        *   **Acceptance Criteria:** Section 6 references latest testing, CI, quality gates; docs explain token scopes + privacy; compliance checklist cross-links to export bundle schema; reviewers sign off.
        *   **Dependencies:** `I5.T1`..`I5.T6`
        *   **Parallelizable:** No

<!-- anchor: task-i5-t8 -->
    *   **Task 5.8:**
        *   **Task ID:** `I5.T8`
        *   **Description:** Refresh glossary (Section 7) and `docs/ui/` assets to capture updated terminology (observe, cleanup, export bundle, deployment record), ensuring anchors referenced by CLI help and downstream agents remain accurate.
            Provide translation cues for key microcopy.
        *   **Agent Type Hint:** `DocumentationAgent`
        *   **Inputs:** Section 1 (Glossary references), `I5.T7` outputs, docs/UI tokens.
        *   **Input Files**: ["docs/ui/microcopy.md", "docs/requirements/project_spec.md", ".codemachine/artifacts/plan/03_Verification_and_Glossary.md"]
        *   **Target Files:** [".codemachine/artifacts/plan/03_Verification_and_Glossary.md", "docs/ui/cli_patterns.md", "docs/ui/design_tokens.json"]
        *   **Deliverables:** Glossary updates, CLI UX docs, design token adjustments capturing new statuses.
        *   **Acceptance Criteria:** Glossary list matches Section 7 entries, CLI help references new terms, design tokens include observe/cleanup/alert states, documentation cross-links anchors.
        *   **Dependencies:** `I5.T7`
        *   **Parallelizable:** Yes

*   **Iteration Risks & Mitigations:**
    - Risk: Deployment automation may accidentally merge unready branches; Mitigation: approvals recorded, branch protection checks enforced, CLI logs gating decisions, and auto-merge disabled by default.
    - Risk: Export bundles could leak secrets; Mitigation: redaction audit before bundling, schema validation, and docs describing manual review before sharing.
    - Risk: Cleanup command might delete active runs; Mitigation: retention metadata + export verification + dry-run flag minimize mistakes.
*   **Hand-off Checklist:**
    - Run `codepipe deploy --dry-run`, `codepipe export --format json`, `codepipe observe`, and `codepipe cleanup --dry-run` on fixture repo, attaching outputs to `plan/milestone_notes.md`.
    - Ensure deployment diagrams, export schema, and ops runbooks linked from README and `.codepipe/templates/` for future contributors.
    - Share audit checklist + glossary updates with downstream automation (Graphite, CodeMachine) and tag completion in `plan/readiness_checklist.md`.
*   **Iteration Metrics & Recording Plan:**
    - Monitor deployment latency, workflow success rate, auto-merge enablement frequency, and export bundle generation time.
    - Capture cleanup activity counts, observe report sizes, and notification send rates in telemetry.
    - Document compliance checks (token scope audits, export reviews) within `docs/ops/compliance_checklist.md`.
*   **Iteration Validation Hooks:**
    - Schedule weekly export bundle verification comparing schema to actual output.
    - Add `scripts/tooling/smoke_ops.sh` to run observe/cleanup/deploy/export flows with sample data and capture results for future regression.
    - Archive sanitized deployment API transcripts and export bundles for use in training/support documentation.
    - Capture observe/cleanup command metrics inside metrics/prometheus.txt and share weekly reports in docs/ops/reports.md for governance tracking.
    - Provide demo video transcript or CLI transcript referencing export/deploy for onboarding docs stored under docs/ops/tutorials.md.
    - Store compliance evidence (export hash list, approval logs, deployment records) in docs/ops/compliance_checklist.md to support audits.
    - Publish glossary diff summary in plan/milestone_notes.md so downstream automation knows which terms changed between blueprint revisions.
    - Tag release notes referencing deployment/export milestones and include pointer to  for navigation.
    - Tag release notes referencing deployment/export milestones and include pointer to .codemachine/artifacts/plan/plan_manifest.json for navigation.

