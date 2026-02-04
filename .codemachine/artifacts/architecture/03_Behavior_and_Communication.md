<!-- anchor: 3-0-proposed-architecture -->
## 3. Proposed Architecture (Behavioral View)

*   **3.7. API Design & Communication:**
    *   **API Style:** The behavioral design embraces the RESTful JSON contract mandated by the foundation so every agent, adapter, and CLI surface shares deterministic semantics.
        - The system standardizes on RESTful JSON interactions because the foundation mandates GitHub and Linear adapters operate over HTTP verbs with predictable semantics.
        - CLI commands map to local orchestration, yet remote invocations (future HTTP surface) follow the same REST contract described in the foundation's primary API style.
        - Each request includes deterministic headers such as Accept and X-GitHub-Api-Version so behavior remains stable even as providers evolve.
        - RepoConfig initialization uses a RESTful sanity-check cycle where the GitHub Adapter issues GET /repos/{owner}/{repo} with pinned headers before persisting any local configuration.
        - Linear onboarding uses POST requests to https://api.linear.app/graphql with Authorization headers, aligning with the same REST discipline even though payloads are GraphQL envelopes.
        - Local-first orchestration still treats CLI-to-adapter calls as request/response boundaries, capturing request metadata inside logs.ndjson for deterministic replay.
        - Every REST invocation writes a RateLimitEnvelope entry, making HTTP metadata part of the persisted DTOs and ensuring resumability respects previous responses.
        - Idempotency is enforced by attaching Idempotency-Key headers to write operations, letting GitHub or Linear deduplicate retries triggered by the resumable state machine.
        - Feature creation via POST /runs accepts prompt, issue, or spec references, and the CLI simply shells that payload into the orchestrator through the same schema.
        - GET /runs/{id} returns the Feature, RepoConfig snapshot, ExecutionTask graph, and the RateLimitEnvelope ledger so downstream automations have complete context.
        - POST /runs/{id}/resume forms the canonical way to restart an interrupted pipeline, carrying the recorded last_step and optional manual overrides.
        - POST /runs/{id}/export drives bundle assembly and always responds with deterministic file paths relative to the run directory manifest.
        - Adapter-based architecture keeps each HTTP client isolated, but all of them share a unified REST policy for retries, error taxonomy, and structured logging.
        - Within GitHub integrations, REST endpoints include branch management (POST /git/refs), pull request operations (POST /pulls), reviewer requests (POST /pulls/{number}/requested_reviewers), and merge (PUT /pulls/{number}/merge).
        - GitHub status checks are read via GET /repos/{owner}/{repo}/commits/{sha}/check-suites, and the responses feed DeploymentRecord DTOs used later in merges.
        - Auto-merge enablement uses the GraphQL mutation from GitHub, yet the HTTP client still wraps the call with REST-like envelope metadata to align logs across providers.
        - Linear snapshots rely on GraphQL queries for issues and comments, but each GraphQL call is stored as a RESTful RequestRecord with method POST and a hashed body for reproducibility.
        - Optional watchers that detect merged code run as CLI commands but talk to GitHub via GET /repos/{owner}/{repo}/pulls?state=closed, continuing the same restful flavor.
        - Observability exports such as codepipe status --json essentially mirror GET /runs/{id} and rely on the same DTO definitions described later in this section.
        - Security posture demands Authorization headers to hold redacted tokens; the HTTP layer enforces this and rejects any call missing a sanitized credential descriptor.
        - CLI-level approvals still route through RESTful artifacts; for example, codepipe approve writes to approvals.json but also exposes POST /runs/{id}/approvals for remote triggers.
        - When the Execution Engine wishes to publish diffs, it calls POST /runs/{id}/artifacts/diff internally, giving a consistent interface to store zipped patch summaries.
        - Rate-limit friendly behavior is enforced by reading x-ratelimit-remaining and x-ratelimit-reset from every response before the HTTP layer resolves the promise back to the caller.
        - Secondary limit handling attaches Retry-After metadata to the DTO so resume operations honor cooling-off periods even across process restarts.
        - Each DTO includes schema_version values, preventing mismatches between CLI versions or partially upgraded adapters.
        - HTTP errors map to the error taxonomy: 429 and 503 are transient, 422 indicates validation, and 403 may be permanent or human action pending depending on response body hints.
        - Observability hub publishes REST traces to traces.json with requestId fields, letting developers correlate CLI logging lines with API responses long after execution.
        - CLI orchestrator enforces Accept: application/vnd.github+json via the HTTP layer and ensures GitHub sees deterministic version pinning at all times.
        - Because the system is local-first, restful interactions can be fully mocked using recorded fixtures loaded by vitest contract tests, aligning with the standard kit's guidance.
        - For BYO agent providers that expose HTTP, each agent call is still treated as REST: POST /agent/sessions and POST /agent/tasks, with manifest-driven capability declarations.
        - CLI commands degrade gracefully by falling back to file-based operations when remote REST interactions fail, yet they still capture the failure as part of the response DTO.
        - Each DTO includes normalized timestamps (ISO 8601, UTC) to simplify reasoning in distributed scenarios or across different developer machines.
        - JSON bodies forbid casing drift; they mirror TypeScript interface casing exactly, ensuring the Behavior Architect's flows remain predictable.
        - The HTTP layer injects Trace-ID headers derived from run_id plus step_id so GitHub and Linear logs can be correlated should escalation be required.
        - The CLI ensures multi-step flows such as PR creation run as separate REST calls, preventing monolithic endpoints from hiding failure granularity.
        - Each restful endpoint is idempotent where practical; for example, POST /runs uses client-generated ULIDs so retries do not create duplicate directories.
        - The HTTP layer rejects chunked uploads to keep traffic deterministic; large artifacts are referenced by path in the DTO instead of streaming raw diff data.
        - Local watchers leverage GET requests with If-None-Match headers, enabling conditional retrievals that align with GitHub caching semantics.
        - CLI-level telemetry uses PUT /runs/{id}/telemetry to store cost tracking, enabling remote dashboards to sync the same data without reading files directly.
        - Artifact bundle exports stick to REST by letting remote agents call POST /runs/{id}/export --format json, returning manifest URIs even when the CLI runs offline.
        - GitHub App support, once enabled, still uses the same REST endpoints but with JWT-based Authorization; the HTTP layer abstracts token management yet logs the provider type.
        - Error responses embed remediation_hint strings so the Behavior Architect can route them into human-in-the-loop prompts or CLI suggestions.
        - CLI run_state transitions are recorded via PATCH /runs/{id}/status with payloads referencing enumerated states (draft, in_progress, review, done, deployed).
        - The resumable queue uses POST /runs/{id}/tasks to append ExecutionTasks, and each record indicates depends_on relationships for deterministic scheduling.
        - Each ExecutionTask update uses PATCH /runs/{id}/tasks/{taskId}, enabling partial completion updates and reflecting logs without rewriting the entire plan.
        - Observability metrics push uses PUT /runs/{id}/metrics to deliver Prometheus textfiles, ensuring remote dashboards stay consistent with local instrumentation.
        - Rate-limit ledgers sync through GET /runs/{id}/rate-limits, allowing distributed operators to review throttle state before issuing new commands.
        - Approvals retrieved via GET /runs/{id}/approvals let remote supervisors confirm gating status before resuming a stalled run.
        - Deploy triggers call POST /runs/{id}/deployments, referencing the DeploymentRecord schema to keep merges and workflow dispatches auditable.
        - Secrets never traverse REST payloads; only references or hashed fingerprints travel through DTOs, aligning with the security guidelines.
        - CLI ensures environment variables are read locally, but when the HTTP surface is used by remote orchestrators they send credential_reference tokens instead of raw secrets.
        - Each request/response pair is hashed and stored under run directories to make audit exports reproducible and tamper-evident.
        - The HTTP layer includes automatic compression toggles (Content-Encoding) but defaults to identity to avoid non-deterministic streaming artifacts.
        - CLI uses synchronous blocking for REST calls to keep control flow simple, but the HTTP module can still multiplex multiple requests thanks to async/await semantics.
        - Artifact references in REST responses use relative paths within .codepipe to keep location independence across machines.
        - Because the CLI may be invoked on air-gapped machines, REST interactions can be mocked by pointing the HTTP layer to recorded fixtures defined in RepoConfig runtime overrides.
        - Request payloads include srid (schema revision identifier) so old clients cannot accidentally submit incompatible Feature DTOs.
        - GitHub pagination is strictly sequential; the HTTP layer follows Link headers but caps page_count to avoid runaway loops when handling PR listings.
        - Observability attaches content-length metadata to logs, aiding in diagnosing truncated responses when network proxies misbehave.
        - RepoConfig discovery is a purely local operation, but once found it is served via GET /config to remote tools so they align with CLI decisions.
        - CLI ensures GraphQL calls (Linear) follow POST semantics with persisted query strings hashed for caching and failure reproduction.
        - Execution Engine communicates with GitHub via REST for operations like checking required status checks and retrieving workflow runs, ensuring branch protection awareness is explicit.
        - Export bundles rely on GET /runs/{id}/bundle/manifest to describe which files to include, and the CLI stores the same manifest on disk for later inspection.
        - CLI extends restful style to AgentAdapter interactions by defining POST /agents/{agentId}/sessions and POST /agents/{agentId}/actions to record prompts, completions, and tool usage.
        - Because adapters obey the same HTTP conventions, new providers can be swapped without rewriting orchestration logic, fulfilling the modular requirement.
        - CLI-level caching uses ETag-like semantics where responses include content_hash fields to allow skip logic, similar to HTTP conditional requests.
        - Observability includes health checks invoked via GET /health for each adapter, returning status_reasons that help operators diagnose integration failures.
        - CLI's local-run-only mode still honors the REST contract by writing pseudo-responses to logs, ensuring future remote orchestrators can parse the same shapes.
        - The CLI enforces TLS for all remote HTTP calls and rejects insecure endpoints unless explicitly flagged for development fixtures.
        - Each request includes User-Agent: codemachine-pipeline/<version> to make GitHub and Linear telemetry easier to analyze.
        - When the CLI triggers GitHub workflow dispatches, it uses POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches with deterministic ref and inputs arrays.
        - GitHub comment creation, if enabled, aligns with POST /repos/{owner}/{repo}/issues/{number}/comments but respects IR-7's throttling requirements by placing writes into a queue.
        - CLI-run watchers use HEAD requests when verifying branch existence, reducing payload sizes while still following the same HTTP semantics.
        - HTTP layer ensures connection reuse via undici keep-alive to respect performance NFRs while still clearly delineating requests at the DTO layer.
        - Agents invoked through local processes (non-HTTP) still emulate REST boundaries by serializing requests/responses to JSON files consumed via POST/GET semantics.
        - CLI orchestrator enforces concurrency by serializing REST writes and allowing certain GET operations to run concurrently, preventing haphazard load on providers.
        - HTTP layer centralizes certificate pinning options, letting operators restrict GitHub endpoints to known root certificates when running in secure homelabs.
        - For local-first resumption, the CLI caches the last HTTP response per step and surfaces it through GET /runs/{id}/steps/{stepId}/response for debugging.
        - Export bundle requests may include filter parameters (e.g., format=md) but still rely on query strings, with the HTTP layer sanitizing all user input before constructing URLs.
        - CLI ensures multi-tenant usage works by including repo_url and feature_id in every REST call, preventing cross-project contamination.
        - Retry policies for REST requests are encoded as part of each DTO, containing attempt counters, jitter settings, and the timestamp of the last retry.
        - CLI orchestrator surfaces these retry plans to the user via codepipe status --json, mapping the HTTP behavior to the state machine view.
        - HTTP layer also annotates request_size bytes, enabling downstream cost accounting for providers that bill per payload size.
        - Observability hub publishes restful transcripts under run/logs/http.ndjson, each entry referencing run_id, component, method, url, status_code, and timeline data.
        - CLI ensures restful endpoints treat arrays deterministically by sorting fields like reviewers or required checks before sending them to GitHub APIs.
        - When patch files must be uploaded, the CLI encodes them as base64 strings within JSON, ensuring the HTTP format remains purely textual.
        - Response parsing uses schema validation (zod) in the HTTP layer to catch provider-side schema drift quickly.
        - CLI orchestrator caches GitHub repo metadata locally but respects ETags when revalidating to avoid hitting rate limits unnecessarily.
        - All HTTP clients respect the same logging levels: debug entries may include truncated payloads, info entries focus on method+status, and error entries embed sanitized bodies.
        - CLI orchestrator ensures restful interactions align with error taxonomy by raising TransientError for 503s and HumanActionRequired for 403s referencing branch protection contexts.
        - Rate-limit aware HTTP client also persists cooldown_end_at fields, which the Behavior Architect uses to pause ExecutionTasks that depend on those providers.
        - Each restful request includes deterministic timestamps derived from the same monotonic clock used by logs, ensuring cross-file correlation is precise.
        - The CLI's offline stub server (used in tests) mimics the REST endpoints exactly, including headers and JSON structure, verifying contract fidelity.
        - CLI orchestrator ensures restful responses referencing paths always use POSIX separators so cross-platform behavior remains deterministic.
        - When CLI acts as REST server (future remote control), it enforces token-based authentication with scoped PATs identical to GitHub's fine-grained tokens concept, keeping mental models consistent.
        - Observability hub includes derived metrics such as http_request_duration_seconds segmented by endpoint_name, aligning CLI metrics with Prometheus conventions.
        - CLI ensures all restful URIs are recorded inside trace.json so audit bundles capture the exact endpoints touched during a feature run.
        - When GitHub returns streaming responses (e.g., large diff), the HTTP layer still marshals them into complete JSON entries before writing to disk, preventing partial states.
        - CLI orchestrator groups related restful calls (context gathering vs PR creation) by component_id so a failure only marks the relevant state machine slice.
        - HTTP layer includes a built-in circuit breaker per provider: repeated failures trip the breaker and require human acknowledgement before new REST calls proceed.
        - CLI ensures restful interactions with Graphite or CodeMachine follow the same standard once those adapters are activated, maintaining uniformity.
        - CLI enforces that restful responses referencing secrets (like GitHub App tokens) are immediately hashed and replaced with redaction tokens before being persisted.
        - HTTP layer includes support for proxies, configured in RepoConfig runtime.network, yet still enforces TLS validation and deterministic logging.
        - CLI uses HTTP HEAD requests to confirm remote resources exist before performing GET or POST operations when the provider charges per call, saving rate limit budget.
        - Observability hub writes warn-level logs whenever restful requests approach rate limit exhaustion (<10% remaining) so operators can pause proactively.
        - CLI ensures restful API version pinning is configurable; defaults to 2022-11-28 per foundation but may change via RepoConfig github.api_version.
        - HTTP layer optionally enforces IPv6 or IPv4 selection via configuration, giving homelab operators more predictability when dealing with network segmentation.
        - CLI orchestrator includes a per-request context_id referencing the calling module (ContextAggregator, PRDAuthoringEngine, etc.), making it easy to audit interactions by subsystem.
        - When CLI receives permanent HTTP failures, it serializes the provider response and cross-links it with the relevant ExecutionTask for future triage.
        - Response DTOs also include derived fields like was_cached or used_fallback to show whether the HTTP layer served data from local caches or remote providers.
        - CLI orchestrator ensures restful endpoints referencing lists (e.g., reviewers) include deterministic ordering to avoid unnecessary diffs when reissuing the same request.
        - When remote endpoints respond with warnings (e.g., GitHub secondary rate-limit headers), the HTTP layer surfaces them via standardized warning_codes array in the DTO.
        - CLI orchestrator persists HTTP cookies only for provider features that require them (rare) and even then stores hashed placeholders to maintain security posture.
        - Incomplete restful responses (network drop mid-transfer) are detected via content-length mismatch, and the HTTP layer retries with exponential backoff as mandated.
        - CLI orchestrator ensures restful interactions produce deterministic error messages by templating them through zod-validated structures before presenting to the user.
        - HTTP layer uses typed enums for HTTP verbs and status codes, preventing typographical mistakes when new adapters are added.
        - Observability hub aggregates restful throughput statistics, enabling future scaling decisions (parallelization) while respecting rate limits.
        - CLI ensures restful endpoints rely on standard JSON serialization, forbidding runtime-specific fields or prototypes, thus keeping exports portable.
        - HTTP layer includes CLI version within a X-AI-Feature-Version header, allowing providers to deliver targeted guidance when features change.
        - Because the CLI is local-first, restful calls are the only time network is touched; this clear boundary simplifies compliance reviews and threat assessments.
    *   **Communication Patterns:** The Behavior Architect view emphasizes how orchestrated request/response paths and asynchronous queues work together without violating local-first constraints.
        - Synchronous CLI Orchestrator to RepoConfig Manager handshake occurs when commands like codepipe start validate repository state before any work begins.
        - RepoConfig Manager responds with resolved paths, integration flags, and capability toggles, which the CLI Orchestrator caches for the remainder of the run.
        - CLI Orchestrator then issues a synchronous request to the Run Directory Manager to create or load the feature run directory, guaranteeing deterministic folder names via ULIDs.
        - Run Directory Manager returns file handles, path registries, and file locks, allowing the CLI Orchestrator to orchestrate subsequent writes safely.
        - Context Aggregator is invoked next through an asynchronous job queue entry so large repo scans do not block command responsiveness.
        - The queue storing Context Aggregator tasks lives in plan.json and logs.ndjson, enabling resume operations to understand what was pending at crash time.
        - Context Aggregator pulls repo content synchronously from local disk but emits asynchronous events to Observability Hub to report progress and summarization statistics.
        - When Context Aggregator finishes summarizing, it serializes ContextDocument DTOs into the run directory and notifies the CLI Orchestrator via a callback message recorded in logs.ndjson.
        - Research Coordinator listens for unknowns flagged by Context Aggregator or the prompt/spec ingestion stage and schedules ResearchTasks accordingly.
        - Each ResearchTask transitions through pending → assigned → complete using asynchronous interactions with Agent Adapter or human operators, yet the CLI Orchestrator polls the queue synchronously to update statuses.
        - Agent Adapter interactions are synchronous when using local providers (function calls) but may be asynchronous when hitting remote HTTP endpoints; the CLI abstracts both behind Promise-based APIs.
        - Observability Hub remains event-driven, ingesting log entries and metrics from every component through asynchronous channels that append to logs.ndjson and metrics/prometheus.txt.
        - Security & Credential Vault communicates synchronously with each adapter before API calls to confirm tokens are available and unexpired.
        - When tokens need rotation, the vault emits a human-action-required event recorded in logs.ndjson, and the CLI halts relevant ExecutionTasks until credentials are refreshed.
        - PRD Authoring Engine receives synchronous requests from CLI Orchestrator once context and research artifacts are ready; it may call Agent Adapters asynchronously to fetch drafts, but returns only after mapping traceability sections.
        - Human-in-the-loop approvals insert communication steps where CLI Orchestrator writes approval requests to approvals.json and optionally notifies external channels via NotificationEvent DTOs.
        - Specification Composer reads PRD outputs and ResearchTask results synchronously, ensuring the spec reflects latest knowledge, then publishes spec.md to run directory in a single transactional write.
        - Task Planner consumes spec.md and context to build ExecutionTasks, storing them in plan.json and queue.ndjson, effectively representing a DAG accessible to Execution Engine.
        - Execution Engine reads ExecutionTasks from queue.ndjson sequentially but may spawn asynchronous worker fibers when tasks are independent, respecting concurrency limits defined in RepoConfig runtime.
        - Each ExecutionTask communicates with GitHub Adapter synchronous when reading status or writing branches, but Execution Engine wraps them in retry loops that follow asynchronous backoff timers.
        - GitHub Adapter interacts with HTTP layer synchronously; once a call completes, the adapter translates GitHub payloads into domain DTOs consumed by orchestration modules.
        - Linear Adapter follows a similar pattern, but because Linear rate limits are lower, the adapter introduces a throttled queue ensuring no more than configured requests per window are executed.
        - Agent Adapter sessions maintain conversation context; CLI orchestrator tags each call with run_id, enabling asynchronous completions to be correlated with the correct feature.
        - Validation Command Registry stores configured commands; Execution Engine interacts synchronously when running lint or tests, capturing stdout/stderr and streaming them to Observability Hub.
        - When validations fail, Execution Engine records failure_response entries and notifies Resume Coordinator so the CLI can present actionable remediation instructions.
        - Resume Coordinator maintains a state machine referencing last_step and last_error; when codepipe resume is invoked, it consults plan.json and queue files to determine the next action synchronously.
        - Deployment Trigger Module only activates after ExecutionTasks and validations succeed; it communicates with GitHub Adapter to inspect branch protection rules and required status checks.
        - If required checks are pending, Deployment Trigger Module enters a wait loop with asynchronous polling intervals, each interval recorded to logs.ndjson to preserve determinism.
        - Observability Hub aggregates these polling events and surfaces them through metrics so operators can see how long merges or deployments remain blocked.
        - Artifact Bundle Service interacts synchronously with Run Directory Manager to gather file lists and compute hashes, but it streams results to export manifests asynchronously to keep CLI responsive.
        - NotificationEvent entries may be dispatched via optional integrations (CodeMachine, Graphite, Slack), but they originate from CLI Orchestrator once significant state transitions occur.
        - CLI Orchestrator ensures no component bypasses the artifact layer; even ephemeral data such as prompt completions are persisted as files before being handed to downstream modules.
        - Error taxonomy enforcement occurs through synchronous callbacks: when HTTP layer raises a TransientError, the receiving component decides whether to retry or escalate to Resume Coordinator.
        - RateLimitEnvelope updates happen after every HTTP call and are broadcast to interested components, ensuring future tasks consider cooldown requirements.
        - The CLI uses file-based locking to serialize write access to key files (feature.json, plan.json, approvals.json), preventing race conditions between asynchronous worker fibers.
        - Execution Engine uses git apply and git status commands synchronously, but logs outputs asynchronously to Observability Hub for streaming feedback.
        - When Execution Engine is about to apply a patch, it asks Security & Credential Vault for path allowlist/denylist enforcement, ensuring policy is centralized.
        - Branch creation uses synchronous calls to GitHub Adapter, while local git branch creation is immediate; the CLI tracks both local and remote states to ensure alignment.
        - When remote PR creation is requested, CLI orchestrator orchestrates sequential steps: create branch, push branch, create PR, request reviewers, each confirmed before the next begins.
        - Reviewer assignment uses GitHub Adapter, and the CLI logs each reviewer_set_event to approvals.json as part of the human-in-the-loop enforcement.
        - Auto-merge enablement occurs conditionally; Deployment Trigger Module checks RepoConfig safety flags before sending a request to GitHub, ensuring explicit operator consent.
        - If auto-merge is disabled, CLI orchestrator tracks merge readiness through asynchronous polling loops, ensuring merges are attempted only when all blockers clear.
        - When merges fail due to stale status checks, Deployment Trigger Module records the failing contexts and surfaces them through CLI summaries for manual action.
        - After merge or deployment, Artifact Bundle Service is notified to capture the final PR result, merge SHA, and deployment logs for audit completeness.
        - CLI orchestrator then updates feature.json status to done or deployed, writing telemetry and final timestamps, and clearing any pending tasks from queue.
        - Observability Hub issues final metrics snapshots, capturing total runtime, API call counts, and retry behavior for the feature run.
        - Execution Engine may interface with third-party agent services for code generation; these interactions remain asynchronous but are tracked as ExecutionTasks of type code_generation.
        - When Execution Engine receives patches from Agent Adapter, it verifies them via git apply --check and only writes to disk upon success, ensuring deterministic patch application.
        - Validation Command Registry ensures test suites run under configured environment variables, communicating with Execution Engine to supply ephemeral credentials or context as needed.
        - Observability hub collects exit codes and durations for each validation command, storing them as structured metrics for later review.
        - Resume Coordinator responds to CLI resume requests by scanning logs.ndjson for the last successful stage and verifying artifact hashes before resuming operations.
        - If artifacts changed unexpectedly, Resume Coordinator triggers a human-action-required event, preventing the pipeline from continuing until inconsistencies are resolved.
        - CLI orchestrator communicates with Artifact Bundle Service via message passing to request on-demand exports, enabling operators to inspect intermediate states.
        - When watchers detect new commits on default branch, they notify context aggregator to refresh relevant summaries through asynchronous tasks, keeping the run context current.
        - NotificationEvent system ensures key transitions (PR created, reviewers requested, merge completed) send messages via configured adapters, yet each message is deduplicated using run_id + event_type keys.
        - Observability hub tags all logs with component_id, run_id, and step_id, enabling real-time filtering even though logs are stored locally.
        - CLI orchestrator ensures each command returns meaningful exit codes; for example, hitting a rate limit returns exit 20 (external API), while missing approvals returns exit 30 (human action required).
        - Execution Engine interacts with Validation Command Registry to interpret exit codes; non-zero codes trigger immediate failure events recorded for resume diagnostics.
        - When tasks depend on each other, Execution Engine uses plan.json adjacency lists to enforce ordering, while asynchronous tasks may run concurrently if dependencies are satisfied.
        - Task Planner annotates each ExecutionTask with assigned_agent or assigned_module, enabling dynamic routing to either human, CLI automation, or external agents.
        - Agent Adapter provides streaming responses for code generation when supported; Execution Engine consumes these streams line-by-line, writing partial files to temporary paths before finalization.
        - Security & Credential Vault controls flow of secrets into Validation Command Registry by injecting environment variables through ephemeral wrappers, preventing secrets from being stored on disk.
        - Observability hub monitors secret usage logs, ensuring the redaction filter has replaced sensitive strings before logs are flushed.
        - CLI orchestrator ensures run directories include trace.json mapping PRD goals to spec requirements and ExecutionTasks; this mapping is updated each time tasks are added or completed.
        - Context Aggregator communicates these traces to Agent Adapter so prompt context stays bounded and traceable.
        - Research Coordinator uses asynchronous loops to refresh ResearchTasks marked freshness_required=high, ensuring stale references are replaced before spec or code generation occurs.
        - CLI orchestrator enforces that ResearchTask results referencing URLs record retrieval metadata, enabling Observability hub to present provenance details to operators.
        - When GitHub returns validations (status checks) still running, Deployment Trigger Module waits with jittered intervals rather than hammering GET endpoints rapidly.
        - Merge attempts are serialized; even if multiple ExecutionTasks request merge, only Deployment Trigger Module is allowed to interact with GitHub merge endpoints, preventing conflicts.
        - After a merge completes, CLI orchestrator instructs watchers to pause for a short period while GitHub finalizes branch updates, ensuring subsequent deployments read the latest commit.
        - For features that skip deployment, Deployment Trigger Module still writes DeploymentRecord with outcome skipped and reasoning, maintaining consistent artifacts.
        - CLI orchestrator maintains concurrency budgets for remote API calls, so GitHub Adapter may queue operations internally when concurrency would exceed configured values.
        - Observability hub surfaces concurrency status in metrics/prometheus.txt, letting operators see pending_count or running_count per adapter.
        - Execution Engine uses asynchronous watchers to monitor git working tree state, ensuring no untracked files remain before validations run.
        - CLI orchestrator ensures that when codepipe status is invoked, it reads current states from feature.json, plan.json, and ExecutionTask files synchronously, presenting a cohesive snapshot.
        - Export command interacts with Artifact Bundle Service; once the export is ready, CLI prints manifest path while Observability hub records the action for audit.
        - Resume operations rely heavily on the queue file; each queue entry includes attempt_count and status, enabling CLI to re-run failed tasks or skip completed ones.
        - Notification events triggered by errors carry severity_level fields, and optional integrations decide how to display them (e.g., Slack warns vs email info).
        - CLI orchestrator interacts with Validation Command Registry via typed functions, but all command outputs go through Observability hub for redaction before being persisted.
        - When Execution Engine requires manual edits, CLI stops automatic tasks and instructs operators to modify files directly, then record the action in approvals.json before resuming.
        - Branch protection awareness relies on synchronous GitHub Adapter calls to fetch required status checks per branch, ensuring merges respect repository policy.
        - CLI orchestrator caches branch protection metadata but invalidates it whenever a new commit is pushed or GitHub indicates configuration changes.
        - Deployment Trigger Module coordinates with Observability hub to emit human-friendly summaries about blocked merges, referencing required check names and states.
        - When auto-merge is enabled, the module posts a request to GitHub and then ceases manual merge polling, but still monitors status updates asynchronously to inform operators.
        - Execution Engine ensures patch application occurs inside file locking boundaries to avoid partial writes when multiple tasks target the same files.
        - If patch conflicts occur, Execution Engine logs conflict details, marks the task as human-action-required, and pauses the queue until manual resolution occurs.
        - CLI orchestrator surfaces these conflicts via status command and ensures Resume Coordinator expects a manual acknowledgement before continuing.
        - Observability hub stores conflict_info objects with file paths and hunk contexts for easier debugging.
        - When optional watchers are run via codepipe observe, they read multiple features' directories sequentially, ensuring no cross-run data leakage occurs.
        - Watchers schedule asynchronous refresh tasks for features waiting on merges, enabling notifications when GitHub branch protections finally allow merges.
        - CLI orchestrator ensures watchers respect concurrency constraints by using file-based locks to avoid simultaneous manipulations of the same run directory.
        - Artifact Bundle Service hooks into watchers so exported bundles remain up-to-date if merges or deployments finish while watchers are active.
        - NotificationEvent system is optional; when disabled, CLI still records the would-be message in logs for audit without hitting external services.
        - Validation Command Registry supports command templating; Execution Engine renders templates with environment variables from RepoConfig or run-specific data before execution.
        - CLI orchestrator wires metrics from Observability hub to optional remote collectors by writing to file-based exporters, staying within local-first constraints.
        - Run Directory Manager includes cleanup hooks invoked by codepipe cleanup; this command communicates with Observability hub to ensure logs for archived runs remain accessible before deletion.
        - Security & Credential Vault stores metadata in integration_credentials.json, and CLI components read this file synchronously before making API requests.
        - When new credentials are added, the vault notifies Observability hub so audit logs record who made the change and when it takes effect.
        - CLI orchestrator uses dependency injection to give modules access to only the services they need, enforcing separation of concerns and simplifying testing.
        - Testing harnesses simulate communication patterns via recorded HTTP fixtures and stubbed modules, ensuring Behavior Architect expectations hold even in CI.
        - Execution Engine logs command outputs incrementally while still marking each ExecutionTask complete only after verifying exit code, ensuring deterministic updates.
        - When Execution Engine writes logs, Observability hub simultaneously updates metrics to show success/failure counts for each command type.
        - CLI orchestrator ensures context_path scanning honors RepoConfig constraints.must_not_touch_paths by skipping restricted directories and logging the skip event.
        - Research Coordinator may interface with external knowledge bases; such calls go through HTTP layer and follow the same rate-limit aware patterns.
        - Agent Adapter handles streaming completions by writing partial responses to temporary files; once final chunk arrives, Execution Engine is notified via asynchronous event.
        - CLI orchestrator ensures plan.json is revalidated whenever spec.md changes, preventing outdated ExecutionTask definitions from driving code generation.
        - Observability hub ensures metrics/time-series align with plan.json states by emitting events when tasks start, complete, or fail.
        - Resume Coordinator reads these events to avoid re-running tasks that already succeeded before a crash.
        - CLI orchestrator enforces gating transitions by preventing Task Planner invocation until PRD approval is recorded in approvals.json.
        - Similarly, Execution Engine remains locked until spec approval is obtained, ensuring no code is generated without consensus.
        - Deployment Trigger Module requires approvals for code-to-PR and PR-to-deploy transitions, reading from approvals.json each time to confirm.
        - Observability hub logs the identity (user or agent) who granted approval, fulfilling audit requirements.
        - When Resumability requires manual cleanup, CLI orchestrator writes instructions to last_error field within feature.json, describing pending action items for operators.
        - Resume Coordinator reads last_error messages to display them during codepipe status or resume, ensuring human operators understand next steps.
        - Execution Engine enforces patch-level allowlists defined in RepoConfig constraints.must_touch_paths by verifying the diff touches expected directories before committing.
        - CLI orchestrator ensures git commits reference ExecutionTask IDs in their messages, enabling traceability between code changes and plan.json entries.
        - GitHub Adapter surfaces commit SHAs back to Execution Engine so plan.json can record code artifacts for each task.
        - Observability hub writes commit_shas into logs, enabling watchers and exporters to find relevant commits later.
        - Artifact Bundle Service pulls commit metadata when building diff summaries, ensuring exported bundles contain both code context and ExecutionTask references.
        - Resume Coordinator ensures that if plan.json is manually edited, its hash is updated; otherwise, CLI refuses to run until the user acknowledges the change.
        - Validation Command Registry supports dry-run previews where Execution Engine prints commands without executing them, giving operators chance to confirm.
        - Observability hub tracks whether commands ran in dry-run mode or actual execution for audit clarity.
        - CLI orchestrator handles concurrency for agent interactions by limiting simultaneous prompts to avoid overrunning provider rate limits or compute budgets.
        - Agent Adapter returns metadata such as token usage and completion reasons, which Observability hub aggregates for cost tracking.
        - When agent responses include code diff suggestions, Execution Engine translates them into patch files and enforces allowlists before applying.
        - CLI orchestrator ensures spec.md references tasks via anchors; Task Planner cross-links these anchors when creating ExecutionTasks.
        - Observability hub uses these anchors to display traceability in CLI status output, fulfilling foundation traceability requirements.
        - When watchers detect new issues in Linear tied to the run, they notify Research Coordinator to refresh context_data, ensuring pipeline decisions stay aligned with tickets.
        - Linear Adapter also updates issues with pipeline state via comment or status updates, following configuration and rate-limit constraints.
        - Deployment Trigger Module optionally posts PR comments summarizing merge readiness; these writes go through WriteActionQueue to obey IR-7.
        - WriteActionQueue serializes actions like PR comments, reviewer requests, and label changes, preventing GitHub from flagging abuse patterns.
        - Observability hub monitors WriteActionQueue backlog and alerts operators if writes accumulate due to rate limiting.
        - CLI orchestrator persists WriteActionQueue state to disk, enabling resume to continue draining it even after crashes.
        - Execution Engine interacts with WriteActionQueue when code generation requires raising PR comments (e.g., manual follow-ups).
        - When watchers operate via cron, they log start/end times and active features, ensuring auditability even for automated monitoring.
        - CLI orchestrator's dependency injection ensures components like Agent Adapter can be replaced with mocks or alternative providers without altering other modules.
        - Observability hub merges logs from all components chronologically, even though they emit events asynchronously, thanks to monotonic timestamps.
        - Artifact Bundle Service includes HTTP transcripts for major interactions, providing replicable evidence for approvals or external audits.
        - CLI orchestrator enforces consistent error codes when commands exit; these codes propagate to calling shells or CI pipelines for automated decision-making.
        - Execution Engine may run on remote agent compute nodes in future versions, but the Behavior Architect ensures the communication contract remains file and REST-based for determinism.
        - Observability hub integrates with optional OpenTelemetry exporters; when configured, it batches spans asynchronously while ensuring local traces.json stays authoritative.
        - RateLimitEnvelope updates feed Observability metrics, enabling dashboards showing how close each provider is to exhaustion.
        - CLI orchestrator surfaces these metrics during status commands, converting them into human-readable statements (e.g., "GitHub remaining: 120/5000 until 14:05 UTC").
        - Resume Coordinator uses RateLimitEnvelope cooldown_end_at to determine whether to pause automatically rather than hammering APIs.
        - Execution Engine uses concurrency_count from runtime config to decide how many tasks to run in parallel, adjusting when rate limits tighten.
        - CLI orchestrator ensures watchers respect the same concurrency_count so background monitoring never starves foreground operations.
        - Observability hub logs concurrency adjustments as info-level entries for transparency.
        - Artifact Bundle Service includes concurrency settings in manifest metadata, capturing the runtime environment used for reproduction.
        - NotificationEvent system ensures severity_high events trigger synchronous CLI output plus optional asynchronous notifications to Slack or email.
        - CLI orchestrator ensures severity_low events remain only in logs to avoid notification fatigue.
        - Execution Engine handles CLI interrupts (Ctrl+C) gracefully by signaling current tasks to stop, completing file writes, and setting last_step accordingly.
        - Resume Coordinator interprets these interrupts as transient and encourages operators to rerun resume without manual cleanup.
        - Observability hub records the interrupt event with stack traces for debugging.
        - CLI orchestrator ensures tasks referencing external storage (optional SQLite index) always flush transactions before acknowledging completion.
        - When GitHub or Linear respond with schema changes, HTTP layer surfaces them as validation errors; CLI orchestrator escalates to governance notes per foundation directives.
        - Operators can record these escalations using codepipe governance add, which writes to RepoConfig governance_notes and notifies relevant components.
        - Observability hub catalogs governance events separately for easier reporting.
        - CLI orchestrator ensures codepipe status includes a summary of outstanding governance questions, aligning ops with architecture directives.
        - Execution Engine respects must_not_touch_paths by scanning diffs before committing; any violation results in immediate failure and log entry referencing the offending path.
        - CLI orchestrator enforces that plan.json includes must_touch_paths when specified, ensuring ExecutionTasks target required directories.
        - Observability hub monitors compliance metrics (percentage of required paths touched) and surfaces them in status output.
        - Artifact Bundle Service includes compliance summary files referencing constraints results for future audits.
        - Resume Coordinator ensures that once compliance fails, pipeline cannot resume until operators adjust code or constraints accordingly.
        - Execution Engine interacts with Task Planner whenever manual edits change spec.md, prompting the planner to regenerate tasks while preserving existing statuses when possible.
        - CLI orchestrator ensures spec regeneration increments spec version numbers recorded in feature.json, keeping traceability intact.
        - Observability hub logs spec version transitions and ties them to approvals.
        - Agent Adapter stores conversation transcripts per spec version to avoid mixing contexts when requirements change mid-run.
        - CLI orchestrator enforces that ExecutionTasks referencing outdated spec versions get invalidated, requiring regeneration before code continues.
        - Resume Coordinator recognizes invalidated tasks and prevents them from running until Task Planner reissues replacements.
        - Observability hub surfaces invalidation counts so operators understand why tasks may have disappeared or been re-queued.
        - Execution Engine uses hashed snapshots of files before patching, enabling quick rollback if a patch fails validation or human review.
        - CLI orchestrator stores these snapshots under run/artifacts/backups for deterministic comparisons.
        - Observability hub records when snapshots are taken and restored, ensuring timeline clarity.
        - Deployment Trigger Module interacts with GitHub workflow dispatch endpoints only after verifying repo automation is configured, preventing spurious failures.
        - NotificationEvent system alerts operators when deployments start and finish, referencing workflow IDs and GitHub URLs.
        - Observability hub records workflow_run statuses, linking them to DeploymentRecord entries for future tracing.
        - CLI orchestrator ensures codepipe deploy commands fail fast if repo disallows direct merges, prompting operators to adjust configuration or approvals.
        - Execution Engine may call optional agent endpoints to propose deployment notes; these interactions follow the same DTO pattern as PRD/spec generation.
        - Artifact Bundle Service packages deployment notes alongside PR summaries to keep audit artifacts comprehensive.
        - Resume Coordinator ensures that if deployment fails mid-way, pipeline state returns to review status and logs reasons for manual follow-up.
        - Observability hub tags deployment failures with severity_high, ensuring they appear prominently in CLI status and exports.
        - CLI orchestrator ensures watchers notify NotificationEvent channels once deployment completes successfully, providing closure to stakeholders.
        - Execution Engine integrates with GitHub Adapter to fetch diff stats per PR, enabling more informative CLI summaries and exports.
        - Artifact Bundle Service consumes these diff stats when generating diff summaries for audit bundles.
        - Resume Coordinator uses diff stats to double-check that expected files were touched according to spec constraints.
        - Observability hub logs these cross-checks to confirm constraint compliance has been validated automatically.
        - CLI orchestrator ensures queue.ndjson entries include creation timestamps; Resume Coordinator uses them to compute queue latency metrics.
        - Observability hub consumes these timestamps to output queue_age_seconds gauges for monitoring stagnation.
        - Execution Engine ensures tasks older than configured threshold raise alerts, prompting human review before work grows stale.
        - NotificationEvent system may send reminders when tasks linger, referencing specific ExecutionTask IDs and spec sections.
        - CLI orchestrator ensures watchers respect these reminder intervals, preventing repeated notifications after the operator acknowledges the issue.
        - Observability hub records acknowledgement events, maintaining a full audit trail of follow-ups.
    *   **Key Interaction Flow (Sequence Diagram):**
        *   **Description:** This diagram walks through the prompt-triggered journey from CLI invocation to deployment and export, highlighting gating approvals, adapter calls, resumability hooks, and rate-limit aware pauses demanded by the blueprint.
        *   **Diagram (PlantUML):**
            ~~~plantuml
            @startuml
            title Prompt-to-Deploy Run Communication Flow
            actor Operator as Operator
            participant "CLI Orchestrator" as CLI
            participant "RepoConfig Manager" as RCM
            participant "Run Directory Manager" as RDM
            participant "Security & Credential Vault" as Vault
            participant "Context Aggregator" as Ctx
            participant "Research Coordinator" as Research
            participant "Agent Adapter Layer" as Agent
            participant "PRD Authoring Engine" as PRD
            participant "Specification Composer" as Spec
            participant "Task Planner" as Planner
            participant "Execution Engine" as Exec
            participant "Validation Command Registry" as ValReg
            participant "GitHub Adapter" as GH
            participant "Linear Adapter" as Linear
            participant "Observability Hub" as Obs
            participant "Deployment Trigger Module" as Deploy
            participant "Artifact Bundle Service" as Bundle
            participant "Resume Coordinator" as Resume
            ' Initialization phase ensures config + credentials are ready
            Operator -> CLI: codepipe start --prompt "<intent>"
            CLI -> Obs: log(command_received, run_hint)
            CLI -> RCM: loadOrInitConfig()
            RCM --> CLI: RepoConfig snapshot
            CLI -> Obs: log(config_loaded, repo_url)
            CLI -> RDM: createRunDirectory(RepoConfig)
            RDM --> CLI: RunDirectoryDescriptor
            CLI -> Obs: log(run_directory_created, feature_id)
            CLI -> Vault: verifyCredentials(GitHub, Linear, Agent)
            Vault --> CLI: credentialStatus{scopes,expires_at}
            CLI -> Obs: log(credentials_validated)
            CLI -> Linear: fetchIssueSnapshot(if source==issue)
            Linear --> CLI: IssueSnapshot(optional)
            CLI -> RDM: persistSnapshot(issuePayload)
            RDM --> CLI: snapshotPath
            CLI -> Obs: log(snapshot_recorded)
            CLI -> Resume: resetLastStep("context_gathering")
            Resume --> CLI: acknowledgment
            ' Context gathering orchestrates asynchronous summarization
            CLI -> Ctx: gatherContext(repoPaths, historyWindow)
            Ctx -> Obs: log(context_start)
            Ctx -> GH: readDefaultBranchMeta()
            GH --> Ctx: branchMetadata
            Ctx -> Obs: log(branch_detected, metadata)
            Ctx -> GH: fetchRecentCommits(paths)
            GH --> Ctx: commitSummaries
            Ctx -> RDM: storeContextDocs(commitSummaries)
            RDM --> Ctx: contextPaths
            Ctx -> Obs: log(commit_context_stored)
            Ctx -> CLI: notifyContext("summariesReady")
            CLI -> Obs: log(context_module_complete)
            CLI -> Resume: updateLastStep("research")
            Resume --> CLI: acknowledgment
            ' Research coordination handles unknowns and rate limits
            CLI -> Research: analyzeUnknowns(ContextDocs, prompt)
            Research -> Obs: log(research_analysis_started)
            Research -> Linear: fetchAdditionalIssueData if configured
            Linear --> Research: additionalIssueFields
            Research -> Agent: proposeResearchTasks(payload)
            Agent --> Research: ResearchTaskList
            Research -> RDM: persistResearchTasks(list)
            RDM --> Research: researchPaths
            Research -> Obs: log(research_tasks_created)
            loop research_execution
            Research -> Agent: executeResearchTask(taskId)
            Agent --> Research: taskResult
            Research -> RDM: appendResearchResult(taskResult)
            RDM --> Research: resultPath
            Research -> Obs: log(research_task_completed, taskId)
            end
            Research -> CLI: researchCompleteNotification
            CLI -> Obs: log(research_phase_done)
            CLI -> Resume: updateLastStep("prd_authoring")
            Resume --> CLI: acknowledgment
            ' PRD authoring uses agent assistance with approvals
            CLI -> PRD: draftPRD(prompt, ContextDocs, ResearchResults)
            PRD -> Agent: requestPRDDraft(traceabilityTargets)
            Agent --> PRD: PRDDraft
            PRD -> Obs: log(prd_draft_received)
            PRD -> RDM: writeFile("prd.md", PRDDraft)
            RDM --> PRD: pathConfirmation
            PRD -> CLI: prdDraftReady
            CLI -> Obs: log(prd_ready_for_review)
            CLI -> Operator: requestApproval("PRD draft ready")
            Operator --> CLI: approvalGranted
            CLI -> RDM: recordApproval("PRD", operatorSignature)
            RDM --> CLI: approvalPath
            CLI -> Obs: log(approval_recorded, stage="PRD")
            CLI -> Resume: updateLastStep("spec_authoring")
            Resume --> CLI: acknowledgment
            ' Specification composer builds constraints + plans
            CLI -> Spec: composeSpec(prdPath, researchPaths)
            Spec -> Agent: refineSpecWithConstraints(prdContent)
            Agent --> Spec: SpecProposal
            Spec -> Obs: log(spec_proposal_received)
            Spec -> RDM: writeFile("spec.md", SpecProposal)
            RDM --> Spec: pathConfirmation
            Spec -> CLI: specReadyForApproval
            CLI -> Obs: log(spec_ready_for_review)
            CLI -> Operator: requestApproval("Spec ready with constraints")
            Operator --> CLI: approvalGranted
            CLI -> RDM: recordApproval("Spec", operatorSignature)
            RDM --> CLI: approvalPath
            CLI -> Obs: log(approval_recorded, stage="Spec")
            CLI -> Resume: updateLastStep("planning")
            Resume --> CLI: acknowledgment
            ' Task planner builds ExecutionTask DAG
            CLI -> Planner: buildPlan(specPath, contextManifest)
            Planner -> Obs: log(plan_generation_started)
            Planner -> RDM: loadSpecAndConstraints()
            RDM --> Planner: specContent, constraints
            Planner -> Agent: proposeTasks(specSections)
            Agent --> Planner: ExecutionTaskDrafts
            Planner -> RDM: writePlan(planJson)
            RDM --> Planner: planPath
            Planner -> Obs: log(plan_written)
            Planner -> CLI: planReadyNotification
            CLI -> Obs: log(plan_ready)
            CLI -> Resume: updateLastStep("execution")
            Resume --> CLI: acknowledgment
            ' Execution engine consumes tasks respecting gating
            loop execution_cycle
            CLI -> Exec: dequeueNextTask(planPath)
            Exec -> Obs: log(task_started, taskId)
            Exec -> Agent: requestPatch(taskDetails)
            Agent --> Exec: patchProposal
            Exec -> RDM: storePatchDraft(taskId, patchProposal)
            RDM --> Exec: patchPath
            Exec -> Obs: log(patch_stored)
            Exec -> ValReg: fetchValidationCommands(taskType)
            ValReg --> Exec: validationList
            Exec -> GH: ensureBranchExists(featureBranch)
            GH --> Exec: branchStatus
            Exec -> GH: pushBranchChanges(patch)
            GH --> Exec: pushConfirmation
            Exec -> Obs: log(branch_pushed, sha)
            Exec -> ValReg: executeCommand("lint", env)
            ValReg --> Exec: commandResult(lintStatus)
            Exec -> Obs: log(lint_result, status)
            Exec -> ValReg: executeCommand("test", env)
            ValReg --> Exec: commandResult(testStatus)
            Exec -> Obs: log(test_result, status)
            alt validation_failed
            Exec -> CLI: reportFailure(taskId, reason)
            CLI -> Resume: setLastError(taskId, reason)
            Resume --> CLI: acknowledgment
            CLI -> Obs: log(task_failed, reason)
            break
            else validation_passed
            Exec -> CLI: reportSuccess(taskId, sha)
            CLI -> Obs: log(task_completed, taskId)
            end
            end
            CLI -> Resume: updateLastStep("execution_progress")
            Resume --> CLI: acknowledgment
            ' PR creation gating occurs after validations succeed
            CLI -> Operator: requestApproval("Create PR and request reviewers")
            Operator --> CLI: approvalGranted
            CLI -> RDM: recordApproval("CodeToPR", signature)
            RDM --> CLI: approvalPath
            CLI -> GH: createPullRequest(base, head, title, body)
            GH --> CLI: pullRequest
            CLI -> Obs: log(pr_created, number)
            CLI -> GH: requestReviewers(prNumber, reviewerList)
            GH --> CLI: reviewerAcknowledgment
            CLI -> Obs: log(reviewers_requested)
            CLI -> Resume: updateLastStep("pr_ready")
            Resume --> CLI: acknowledgment
            CLI -> Deploy: notifyNewPR(prNumber, sha)
            Deploy -> Obs: log(deploy_module_notified)
            ' Deployment trigger monitors status checks and merges
            loop status_check_poll
            Deploy -> GH: fetchRequiredStatusChecks(prNumber)
            GH --> Deploy: requiredChecks
            Deploy -> Obs: log(status_checks_snapshot)
            Deploy -> GH: fetchCheckRuns(sha)
            GH --> Deploy: checkRunStatuses
            Deploy -> Obs: log(checkrun_state, details)
            alt checks_blocked
            Deploy -> CLI: reportBlocked(prNumber, failingContext)
            CLI -> Obs: log(merge_blocked_notification)
            CLI -> Operator: informBlockedChecks(failingContext)
            else checks_ready
            Deploy -> CLI: mergeReady(prNumber)
            CLI -> Operator: requestApproval("Merge and deploy")
            Operator --> CLI: approvalGranted
            CLI -> RDM: recordApproval("PRToDeploy", signature)
            RDM --> CLI: approvalPath
            CLI -> Deploy: proceedMerge(prNumber)
            Deploy -> GH: mergePullRequest(prNumber)
            GH --> Deploy: mergeResult
            Deploy -> Obs: log(merge_attempt_result)
            Deploy -> GH: triggerWorkflowDispatch(workflowId, inputs)
            GH --> Deploy: workflowAccepted
            Deploy -> Obs: log(workflow_started)
            end
            end
            Deploy -> CLI: deploymentStatus(workflowUrl, outcome)
            CLI -> Obs: log(deployment_status_reported)
            CLI -> RDM: writeDeploymentRecord(outcomeData)
            RDM --> CLI: deploymentRecordPath
            ' Artifact bundle creation consolidates run outputs
            CLI -> Bundle: assembleBundle(runDirectory)
            Bundle -> Obs: log(bundle_generation_started)
            Bundle -> RDM: enumerateArtifacts(featureId)
            RDM --> Bundle: artifactList
            Bundle -> GH: fetchPRDiffSummary(prNumber)
            GH --> Bundle: diffStats
            Bundle -> Obs: log(diff_stats_collected)
            Bundle -> Ctx: fetchContextManifest()
            Ctx --> Bundle: contextManifest
            Bundle -> Research: fetchResearchDigest()
            Research --> Bundle: researchDigest
            Bundle -> RDM: writeBundleManifest(manifest)
            RDM --> Bundle: bundlePath
            Bundle -> CLI: bundleReady(bundlePath)
            CLI -> Obs: log(bundle_ready)
            CLI -> Operator: provideBundlePath(bundlePath)
            Operator --> CLI: acknowledgeReceipt
            ' Rate limit handling ensures safe retries
            CLI -> GH: checkRateLimitStatus()
            GH --> CLI: rateLimitHeaders
            CLI -> Obs: log(rate_limit_snapshot)
            alt primary_limit_exhausted
            CLI -> Resume: setCooldown(provider="GitHub", resetAt)
            Resume --> CLI: cooldownRecorded
            CLI -> Obs: log(cooldown_applied)
            else secondary_limit_hit
            CLI -> Resume: recordRetryAfter(provider="GitHub", seconds)
            Resume --> CLI: retryAfterRecorded
            CLI -> Obs: log(retry_after_respected)
            end
            CLI -> Linear: checkRateLimitStatus()
            Linear --> CLI: rateLimitHeaders
            CLI -> Obs: log(linear_rate_limit_snapshot)
            alt linear_limit_warning
            CLI -> Research: throttleRequests(window)
            Research --> CLI: throttleAcknowledged
            CLI -> Obs: log(linear_throttling_enabled)
            end
            ' Resume command picks up after failure
            Operator -> CLI: codepipe resume <feature_id>
            CLI -> Obs: log(resume_requested)
            CLI -> Resume: inspectState(runDirectory)
            Resume --> CLI: resumePlan(lastStep, pendingTasks)
            CLI -> RDM: verifyArtifactsHashes(resumePlan)
            RDM --> CLI: hashVerificationResult
            alt hashes_valid
            CLI -> Obs: log(hashes_validated)
            CLI -> Resume: markStepInProgress(lastStep)
            Resume --> CLI: acknowledgment
            alt lastStep==execution
            CLI -> Exec: resumePendingTasks(resumePlan)
            Exec --> CLI: resumeAck
            else lastStep==deployment
            CLI -> Deploy: resumeDeploymentMonitoring(resumePlan)
            Deploy --> CLI: resumeAck
            else lastStep==export
            CLI -> Bundle: resumeExport(resumePlan)
            Bundle --> CLI: resumeAck
            end
            else hash_mismatch
            CLI -> Operator: requestManualIntervention("Artifacts changed")
            Operator --> CLI: acknowledgement
            CLI -> Obs: log(resume_blocked_due_to_hash_mismatch)
            end
            ' Observability hub collects logs and metrics continuously
            loop logging_cycle
            Exec -> Obs: emitLog("info","task_progress",taskId)
            Obs --> Exec: logStored
            Deploy -> Obs: emitLog("info","status_poll",prNumber)
            Obs --> Deploy: logStored
            Ctx -> Obs: emitLog("debug","summarization_chunk",path)
            Obs --> Ctx: logStored
            end
            loop metrics_cycle
            ValReg -> Obs: emitMetric("validation_duration",duration)
            Obs --> ValReg: metricStored
            GH -> Obs: emitMetric("api_calls",1)
            Obs --> GH: metricStored
            end
            loop tracing_cycle
            Agent -> Obs: emitTrace("agent_call",traceId)
            Obs --> Agent: traceStored
            end
            ' Finalization updates feature status and exports audit data
            CLI -> RDM: updateFeatureStatus("deployed")
            RDM --> CLI: statusWriteAck
            CLI -> Obs: log(feature_status_updated)
            CLI -> Bundle: confirmBundleIntegrity()
            Bundle --> CLI: integrityOk
            CLI -> Operator: displaySummary(status, nextSteps)
            Operator --> CLI: acknowledgement
            CLI -> Obs: log(run_complete)
            ' Optional watcher monitors merged PRs for documentation
            loop watcher_cycle
            CLI -> GH: fetchMergedPRsSince(lastCheck)
            GH --> CLI: mergedList
            CLI -> Bundle: generatePostMergeDoc(mergedList)
            Bundle --> CLI: docPaths
            CLI -> Obs: log(watcher_generated_docs)
            end
            ' Agent provider fallback ensures resiliency
            alt primary_agent_available
            Agent -> CLI: capabilityReport(primary=true)
            CLI -> Obs: log(agent_primary_active)
            else fallback_agent
            CLI -> Agent: switchProvider("local-model")
            Agent --> CLI: capabilityReport(primary=false)
            CLI -> Obs: log(agent_fallback_enabled)
            end
            note over CLI,Agent: Capability manifests describe context window and tool usage so orchestration picks the correct prompting strategy.
            @enduml
            ~~~
    *   **Data Transfer Objects (DTOs):** The DTO catalog below highlights how Feature, RepoConfig, ExecutionTask, and DeploymentRecord data models manifest within the REST endpoints described earlier.
        - FeatureCreateRequest (used by POST /runs) encapsulates the operator's intent and repository context.
        - Field runId: ULID generated client-side, allowing idempotent retries.
        - Field source: enum prompt | issue | spec mirroring Feature schema.
        - Field prompt: markdown string when source=prompt.
        - Field issueReference: { provider: "linear"|"github", id: string } optional when linking tickets.
        - Field specPath: absolute or relative path when source=spec.
        - Field repo: { repo_url, default_branch?, provider } aligning with Feature.repo requirements.
        - Field constraints: carries must_touch_paths and must_not_touch_paths arrays for gating early.
        - Field agents: array of capability references specifying which Agent Adapter profile to use for PRD/spec/code phases.
        - Field approvals: optional array referencing pre-approved gates for automation-heavy environments.
        - FeatureCreateResponse returns { featureId, runDirectory, initialState, repoSummary } for CLI or remote clients.
        - runDirectory is a deterministic path inside .codepipe/<featureId>/ enabling offline navigation.
        - initialState includes last_step="context_gathering", last_error=null, and telemetry counters reset to zero.
        - repoSummary echoes RepoConfig fields plus integration flags, letting remote agents confirm capabilities.
        - ResearchTask DTOs include id, feature_id, title, objective, status, sources, cache_key, and freshness_required as per foundation spec.
        - When CLI posts ResearchTask updates to POST /runs/{id}/research/{taskId}, the payload contains result markdown and status transitions.
        - Response includes updated timestamps, assigned_to references, and a hash_of_result for resumable verification.
        - PRDDraft DTO writes to RDM but also flows through CLI JSON outputs; it contains sections problem_statement, goals, non_goals, acceptance_criteria, traceability_map.
        - The traceability_map is an array mapping goal_id → spec_requirement_ids, satisfying foundation traceability mandates.
        - Spec DTO extends PRD mapping, adding constraints (must_touch_paths, must_not_touch_paths, languages), test_plan entries, rollout_plan, and risks arrays.
        - ExecutionTask DTO includes id, feature_id, type, status, depends_on[], retry_policy{max_attempts, backoff}, assigned_agent, output_ref, logs_ref.
        - Each ExecutionTask also stores spec_anchor_id linking back to specific spec sections for traceability.
        - HTTP surfaces expose GET /runs/{id}/tasks to return an array of ExecutionTask DTOs for monitoring or remote orchestration.
        - RateLimitEnvelope DTO contains provider, limit, remaining, reset_at, retry_after, backoff_attempts, last_error, last_checked.
        - This envelope is included in responses to GET /runs/{id} and GET /runs/{id}/rate-limits to keep operators aware of throttle state.
        - DeploymentRecord DTO retains pr_number, merge_sha, status_checks[], required_reviews[], auto_merge_enabled flag, deploy_job_url, completed_at, outcome_notes.
        - Status_check entries include context_name, state, target_url, required flag, and observed_sha to confirm branch protection compliance.
        - Approvals DTO stored in approvals.json contains stage_name, signer_identity, signature_type (human|agent), timestamp, artifact_hash.
        - ArtifactBundleManifest enumerates documents, context entries, logs, metrics, diff summaries, HTTP transcripts, approvals, and deployment records.
        - Each manifest entry contains path, sha256, size_bytes, category, and optional description for audit clarity.
        - POST /runs/{id}/resume accepts ResumeRequest DTO with fields run_id, resume_token (optional), override_last_step (optional), and acknowledgment flags for outstanding errors.
        - ResumeResponse includes resolved next_step, pending_tasks summary, cooldown_info for rate-limited adapters, and warnings requiring operator attention.
        - GitHubPullRequestPayload used by GitHub Adapter's createPullRequest call includes title, head, base, body, maintainer_can_modify, draft flag, and issue references when linking Linear tickets.
        - GitHubReviewRequestPayload contains reviewers[], team_reviewers[], and contextual metadata (feature_id, run_id) stored client-side for audit.
        - GitHubMergePayload holds commit_title, commit_message, merge_method, sha, and auto_merge flag; CLI ensures commit_title references ExecutionTask IDs.
        - WorkflowDispatchPayload includes workflow_id, ref, inputs (feature_id, run_id, pr_number, deployment_mode).
        - LinearIssueSnapshot DTO stores issue_id, title, description, state, labels, project, assignee, due_date, plus metadata retrieved_at and content_hash.
        - Rate limit aware HTTP layer extends each DTO with response_headers sanitized for future debugging.
        - NotificationEvent DTO, when adapters enabled, includes id, feature_id, channel, audience, message, severity, sent_at, delivery_status, metadata.
        - ObservabilityEvent DTO stored in logs.ndjson uses structure {timestamp, level, run_id, component, message, context}.
        - TraceLink DTO ties together prd_goal_id, spec_requirement_id, execution_task_id, and git_commit_sha, enabling deterministic trace.json generation.
        - ValidationCommand DTO defines name, command, env, timeout_ms, required flag, and tags (lint|test|build).
        - ValidationResult DTO written to logs carries command_name, exit_code, duration_ms, stdout_path, stderr_path, and redaction_applied flag.
        - AgentSession DTO includes provider_id, model_identifier, max_tokens, tool_capabilities[], cost_estimate, session_start, session_end.
        - AgentAction DTO references session_id, prompt_hash, completion_hash, token_usage, cited_context_ids, reproduction_seed.
        - GitContextSummary DTO describes each contextual file: {path, sha, summary, token_cost, captured_at, source_kind}.
        - ResearchCacheEntry DTO stores cache_key, source_url, retrieved_at, excerpt, relevance_note, expiry_timestamp.
        - DeploymentOutcome DTO extends DeploymentRecord with statuses of GitHub Actions jobs, containing job_name, conclusion, html_url, started_at, completed_at.
        - ExportBundle DTO includes links to zipped bundles, manifest_path, export_format, generated_at, generator_version, run_id.
        - ResumeDiagnostic DTO contains last_error, remediation_hint, blocking_files[], approvals_needed[], cooldowns[] to inform operators during resume.
        - POST /runs/{id}/tasks accepts TaskAppendRequest carrying new ExecutionTask definitions when dynamic planning occurs mid-run.
        - Response returns updated plan_hash and queue_position to reflect deterministic ordering.
        - GET /runs/{id}/status returns RunStatus DTO summarizing stage_state objects for context, research, prd, spec, plan, execution, validation, pr, deploy, export.
        - Each stage_state includes status enum (pending|running|blocked|done), started_at, completed_at, blockers[], approvals_needed[], artifacts[].
        - RateLimitLedger DTO aggregates RateLimitEnvelope entries plus derived fields like percentage_used and estimated_reset_time.
        - HumanActionRequest DTO describes blocking events: {id, run_id, type, description, required_files[], due_to_rate_limit?, due_to_validation?}.
        - CLI surfaces HumanActionRequest via codepipe status, and remote systems can respond via POST /runs/{id}/actions/{actionId}/acknowledge.
        - ack payload includes actor_id, notes, and optional attachments referencing run directory paths.
        - ExecutionTaskOutput DTO includes stdout_path, stderr_path, exit_code, produced_artifacts[], and metric samples for Observability hub.
        - When ExecutionTask generates code, diff_summary_ref points to patch_file_path for bundling.
        - BranchState DTO retrieved from GitHub adapter includes branch_name, exists_remote, head_sha, ahead_by, behind_by, default_branch_flag.
        - StatusCheck DTO includes context, state, description, target_url, required, latest_sha, recorded_at, making it easy to explain merge blockers.
        - RateLimitBreach DTO stores provider, timestamp, headers_snapshot, action_taken (cooldown|retry_after|manual_ack), used_by_component.
        - ObservabilityMetric DTO for Prometheus exporter includes metric_name, value, labels, timestamp, and aggregator (gauge|counter|histogram).
        - TraceSpan DTO includes span_id, parent_id, name, start_time, end_time, attributes (component, endpoint, run_id), events array.
        - RepoConfig DTO stored at GET /config contains schema_version, repo_url, default_branch, context_paths, integration flags, runtime, safety settings, feature_flags.
        - GitHubIntegration DTO nested under RepoConfig includes api_base_url, api_version, auth_method, token_reference, rate_limit_policy.
        - LinearIntegration DTO includes api_base_url, auth_method, rate_limit_per_hour, use_agents_preview flag.
        - RuntimeConfig DTO contains min_node_version, concurrency, optional sqlite_index flag.
        - SafetyConfig DTO includes require_human_approval_for_merge, allow_force_push, redact_secrets_in_logs.
        - Feature DTO (feature.json) persists id, title, description, source, status, repo object, working_branch, artifacts catalogue, external_links, acceptance_criteria, constraints, telemetry.
        - Telemetry DTO includes last_step, last_error, agent_costs, total_runtime_ms, api_call_counts per provider.
        - ArtifactCatalog DTO lists prd_path, spec_path, plan_path, run_log_path, approvals_path, bundle_path.
        - ExecutionQueueEntry DTO stored in queue.ndjson includes task_id, status, depends_on, attempt_count, last_attempt_at, result_ref.
        - NotificationPlan DTO used when optional notifications are enabled describes channel, audience, severity_thresholds, deduplication_window.
        - ObservabilityAlert DTO used for CLI warnings includes alert_id, severity, description, related_components, recommended_action.
        - GovernanceNote DTO appended to RepoConfig governance_notes includes topic, description, raised_by, raised_at, resolution_status.
        - AutoMergePolicy DTO defines whether auto-merge is allowed per feature: {enabled:boolean, gate:"human"|"auto", recorded_by}.
        - DeploymentTriggerConfig DTO references workflow_id, ref, inputs schema, blocking_checks_policy.
        - ExportRequest DTO includes feature_id, format (json|md), include_logs?, include_http_transcripts?, redaction_level.
        - ExportResponse DTO returns manifest_path, bundle_paths[], warnings[], generated_at.
        - RateLimitWarning DTO surfaces when remaining budget below threshold: {provider, remaining, limit, reset_at, severity}.
        - CLI command outputs wrap these DTOs inside envelope {version, status, data, warnings, errors}.
        - Error DTO includes code (validation_error|rate_limit|human_action), message, remediation_hint, related_files[].
        - Success DTO includes message, next_steps[], related_artifacts[].
        - ObservabilityLogBatch DTO used for export contains entries[], each entry referencing the same ObservabilityEvent structure.
        - GitDiffSummary DTO includes files_changed, insertions, deletions, changed_files[], each with path, status, hunks[].
        - Hunk DTO contains header, added_lines[], removed_lines[], enabling downstream diff viewers or audits.
        - MergeEvent DTO includes pr_number, merged_by, merge_sha, merged_at, auto_merge_enabled, blocking_checks_summary.
        - DeploymentStatus DTO includes workflow_url, environment, status, started_at, completed_at, logs_path.
        - CleanupPlan DTO produced by codepipe cleanup lists run directories older than threshold, size_bytes, artifacts_to_archive.
        - AgentCapabilityManifest DTO includes provider, models[], tools[], limits, fallback_priority, environment_requirements.
        - BranchProtectionSnapshot DTO captures required_status_checks, required_reviewers, dismissal_restrictions, enforce_admins, recorded_at.
        - SecondaryRateLimitEvent DTO stores provider, triggered_at, retry_after_seconds, backoff_plan.
        - ContextBudget DTO tracks tokens consumed per context entry: {context_id, tokens_used, summarization_strategy}.
        - SummarizationJob DTO includes job_id, file_path, chunk_index, total_chunks, tokens_consumed, summary_path.
        - ResearchResult DTO used in exports includes task_id, objective, result_markdown_path, sources[].
        - ValidationSummary DTO includes command_name, pass_fail, retries, artifacts[], gating_stage.
        - ResumeSummary DTO comprises attempted_step, success, elapsed_ms, next_actions.
        - ObservabilityFileDescriptor DTO describes location (logs.ndjson, traces.json, metrics/prometheus.txt), size, sha, retention_policy.
