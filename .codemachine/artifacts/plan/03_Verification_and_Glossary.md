<!-- anchor: verification-strategy -->
## 6. Verification and Integration Strategy

<!-- anchor: verification-testing-levels -->
### 6.1 Testing Levels

1. **Unit Tests:** `vitest` suites cover configuration loaders, run directory manager, HTTP client, context aggregator, ResearchTask coordinator, task planner, validation registry, agent adapters, deployment trigger, export bundler, and CLI helpers. Threshold: >90% statement coverage for core modules with fixtures in `tests/fixtures/`.
2. **Integration Tests:** Multi-stage tests simulate CLI workflows (`start`, `plan`, `validate`, `pr`, `deploy`, `export`, `observe`, `cleanup`) using sample repos and mocked GitHub/Linear endpoints. Nightly pipeline runs `npm run test:smoke-execution`, `npm run test:smoke-pr`, and `npm run test:smoke-deploy` for deterministic verification.
3. **End-to-End Deploy Tests:** `tests/integration/deploy_resume.spec.ts` verifies status-check polling, approvals, auto-merge toggles, workflow dispatch, resume after failure, and export bundle creation. GitHub fixtures replicate success/failure cases; logs stored for compliance review.
4. **Contract Tests:** Adapter suites (`tests/integration/githubAdapter.spec.ts`, `tests/integration/linearAdapter.spec.ts`) replay recorded HTTP fixtures validating headers, payloads, rate-limit handling, and error taxonomy. Failures block release.
5. **UX Snapshot Tests:** CLI output snapshots ensure `status --json`, `plan --json`, `resume --json`, `rate-limits --json`, and `observe --json` remain schema-compatible for automation consumers (Graphite, CodeMachine).
6. **Doc/Diagram Validation:** `scripts/tooling/validate_diagrams.sh` renders PlantUML/Mermaid sources; markdown lint ensures anchors remain intact; plan_manifest regenerated each release.

<!-- anchor: verification-ci -->
### 6.2 CI/CD Pipeline Expectations

* **Pipeline Stages:** (1) Lint (`npm run lint`), (2) Type-check (`tsc --noEmit`), (3) Unit tests, (4) Integration tests (mocked adapters + CLI commands), (5) Smoke tests on nightly schedule, (6) Docs/diagram validation, (7) Export bundle verification, (8) Docker image build + publish.
* **Environment Matrix:** Node v24 (primary) / Node v20 (maintenance) across Linux and macOS; Docker workflow ensures reproducibility for homelab operators and CI.
* **Secrets Handling:** GitHub/Linear tokens injected as CI secrets; live-integration jobs limited to scheduled windows; recorded fixtures used by default; telemetry redacts tokens before log export.
* **Artifact Publishing:** CI stores run directory snapshots, coverage reports, diagram exports, telemetry metrics, export bundles, and `plan_manifest.json` for traceability.
* **Fail Fast:** CI fails when coverage drops below thresholds, lint/test errors occur, OpenAPI docs outdated, or plan_manifest missing anchors.

<!-- anchor: verification-quality-gates -->
### 6.3 Code Quality Gates & Metrics

* **Static Analysis:** ESLint (`@typescript-eslint`), TypeScript strict compilation, Prettier formatting, and optional Semgrep. Blocking issues resolved before merge.
* **Coverage Targets:** 85% branch / 90% statement coverage for core modules; `plan/milestone_notes.md` records deltas and remediation owners.
* **Security Scans:** `npm audit` (with allowlist for vetted packages), dependency review (GitHub Dependabot), optional `npm audit signatures`. Security issues tagged with severity and tracked until resolved.
* **Rate-Limit Budgets:** Telemetry ensures GitHub/Linear `retry-after` or `x-ratelimit-reset` waits rarely exceed alert thresholds (<5 warnings per 1000 calls). Observability hub raises warning events when budgets low.
* **Performance Budgets:** Context gather <30s for <2k files / <2m for <20k; PR creation <10s excluding GitHub latency; export bundler <60s; cleanup <30s. Deviations logged as incidents.

<!-- anchor: verification-artifact-validation -->
### 6.4 Artifact Validation

* **Run Directory Integrity:** `hash_manifest.json` updated each step; `status --json` surfaces mismatches; `cleanup` verifies exports before deletion; resume refuses to start when hashes mismatch recorded state.
* **PRD/Spec/Plan Checks:** Templates validated via `zod`; approvals recorded with hash + signer; change logs stored; traceability map confirms each requirement links to ExecutionTasks.
* **Export Bundle Schema:** JSON Schema enforced via `npm run test:export-schema`; CLI offers `--validate-only`; manifest includes SHA256 for each file plus CLI/Node versions; MD exports reference anchors for docs/diagrams.
* **Diagrams & Docs:** PlantUML/Mermaid lint ensures diagrams compile; doc anchors verified by plan_manifest; README lists artifact paths.
* **HTTP Ledger:** `rate_limits.json` validated using schema logging provider, limit, remaining, reset, retry-after, backoff attempts, and last error; CLI `rate-limits` command reads same structure.

<!-- anchor: verification-risk-monitoring -->
### 6.5 Risk Mitigation & Monitoring

* **Rate-Limit Alerts:** CLI warns when `remaining` < threshold; `observe` summarizes blocked tasks; ledger stored for postmortems.
* **Approval Compliance:** CLI enforces gating, `observe` surfaces pending approvals older than SLA, docs instruct manual overrides; audit logs capture signer/time/artifact hash.
* **Resume Health:** Resume tests run nightly; `metrics/prometheus.txt` tracks resume success; `plan/milestone_notes.md` records incidents.
* **Security/Secrets:** Redaction filters run before logging/export; cleanup ensures secrets never leave environment; docs describe PAT scope requirements.
* **Incident Documentation:** `plan/milestone_notes.md` captures rate-limit failures, validation flakes, integration drift; `docs/ops/compliance_checklist.md` references evidence for audit.

<!-- anchor: verification-readiness -->
### 6.6 Verification Readiness Checklist

1. Smoke tests green on latest commit (execution, PR, deploy, ops).
2. OpenAPI specification versioned + linted; diff recorded.
3. Export bundle validation suite passes on representative run; manifest stored.
4. Observability dashboards verified via `observe` command; metrics/traces accessible.
5. Documentation updated (PRD/spec templates, approval playbooks, branch protection, deployment, export, observe, cleanup).
6. `plan_manifest.json` regenerates referencing all anchors with descriptions for downstream agents.

<!-- anchor: verification-tooling -->
### 6.7 Tooling & Evidence Capture

* **Logs:** `logs.ndjson` appended per run, with severity, component, message, trace ID; zipped into export bundles; `observe` references log size + last entry time.
* **Metrics:** `metrics/prometheus.txt` collects queue depth, validation durations, retry counts, API latency histograms, cleanup actions, observe KPIs; optional OTLP exporter can send to Prometheus-compatible collectors.
* **Traces:** `traces.json` records CLI spans per command; exporters optional; docs describe rehydrating traces for debugging.
* **Evidence Bundles:** `docs/ops/compliance_checklist.md` outlines which evidence to gather (export manifests, approvals, ledger snapshots, PR transcripts) for audits.
* **Automation Hooks:** `scripts/tooling/smoke_*.sh` produce machine-readable results consumed by CI and stored in `plan/milestone_notes.md`.

<!-- anchor: verification-approvals -->
### 6.8 Release Approval & Change Control

* **Release Review:** Each release requires sign-off from Architecture (diagram/spec updates), Ops (observability + cleanup), Security (token/approval review), and Product (feature readiness). Sign-offs recorded in `plan/readiness_checklist.md`.
* **Change Control:** Schema/CLI-breaking changes require new ADR or addendum; config migrations tracked in `docs/requirements/config_migrations.md`; plan_manifest updated accordingly.
* **Rollback Strategy:** `codepipe cleanup --archive` used to snapshot runs before upgrades; Docker images pinned to version tags; release notes identify upgrade steps.

<!-- anchor: verification-environment -->
### 6.9 Environmental Health Checks

* **Doctor Command:** Validates Node version, git, Docker, required env vars, disk space, and CLI version; logs results to `docs/ops/doctor_reference.md`.
* **Init Command Dry-Run:** `codepipe init --dry-run` ensures repo ready before enabling automation; outputs stored for compliance.
* **Observe/cleanup Cron:** Documented schedule ensures telemetry + storage budgets tracked; cron logs referenced by Ops.

<!-- anchor: glossary -->
## 7. Glossary

1. **Agent Adapter:** Interface that abstracts provider-specific prompt/response flows; enforces manifest schema, capability negotiation, cost/rate-limit metadata, and redaction policies.
2. **Approval Gate:** CLI-enforced checkpoint (PRD, spec, code, PR, deploy) requiring human or delegated approval recorded with artifact hash, signer, and timestamp.
3. **Auto-Fix Loop:** Validation workflow described in ADR-7 where failing lint/test/build commands trigger bounded retries before surfacing errors to operators.
4. **Branch Protection Intelligence:** Module that inspects GitHub-required checks, reviews, and auto-merge eligibility, surfacing blockers before deployment attempts.
5. **Context Aggregator:** Service that scans repo globs, README, docs, history, summarizes content, scores relevance, and stores context manifests consumed by PRD/spec engines.
6. **Export Bundle:** Deterministic archive (JSON/Markdown) containing prompts, context, PRD/spec, plan, logs, metrics, diffs, approvals, rate-limit ledger, deployment info, and manifest referencing SHA256 for every file.
7. **ExecutionTask:** DAG node describing work units (code generation, validation, PR automation, deployment) with dependencies, retry policies, telemetry, and traceability links.
8. **Linear Snapshot:** Cached representation of Linear issue data captured via MCP adapter, including metadata, attachments, and retrieval timestamps for offline contexts.
9. **Rate-Limit Ledger:** Persistent JSON record per provider storing limit, remaining, reset time, retry-after, backoff attempts, and last error to enforce cooldowns and support resume flows.
10. **Run Directory:** `.codepipe/<feature_id>/` folder storing manifests, queue, approvals, logs, metrics, traces, context, ResearchTasks, PRD/spec, plan, deployment records, and exports.
11. **Traceability Map:** JSON + Markdown mapping PRD goals to spec requirements, ExecutionTasks, diffs, and deployment artifacts, ensuring audits can follow end-to-end lineage.
12. **Validation Registry:** Configuration-driven catalog of lint/test/typecheck/build commands executed before PR creation or deployment, supporting auto-fix loops and CLI reporting.
13. **Write Action Queue:** Throttled queue for GitHub write operations (PR creation, comments, labels) that enforces IR-7 and records telemetry to avoid abuse-rate limits.
14. **Observe Report:** Output of `codepipe observe` capturing run KPIs, rate-limit warnings, approval aging, and incident summaries for operators and homelab cron jobs.
15. **Cleanup Command:** CLI utility that enforces retention policies, verifies exports, archives artifacts, and deletes stale run directories only after compliance checks succeed.
16. **Deployment Record:** Metadata describing PR number, merge SHA, required checks, reviews, workflow dispatch results, notifications, and timestamped outcomes stored under run directory for audit/export.
17. **Plan Manifest:** JSON index mapping anchors to file locations (this plan), enabling automation agents to retrieve sections/tasks deterministically.
18. **Capability Manifest:** JSON description of agent provider models, rate limits, tooling support, and costs; consumed by Agent Adapter to select providers for PRD/spec/code flows.
19. **Milestone Notes:** Living log stored in `plan/milestone_notes.md` capturing iteration risks, incidents, KPIs, and approvals for change-control transparency.
20. **Observe/Cleanup KPIs:** Metrics tracked during `observe`/`cleanup` commands (queue depth, stale approvals, storage usage) to maintain operational health.
21. **Telemetry Hub:** Aggregated logging/metrics/traces stack living within each run directory, ensuring local-first observability without external dependencies.
22. **Deployment Workflow Dispatch:** GitHub Action or other automation triggered by CLI `deploy` command, referenced in deployment records and export bundles.
