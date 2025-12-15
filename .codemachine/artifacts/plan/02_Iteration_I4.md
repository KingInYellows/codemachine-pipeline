<!-- anchor: iteration-4-plan -->
### Iteration 4: Workflow UX, CLI Commands, and Human-in-the-Loop Experience

*   **Iteration ID:** `I4`
*   **Goal:** Finish CLI workflows across plan/resume/pr/deploy subcommands, enforce approval prompts, introduce notification hooks, polish UI/UX tokens, and ensure human operators receive actionable summaries.
*   **Prerequisites:** `I1`–`I3`
*   **Key Deliverables:** CLI render utilities, density/color toggles, resume enhancements, PR command suite, reviewer assignment logic, notification adapter stubs, documentation for UX tokens, start/status/resume/plan/pr/deploy help pages, interactive approvals.
*   **Key Risks:** Poor UX causing misuse of approvals, CLI outputs missing anchors for automation, notifications spamming external systems, watchers clashing with local-first constraints.
*   **Coordination Plan:** Pair UI/UX writer with CLI engineers, run usability testing on sample runs, review notification templates with security + ops teams.
*   **Success Metrics:** CLI commands share design tokens, approvals clearly spelled out, watch/observe commands run non-destructively, doc anchors referencing sections, exit codes reliable for automation.
*   **Exit Criteria:** All core commands (`status`, `resume`, `plan`, `run`, `pr`, `deploy`, `observe`, `export`) provide polished UX with documentation, approvals, and optional JSON outputs.

<!-- anchor: task-i4-t1 -->
*   **Task 4.1:**
    *   **Task ID:** `I4.T1`
    *   **Description:** Build CLI rendering/tokens module implementing spacing, color palette, density toggles, badge styles, progress lanes, and JSON fallback as defined in UI architecture.
    *   **Agent Type Hint:** `FrontendAgent`
    *   **Inputs:** UI/UX Architecture Section, Section 4 directives.
    *   **Input Files:** [`src/cli/renderers/tokens.ts`, `docs/guides/ui_style.md`]
    *   **Target Files:** [`src/cli/renderers/tokens.ts`, `src/cli/renderers/components.ts`, `docs/guides/ui_style.md`]
    *   **Deliverables:** Token definitions, reusable components, doc describing usage + accessibility guidelines.
    *   **Acceptance Criteria:** Renderers support colorless mode, density toggles, anchors for automation; doc references design tokens.
    *   **Dependencies:** [`I1.T1`, `I1.T7`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i4-t2 -->
*   **Task 4.2:**
    *   **Task ID:** `I4.T2`
    *   **Description:** Enhance `ai-feature status` command with improved layout (progress lanes, context tables, approval reminders, rate-limit ledger) plus `--json` schema documentation.
    *   **Agent Type Hint:** `FrontendAgent`
    *   **Inputs:** Renderer module, approval registry, context aggregator.
    *   **Input Files:** [`src/cli/commands/status.ts`, `docs/guides/status_command.md`]
    *   **Target Files:** [`src/cli/commands/status.ts`, `docs/guides/status_command.md`, `tests/snapshot/status_output.test.ts`]
    *   **Deliverables:** Styled status output, snapshot tests, doc referencing fields + exit codes.
    *   **Acceptance Criteria:** Status shows sections per design, `--json` matches schema, tests protect formatting.
    *   **Dependencies:** [`I4.T1`, `I2.T11`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t3 -->
*   **Task 4.3:**
    *   **Task ID:** `I4.T3`
    *   **Description:** Implement `ai-feature resume` UX combining last_step/last_error, pending tasks, cooldowns, and manual action prompts with automation-friendly JSON output + docs.
    *   **Agent Type Hint:** `FrontendAgent`
    *   **Inputs:** Resume coordinator, renderer module.
    *   **Input Files:** [`src/cli/commands/resume.ts`, `docs/guides/resume_flow.md`]
    *   **Target Files:** [`src/cli/commands/resume.ts`, `tests/smoke/resume_cli.test.ts`, `docs/guides/resume_flow.md`]
    *   **Deliverables:** CLI command hooking to coordinator, docs describing exit codes + instructions.
    *   **Acceptance Criteria:** Resume prints blocking items, respects `--yes`, logs actions, JSON output includes tasks/cooldowns.
    *   **Dependencies:** [`I3.T9`, `I4.T1`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t4 -->
*   **Task 4.4:**
    *   **Task ID:** `I4.T4`
    *   **Description:** Implement PR workflow commands: `ai-feature pr create`, `ai-feature pr reviewers`, `ai-feature pr status`, `ai-feature pr disable-auto-merge`, leveraging GitHub adapter and approval gating.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** GitHub adapter, approval registry, execution engine outputs.
    *   **Input Files:** [`src/cli/commands/pr/create.ts`, `src/cli/commands/pr/reviewers.ts`, `src/cli/commands/pr/status.ts`]
    *   **Target Files:** [`src/cli/commands/pr/create.ts`, `src/cli/commands/pr/reviewers.ts`, `src/cli/commands/pr/status.ts`, `docs/guides/pr_commands.md`, `tests/smoke/pr_commands.test.ts`]
    *   **Deliverables:** CLI commands, doc covering gating + exit codes, smoke tests using fixtures.
    *   **Acceptance Criteria:** Commands refuse to run without approvals/validations, display reviewer/required-check info, JSON output enumerates PR metadata.
    *   **Dependencies:** [`I3.T2`, `I3.T7`, `I2.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t5 -->
*   **Task 4.5:**
    *   **Task ID:** `I4.T5`
    *   **Description:** Deliver deployment CLI (`ai-feature deploy`) orchestrating branch protection checks, merge attempts, auto-merge toggles, workflow dispatch, and blocked reason reporting.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** GitHub adapter, deployment module plan, validation registry.
    *   **Input Files:** [`src/cli/commands/deploy.ts`, `docs/guides/deploy_command.md`]
    *   **Target Files:** [`src/cli/commands/deploy.ts`, `tests/smoke/deploy_command.test.ts`, `docs/guides/deploy_command.md`]
    *   **Deliverables:** CLI command, doc enumerating required statuses + exit codes, tests verifying blocked/merge success flows.
    *   **Acceptance Criteria:** Command detects missing checks, waits/backoffs, records deployment.json, outputs actionable statuses.
    *   **Dependencies:** [`I3.T2`, `I3.T7`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t6 -->
*   **Task 4.6:**
    *   **Task ID:** `I4.T6`
    *   **Description:** Introduce notification adapter stubs (Slack/email/webhook) with throttled queue, templates referencing severity levels, redaction, and feature flags.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 4 directives, observability spec.
    *   **Input Files:** [`src/adapters/notifications/index.ts`, `docs/guides/notification_playbook.md`]
    *   **Target Files:** [`src/adapters/notifications/index.ts`, `tests/unit/notification_adapter.test.ts`, `docs/guides/notification_playbook.md`]
    *   **Deliverables:** Adapter skeleton, queue config, doc describing enabling/disabling per repo.
    *   **Acceptance Criteria:** Notifications disabled by default, throttle thresholds configurable, templates include anchors + severity labels; tests verify queue/resend logic.
    *   **Dependencies:** [`I1.T7`, `I3.T6`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i4-t7 -->
*   **Task 4.7:**
    *   **Task ID:** `I4.T7`
    *   **Description:** Implement `ai-feature observe` command (cron-friendly) scanning run directories + GitHub merges to produce health report with KPIs, anomalies, and suggestions.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Observability hub, GitHub adapter, run-directory metadata.
    *   **Input Files:** [`src/cli/commands/observe.ts`, `docs/guides/observe_command.md`]
    *   **Target Files:** [`src/cli/commands/observe.ts`, `docs/guides/observe_command.md`, `tests/smoke/observe_command.test.ts`]
    *   **Deliverables:** CLI command writing `.ai-feature-pipeline/reports/<timestamp>.md`, doc describing scheduling + file lock usage.
    *   **Acceptance Criteria:** Observe command reads run dirs, compiles KPI summary, respects concurrency lock, exit codes indicate success/anomaly.
    *   **Dependencies:** [`I1.T6`, `I3.T6`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i4-t8 -->
*   **Task 4.8:**
    *   **Task ID:** `I4.T8`
    *   **Description:** Enhance `ai-feature export` CLI to package selected artifacts, run redaction scan, allow md/json output, and document manifest schema.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Artifact bundle service, observability guidelines, Section 4 directives.
    *   **Input Files:** [`src/cli/commands/export.ts`, `docs/guides/export_command.md`]
    *   **Target Files:** [`src/cli/commands/export.ts`, `tests/smoke/export_command.test.ts`, `docs/guides/export_command.md`, `docs/templates/export_manifest.json`]
    *   **Deliverables:** Enhanced command + doc, sample manifest, tests verifying redaction + inclusion toggles.
    *   **Acceptance Criteria:** Export bundles include manifest/diffs/logs/telemetry, redaction filter passes tests, CLI prints shareable path.
    *   **Dependencies:** [`I3.T7`, `I3.T9`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t9 -->
*   **Task 4.9:**
    *   **Task ID:** `I4.T9`
    *   **Description:** Publish comprehensive CLI help system + docs (README updates, command reference, FAQs) referencing anchors and cross-linking to plan sections.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** All CLI commands, UI architecture.
    *   **Input Files:** [`docs/guides/command_reference.md`, `README.md`]
    *   **Target Files:** [`docs/guides/command_reference.md`, `README.md`, `docs/guides/faq.md`]
    *   **Deliverables:** Up-to-date docs with tables for commands, flags, exit codes, reliability tips.
    *   **Acceptance Criteria:** Each command documented with synopsis + exit codes; README includes quickstart; docs reference iterations + requirements.
    *   **Dependencies:** [`I4.T2`–`I4.T8`]
    *   **Parallelizable:** No

<!-- anchor: task-i4-t10 -->
*   **Task 4.10:**
    *   **Task ID:** `I4.T10`
    *   **Description:** Implement interactive approval prompts (with `$EDITOR` fallback) capturing artifact hash, reason, signer, plus automation-friendly `--approved-by` flag for signed bundles.
    *   **Agent Type Hint:** `FrontendAgent`
    *   **Inputs:** Approval registry, UI renderer, Section 4 directives.
    *   **Input Files:** [`src/cli/prompts/approval_prompt.ts`, `docs/guides/approvals.md`]
    *   **Target Files:** [`src/cli/prompts/approval_prompt.ts`, `tests/unit/approval_prompt.test.ts`, `docs/guides/approvals.md`]
    *   **Deliverables:** Prompt component, tests for $EDITOR fallback, doc updates covering automation usage.
    *   **Acceptance Criteria:** Prompt shows artifact summary + diff hints, fallback instructions documented, CLI stores signatures + method, tests cover non-TTY behavior.
    *   **Dependencies:** [`I2.T8`, `I4.T1`]
    *   **Parallelizable:** Yes

<!-- anchor: task-i4-t11 -->
*   **Task 4.11:**
    *   **Task ID:** `I4.T11`
    *   **Description:** Add `ai-feature cleanup` CLI for retention enforcement: detect old run directories, verify exports, archive to tar when requested, and log actions for audit.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Run-directory design, export command, observability docs.
    *   **Input Files:** [`src/cli/commands/cleanup.ts`, `docs/guides/cleanup_command.md`]
    *   **Target Files:** [`src/cli/commands/cleanup.ts`, `tests/smoke/cleanup_command.test.ts`, `docs/guides/cleanup_command.md`]
    *   **Deliverables:** CLI command, doc describing retention settings, tests verifying dry-run + actual cleanup.
    *   **Acceptance Criteria:** Command lists candidates, respects `--dry-run`, archives when `--archive` set, records actions to logs.
    *   **Dependencies:** [`I1.T6`, `I4.T8`]
    *   **Parallelizable:** Yes

*   **Iteration Reporting:** Produce `.codemachine/reports/I4_summary.md` summarizing CLI UX changes, documentation updates, and command coverage stats.
*   **Carryover Handling:** Log UX backlog items (e.g., TUIs) if not finished, reference them in `docs/guides/ui_style.md` backlog section.
*   **Retro Notes:** Capture operator feedback, notification tuning, and gating improvements inside `docs/guides/iteration_retrospectives.md`.
