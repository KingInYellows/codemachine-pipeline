<!-- anchor: 3-0-proposed-architecture -->
## 3. Proposed Architecture (Operational View)
The operational blueprint extends the foundation mandates into executable guardrails for human operators and AI agents running the CLI. All wording, numbering, and responsibilities mirror the standard kit so downstream teams can trace requirements directly back to the foundation. The emphasis is on deterministic state management, adapter isolation, and observability artifacts that survive across laptops, homelab runners, and future CI containers.
The CLI-centric nature forces every operational concern to resolve through portable scripts and repo-local files. This section therefore addresses how workflows, adapters, security, and scale characteristics materialize when the orchestrator is invoked with commands such as `codepipe start`, `codepipe resume`, or `codepipe deploy`. Each subsection enumerates controls, automation hooks, and responsibilities of Ops, Infra, and Security personas.

<!-- anchor: 3-1-operational-posture -->
### 3.1 Operational Posture & Assumptions
Operations prioritize local-first execution, rate-limit discipline, and adapter isolation. The following items document the operational stance required for reliable runs across varied environments.
- Every command validates `.codepipe/config.json` using `zod` schemas before executing any external call. Any schema mismatch triggers exit code `10` (validation) with actionable remediation text referencing the config history entry.
- Node.js LTS (v20 or v24) is auto-detected at `codepipe init` time. If the runtime drifts, commands abort with a pointer to Ops docs describing `nvm`-based remediation and Docker fallbacks.
- Repo detection occurs by walking up from the current directory until `.git` is found, ensuring commands operate at consistent roots and preventing accidental cross-repo writes.
- Capability flags govern optional adapters (Linear Agents, CodeMachine telemetry, auto-merge). Operators must explicitly enable them via config or CLI overrides; default posture is conservative.
- Deterministic state is enforced with ULID/UUIDv7 feature IDs and monotonic log entries. Each run directory contains the canonical timeline, ensuring cross-machine reproducibility.
- All commands log structured JSON to both stdout (when `--json` is used) and `logs.ndjson`. Human-friendly summaries are interleaved only when not in JSON mode.
- Credential validation precedes any API call batch. Missing or insufficient scopes produce `Transient` vs `Permanent` classification, guiding whether reruns are safe.
- Observability artifacts (`metrics/prometheus.txt`, `traces.json`) are rotated per run ID to limit file contention and support incremental exports.
- Local caches (context summaries, Linear snapshots) include `retrieved_at` timestamps. Commands compare timestamps to TTL thresholds before reuse to avoid stale context.
- Crash-only design: there are no daemons. A failed command leaves run directories untouched except for updated `last_error` fields; resuming does not require cleanup scripts.

<!-- anchor: 3-2-orchestration-control-plane -->
### 3.2 Orchestration Control Plane
The CLI orchestrator enforces a layered control plane even though it runs within a single Node process.
- Presentation Layer: `oclif` commands parse flags, dispatch workflows, and normalize exit codes. They never perform business logic beyond argument validation.
- Orchestration Core: Coordinates finite-state transitions, approvals, and dependency ordering defined in `plan.json`. It relies on dependency injection to request adapters and artifact services.
- Adapter Layer: Concrete GitHub, Linear, and Agent adapters implement provider contracts. Each adapter must register capability metadata and rate-limit policies read by the orchestrator.
- Artifact Persistence: Run directories store all artifacts. File locking ensures mutual exclusion when multiple CLI invocations target the same feature.
- Resume Engine: At command start, the orchestrator inspects `last_step`, `last_error`, `approvals.json`, and queue files to determine whether to proceed or prompt for manual intervention.
- Approval Hooks: Before crossing gates (PRD acceptance, spec acceptance, codegen, PR creation, deploy), the orchestrator requests recorded approvals. Non-interactive mode reads signed statements referencing artifact hashes.
- Validation Registry: Maintains ordered commands per repo (lint, test, build). Each entry records command text, required env vars, and allowed failure categories. The orchestrator executes them before PR creation or deploy steps.
- Concurrency Governor: Limits concurrent ExecutionTasks based on RepoConfig `runtime.concurrency`. Tasks referencing identical files or high-risk operations (e.g., branch manipulation) run serially.
- Error Taxonomy Emission: Failures propagate structured objects indicating `transient`, `permanent`, or `human-action` to help automation decide on retries vs manual fix.
- Extensibility Ports: Additional adapters (Graphite, CodeMachine) register via plugin manifests yet still rely on shared HTTP and logging modules to maintain consistent telemetry.

<!-- anchor: 3-3-run-directories-and-resume -->
### 3.3 Run Directories & Resumability Mechanics
Run directories implement the deterministic checkpointing mandated by the foundation. Key operational behaviors:
- Directory Layout: `.codepipe/<feature_id>/` includes `feature.json`, `prd.md`, `spec.md`, `plan.json`, `logs.ndjson`, `context/`, `artifacts/`, `metrics/`, and `traces/` subfolders.
- Hash Manifest: Each major artifact includes a SHA-256 entry in `hash_manifest.json`. When commands rerun, they compare file hashes to detect changes and skip idempotent steps.
- Queue Files: Execution queues reside in `queue.jsonl` with each line describing `ExecutionTask` id, status, retry metadata, and dependencies. The orchestrator replays queue states on resume.
- File Locks: `feature.lock` uses advisory locking to prevent concurrent modification. Locks drop cleanly on crash due to OS-level release.
- Last Error Recording: `feature.json.telemetry.last_error` stores markdown summary plus failure classification. Resume commands display the exact message to operators before continuing.
- Input Snapshots: prompts, Linear payloads, or spec files are copied into `inputs/` with metadata describing origin, time captured, and source integrity (hash, API version).
- Context Cache: Summaries stored under `context/docs/<id>.json` record origin path, commit SHA, summarization method, token counts, and redaction flags. Regeneration occurs when commit SHA changes or TTL expires.
- Logs: `logs.ndjson` uses monotonic timestamp schema, run-scoped correlation IDs, and severity levels. Each step logs start/end events plus relevant metrics.
- Traceability Map: `trace.json` links PRD goals → Spec requirements → ExecutionTasks → git commits, enabling deterministic audits and supporting export bundles.
- Cleanup Policy: `codepipe cleanup --before <date>` scans run directories, respects `expiration_at` metadata, archives artifacts into tarballs, and deletes obsolete directories only after verifying exported bundles.

<!-- anchor: 3-4-http-clients-and-adapters -->
### 3.4 HTTP Clients & Adapter Responsibilities
External API access flows through a unified HTTP layer built on `undici`.
- Header Injection: Each request automatically includes `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` (overrideable), and provider-specific Authorization headers. Linear GraphQL requests include `Authorization: <API_KEY>`.
- Retry Policies: The HTTP layer implements exponential backoff with jitter for `429`, `502`, `503`, and network timeouts. GitHub-specific logic parses `retry-after`, `x-ratelimit-remaining`, and `x-ratelimit-reset` to determine the appropriate pause. Linear requests enforce sliding-window counts based on the 1,500 requests/hour rule.
- Rate Limit Ledger: Responses update `rate_limits.json`, which records provider, remaining quota, reset timestamp, and recent errors. The orchestrator inspects this ledger before initiating bursts of operations.
- Idempotency Keys: Mutating operations (PR creation, reviewer requests, merge attempts, Linear updates) include `Idempotency-Key` headers derived from feature ID and payload hash to prevent duplicates when retries occur.
- Adapter Boundaries: GitHubAdapter exposes methods for repo introspection, branch management, PR operations, status check queries, and auto-merge toggling. LinearAdapter handles issue fetch, snapshot caching, and optional comment updates. AgentAdapter orchestrates prompts, tool invocation, and fallback logic between providers.
- Error Translation: Adapters translate HTTP errors into normalized error classes with metadata describing HTTP status, provider, endpoint, request ID, and whether the error was due to auth, rate limit, or payload validation.
- Logging Hooks: Each request logs sanitized payload metadata, duration, bytes transferred, and trace IDs into `logs.ndjson` and `metrics/prometheus.txt` for latency histograms.
- Fixture Testing: Contract tests record HTTP fixtures under `.fixtures/http/<provider>/` and run via `vitest` to ensure adapters respect headers and error translation semantics over time.
- Capability Negotiation: Agent providers publish manifests describing tokens, streaming support, tool availability, rate limits, and cost per token. The orchestrator selects providers based on capability requirements of each stage.
- Offline Mode: If adapters detect network unavailability, they emit `human-action` errors instructing operators to resume later. Cached context and snapshots remain accessible so planning tasks can continue offline when possible.

<!-- anchor: 3-5-observability-operations -->
### 3.5 Observability Operations & Telemetry Surfaces
Observability ensures every feature run is auditable without external tooling.
- Logging: JSONL format with schema `{timestamp, level, run_id, component, message, context}`. The logger masks secrets by scanning strings for token patterns and replacing them with `***REDACTED***` while storing hashed fingerprints when necessary for debugging.
- Metrics: Prometheus-compatible textfiles under `metrics/prometheus.txt` capture queue depths, retry counters, API latency buckets, validation runtimes, agent token usage, and storage consumption. Files rotate per run ID to keep metrics deterministic.
- Tracing: `@opentelemetry/sdk-trace-node` collects spans across orchestrator stages, adapters, and validations. Default exporter writes to `traces.json`; optional OTLP endpoints are configurable via RepoConfig for integration with remote collectors.
- Alerting Hooks: Threshold breaches (e.g., repeated rate limit hits, validation flakiness, missing approvals) emit `NotificationEvent`s that can be surfaced via CLI output, log entries, or optional Slack/email adapters (future extension).
- Run Dashboards: `codepipe status --json` surfaces aggregated telemetry, enabling integration with other automation (Graphite, CodeMachine) without additional API calls.
- Metrics Governance: Operators can set `metrics.retention_days` in RepoConfig to control cleanup schedules; cleanup command enforces retention alongside run directory expiration.
- Failure Storytelling: When a stage fails, logs and traces include cross-links (via artifact-relative paths) so operators can open relevant files quickly.
- Observability Hardening: `codepipe observe` (cron job) inspects past run directories for anomalies (missing artifacts, incomplete exports) and produces aggregated reports for Ops leads.
- Privacy Controls: Logs avoid storing full file contents; context entries reference IDs and SHAs. Summaries record token counts and redaction flags to ensure sensitive data is not inadvertently exported.
- Deterministic Export: `codepipe export` bundles logs, metrics, traces, and rate-limit ledgers with a manifest referencing file hashes, enabling remote review without direct repo access.

<!-- anchor: 3-6-security-operations -->
### 3.6 Security Operations & Credential Governance
Security posture follows least privilege and defense-in-depth even though execution is local-first.
- Secrets via Environment: `GITHUB_TOKEN`, `LINEAR_API_KEY`, and agent credentials are read from environment variables. CLI detects missing values early and stops with `Permanent` errors requiring operator intervention.
- Scope Validation: GitHub token scopes must include repo, pull_request, workflow (for deploy triggers). CLI calls GitHub `/user` or `/app/installations` endpoints to inspect scopes and logs warnings for over-privileged tokens.
- Token Masking: Logging pipeline redacts tokens before writing to disk. For forensics, hashed fingerprints (e.g., first six characters hashed) help correlate events without leaking secrets.
- Config Safety: RepoConfig `safety` block enforces default `require_human_approval_for_merge=true`, `allow_force_push=false`, and `redact_secrets_in_logs=true`. Commands referencing overrides must record approvals in `approvals.json`.
- Branch Protection Awareness: Deployment module queries required status checks, required reviews, and if auto-merge is allowed. If requirements are unmet, CLI surfaces blocked reasons and exits gracefully.
- Artifact Sanitization: Export bundles exclude secrets by scanning files and replacing matches with redaction tokens. If sanitization cannot guarantee safety, the export command aborts and logs instructions.
- Credential Rotation: CLI records `expires_at` metadata (when provided by provider) in `integration_credentials.json` and warns operators when expiration is within 14 days.
- Agent Isolation: Bring-your-own-agent endpoints register capability flags indicating whether they store prompts server-side. Operators can force local-only prompts to avoid leaking sensitive repo content beyond approved endpoints.
- Audit Logging: Every critical action (approval, PR creation, merge attempt) logs actor identity, timestamp, and inputs referencing hashed artifacts. This data supports compliance requirements.
- Security Documentation: Ops docs describe minimal PAT scopes, recommended GitHub App configurations, and procedures for rotating tokens without losing resumability (update env var, rerun command, CLI validates and resumes).

<!-- anchor: 3-7-scalability-and-performance -->
### 3.7 Scalability, Performance & Capacity Planning
Even though the system runs locally, it must scale across large repos and heavy automation usage.
- Stateless CLI: Each invocation reads necessary artifacts, performs work, and exits. This design allows horizontal scaling by running multiple CLI commands in parallel on different features or on different machines.
- Executable Queue: `plan.json` and `queue.jsonl` allow ExecutionTasks to run in controlled batches, respecting concurrency settings while enabling parallelizable steps (e.g., code generation vs context summarization) to overlap when safe.
- Context Budgeting: Summarization budgets default to 8k tokens per feature run. Operators can adjust via config, but CLI enforces upper bounds to prevent runaway cost or latency.
- Repository Size Handling: Context aggregator uses glob filters and file hashing to avoid reprocessing unchanged files. Large files trigger summarization with chunk-level metadata and compression.
- Validation Scaling: Validation registry supports targeted commands per path (lint only touched files) and parallel execution when dependencies allow. Results capture per-command CPU/memory usage for tuning.
- Rate Limit Backpressure: HTTP layer enforces provider rate limits, ensuring long-running automation sessions do not exceed GitHub or Linear quotas. Backoff durations log to metrics for later tuning.
- Storage Management: Run directories store `expiration_at` metadata; cleanup command enforces quotas, archiving bundles externally before deletion. Operators can set max storage budgets in RepoConfig to trigger warnings.
- Homelab Parallelism: On self-hosted runners, cron jobs or orchestrated shell scripts can queue multiple features. File locks prevent collisions, while concurrency settings avoid saturating limited CPU/RAM.
- Agent Throughput: Agent adapter caches prompts/responses when deterministic results are acceptable, but also records capability-specific rate limits to avoid hitting provider caps. Cost-tracking files help operators plan budgets.
- Deployment Scaling: Docker-based CI image ensures consistent Node environment and dependencies, enabling easy scaling to GitHub Actions, GitLab runners, or homelab containers without divergence from local runs.

<!-- anchor: 3-8-cross-cutting-concerns -->
### 3.8 Cross-Cutting Concerns
This subsection articulates operational strategies for key cross-cutting topics mandated by the foundation plus additional hardening required for large-scale deployments.

<!-- anchor: 3-8-1-authentication-authorization -->
#### 3.8.1 Authentication & Authorization
- GitHub authentication relies on PATs or GitHub App tokens supplied via environment variables. Tokens are validated against scope requirements (repo, pull_request, workflow) before PR or deploy stages.
- Linear authentication uses API keys stored in `LINEAR_API_KEY`. GraphQL requests send the key in the `Authorization` header, and the CLI enforces max 1,500 requests/hour per key by tracking request timestamps.
- Agent providers declare their auth mechanisms (API keys, OAuth tokens, local sockets). The CLI supports env var injection and optional OS keychain lookups but defaults to env vars for determinism.
- Authorization decisions concentrate on branch protections: CLI queries required reviews/checks before merges, ensuring that automation never bypasses repo rules. Approvals recorded in `approvals.json` tie actions to specific actors.
- Optional GitHub App integration (future) would allow per-repo installations with least privilege; current version documents PAT scope guidelines and encourages fine-grained PATs.
- No standalone auth service exists; commands rely on the local user's credentials, aligning with local-first and no-daemon constraints.

<!-- anchor: 3-8-2-logging-monitoring -->
#### 3.8.2 Logging & Monitoring
- Structured logging across all commands ensures consistent ingestion into tools like `jq`, `Grafana Loki`, or future collectors. Each log entry includes run ID and component for fast filtering.
- Metrics follow Prometheus textfile format, enabling node exporters or custom scrapers to ingest metrics from homelab machines. Standard metrics include `run_duration_seconds`, `github_requests_total`, `linear_requests_total`, and validation timings.
- `codepipe observe` can push summarized metrics to optional dashboards by tailing metrics files and publishing aggregated JSON via CLI. This remains optional to honor local-first constraints.
- Health Checks: When invoked in automation, commands can run `codepipe status --json` to confirm the latest step succeeded, acting as a health probe for resumed runs.
- Log Retention: Operators configure retention policies to avoid disk bloat; cleanup tooling enforces retention while ensuring bundle exports remain intact for audit needs.
- Monitoring of rate-limit behavior includes diffing `rate_limits.json` snapshots to highlight providers nearing exhaustion. CLI surfaces warnings to prompt manual pauses or token rotation.

<!-- anchor: 3-8-3-security-considerations -->
#### 3.8.3 Security Considerations
- HTTPS is enforced because all external APIs communicate over TLS endpoints (GitHub, Linear, optional agent services). CLI rejects non-HTTPS URLs in RepoConfig.
- Secrets never persist in plaintext files; when necessary, hashed fingerprints allow cross-referencing without exposing values.
- Sensitive context files flagged via `constraints.must_not_touch_paths` are excluded from agent prompts and bundle exports automatically. Operators maintain this list through RepoConfig revisions tracked in `config_history.json`.
- Input validation uses `zod` to sanitize CLI inputs, configuration values, and adapter responses before use. Unknown fields trigger warnings so spec drift is detected early.
- Agent manifests include risk classifications; Developer Preview integrations, such as Linear Agents, remain behind feature flags and require explicit operator acknowledgement due to instability.
- Git commands avoid force push by default. Branch creation includes naming conventions derived from feature IDs to prevent collisions and to simplify cleanup if runs are abandoned.
- Auto-merge is only enabled if config and approvals permit it, ensuring automation cannot bypass human review requirements.

<!-- anchor: 3-8-4-scalability-performance -->
#### 3.8.4 Scalability & Performance
- CLI commands remain stateless, enabling horizontal scaling via multiple machines or containers. Run directories act as the shared truth; when using network filesystems, file locking ensures safe concurrency.
- Summarization and planning steps support streaming agent interactions for responsiveness, while caching results to reduce repeated costs.
- Docker image provides consistent environment for CI, ensuring heavy workloads can be offloaded to build agents without environment drift.
- Validation commands run in parallel when there are no dependencies, reducing wall-clock time for large projects. Results feed into metrics to help tune concurrency settings.
- HTTP client maintains connection pooling via `undici`, minimizing overhead when interacting with GitHub/Linear under load.

<!-- anchor: 3-8-5-reliability-availability -->
#### 3.8.5 Reliability & Availability
- Resumable state machine ensures 99% run recovery requirement by persisting `last_step`, `last_error`, queue statuses, and approvals. After crashes, operators invoke `codepipe resume` to continue.
- Rate limit handling prevents repeated failures; CLI waits per `retry-after` or `x-ratelimit-reset` and logs wait durations for transparency.
- Validation of branch protection states prevents repeated merge attempts when required checks are pending. CLI surfaces actionable statuses rather than busy loops.
- Deployment triggers rely on GitHub Actions or repo scripts, keeping operations stateless. CLI waits for statuses using backoff to avoid API thrashing.
- Observability artifacts allow fast diagnosis of incidents. Exports capture everything needed so remote experts can analyze without replicating environment.

<!-- anchor: 3-9-deployment-view -->
### 3.9 Deployment View
Even though the CLI is local-first, deployment in CI or containerized environments must remain deterministic and aligned with the foundation's Docker requirements.

<!-- anchor: 3-9-1-target-environment -->
#### 3.9.1 Target Environment
- Cloud Platform: None required during execution; operations occur on developer machines, homelab runners, or CI jobs that run the CLI directly.
- Containerization: Docker images based on Node v24 (Active LTS) provide reproducible environments for CI pipelines. Images are stateless and expect repo directories mounted at runtime.
- Optional Future Cloud: Should a hosted orchestrator emerge, it would still rely on the same CLI commands executed via automation; no always-on server is mandated at present.

<!-- anchor: 3-9-2-deployment-strategy -->
#### 3.9.2 Deployment Strategy
- Distribution via npm: Operators install `@codepipe/pipeline` globally or as a dev dependency. Version pinning ensures compatibility with RepoConfig `schema_version`.
- Docker Usage: Provided `Dockerfile` packages CLI with dependencies. Scripts such as `docker run --rm -v $PWD:/workspace codepipe start --prompt "..."` execute workflows in a controlled environment.
- CI Integration: GitHub Actions or other CI systems call CLI commands within workflow steps. Secrets inject via environment variables, and run directories persist as build artifacts for audit.
- Homelab Cron Jobs: Operators schedule commands like `codepipe observe` or `codepipe cleanup` via cron on self-hosted runners. File locks prevent overlapping operations.
- Deployment to Production: `codepipe deploy` triggers GitHub workflow dispatches or merge actions. CLI ensures status checks and approvals before merge, matching branch protection policies.
- Disaster Recovery: Because artifacts live in repo directories, backup strategies rely on existing repo backup tooling plus optional archive exports to remote storage.

<!-- anchor: 3-9-3-deployment-diagram -->
#### 3.9.3 Deployment Diagram (PlantUML)
~~~plantuml
@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Deployment.puml
LAYOUT_WITH_LEGEND()
Person(dev, "Developer", "Runs CLI commands locally or via homelab runner")
Node(laptop, "Developer Workstation", "Node.js v24 + CLI")
Node(homelab, "Homelab Runner", "Docker host or VM")
Node(ci, "CI Job", "GitHub Actions / Other CI")
Node(repo, "Git Repository", "Git + Repo files")
Node(github, "GitHub REST API", "api.github.com + required headers")
Node(linear, "Linear API", "GraphQL endpoint")
Node(agent, "Agent Providers", "OpenAI-compatible / Local LLMs")
Node(storage, "Run Directory", "Deterministic artifacts under .codepipe")
Rel(dev, laptop, "Invokes codepipe commands", "CLI input")
Rel(laptop, repo, "Reads/writes repo + run dirs", "File operations")
Rel(laptop, github, "REST calls", "HTTPS + headers")
Rel(laptop, linear, "GraphQL calls", "HTTPS + Authorization")
Rel(laptop, agent, "Prompts/tasks", "HTTPS/Websocket")
Rel(laptop, storage, "Persists artifacts", "JSON/Markdown")
Rel(homelab, repo, "Executes CLI via Docker", "Mounted volumes")
Rel(ci, repo, "Checks out repo + runs CLI", "CI workspace")
Rel(repo, github, "Push branches / fetch status", "git over HTTPS")
@enduml
~~~
<!-- anchor: 3-10-operational-playbooks -->
### 3.10 Operational Playbooks & Runbooks
This section enumerates detailed operational procedures for each CLI command family. The intent is to make the system approachable for on-call engineers, automation scripts, and AI operators who need explicit sequences, prechecks, and rollback steps. Each playbook references relevant files in the run directory and indicates success evidence to capture in audit bundles.

<!-- anchor: 3-10-1-init -->
#### 3.10.1 `codepipe init`
- Prechecks: Confirm git repository is accessible, Node LTS is installed, and `GITHUB_TOKEN` plus optional `LINEAR_API_KEY` exist.
- Execution Steps:
  - CLI detects repo root and scaffolds `.codepipe/config.json` with defaults, including `schema_version`, `feature_flags`, `github`, `linear`, and `runtime` sections.
  - Performs lightweight API calls: GitHub `GET /repos/{owner}/{repo}` and Linear `viewer` query (if configured) to validate credentials.
  - Writes `config_history.json` entry describing author, timestamp, and CLI version.
- Success Criteria: Config file exists, sanity checks succeed, and `codepipe status` reports `init_complete=true`.
- Failure Handling: Validation errors exit with code `10`; HTTP failures exit with `20`. Operators fix config or credentials and rerun. Logs capture provider responses sans secrets.

<!-- anchor: 3-10-2-start -->
#### 3.10.2 `codepipe start`
- Entry Points: `--prompt`, `--linear ISSUE-123`, `--spec path`. Each path stores input snapshots.
- Workflow:
  - Generates feature ID and run directory, recording source metadata.
  - Executes context gathering, research planning, PRD drafting, and spec drafting sequentially, inserting approval gates per stage.
  - Populates `plan.json` and seeds ExecutionTasks queue.
- Operator Responsibilities: Provide approvals at PRD/spec gates, resolve unknowns flagged as ResearchTasks, ensure context_path configuration covers necessary files.
- Success Evidence: `feature.json.status` transitions to `in_progress`, `prd.md` and `spec.md` exist with hashed entries, and `logs.ndjson` includes `start_complete` event.
- Failure Modes: Rate limits, missing approvals, invalid spec sections. CLI records `last_error`; operator edits relevant artifacts and uses `codepipe resume`.

<!-- anchor: 3-10-3-resume -->
#### 3.10.3 `codepipe resume`
- Purpose: Continue a run from the latest successful step, respecting idempotence.
- Process:
  - CLI reads `feature.json.telemetry` to find `last_step` and `last_error`.
  - Validates artifact integrity using `hash_manifest.json` and ensures no locks exist.
  - Replays queue entries until it reaches pending tasks, skipping completed steps unless inputs changed.
- Operator Inputs: Provide missing approvals, update context, or resolve file conflicts before resuming.
- Observability: Resume emits events summarizing which steps were skipped or rerun, aiding audit trails.
- Edge Cases: If run directory is corrupted, CLI attempts to repair by verifying backup bundle if available; otherwise, it instructs operator to clone run directory from VCS or backup.

<!-- anchor: 3-10-4-pr -->
#### 3.10.4 `codepipe pr ...`
- Includes `pr create`, `pr status`, `pr disable-auto-merge` commands.
- Preflight: Ensures working branch exists, validations passed (lint/test/build). CLI refuses to create PR if validations fail or approvals missing.
- `pr create` Flow:
  - Calls GitHub `POST /repos/{owner}/{repo}/pulls` with rate-limit aware HTTP client.
  - Optionally requests reviewers via `POST /repos/{owner}/{repo}/pulls/{number}/requested_reviewers`.
  - Records PR number in `feature.json.external_links.github_pr_number` and writes `pr.json` artifact with API response metadata.
- Auto-merge Handling: If repo allows auto-merge and approvals permit, CLI can enable auto-merge through GitHub API, logging action in `deployment.json`.
- Rollback: If PR creation must be undone, operator deletes branch/PR manually and updates run directory to reflect rollback, capturing notes in `approvals.json`.

<!-- anchor: 3-10-5-deploy -->
#### 3.10.5 `codepipe deploy`
- Objective: Merge PR and trigger deployment workflows without requiring persistent services.
- Steps:
  - Verifies PR approvals, required checks, and branch protections. Surfaces missing conditions explicitly.
  - If clear, merges PR via GitHub API or enables auto-merge. Alternatively, triggers GitHub Actions workflow dispatch defined in RepoConfig.
  - Captures merge SHA, deployment job URLs, and statuses in `deployment.json` with hashed references.
- Operator Options: Provide manual override approvals, disable auto-merge if necessary, or pause deployment when dependencies are blocked.
- Failure Handling: For blocked merges due to failing checks, CLI records the failing check names and instructs operators to inspect CI logs. Rate-limit errors trigger exponential backoff with jitter and `human-action` classification after repeated hits.

<!-- anchor: 3-10-6-status -->
#### 3.10.6 `codepipe status`
- Summarizes run progress via CLI or machine-readable JSON.
- Data Sources: Reads `feature.json`, `plan.json`, queue files, approvals, metrics, and rate-limit ledger to present a consolidated status board.
- Automation Usage: Scripts or AI agents can parse `--json` output to determine next actions, request approvals, or confirm completion before deployment.
- Error Surfaces: Highlights blocking issues (missing approvals, failed validations, rate-limit cooldowns) with remediation steps.

<!-- anchor: 3-10-7-export -->
#### 3.10.7 `codepipe export`
- Formats: Markdown or JSON bundles stored under `bundle/` directory.
- Contents: Manifest, inputs, context list with hashes, PRD, spec, plan, logs, metrics, traces, diff summaries, PR metadata, deployment results, and cost tracking.
- Usage: Operators share bundles with auditors, AI assistants, or other tools (Graphite, CodeMachine). Bundles maintain deterministic structure for easy parsing.
- Security: Export pipeline performs final redaction scan, verifying no secrets exist in artifacts. If redaction fails, command aborts with actionable instructions.

<!-- anchor: 3-10-8-cleanup -->
#### 3.10.8 `codepipe cleanup`
- Purpose: Manage disk usage by archiving or deleting old runs beyond retention thresholds.
- Behavior:
  - Scans run directories for `expiration_at` metadata and optional operator-provided cutoff date.
  - For each candidate, ensures export bundle exists; if not, prompts operator (or instructs via CLI) to generate before deletion.
  - Archives directories into compressed tarballs if `--archive` flag is set, storing them in configurable backup paths.
- Safety: Cleanup never deletes directories lacking manifest completeness or while locks exist. Logs include details for audit.

<!-- anchor: 3-10-9-observe -->
#### 3.10.9 `codepipe observe`
- Optional cron-compatible command that inspects repo state, merged PRs, and run directories to produce health reports.
- Capabilities:
  - Detects merged PRs lacking deployment records and prompts follow-up tasks.
  - Collects metrics across runs (retry counts, agent cost trends) and surfaces anomalies.
  - Ensures watchers operate without persistent daemons by relying on scheduled invocations.
- Observability: Reports stored under `.codepipe/reports/<timestamp>.md` with summary tables and recommended actions.

<!-- anchor: 3-11-disaster-recovery -->
### 3.11 Disaster Recovery & Continuity
Local-first design reduces reliance on centralized infrastructure but still requires planning for machine loss, repo corruption, or credential incidents.
- Backup Strategy: Operators include `.codepipe/` in repo commits or use git submodules to version control run directories when appropriate. Alternatively, export bundles stored in remote artifact storage guarantee recoverability.
- Portable State: Run directories contain all necessary files to resume runs elsewhere. Operators can copy directories to another machine, update environment variables, and run `codepipe resume` without additional setup.
- Git Backups: Because code changes reside on feature branches in GitHub, standard git backup/clone procedures already cover code artifacts. Run directories provide supplemental context for audit.
- Credential Loss: If tokens are revoked, CLI surfaces errors and preserves state until new credentials are configured. Operators resume once tokens restore, leveraging HTTP layer's idempotent design.
- Disaster Drills: Ops teams should schedule periodic restoration exercises where run directories are restored from backups and resumes executed to verify documentation accuracy.
- Incident Logging: Significant incidents (credential leak, data corruption) require entries in `governance_notes` with timestamp, root cause, and mitigation steps. Export bundles capture incident reports for compliance.
- Homelab Considerations: When running on single-node homelabs, UPS or battery backups reduce abrupt shutdown risk. However, state machine resilience ensures even power loss is manageable.

<!-- anchor: 3-12-compliance-audit -->
### 3.12 Compliance, Governance & Audit Alignment
Large-scale programs demand rigorous audit trails even in CLI-first workflows.
- Audit Artifacts: Each run directory acts as an audit pack containing spec, approvals, diffs, and API transcripts. `codepipe export` signs manifests with CLI version and Node version metadata to ensure provenance.
- Change Control: Config revisions, feature flag toggles, and auto-merge authorizations require recorded approvals referencing the actor, reason, and affected artifacts.
- Policy Hooks: RepoConfig `feature_flags` gate risky automation. Operators document policy rationale in `policy_notes.md`, enabling quick reviews by compliance teams.
- Traceability: Mandatory `trace.json` ensures PRD goals map to spec requirements, tasks, and commits. Auditors can follow a single feature from prompt to deployment without additional tooling.
- Documentation: Ops_Docs maintainers provide runbooks, troubleshooting guides, and security advisories within `.codemachine/docs/` or the repo wiki. CLI commands reference these docs when errors occur.
- Reporting: `codepipe export --format json` integrates with governance dashboards, enabling ingestion into BI tools for oversight of throughput, approval latency, and compliance posture.
- Future Compliance Targets: Align with SOC 2 / ISO-style controls by demonstrating deterministic logging, change approvals, and secret management. CLI architecture already satisfies many prerequisites due to local artifact persistence.

<!-- anchor: 3-13-future-ops-enhancements -->
### 3.13 Future Operational Enhancements
To continue scaling, the operational blueprint outlines potential enhancements aligned with foundation guardrails.
- Remote Observability: Optional OTLP exporters could send traces/metrics to managed collectors while preserving default file outputs for offline use.
- Agent Marketplace: Provide CLI command to list available agent manifests, verify capabilities, and download updates from a signed catalog.
- Adaptive Concurrency: Introduce dynamic concurrency tuning based on observed validation runtimes, ensuring efficient use of multi-core systems without oversubscription.
- Expandable Deployment Integrations: Add adapters for other git providers or CI systems while retaining GitHub-first design. Capability flags ensure safe rollouts.
- Secrets Bridges: Explore optional integration with OS keychains or HashiCorp Vault, still defaulting to env vars but providing hardened environments when available.
- Continuous Verification: Build CLI subcommand that replays exports to confirm reproducibility, aiding compliance and disaster recovery readiness.

<!-- anchor: 3-14-operational-kpis -->
### 3.14 Operational KPIs & Reporting Cadence
Defining KPIs ensures administrators can evaluate system performance and plan improvements.
- Throughput: Number of features completed per week, derived from `feature.json` statuses and timestamps.
- Resume Success Rate: Percentage of runs successfully resumed without manual file edits, supporting the 99% target.
- Rate Limit Incidents: Count of GitHub/Linear rate-limit events per week, plus mean backoff durations.
- Validation Reliability: Pass/fail ratios for configured validation commands, highlighting flaky tests or tooling gaps.
- Approval Latency: Time between PRD/spec/code approvals, informing human-in-the-loop efficiency.
- Storage Usage: Total size of `.codepipe/` directories, guiding cleanup schedules.
- Deployment Lead Time: Duration from PR creation to merge/deploy completion, used to evaluate operational bottlenecks.
- Reporting Process: `codepipe observe` compiles KPI snapshots weekly, storing them under `.codepipe/reports/` and optionally exporting to markdown for leadership reviews.

<!-- anchor: 3-15-operational-raci -->
### 3.15 Operational RACI Matrix (Sample)
Clear responsibility assignments minimize ambiguity between roles.
- Responsible (R): Ops_Docs Architect for maintaining runbooks, Behavior Architect for orchestrator flow updates, Structural_Data Architect for schema migrations.
- Accountable (A): Operational Architect ensures cross-cutting decisions align with foundation; Product Owner approves policy changes.
- Consulted (C): Security engineer for token scope modifications, Infra lead for Docker updates, Observability lead for telemetry schema changes.
- Informed (I): Developer community, AI agent maintainers, external stakeholders receiving exported bundles.
- Usage: RACI entries live in `.codemachine/governance/` and are referenced by CLI when logging policy decisions, ensuring audit traceability.

<!-- anchor: 3-16-operational-roadmap -->
### 3.16 Operational Roadmap Highlights
- Q1: Harden cleanup automation, add diff-based incremental exports, and finalize Docker CI image with reproducible builds.
- Q2: Introduce optional OTLP exporter, integrate Graphite telemetry consumption, and evaluate GitHub App auth path.
- Q3: Expand agent manifest tooling, add advanced branch protection diagnostics, and prototype offline-first UI (still CLI) for approvals.
- Q4: Deliver compliance automation features (policy packs, automated evidence collection) and evaluate cross-repo orchestration capabilities.
- Each milestone references blueprint anchors, ensuring updates undergo change-control with recorded approvals.
<!-- anchor: 3-17-operational-scenarios -->
### 3.17 Operational Scenarios & Walkthroughs
To ensure the runbooks translate into predictable behavior, this section documents representative scenarios with expected file mutations, API usage, and operator decisions. Each scenario references the finite-state machine and demonstrates how resumability plus artifact governance works in practice.

<!-- anchor: 3-17-1-scenario-prompt-to-deploy -->
#### 3.17.1 Scenario: Prompt-Initiated Feature to Deployment
1. Operator runs `codepipe start --prompt "Add structured export command"`.
2. CLI creates run directory, gathers context (`README`, docs, configured globs), and drafts PRD/spec.
3. Operator reviews `prd.md` and `spec.md`, edits sections, and records approval via CLI prompt.
4. Execution Engine generates code patches, runs validations, and commits changes to feature branch.
5. `codepipe pr create` opens PR, requests reviewers, and waits for feedback.
6. Once reviewers approve and status checks pass, operator runs `codepipe deploy` to merge and optionally trigger GitHub Actions workflow.
7. `codepipe export --format md` packages artifacts for audit; cleanup scheduled once feature is marked `deployed`.

<!-- anchor: 3-17-2-scenario-linear-outage -->
#### 3.17.2 Scenario: Linear Outage During Issue Trigger
1. Operator runs `codepipe start --linear ENG-321` during Linear API outage.
2. Linear adapter detects network failure, classifies as `transient`, and caches the most recent snapshot if available.
3. CLI prompts operator to proceed with prompt/spec-only mode using cached data while continuing to retry Linear in the background according to rate-limit safe schedule.
4. Resume command later refreshes Linear snapshot once API recovers, ensuring final artifacts capture accurate ticket data.

<!-- anchor: 3-17-3-scenario-github-secondary-limit -->
#### 3.17.3 Scenario: GitHub Secondary Rate Limit Hit
1. Bulk automation triggers multiple PR-related commands, hitting secondary limits.
2. HTTP layer processes `retry-after` header, logs event, and pauses new GitHub requests for the specified time plus jitter.
3. CLI surfaces message instructing operator to wait; run remains resumable without corruption.
4. Metrics capture incident for later analysis; `codepipe observe` compiles weekly summary of rate-limit events.

<!-- anchor: 3-17-4-scenario-validation-failure -->
#### 3.17.4 Scenario: Validation Failure Before PR Creation
1. Execution Engine runs `npm run lint` and `npm test`. Lint fails due to formatting issues.
2. CLI records failure under `logs.ndjson`, updates `last_error`, and halts before PR creation.
3. Operator reviews logs, runs formatting fix locally, and re-triggers `codepipe resume`.
4. CLI detects that validations now succeed and continues to PR creation stage without redoing PRD/spec steps, honoring idempotence.

<!-- anchor: 3-17-5-scenario-approval-delay -->
#### 3.17.5 Scenario: Approval Delay at Spec Stage
1. After PRD is approved, spec generation completes but awaits human sign-off.
2. CLI records `human-action-required` error, logs pending approval path, and exits with code `30`.
3. Operator modifies `spec.md`, adds clarifications, and runs `codepipe approve --artifact spec.md` (or uses manual JSON entry) referencing file hash.
4. Resume picks up at task planning stage, ensuring no duplicate work occurs.

<!-- anchor: 3-18-rate-limit-playbook -->
### 3.18 Rate-Limit Playbook & Ledger Management
Because GitHub and Linear rate limits are critical reliability constraints, operators need an explicit playbook for interpreting ledger files and responding.
- Ledger Structure: `rate_limits.json` contains entries per provider with fields for `limit`, `remaining`, `reset_at`, `retry_after`, `last_error`, and `backoff_attempts`.
- Inspection: `codepipe status --json` surfaces ledger highlights. Operators can also open file directly for debugging.
- Manual Intervention: If repeated secondary limits occur, operators can throttle commands by setting `CODEPIPE_HTTP_MAX_CONCURRENCY` env var or staggering workflows.
- Automation: Cron-based `codepipe observe` monitors ledger trends, generating warnings when remaining budgets fall below thresholds before business-critical steps (PR creation, merges).
- Linear Specifics: CLI enforces per-hour limits by tracking request timestamps; when near capacity, it defers non-essential operations and instructs operator to resume later.
- Documentation: Ops team maintains knowledge base entries describing typical GitHub limit numbers for PATs vs GitHub Apps to guide token provisioning.

<!-- anchor: 3-19-agent-management -->
### 3.19 Agent Management & Capability Governance
Agent providers drive AI-assisted drafting and coding. Operations must manage capabilities, costs, and risk exposure.
- Manifest Storage: `.codepipe/agents/<provider>.json` includes provider metadata, supported models, max tokens, tools (code editing, planning), streaming support, and rate-limit notes.
- Selection Rules: For each stage (PRD, spec, codegen), the orchestrator queries manifests and chooses the best fit based on required context size, determinism preference, and cost profile.
- Cost Tracking: `telemetry/costs.json` accumulates estimated spend per run, broken down by provider and model. Operators analyze trends to tune defaults or apply budgets.
- Provider Modes: BYO agents can be local (e.g., `llama.cpp` server) or remote (OpenAI-compatible). CLI ensures prompts and artifacts flow through sanitized paths, respecting constraints not to leak sensitive files.
- Capability Flags: Experimental providers (Linear Agents) require enabling feature flags and referencing specific version anchors. CLI warns about developer preview instability and isolates such adapters behind retry-safe wrappers.
- Offline Support: When no agent is available (network outage), CLI falls back to template-driven scaffolding. Operators can edit outputs manually, ensuring workflow continuity.

<!-- anchor: 3-20-observability-implementation -->
### 3.20 Observability Implementation Details
- Metrics Schema: Textfile includes counters/histograms such as `ai_feature_command_duration_seconds{command="start"}`, enabling cross-run comparisons.
- Trace Context Propagation: CLI generates a run-level trace ID that attaches to HTTP headers (e.g., `X-AI-Trace`). External providers may echo this ID in logs for correlation.
- Log Aggregation: Operators can symlink `logs.ndjson` directories into a central log collector. Because format is deterministic, ingestion pipelines remain simple.
- Alert Thresholds: Observability config defines thresholds (e.g., more than 3 retries for HTTP request) to mark events as warnings. CLI automatically elevates severity when thresholds exceed.
- Visualization: Example Grafana dashboards (shipped as JSON in repo docs) visualize metrics from Prometheus textfiles once scraped into a Prometheus server.
- Privacy Controls: Observability outputs mark redacted fields explicitly, enabling auditors to confirm compliance.

<!-- anchor: 3-21-local-first-tooling -->
### 3.21 Local-First Tooling & Developer Ergonomics
- Editor Integration: CLI respects `$EDITOR` for manual artifact edits. In absence, it defaults to a minimal TUI, but outputs changed files to facilitate external editing.
- File Watching: Optional `codepipe watch` (future) monitors run directories and surfaces notifications when approvals or tasks change, leveraging OS file events when available.
- Shell Autocomplete: `oclif`-generated completions help operators discover commands quickly, improving adoption without GUI requirements.
- Templates: Repo includes sample PRD/spec templates under `.codemachine/templates/`, ensuring consistent structure when agents are offline.
- Documentation Sync: Commands reference anchors in documentation (including this file) for quick jumps to relevant sections using CLI help output.

<!-- anchor: 3-22-operational-interfaces -->
### 3.22 Operational Interfaces & Integration Points
- CLI API Parity: Optional REST endpoints mirror CLI outputs for future remote orchestrators, but share the same data models and artifacts to prevent drift.
- JSON Output: All status-like commands support `--json`, enabling integration with other automation systems (Graphite, CodeMachine) that consume deterministic data.
- Notifications: Optional adapters for Slack/email produce `NotificationEvent` objects stored locally before dispatch, ensuring traceability even if delivery fails.
- Governance Hooks: CLI can emit signed statements (JSON Web Signatures) that capture approvals or policy acknowledgements, supporting future compliance requirements.

<!-- anchor: 3-23-operational-dependencies -->
### 3.23 Operational Dependencies & Supply Chain
- Runtime Dependencies: Node.js LTS, `oclif`, `undici`, `zod`, `vitest`, `better-sqlite3` (optional), `@opentelemetry` packages.
- External APIs: GitHub REST (version pinned), Linear GraphQL, optional agent endpoints.
- Supply Chain Security: `package-lock.json` committed; release process includes `npm audit` reports stored under `.artifacts/tests` to ensure dependencies remain vetted.
- Docker Image: Base image from official Node v24 release; Dockerfile uses deterministic installs with `npm ci` to ensure reproducible builds.
- Updates: CLI includes `codepipe doctor` (future) to check dependency versions, Node runtime status, and known CVEs.

<!-- anchor: 3-24-operational-testing -->
### 3.24 Operational Testing & Validation
- Unit Tests: `vitest` suite covers orchestrator logic, adapters, and artifact services.
- Integration Tests: CLI smoke tests simulate `codepipe start --prompt`, verifying run directory creation, context gathering, and state transitions.
- Contract Tests: HTTP fixtures validate GitHub/Linear headers, rate-limit handling, and error translations.
- Load Tests: Optional scripts simulate multiple concurrent runs to evaluate concurrency settings, disk IO, and rate-limit management.
- Disaster Recovery Tests: Periodic exercises restore run directories from backups and attempt resumes to ensure documentation accuracy.
- Observability Tests: Scripts verify metrics/traces/logs exist for sample runs and match schema expectations.

<!-- anchor: 3-25-operational-tooling-roadmap -->
### 3.25 Tooling Roadmap for Operations Teams
- CLI UX Enhancements: Add `--dry-run` previews for commands touching GitHub (PR creation, merges) to build operator confidence.
- Policy Packs: Provide reusable configuration presets (e.g., strict branch protection rules) stored under `.codemachine/policies/`.
- Knowledge Base Automation: Generate runbook snippets automatically from this documentation using `codepipe docs sync` to ensure updates propagate.
- Observability Connectors: Ship scripts for shipping logs to Loki or traces to Jaeger while preserving local files.
- Self-Diagnostics: Extend `codepipe doctor` to evaluate disk space, Node version, Docker availability, and config drift before operations begin.
- Agent Sandboxing: Explore WASI or containerized agent runtimes to isolate codegen tasks when running untrusted provider models.
<!-- anchor: 3-26-command-reference -->
### 3.26 Command Reference Snapshot
- `codepipe init`: scaffolds config, validates integrations, records schema version.
- `codepipe start`: entry point for new features; triggers context gathering, research, PRD/spec.
- `codepipe status`: summarizes run artifacts, queue states, rate-limit ledger.
- `codepipe resume`: restarts failed or paused runs from last checkpoint.
- `codepipe approve`: records approvals tied to artifact hashes.
- `codepipe pr create`: opens PRs, requests reviewers, records metadata.
- `codepipe pr status`: checks PR readiness, status checks, approvals, and potential blockers.
- `codepipe deploy`: merges PRs or triggers deployment workflows when protections satisfied.
- `codepipe export`: packages artifacts into deterministic bundles for external review.
- `codepipe cleanup`: archives or deletes run directories beyond retention windows.
- `codepipe observe`: scheduled health check summarizing run health, KPIs, and anomalies.
- Each command respects exit codes (0 success, 10 validation errors, 20 external API issues, 30 human action required) to aid automation.

<!-- anchor: 3-27-operational-faq -->
### 3.27 Operational FAQ
- **What happens if GitHub token expires mid-run?** CLI records error, stops external calls, and preserves state. After refreshing token, rerun `codepipe resume` to continue without rerunning completed steps.
- **How are secrets protected inside run directories?** Secrets never persist. Files only contain hashed fingerprints. Logs redact tokens automatically. Operators should still restrict repo access and consider `.gitignore` rules when run directories contain sensitive context summaries.
- **Can I run multiple features simultaneously?** Yes. Each feature has its own run directory and lock file. Concurrency settings ensure ExecutionTasks within a single run avoid conflicts.
- **How do I handle repo cleanups after abandoned runs?** Use `codepipe cleanup --stale` to identify runs older than configured threshold, archive them, and optionally delete branches. CLI ensures exported bundles exist before deletion.
- **What if I need to integrate a new agent provider?** Create manifest under `.codepipe/agents/`, register capabilities, update RepoConfig feature flag, and run `codepipe doctor` to validate connectivity before using it in production runs.
- **Do I need Docker to use the CLI?** No. Docker is optional for reproducible CI. Local runs rely on installed Node LTS. However, shipping the Docker image ensures homelab or CI environments remain consistent with local machines.
- **How are approvals enforced in headless automation?** Operators submit signed approval bundles referencing artifact hashes. CLI validates signatures (if configured) or accepts `--approved-by` flags logged into `approvals.json`.
- **What telemetry is safe to share externally?** Export bundles already redact secrets and include hashed references. Operators should still review content for organization-specific policies before sharing outside the team.
- **How do we extend branch protection awareness?** Deployment module queries GitHub branch protection APIs. Operators can configure additional required checks in RepoConfig to catch repository-specific guardrails beyond GitHub defaults.
- **What ensures CLI versions stay compatible with RepoConfig schema?** `schema_version` inside config is compared to CLI-supported version list. If config is newer, CLI aborts unless `--force` is used, preventing undefined behavior.
<!-- anchor: 3-28-operational-glossary -->
### 3.28 Operational Glossary (Selected Terms)
- **Artifact Bundle:** Exported package containing manifest, context, PRD, spec, plan, logs, metrics, traces, diffs, and deployment record for a feature run.
- **Approval Gate:** Mandatory checkpoint requiring human or authorized agent confirmation before progressing (e.g., PRD approval, spec acceptance, code change authorization, PR creation, deploy trigger).
- **Auto-Merge:** GitHub capability to automatically merge when required checks and approvals complete. CLI toggles it only when approved and recorded in `approvals.json`.
- **ExecutionTask:** Entry in `plan.json` referencing code generation, validation, PR creation, or deployment steps with dependencies and retry policies.
- **Feature Flag:** Configurable switch stored in RepoConfig controlling optional or risky automation (e.g., auto-merge, experimental adapters, telemetry exports).
- **Rate-Limit Ledger:** Persistent record of API quotas, remaining tokens, reset times, and backoff attempts per provider to inform operational pacing.
- **Run Directory:** Deterministic folder under `.codepipe/<feature_id>/` containing all artifacts, logs, metrics, and telemetry for a specific feature run.
- **State Machine:** Finite-state workflow controlling stage transitions (`draft`, `in_progress`, `review`, `done`, `deployed`) with explicit events and approvals.
- **Telemetry Hub:** Collection of logs, metrics, and traces ensuring observability within run directories without external dependencies.
- **Trace Map:** `trace.json` linking PRD goals to spec requirements, ExecutionTasks, git commits, and deployment outcomes for auditability.
<!-- anchor: 3-29-operator-checklist -->
### 3.29 Operator Preflight Checklist (Daily)
- Confirm Node LTS version matches RepoConfig `runtime.min_node_version`.
- Validate environment variables (`GITHUB_TOKEN`, `LINEAR_API_KEY`, agent keys) are present and unexpired.
- Pull latest repo changes, including `.codepipe` templates and docs.
- Review `codepipe observe` report from previous day for outstanding actions.
- Ensure Docker image is rebuilt if dependencies changed (for CI parity).
- Verify storage usage and run cleanup if approaching quota.
- Check rate-limit ledger to ensure ample quotas before launching long sessions.
