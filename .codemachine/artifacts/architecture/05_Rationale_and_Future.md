<!-- anchor: 4-0-design-rationale -->
## 4. Design Rationale & Trade-offs
The design rationale articulates why the architecture embraces a modular CLI orchestrator, deterministic artifacts, and adapter-based integrations. These choices align with the foundation's mandate for local-first execution, resumability, and provider neutrality. Each subsection traces a foundation directive to resulting operational mechanics, ensuring future contributors understand the why behind every requirement.

<!-- anchor: 4-1-key-decisions -->
### 4.1 Key Decisions Summary
The most critical architectural decisions anchor the solution to deterministic workflows and portable artifacts.

<!-- anchor: 4-1-1-cli-layer -->
#### 4.1.1 CLI-First Layered Architecture
- Decision: Build the entire experience as a POSIX-friendly CLI using `oclif`, with commands orchestrating layered modules (presentation, orchestration, adapters, persistence).
- Rationale: CLI ensures portability and adheres to local-first constraint; `oclif` provides scaffolding, plugin discovery, and testing harness.
- Trade-off: Requires thorough documentation for non-CLI users, but benefits include reproducibility, automation friendliness, and zero-daemon operations.

<!-- anchor: 4-1-2-run-directories -->
#### 4.1.2 Deterministic Run Directories
- Decision: Persist every artifact within `.ai-feature-pipeline/<feature_id>/` including PRD, spec, plan, logs, metrics, traces, approvals, and exports.
- Rationale: Enables resumability, auditability, and portable debugging across devices or homelab runners.
- Trade-off: Requires disciplined cleanup policies to avoid disk bloat; mitigated via `ai-feature cleanup` and export bundles.

<!-- anchor: 4-1-3-adapter-interfaces -->
#### 4.1.3 Adapter Interfaces for Integrations
- Decision: Define explicit interfaces for GitHub, Linear, agent providers, and future integrations, forcing all external access through a shared HTTP client.
- Rationale: Isolates API churn, supports capability-driven plug-ins, and ensures rate-limit handling plus header enforcement remain consistent.
- Trade-off: Slight up-front complexity; pays dividends when adding providers like Graphite, CodeMachine, or new agent services.

<!-- anchor: 4-1-4-rate-limit-disciplinary -->
#### 4.1.4 Rate-Limit Disciplinary Controls
- Decision: Implement rate-limit aware HTTP layer with ledger persistence, exponential backoff, and `retry-after` / `x-ratelimit-reset` handling for GitHub and Linear.
- Rationale: Foundation mandates resilience to primary/secondary limits; ledger approach provides transparency and automation hooks.
- Trade-off: Adds latency during throttling, but avoids flakiness and respects provider terms.

<!-- anchor: 4-1-5-approval-gating -->
#### 4.1.5 Human-in-the-Loop Approval Gates
- Decision: Enforce approvals before PRD acceptance, spec acceptance, code generation, PR creation, and deploy operations, with signatures recorded in `approvals.json`.
- Rationale: Mitigates AI drift risk, satisfies compliance, and ensures human oversight for critical transitions.
- Trade-off: Introduces pauses awaiting approval; resume mechanics and signed bundles keep process efficient.

<!-- anchor: 4-1-6-validation-registry -->
#### 4.1.6 Validation Command Registry
- Decision: Repo-configured validation commands (lint, test, typecheck, build) must pass before PR creation or deploy steps.
- Rationale: Enforces consistent quality gates across repositories and ensures auto-generated code meets standards.
- Trade-off: Slower loops for large projects; mitigated via targeted commands per file set and concurrency options.

<!-- anchor: 4-1-7-observability-artifacts -->
#### 4.1.7 Self-Contained Observability Artifacts
- Decision: Store logs (`logs.ndjson`), metrics (Prometheus textfiles), and traces (`traces.json`) within run directories by default.
- Rationale: Aligns with no-server requirement, ensures offline debugging, and simplifies export/resume flows.
- Trade-off: Operators must manually integrate with centralized telemetry if desired; optional connectors planned.

<!-- anchor: 4-1-8-security-posture -->
#### 4.1.8 Least-Privilege Security Posture
- Decision: Require env-var based tokens (fine-grained PATs, Linear API keys), enforce scope checks, and redact secrets in logs/exports.
- Rationale: Minimizes blast radius, honors foundation's security guardrails, and simplifies compliance reporting.
- Trade-off: Operators manage tokens manually; documentation clarifies rotation and scope requirements.

<!-- anchor: 4-1-9-docker-ci -->
#### 4.1.9 Dockerized CI Reference
- Decision: Ship Dockerfile targeting Node v24 Active LTS for reproducible CI runs.
- Rationale: Aligns with foundation's container directive and ensures homelab + CI environments replicate local behavior.
- Trade-off: CI pipelines must manage Docker caching; acceptable for deterministic builds.

<!-- anchor: 4-1-10-distribution-npm -->
#### 4.1.10 npm Distribution with Schema Versioning
- Decision: Publish CLI as npm package with schema version gating to ensure configuration compatibility.
- Rationale: Simplifies installation, supports pinned versions, and allows CLI to refuse mismatched configs.
- Trade-off: Requires release governance; versioned docs mitigate confusion.

<!-- anchor: 4-1-11-observe-command -->
#### 4.1.11 Optional `ai-feature observe` Health Command
- Decision: Provide scheduled command for monitoring run directories, KPIs, and anomalies without always-on services.
- Rationale: Maintains local-first philosophy while delivering health insights.
- Trade-off: Requires cron/scheduler integration; acceptable given homelab constraints.

<!-- anchor: 4-2-alternatives -->
### 4.2 Alternatives Considered
Many alternatives were evaluated but rejected to maintain alignment with the foundation's priorities.

<!-- anchor: 4-2-1-server-orchestrator -->
#### 4.2.1 Persistent Server-Orchestrator
- Alternative: Build a centralized web service managing workflows, storing state in hosted databases.
- Rejection Reason: Violates local-first requirement, introduces always-on infrastructure, and conflicts with homelab reality. CLI-based approach preserves portability while still offering optional cron-style automation.

<!-- anchor: 4-2-2-monolithic-artifacts -->
#### 4.2.2 Monolithic Artifact Store
- Alternative: Store artifacts inside a single SQLite database per repo.
- Rejection Reason: Harder to inspect manually, conflicts with deterministic file bundle requirement, and complicates VCS storage. File-based approach remains transparent and export-friendly.

<!-- anchor: 4-2-3-direct-provider-sdks -->
#### 4.2.3 Direct Provider SDK Usage
- Alternative: Use GitHub/Linear SDKs directly in orchestrator modules.
- Rejection Reason: Bypasses shared HTTP layer, making rate-limit governance inconsistent and hindering provider neutrality. Unified client ensures consistent headers, logging, and retries.

<!-- anchor: 4-2-4-auto-merge-default -->
#### 4.2.4 Always-On Auto-Merge
- Alternative: Enable auto-merge for all PRs by default.
- Rejection Reason: Conflicts with conservative default posture and branch protection awareness. Instead, auto-merge remains optional via approvals and feature flags.

<!-- anchor: 4-2-5-agent-single-provider -->
#### 4.2.5 Single-Agent Provider Hardcoding
- Alternative: Mandate a single AI provider baked into CLI flow.
- Rejection Reason: Violates bring-your-own-agent requirement and undermines provider neutrality. Manifests plus adapter layer accommodate OpenAI-compatible endpoints, local LLMs, or third-party agent services.

<!-- anchor: 4-2-6-lightweight-rate-limit -->
#### 4.2.6 Minimal Rate-Limit Handling
- Alternative: Retry failed requests blindly without ledger tracking.
- Rejection Reason: Would produce flaky automation and disregard foundation's explicit requirements around primary/secondary limit handling, `retry-after`, and `x-ratelimit-reset` semantics.

<!-- anchor: 4-2-7-ui-dashboard -->
#### 4.2.7 Dedicated UI Dashboard
- Alternative: Build browser-hosted dashboard for run management.
- Rejection Reason: Out of scope per foundation; CLI remains the UX surface. Optional exports can feed future dashboards without changing core architecture.

<!-- anchor: 4-3-known-risks -->
### 4.3 Known Risks & Mitigation
The architecture anticipates several risks inherent to AI-assisted automation, adapter churn, and local-first execution.

<!-- anchor: 4-3-1-risk-rate-limit -->
#### 4.3.1 Risk: Rate-Limit Exhaustion
- Impact: Automation stalls, potential provider lockouts.
- Mitigation: Ledger-tracked quotas, exponential backoff, manual warnings, and optional throttle controls in RepoConfig.

<!-- anchor: 4-3-2-risk-agent-drift -->
#### 4.3.2 Risk: Agent Output Drift or Quality Issues
- Impact: Low-quality PRDs/specs/code; wasted cycles.
- Mitigation: Human approval gates, deterministic prompts, template fallbacks, and cost telemetry to evaluate provider choices.

<!-- anchor: 4-3-3-ri[example-openai-key] -->
#### 4.3.3 Risk: Context Overload/Tokens
- Impact: Agent failures due to token limits.
- Mitigation: Summarization budgets, chunking, hash manifesting, and context TTL controls.

<!-- anchor: 4-3-4-ri[example-openai-key] -->
#### 4.3.4 Risk: Storage Bloat from Run Directories
- Impact: Disk exhaustion, slow backups.
- Mitigation: Retention metadata, cleanup command, export bundles for archival, and KPI tracking.

<!-- anchor: 4-3-5-ri[example-openai-key] -->
#### 4.3.5 Risk: Credential Sprawl or Scope Drift
- Impact: Security exposure, failed runs.
- Mitigation: Scope validation on every run, hashed fingerprints for auditing, documentation on PAT scopes, and option to migrate to GitHub Apps later.

<!-- anchor: 4-3-6-ri[example-openai-key] -->
#### 4.3.6 Risk: Branch Protection Blocking Deployments
- Impact: Merge loops, manual intervention.
- Mitigation: Dedicated branch protection checks, required status detection, auto-merge toggles only when safe, and explicit error reporting.

<!-- anchor: 4-3-7-ri[example-openai-key] -->
#### 4.3.7 Risk: Config Drift Across Repositories
- Impact: CLI misbehavior or invalid assumptions.
- Mitigation: `schema_version` enforcement, `config_history.json`, `ai-feature init` sanity checks, and `ai-feature doctor` diagnostics.

<!-- anchor: 4-3-8-ri[example-openai-key] -->
#### 4.3.8 Risk: Observability Gaps
- Impact: Harder troubleshooting on remote machines.
- Mitigation: Mandatory logs/metrics/traces per run, export bundling, optional OTLP connectors, and weekly `observe` reports.

<!-- anchor: 5-0-future-considerations -->
## 5. Future Considerations
Future work focuses on deepening automation, compliance, and integration breadth while retaining local-first guarantees.

<!-- anchor: 5-1-potential-evolution -->
### 5.1 Potential Evolution

<!-- anchor: 5-1-1-github-app -->
#### 5.1.1 GitHub App Authentication Path
- Description: Introduce GitHub App support to replace PATs for organizations seeking centralized credential management.
- Benefits: Fine-grained permissions, better auditability, easier rotation.
- Considerations: Requires App installation workflows and possible rate-limit adjustments per installation.

<!-- anchor: 5-1-2-remote-observability -->
#### 5.1.2 Remote Observability Options
- Description: Optional OTLP exporter to push traces/metrics to managed systems while preserving default local files.
- Benefits: Integrates with enterprise observability stacks (Grafana, Datadog) without changing CLI behavior.
- Considerations: Must remain opt-in and support offline fallback.

<!-- anchor: 5-1-3-agent-cartography -->
#### 5.1.3 Agent Capability Catalog & Marketplace
- Description: Signed manifests distributed via registry, enabling operators to fetch supported agent configurations with versioning.
- Benefits: Simplifies BYO agent adoption, surfaces cost/latency trade-offs, and enforces compatibility.
- Considerations: Requires signing infrastructure and policy enforcement.

<!-- anchor: 5-1-4-cross-repo -->
#### 5.1.4 Cross-Repo Orchestration
- Description: Expand CLI to coordinate multi-repo features via manifest referencing multiple git roots.
- Benefits: Supports large platforms where features span multiple services.
- Considerations: Must preserve deterministic artifacts per repo and handle aggregated exports.

<!-- anchor: 5-1-5-compliance-automation -->
#### 5.1.5 Compliance Automation Packs
- Description: Provide templates/policy packs for SOC 2 or ISO evidence gathering, automatically tagging artifacts with control IDs.
- Benefits: Reduces manual compliance work, increases trust with auditors.
- Considerations: Requires collaboration with compliance teams to codify controls.

<!-- anchor: 5-1-6-agent-sandbox -->
#### 5.1.6 Agent Sandboxing Options
- Description: Investigate WASI/containerized execution for untrusted agents to limit filesystem access to run directories.
- Benefits: Enhances security, especially when evaluating community agents or preview features.
- Considerations: Must not compromise local-first simplicity; sandbox optional.

<!-- anchor: 5-2-areas-deeper-dive -->
### 5.2 Areas for Deeper Dive

<!-- anchor: 5-2-1-ci-cd -->
#### 5.2.1 CI/CD Pipeline Detailing
- Need: Define canonical GitHub Actions workflows invoking CLI commands, handling caching, secrets, and artifact uploads.
- Scope: Document matrix builds, concurrency controls, and failure notifications integrating with observability artifacts.

<!-- anchor: 5-2-2-agent-evaluation -->
#### 5.2.2 Agent Evaluation & Testing Harness
- Need: Establish automated evaluation suite comparing agent outputs against golden PRD/spec/code artifacts.
- Scope: Include scoring metrics, bias detection, and fallback heuristics when agents deviate.

<!-- anchor: 5-2-3-context-governance -->
#### 5.2.3 Context Selection Governance
- Need: Formalize heuristics for selecting context files, summarization thresholds, and redaction policies.
- Scope: Provide configuration DSL for context paths, budgets, and sensitivity labels.

<!-- anchor: 5-2-4-secrets-bridging -->
#### 5.2.4 Secrets Bridging Exploration
- Need: Evaluate integration with OS keychains, Vault, or SOPS while respecting default env-var behavior.
- Scope: Determine encryption-at-rest strategies, redaction audit proofs, and portability impacts.

<!-- anchor: 5-2-5-multi-agent-coordination -->
#### 5.2.5 Multi-Agent Coordination Patterns
- Need: Document best practices for distributing tasks among multiple agents (plan vs code vs review) using ExecutionTask assignments.
- Scope: Define capability negotiation, shared context locking, and telemetry for agent contributions.

<!-- anchor: 5-2-6-governance-automation -->
#### 5.2.6 Governance Automation Interfaces
- Need: Provide APIs or CLI hooks for governance platforms to query approvals, policy flags, and compliance statuses.
- Scope: Extend export formats, add signed attestations, and integrate with organization-specific workflows.

<!-- anchor: 6-0-glossary -->
## 6. Glossary
Definitions ensure shared understanding across human operators, AI agents, and auditors.

<!-- anchor: 6-0-1-artifact-bundle -->
- **Artifact Bundle:** Structured export representing all inputs, outputs, telemetry, and approvals for a feature run, enabling offline review and compliance evidence.
<!-- anchor: 6-0-2-approval-gate -->
- **Approval Gate:** Mandatory checkpoint requiring human or agent authorization before proceeding to the next pipeline stage (e.g., spec acceptance, PR creation).
<!-- anchor: 6-0-3-auto-merge -->
- **Auto-Merge:** GitHub capability enabling automatic merges once checks/approvals pass; toggled only when policy flags and approvals allow.
<!-- anchor: 6-0-4-context-budget -->
- **Context Budget:** Token/size limit for files provided to agents; ensures determinism and prevents prompt overload.
<!-- anchor: 6-0-5-executiontask -->
- **ExecutionTask:** Task object describing code generation, validation, PR operations, or deployment steps with dependencies and retry policies.
<!-- anchor: 6-0-6-http-ledger -->
- **HTTP Ledger:** Persistent record of rate-limit quotas, resets, and backoff attempts per provider, guiding throttling behavior.
<!-- anchor: 6-0-7-linear-snapshot -->
- **Linear Snapshot:** Cached representation of Linear issue payload stored in run directory for offline use and audit.
<!-- anchor: 6-0-8-observe-report -->
- **Observe Report:** Output of `ai-feature observe`, summarizing run health, KPIs, and anomalies for human review.
<!-- anchor: 6-0-9-plan-json -->
- **Plan.json:** Artifact describing ExecutionTasks, dependencies, and metadata powering the Execution Engine.
<!-- anchor: 6-0-10-prd -->
- **PRD (Product Requirements Document):** Artifact capturing problem statement, goals, non-goals, risks, and acceptance criteria before engineering work begins.
<!-- anchor: 6-0-11-resume-engine -->
- **Resume Engine:** Orchestrator component that reads `last_step` and `last_error` to continue failed runs safely.
<!-- anchor: 6-0-12-run-directory -->
- **Run Directory:** Namespaced folder storing all artifacts for a single feature run, including contexts, specs, logs, metrics, traces, approvals, and exports.
<!-- anchor: 6-0-13-schema-version -->
- **Schema Version:** Version number stored in RepoConfig indicating configuration format; CLI enforces compatibility before running commands.
<!-- anchor: 6-0-14-state-machine -->
- **State Machine:** Finite set of statuses (`draft`, `in_progress`, `review`, `done`, `deployed`) plus transitions governing feature lifecycle.
<!-- anchor: 6-0-15-telemetry-hub -->
- **Telemetry Hub:** Local collection of logs, metrics, and traces produced by each run to guarantee observability without cloud services.
<!-- anchor: 6-0-16-trace-map -->
- **Trace Map:** Document linking PRD goals to spec requirements, ExecutionTasks, git commits, and deployment evidence for auditability.
<!-- anchor: 6-0-17-ulid -->
- **ULID/UUIDv7:** Timestamp-sortable identifiers used for features and tasks to simplify ordering and ensure uniqueness.
<!-- anchor: 6-0-18-validation-registry -->
- **Validation Registry:** Configured list of commands (lint/test/build) executed before PR creation or deploy, with metadata about exit codes and retries.
<!-- anchor: 6-0-19-zod -->
- **Zod:** TypeScript schema validation library used to validate configs, adapter responses, and artifact structures.
