# AI-Driven Feature Development Workflow Specification

[[ TEMPLATE META ]] Name: Project Specification Schema

Description: This template is designed to scale with your project's needs, offering both essential and advanced specifications for various project complexities.

Instructions: Use this template to guide the documentation of your project requirements, ensuring all necessary information is captured for both simple and complex projects.

---

## 1.0 Project Overview

### 1.1 Project Name

AI-Driven Feature Development Workflow 

### 1.2 Project Goal

To create a repository-agnostic, AI-augmented pipeline that streamlines feature research, specification, implementation, review, and deployment—triggered via human or agent input—to standardize, automate, and optimize the end-to-end process for codebase evolution. 

**Implementation-smoothness additions (homelab reality):**

* The system MUST be “local-first”: runnable on a developer workstation / homelab runner with no always-on server requirement (agents can be invoked on-demand). 
* The system MUST produce deterministic artifacts and a resumable state machine so partially-completed runs can be continued after failures (rate limits, agent failures, network loss).
* The system SHOULD allow “bring-your-own-agent” execution (OpenAI-compatible endpoint, local model, or external agent service) without hard-coding a single provider.
* The system MUST explicitly support modern GitHub REST API versioning via the `X-GitHub-Api-Version` header to reduce breakage from future API changes. ([GitHub Docs][1])
* The system MUST explicitly design for API rate limit behavior (primary + secondary limits) with `retry-after`, `x-ratelimit-reset`, and exponential backoff to avoid flakiness. ([GitHub Docs][2])

### 1.3 Target Audience

* Human operators (project creators, developers, maintainers) 
* AI agents and systems that consume this document as operational context to drive or ingest the workflow 

**Primary consumer assumption:** AI coding agents will ingest this document and generate implementation tasks/code. Therefore, requirements in Sections 6–9 are written to be machine-actionable (clear MUST/SHOULD/MAY, concrete artifacts, explicit error handling expectations).

---

## 2.0 Core Functionality & User Journeys

### 2.1 Core Features List

* Repository-agnostic feature pipeline initialization 
* Multiple entry points: prompt, ticket/issue (e.g., Linear), or structured specification 
* Automated context gathering (repo, tickets, docs) 
* PRD (Product Requirements Document) drafting and AI/mixed drafting flows 
* Specification-to-code pipeline (generation, review, approval) 
* Automated PR (pull request) creation and code review assignment 
* Support for deployment automation and status checks 
* Configurable via npm package and command-line interface (CLI) 
* Seamless integration with third-party tools (Linear, GitHub, Graphite, CodeMachine, etc.) 

**Implementation-smoothness additions (explicit operational capabilities):**

* The workflow MUST support a **stateful run directory** per feature (local persistence) to enable resumable execution across: research → PRD → spec → code → PR → deploy.
* The system MUST include a **rate-limit aware HTTP client** for GitHub + Linear:

  * Must honor `retry-after` when present.
  * Must honor `x-ratelimit-reset` when `x-ratelimit-remaining` is `0`.
  * Must apply exponential backoff on repeated secondary limit hits. ([GitHub Docs][2])
* The system MUST support GitHub REST API **version pinning** and recommended headers:

  * `Accept: application/vnd.github+json`
  * `X-GitHub-Api-Version: 2022-11-28` (configurable) ([GitHub Docs][1])
* The system MUST support GitHub PR operations via REST endpoints including create PR, request reviewers, and merge/check merged. ([GitHub Docs][3])
* If Linear integration is enabled, the system MUST respect Linear API rate limiting (notably 1,500 requests/hour per user when authenticated via API key). ([Linear][4])
* If Linear “Agents” integration is used, the system MUST treat it as potentially unstable because Linear’s agent APIs are described as **Developer Preview** and may change. ([Linear][5])

**Suggested CLI “surface area” (still CLI-only, no UI dashboards):**

* `ai-feature init` → create RepoConfig + integration sanity checks
* `ai-feature start --prompt "..."` OR `ai-feature start --linear ISSUE-123` OR `ai-feature start --spec path/to/spec.md`
* `ai-feature status <feature_id>` → show state machine + artifact links/paths
* `ai-feature resume <feature_id>` → continue from last successful step
* `ai-feature pr create <feature_id>` → create PR + request reviewers
* `ai-feature deploy <feature_id>` → trigger merge/deploy path (when configured)
* `ai-feature export <feature_id> --format json|md` → agent-consumable snapshot

(These are requirements only if adopted in Section 6; otherwise treat as recommended ergonomics.)

### 2.2 User Journeys

* User submits prompt or opens Linear issue → system MUST extract feature intent, link to repo and gather context → PRD draft is created and shown for validation/edit → upon acceptance, AI/agent system breaks down tasks, generates code, opens PR for review → On approval, system MUST trigger merge/deploy workflow and notify user 

* AI Agent detects merged code and completed PR in monitored repo → system MAY offer post-deployment documentation or alert generation → feature marked as delivered and recorded in context index 

* User provides direct specification doc → system MUST ingest and connect to current repo context → automates or suggests research subtasks if information gaps found → proceeds as above 

**Implementation-smoothness additions (failure-aware journey variants):**

* If GitHub branch protection requires status checks, the system MUST detect “blocked merge” conditions and surface which required checks are missing/failed, rather than retrying merges blindly. (Required checks must pass against the latest commit SHA.) ([GitHub Docs][6])
* If repository supports auto-merge and it’s enabled, the system MAY enable auto-merge to avoid polling loops; however it MUST confirm repository auto-merge is enabled first. ([GitHub Docs][7])
* If the workflow hits GitHub secondary rate limits, the system MUST pause and retry according to GitHub guidance (`retry-after` or wait ≥ 60s when appropriate) to avoid “flaky” automation. ([GitHub Docs][2])
* If Linear is configured and rate limited, the system MUST degrade gracefully (cache issue data locally; avoid refetch storms) and continue with prompt/spec-only mode using the last known ticket snapshot. ([Linear][4])

---

## 3.0 Data Models

**Feature:**

* id (REQUIRED, unique)

  * RECOMMENDED: ULID or UUIDv7 for sortable uniqueness (local-first friendly)
* title (REQUIRED, 128 chars max) 
* description (REQUIRED, markdown) 
* source (REQUIRED, enum: prompt | issue | spec) 
* status (REQUIRED, enum: draft | in_progress | review | done | deployed) 
* related_research_tasks (OPTIONAL, array of ResearchTask ids) 
* linked_prs (OPTIONAL, array of PR ids) 
* context_docs (OPTIONAL, array of doc references) 
* created_at (REQUIRED) 
* updated_at (REQUIRED) 

**Recommended additions to reduce implementation ambiguity:**

* repo (REQUIRED, object)

  * repo_url (REQUIRED, string)
  * default_branch (OPTIONAL, string; if omitted, discovered from git/remote)
  * provider (REQUIRED, enum: github | other)
* working_branch (OPTIONAL, string)

  * The branch name created for this feature (if code changes occur)
* artifacts (OPTIONAL, object)

  * prd_path (OPTIONAL, string)
  * spec_path (OPTIONAL, string)
  * plan_path (OPTIONAL, string) — task breakdown for agent
  * run_log_path (OPTIONAL, string) — append-only log file
* external_links (OPTIONAL, object)

  * linear_issue_id (OPTIONAL, string)
  * github_issue_number (OPTIONAL, number)
  * github_pr_number (OPTIONAL, number)
* acceptance_criteria (OPTIONAL, array of strings)

  * Explicit “done means…” statements for agents/tests
* constraints (OPTIONAL, object)

  * languages (OPTIONAL, array of strings)
  * must_not_touch_paths (OPTIONAL, array of globs)
  * must_touch_paths (OPTIONAL, array of globs)
* telemetry (OPTIONAL, object)

  * last_step (OPTIONAL, string) — resumability
  * last_error (OPTIONAL, string, markdown)

---

**ResearchTask:**

* id (REQUIRED, unique) 
* feature_id (REQUIRED, Feature id) 
* title (REQUIRED) 
* objective (REQUIRED, string) 
* result (OPTIONAL, string, markdown) 
* status (REQUIRED, enum: pending | complete) 
* assigned_to (OPTIONAL, agent or user) 
* created_at (REQUIRED) 

**Recommended additions:**

* sources (OPTIONAL, array)

  * Each entry: { url, retrieved_at, excerpt, relevance_note }
* cache_key (OPTIONAL, string)

  * For avoiding repeated web/API calls in resumable runs
* freshness_required (OPTIONAL, enum: low | medium | high)

  * “high” implies revalidation near execution time for unstable dependencies (API docs, SDK versions)

---

**Specification:**

* id (REQUIRED, unique) 
* feature_id (REQUIRED, Feature id) 
* content (REQUIRED, markdown) 
* reviewer (OPTIONAL, user or agent id) 
* status (REQUIRED, enum: draft | review | accepted | rejected) 
* created_at (REQUIRED) 

**Recommended additions:**

* change_log (OPTIONAL, array of { at, by, summary })
* test_plan (OPTIONAL, markdown)
* rollout_plan (OPTIONAL, markdown)
* risks (OPTIONAL, markdown)

---

**RepoConfig:**

* id (REQUIRED, unique) 
* repo_url (REQUIRED) 
* tool_integrations (OPTIONAL, array: Linear, CodeMachine, Graphite, etc.) 
* active (REQUIRED, boolean) 
* context_paths (OPTIONAL, array of file/glob patterns) 
* project_leads (OPTIONAL, array of user ids) 
* created_at (REQUIRED) 

**Recommended additions (make runs smoother + safer):**

* github (OPTIONAL, object)

  * api_base_url (OPTIONAL, default: `https://api.github.com`)
  * api_version (OPTIONAL, default: `2022-11-28`) ([GitHub Docs][1])
  * auth_method (REQUIRED if github enabled, enum: env_token | gh_cli | github_app)
* linear (OPTIONAL, object)

  * api_base_url (OPTIONAL, default: `https://api.linear.app/graphql`)
  * auth_method (REQUIRED if linear enabled, enum: api_key | oauth)
  * rate_limit_per_hour (OPTIONAL, default: 1500 when api_key) ([Linear][4])
  * mcp_enabled (OPTIONAL, boolean, default: true when MCP Linear server detected) — **[ADR-6]** Delegate Linear operations to MCP server
* runtime (OPTIONAL, object)

  * min_node_version (RECOMMENDED, default aligned to active LTS) ([Node.js][8])
  * concurrency (OPTIONAL, number; default 4)
* context (OPTIONAL, object) — **[ADR-4]**

  * embedding_model (OPTIONAL, string, default: `text-embedding-3-small`) — Model for semantic context ranking
  * similarity_threshold (OPTIONAL, number, default: 0.3) — Minimum similarity score for context inclusion
  * token_budget (OPTIONAL, object)
    * context_ratio (OPTIONAL, number, default: 0.75) — Fraction of budget for ranked context
    * instruction_ratio (OPTIONAL, number, default: 0.20) — Fraction for prompts/instructions
* safety (OPTIONAL, object)

  * require_human_approval_for_merge (REQUIRED default true)
  * allow_force_push (REQUIRED default false)
  * redact_secrets_in_logs (REQUIRED default true)
  * approval_timeout_seconds (OPTIONAL, number, default: 300) — **[ADR-5]** CLI approval gate timeout
  * allow_non_interactive (OPTIONAL, boolean, default: false) — **[ADR-5]** Allow `--yes` flag to skip prompts
* validation (OPTIONAL, object) — **[ADR-7]**

  * max_fix_attempts (OPTIONAL, number, default: 3) — Auto-fix retry limit before halting
  * skip_validation_allowed (OPTIONAL, boolean, default: false) — Allow `--skip-validation` flag

---

**ExecutionTask:**

* id (REQUIRED, unique) 
* feature_id (REQUIRED, Feature id) 
* type (REQUIRED, enum: code_generation | testing | pr_creation | deployment) 
* status (REQUIRED, enum: queued | running | failed | done) 
* output (OPTIONAL, string, markdown or URL) 
* assigned_agent (OPTIONAL, agent reference) 
* created_at (REQUIRED) 

**Recommended additions:**

* depends_on (OPTIONAL, array of ExecutionTask ids)
* retry_policy (OPTIONAL, object)

  * max_attempts (default 3)
  * backoff (default exponential)
  * retryable_errors (list)
* logs (OPTIONAL, array of { at, level, message })

---

**References:**

* tickets (Linear or GitHub Issue ids) 
* code files (absolute or relative repo paths) 
* PRs (GitHub PR numbers/URLs) 
* context docs (files, Confluence, Notion links) 

**Recommended additions:**

* snapshots (OPTIONAL, array)

  * { kind: "linear_issue"|"github_issue"|"repo_file", ref, captured_at, content_hash }

---

## 5.0 Formal Project Controls & Scope

### 5.1 Document Control

Version: 1.2 | Status: Specification Complete | Date: December 15, 2025

**Change summary (since 1.1):** Added Section 5.4 Architectural Decision Records (ADRs) resolving 7 critical implementation decisions: Agent Execution Model, State Persistence (SQLite/WAL), Merge Governance, Context Gathering (Semantic Ranking), Approval Workflow, Linear Integration (MCP delegation), and Validation Policy (Auto-Fix Iteration). Updated RepoConfig data model with new configuration options.

**Change summary (since 1.0):** Added implementation-smoothness research: GitHub API versioning + rate limiting, Node LTS targeting, Linear SDK/rate limits, and merge/status-check behaviors. ([GitHub Docs][1])

### 5.2 Detailed Scope

**In Scope:**

* AI-augmented, repository-agnostic workflow for feature lifecycle (context, PRD, code, review, deploy) 
* Configurable and discoverable via npm or CLI 
* Integration with GitHub (Git-focused repos) 
* Multiple workflow triggers (prompt, Linear issue, direct spec) 
* Automated linking of tickets/issues, code, PRs, context docs 
* Modular support for AI and human-in-the-loop at every step 
* Out-of-the-box integrations for CodeMachine, Codex, Linear, Graphite 

**Explicit “smooth build” scope clarifications:**

* Rate-limit safe GitHub + Linear clients are **in scope** (this is required to keep runs stable). ([GitHub Docs][2])
* GitHub REST API version pinning is **in scope** to reduce future breakage. ([GitHub Docs][1])
* Local-first run persistence/resume is **in scope** (homelab + agent failures).
* Detecting “merge blocked by required checks” and “merge blocked by required reviews” is **in scope** (needed for reliable deploy automation). ([GitHub Docs][9])

**Out of Scope:**

* Proprietary code hosting outside of standard GitHub API 
* Enforced or opinionated repo structure/layouts 
* Feature flag provisioning or A/B testing 
* End-to-end test orchestration outside code PR lifecycle 
* Closed, ecosystem-specific integrations (i.e., not open API) 
* UI dashboards (CLI and config-driven only in this version) 

### 5.3 Glossary of Terms & Acronyms

* **PRD**: Product Requirements Document — user-facing/problem + outcomes definition.
* **Spec**: Engineering specification — constraints, acceptance criteria, API/design details.
* **ExecutionTask**: A machine-runnable unit of work (codegen/test/PR/deploy).
* **Context Gathering**: Automated collection of repo files, docs, ticket text, and historical changes relevant to a feature.
* **GitHub REST API Versioning**: GitHub’s date-based versioning, set via `X-GitHub-Api-Version` header (default currently `2022-11-28` when omitted, but explicit pinning recommended). ([GitHub Docs][1])
* **Primary vs Secondary Rate Limits**:

  * Primary: overall request budgets (e.g., authenticated REST requests often 5,000/hour; GitHub Actions `GITHUB_TOKEN` 1,000/hour/repo). ([GitHub Docs][2])
  * Secondary: abuse-prevention throttles; handle via `retry-after` and backoff. ([GitHub Docs][2])
* **Required Status Checks**: Repository branch protection can require CI checks to pass before merge. ([GitHub Docs][9])
* **Auto-merge**: GitHub feature that merges automatically once requirements are met (if enabled for repo). ([GitHub Docs][7])
* **Linear API Key**: Personal API key used to authenticate GraphQL calls (header `Authorization: <API_KEY>`). ([Linear][10])

---

## 5.4 Architectural Decision Records (ADRs)

**Status:** Approved | **Date:** December 15, 2025

The following architectural decisions resolve the ambiguities identified during specification review and establish binding constraints for implementation.

---

### ADR-1: AI Agent Execution Model

**Decision:** Single Abstract Interface (Path A)

**Context:** The system requires "bring-your-own-agent" execution with OpenAI-compatible endpoints, local models, or external agent services.

**Resolution:**
* The system SHALL implement a unified `AgentAdapter` interface with a standardized prompt/response contract.
* All agents MUST conform to a fixed capability set: PRD generation, spec generation, code generation, code review, test generation.
* The adapter SHALL include a simple retry mechanism (max 3 attempts with exponential backoff) for transient failures.
* Quality thresholds: Agent outputs MUST pass validation (syntax check, schema conformance) before acceptance.
* Escalation: When all retry attempts fail, the system SHALL halt execution, record the error in `last_error`, and await human intervention via `resume` command.

**Rationale:** Simplicity and consistency outweigh provider-specific optimizations for the initial release. This can be extended to capability-based routing in future versions.

---

### ADR-2: State Persistence & Concurrency Control

**Decision:** SQLite with WAL Mode (Tier 3)

**Context:** The system requires local-first resumable state machines with run directories containing JSON/markdown artifacts.

**Resolution:**
* The system SHALL use SQLite with Write-Ahead Logging (WAL) mode for transactional state updates.
* Database location: `.ai-feature-pipeline/state.db` within the repository root.
* All state mutations (Feature, ExecutionTask, ResearchTask) SHALL be atomic transactions.
* The system SHALL support concurrent reads from multiple processes.
* JSON/markdown artifact files (prd.md, spec.md, etc.) SHALL remain as human-readable exports, with SQLite as the source of truth.
* Schema migrations SHALL be versioned and applied automatically on CLI startup.

**Rationale:** SQLite provides robust ACID guarantees, built-in concurrency control, and zero external dependencies while remaining local-first and homelab-friendly.

---

### ADR-3: GitHub Merge Automation Governance

**Decision:** Conservative - Always Wait (Mode 1)

**Context:** The specification mandates detection of required status checks and support for auto-merge, but governance policy was undefined.

**Resolution:**
* The system SHALL NEVER enable auto-merge automatically.
* The system SHALL poll status checks and report merge readiness via `ai-feature status <feature_id>`.
* Human operators MUST manually execute merge via `ai-feature deploy <feature_id>` or GitHub UI.
* The system SHALL provide clear reporting of:
  * Which required checks are passing/failing
  * Whether required reviews are satisfied
  * Whether the branch is up-to-date with base
* Notification: The system SHALL output merge-readiness status to stdout and optionally to `logs.ndjson`.

**Rationale:** Safety-first approach prevents accidental merges of untested code. Auto-merge can be added as an opt-in feature in future releases.

---

### ADR-4: Context Gathering & Token Budget Management

**Decision:** Semantic Ranking (Strategy 2)

**Context:** Context gathering from README, docs, and `context_paths` globs requires prioritization when content exceeds token budgets.

**Resolution:**
* The system SHALL use embedding-based similarity between the feature description and available files to rank context relevance.
* Embedding model: The system SHALL support configurable embedding providers via `RepoConfig.context.embedding_model` (default: OpenAI `text-embedding-3-small`).
* Token budget allocation: 75% for ranked context, 20% for instructions/prompts, 5% reserved for agent response parsing.
* The system SHALL cache embeddings per file (keyed by file path + content hash) to minimize latency on subsequent runs.
* Fallback: If embedding service is unavailable, the system SHALL fall back to static priority ordering (README > package.json > touched files > tests).
* The system SHALL include in context: files with similarity score > 0.3 (configurable threshold).

**Rationale:** Semantic ranking provides more accurate context selection for diverse codebases, improving AI output quality. Caching mitigates startup latency concerns.

---

### ADR-5: Human-in-the-Loop Approval Workflow

**Decision:** Inline CLI Approval (Path A)

**Context:** Human approval gates are required before code writing, PR creation, and merge/deploy.

**Resolution:**
* The system SHALL block execution and prompt for Y/N confirmation in the terminal at each gate.
* Approval gates:
  1. Before code generation (after spec acceptance)
  2. Before PR creation (after validation passes)
  3. Before merge/deploy trigger
* Timeout: 5 minutes (configurable via `RepoConfig.safety.approval_timeout_seconds`).
* On timeout: Execution halts, state is saved, user can `resume` later.
* Audit trail: All approval/rejection events SHALL be logged to `logs.ndjson` with timestamp, gate name, and response.
* Bypass: `--yes` flag SHALL skip interactive prompts for CI/scripted scenarios (requires explicit `RepoConfig.safety.allow_non_interactive: true`).

**Rationale:** Inline CLI approval is zero-dependency and suitable for single-developer homelab scenarios. File-based or webhook approvals can be added as future enhancements.

---

### ADR-6: Linear Integration Strategy

**Decision:** MCP Server Delegation

**Context:** The specification requires Linear issue fetching and rate-limit-aware operations, but write-back strategy was undefined.

**Resolution:**
* The system SHALL delegate all Linear API operations to the configured MCP (Model Context Protocol) server.
* Read operations: Issue fetching, metadata retrieval, and snapshot capture SHALL be performed via MCP Linear server tools.
* Write operations: Status updates, label changes, and comment creation SHALL be performed via MCP Linear server tools when configured.
* The system SHALL NOT implement direct Linear API client code; all Linear interactions are abstracted through MCP.
* Rate limiting: The MCP server is responsible for rate limit compliance; the system SHALL respect any rate-limit errors returned by MCP tools and apply standard retry/backoff.
* Fallback: If MCP Linear server is unavailable, the system SHALL operate in offline mode using cached issue snapshots.
* Configuration: `RepoConfig.linear.mcp_enabled: true` (default when MCP Linear server is detected).

**Rationale:** MCP delegation provides a clean abstraction layer, avoids duplicating Linear SDK integration, and leverages existing MCP infrastructure. This also future-proofs against Linear API changes.

---

### ADR-7: Testing & Validation Enforcement Policy

**Decision:** Auto-Fix Iteration (Policy 3)

**Context:** Validation steps (lint, test, typecheck, build) are mandated before PR creation, but failure handling was undefined.

**Resolution:**
* When validation fails, the system SHALL invoke the agent to fix failures automatically.
* Maximum retry attempts: 3 (configurable via `RepoConfig.validation.max_fix_attempts`).
* Per-attempt flow:
  1. Run validation suite
  2. On failure, extract error messages and failing file paths
  3. Invoke agent with error context and request fixes
  4. Apply agent patches
  5. Re-run validation
* If all attempts fail:
  * The system SHALL halt and save detailed failure output to `run_directory/validation_failures.json`.
  * Human intervention required via `resume` after manual fixes.
* Test generation: The system SHALL NOT auto-generate tests for untested code paths unless explicitly requested via `--generate-tests` flag.
* Escape hatch: `--skip-validation` flag allows PR creation with failing checks (adds `validation-skipped` label to PR).

**Rationale:** Auto-fix iteration maximizes automation and reduces friction from minor agent-introduced issues (lint errors, type mismatches) while maintaining quality gates through bounded retries.

---

## 6.0 Granular & Traceable Requirements

**Notation:** Requirements are labeled **FR-x** (functional) and **IR-x** (integration/reliability). These are written so AI coding agents can directly implement and test them.

### Feature lifecycle & state machine

* **FR-1 (Initialize)**: The system MUST support initializing RepoConfig in the current working directory, including:

  * Detect git repo root.
  * Create a config file (format: JSON or YAML) under a tool-owned directory (RECOMMENDED: `.ai-feature-pipeline/`).
  * Validate required integrations (if enabled) by performing lightweight API calls (e.g., GitHub “get repo” and Linear “viewer” query).
* **FR-2 (Run directory)**: For each Feature, the system MUST create a run directory containing:

  * `feature.json` (Feature model)
  * `prd.md` (generated PRD)
  * `spec.md` (generated/accepted spec)
  * `plan.json` (task breakdown, dependency graph)
  * `logs.ndjson` (append-only structured logs)
* **FR-3 (Resumability)**: Each pipeline step MUST be idempotent:

  * If step output exists and inputs have not changed (hash compare), step MUST be skipped.
  * If a step fails, the system MUST record `last_error` and `last_step` and allow `resume` to continue from the failure point.

### Inputs / triggers

* **FR-4 (Prompt trigger)**: Given a prompt string, the system MUST:

  * Create a Feature with `source=prompt`.
  * Generate a PRD draft (stored as `prd.md`) and present it for acceptance/edit (CLI editor or file-based).
* **FR-5 (Linear trigger)**: Given a Linear issue identifier, the system MUST:

  * Fetch issue title/description and relevant metadata.
  * Snapshot the issue payload into the run directory.
  * Create a Feature with `source=issue`.
  * Respect Linear API limits (see IR-4). ([Linear][4])
* **FR-6 (Spec trigger)**: Given a specification file, the system MUST:

  * Ingest it as the initial `spec.md`.
  * Generate missing PRD sections if required for downstream (kept as `prd.md`).
  * Identify “unknowns” and create ResearchTasks.

### Context gathering

* **FR-7 (Repo context selection)**: The system MUST gather:

  * `README`, top-level docs, and files matching `context_paths` globs in RepoConfig.
  * Optionally recent git history summaries (e.g., last N commits touching relevant paths).
* **FR-8 (Context size control)**: The system MUST enforce token/size budgets for agent ingestion:

  * Must include a summarization step for large files.
  * Must record exact file SHAs/hashes used for the run.

### PRD and spec drafting

* **FR-9 (PRD generation)**: The system MUST produce a PRD draft that includes:

  * Problem statement
  * Goals / non-goals
  * Acceptance criteria
  * Risks and dependencies
  * Traceability: mapping from PRD goals → Spec requirements → Tasks
* **FR-10 (Spec generation)**: After PRD acceptance, the system MUST generate a spec that includes:

  * Implementation constraints (paths to touch/avoid)
  * Test plan
  * Rollout plan (even if “no deploy”, specify merge + verification)
* **FR-11 (Human-in-the-loop gate)**: The system MUST provide a gate requiring explicit approval (human or configured agent) before:

  * Writing code changes
  * Creating PR
  * Merging/triggering deploy

### Code generation & validation

* **FR-12 (Branch management)**: The system MUST create a working branch per feature and avoid force-push by default.
* **FR-13 (Patch-based edits)**: Agent edits MUST be applied as patches/diffs with:

  * File path allowlist/denylist enforcement
  * A dry-run mode showing changes before applying
* **FR-14 (Local validation)**: The system MUST run configured validation steps before PR creation:

  * lint, unit tests, typecheck, build (configurable)
  * If no test command exists, the system MUST at minimum run a syntax/type check step when possible.

### GitHub PR operations (reliability-critical)

* **IR-1 (GitHub API headers)**: All GitHub REST requests MUST set:

  * `Accept: application/vnd.github+json`
  * `X-GitHub-Api-Version` (default `2022-11-28`, configurable) ([GitHub Docs][1])
* **IR-2 (Create PR)**: The system MUST support PR creation via GitHub REST “pulls” endpoints. ([GitHub Docs][3])
* **IR-3 (Request reviewers)**: The system MUST support requesting reviewers via GitHub REST review-requests endpoints. ([GitHub Docs][11])
* **IR-4 (Merge / merged-check)**: The system MUST support:

  * Checking merged state via GitHub REST “check if merged”
  * Merging via GitHub REST “merge a pull request” ([GitHub Docs][3])
* **IR-5 (Branch protection awareness)**: Before attempting merge, the system MUST:

  * Detect required status checks and ensure it is operating on the latest commit SHA (or clearly report that checks are stale/for a different SHA). ([GitHub Docs][6])
  * If auto-merge is configured and enabled, the system MAY enable it instead of polling merges. ([GitHub Docs][7])
* **IR-6 (Rate limit handling - GitHub)**: The system MUST implement GitHub rate limit handling:

  * If primary limit exceeded, do not retry until after `x-ratelimit-reset`. ([GitHub Docs][2])
  * If secondary limit exceeded and `retry-after` exists, wait that many seconds. ([GitHub Docs][2])
  * Otherwise wait ≥ 60 seconds and apply exponential backoff on repeated failures. ([GitHub Docs][2])
* **IR-7 (Content-creation throttling)**: The system SHOULD throttle write operations (opening PRs, comments, labels) to avoid triggering abuse/secondary limits; implement a queue for write actions. ([GitHub Docs][2])

### Linear integration (optional but specified)

* **IR-8 (Linear auth)**: When using API keys, the system MUST authenticate with `Authorization: <API_KEY>` for GraphQL calls. ([Linear][10])
* **IR-9 (Linear rate limiting)**: The system MUST enforce request pacing such that it can operate within 1,500 requests/hour per user for API-key auth. ([Linear][4])
* **IR-10 (SDK support)**: The system SHOULD support using `@linear/sdk` for typed access in Node/TypeScript environments. ([Linear][12])
* **IR-11 (Agents preview risk)**: If integrating with Linear’s “agents” APIs, the system MUST treat schemas/behavior as unstable (Developer Preview) and isolate that integration behind a versioned adapter interface. ([Linear][5])

### Deployment automation

* **FR-15 (Status checks)**: The system MUST be able to read status checks / required checks state from GitHub and block merge until they pass (or enable auto-merge when allowed). ([GitHub Docs][9])
* **FR-16 (No-server deploy trigger)**: The system MAY trigger deployments via existing repo automation (e.g., GitHub Actions workflows) but MUST not require a dedicated server component in this version. 

### Security & secret handling

* **FR-17 (Token safety)**: The system MUST support secrets via environment variables as the baseline:

  * `GITHUB_TOKEN`/`GITHUB_PAT` (fine-grained recommended)
  * `LINEAR_API_KEY`
* **FR-18 (Least privilege guidance)**: The system MUST document and surface the minimal permissions required for configured operations; fine-grained PATs are recommended and GitHub suggests GitHub Apps for more scalable automation. ([GitHub Docs][13])
* **FR-19 (Log redaction)**: The system MUST redact tokens and secrets in logs and saved artifacts.

---

## 7.0 Measurable Non-Functional Requirements (NFRs)

**Reliability**

* **NFR-1**: 99% of runs SHOULD be resumable after an interruption (process kill, network drop) without manual file surgery (resume from `last_step`).
* **NFR-2**: The system MUST avoid “busy loop” retry storms on API failures; all retry loops MUST be rate-limit aware and bounded (max attempts, backoff). ([GitHub Docs][2])

**Performance**

* **NFR-3**: Context gathering SHOULD complete within:

  * < 30s for repos < 2k files
  * < 2m for repos < 20k files
    (Assumes local disk + normal CPU; allow config overrides.)
* **NFR-4**: PR creation and reviewer request operations SHOULD complete in < 10s excluding GitHub response latency, under normal rate limits. ([GitHub Docs][3])

**Compatibility**

* **NFR-5**: The CLI MUST support current maintained Node.js LTS lines. As of December 2025, Node v24 is Active LTS and Node v20 is Maintenance LTS; the tool SHOULD run on both. ([Node.js][8])

**Security**

* **NFR-6**: The tool MUST not print secrets in plaintext to stdout/stderr by default.
* **NFR-7**: The tool MUST use least-privilege authentication guidance and prefer fine-grained PATs, with an upgrade path toward GitHub Apps for longer-lived automation. ([GitHub Docs][13])

**Maintainability**

* **NFR-8**: Integrations MUST be adapter-based (GitHubAdapter, LinearAdapter, AgentAdapter) to isolate API churn and allow swapping providers.
* **NFR-9**: All external API calls MUST be centralized through a single HTTP layer supporting:

  * automatic headers (API versioning)
  * retry/backoff
  * structured logging
  * request IDs

**Auditability**

* **NFR-10**: Every run MUST output an artifact bundle containing:

  * inputs (prompt/ticket/spec snapshot)
  * context file list + hashes
  * produced PRD/spec
  * diff summary of code changes
  * PR link + merge/deploy result (if executed)

---

## 8.0 Technical & Architectural Constraints

### 8.1 Technology Stack

* Language: Node.js (TypeScript preferred) 
* Distribution: npm package 
* Repository: Git/GitHub-centric operation for both public and private repos 
* CLI Interface: Standard POSIX-compatible CLI 

**Up-to-date runtime targeting constraint:**

* The implementation SHOULD target maintained Node LTS releases. As of December 2025, Node v24 is Active LTS and Node v20 is Maintenance LTS. ([Node.js][8])

### 8.2 Architectural Principles

* Solution MUST operate as a non-owning, overlay/config layer 
* No assumptions about repo exclusivity—MUST co-exist with other tools & configs 
* Modular integration, agent plug-ins, and third-party tool compatibility by design 

**Additional constraints for smooth implementation:**

* **API version pinning**: GitHub REST requests MUST set `X-GitHub-Api-Version` to avoid implicit version drift; GitHub documents this header and default behavior. ([GitHub Docs][1])
* **Rate limit discipline**: The system MUST implement primary + secondary rate-limit handling exactly as documented (respect `retry-after`, `x-ratelimit-reset`). ([GitHub Docs][2])
* **Branch protection awareness**: The system MUST not assume merges will succeed; required status checks may block merges. ([GitHub Docs][9])

### 8.3 Deployment Environment

* Installation via `npm install -g ai-feature-pipeline` or as repo dependency 
* CLI accessible in any initialized repo via npm script or global cmd 
* No required server—workflow handled by agents on demand and via ephemeral processes 

**Homelab-friendly operational constraints:**

* The system SHOULD support running entirely on:

  * developer laptop
  * self-hosted runner
  * single homelab VM/container
    without requiring externally hosted databases.
* Any “watcher” behavior (monitoring PR merges) SHOULD be optional and runnable as a scheduled job (cron) rather than requiring a daemon.

---

## 9.0 Assumptions, Dependencies & Risks

### 9.1 Assumptions

* AI agents and human operators have required API keys and permissions for all integrated tools 
* Standard GitHub repo layouts (src, docs/ or README.md) are available for context parsing 
* Linear, Graphite, CodeMachine, etc., maintain backwards-compatible APIs 

**Updated assumptions (to reduce surprises):**

* Operators will use fine-grained GitHub tokens where possible; GitHub recommends fine-grained PATs over classic PATs. ([GitHub Docs][13])
* GitHub REST usage will include explicit API version headers; requests without the header default to `2022-11-28` today, but relying on defaults is discouraged for long-lived automation. ([GitHub Docs][1])
* If Linear “Agents” APIs are used, they may change because they are described as Developer Preview. ([Linear][5])

### 9.2 Dependencies

* Access to GitHub and Linear APIs for ticket/PR sync 
* npm ecosystem for installation and package updates 
* Agents such as Codex or CodeMachine being available and API-accessible 
* Optional: Confluence/Notion API access for broader context gathering 

**Critical dependency details (implementation smoothness):**

* **GitHub REST API behaviors**

  * Versioning via `X-GitHub-Api-Version` header. ([GitHub Docs][1])
  * Rate limits + retry semantics (primary and secondary). ([GitHub Docs][2])
  * PR operations: create PR, request reviewers, merge/check merged. ([GitHub Docs][3])
* **Linear API behaviors**

  * GraphQL authentication uses `Authorization: <API_KEY>`. ([Linear][10])
  * API-key rate limit is 1,500 requests/hour per user. ([Linear][4])
  * TypeScript SDK exists (`@linear/sdk`) and is actively published (useful for typed integration). ([Linear][12])

### 9.3 Risks

* Cross-repo orchestration: Potential mismatch in context or feature linkage due to inconsistent ticket or PR naming conventions 
* AI agent drift or hallucination: Poorly specified tasks may yield unusable code, requiring strong human-in-the-loop controls 
* Integration fatigue: Tool or API changes (breaking changes in Linear or GitHub) could disrupt workflow until patched 
* Security: Ensuring that PRs and code generated by AI is always subject to human review before merge/deploy 

**Additional high-probability operational risks + mitigations:**

* **Rate limiting / abuse throttling risk (GitHub):**

  * Risk: Secondary rate limits cause intermittent 403/429.
  * Mitigation: Implement retry rules based on `retry-after` and `x-ratelimit-reset` (and backoff) as documented. ([GitHub Docs][2])
* **Merge blocked by branch protection:**

  * Risk: Required status checks must pass against latest SHA; merges fail unexpectedly.
  * Mitigation: Detect and report missing/failed checks; optionally enable auto-merge where allowed. ([GitHub Docs][6])
* **Token sprawl risk:**

  * Risk: PAT rotation/expiry breaks runs; too-broad scopes create security exposure.
  * Mitigation: Prefer fine-grained PATs and provide an upgrade path to GitHub Apps for longer-lived automation. ([GitHub Docs][13])
* **Linear agents API instability:**

  * Risk: Developer Preview changes break integrations.
  * Mitigation: Treat as optional; adapter isolation; contract tests against recorded fixtures. ([Linear][5])

---

[1]: https://docs.github.com/rest/overview/api-versions?utm_source=chatgpt.com "API Versions"
[2]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?utm_source=chatgpt.com "Rate limits for the REST API"
[3]: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28&utm_source=chatgpt.com "REST API endpoints for pull requests"
[4]: https://linear.app/developers/rate-limiting?utm_source=chatgpt.com "Rate limiting – Linear Developers"
[5]: https://linear.app/developers/agents?utm_source=chatgpt.com "Getting Started – Linear Developers"
[6]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks?utm_source=chatgpt.com "Troubleshooting required status checks"
[7]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request?utm_source=chatgpt.com "Automatically merging a pull request"
[8]: https://nodejs.org/en/about/previous-releases?utm_source=chatgpt.com "Node.js Releases"
[9]: https://docs.github.com/articles/about-status-checks?utm_source=chatgpt.com "About status checks"
[10]: https://linear.app/developers/graphql?utm_source=chatgpt.com "Getting started – Linear Developers"
[11]: https://docs.github.com/en/rest/pulls/review-requests?utm_source=chatgpt.com "REST API endpoints for review requests"
[12]: https://linear.app/developers/sdk?utm_source=chatgpt.com "Getting started – Linear Developers"
[13]: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens?utm_source=chatgpt.com "Managing your personal access tokens"
