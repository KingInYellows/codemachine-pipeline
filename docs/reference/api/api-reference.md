<!-- Hand-written API reference. Safe to edit directly. -->
<!-- Config example validated by: node scripts/tooling/validate_api_examples.js -->

# API Reference

**Version:** 1.0.0
**Last Updated:** 2026-02-10

This reference covers the public APIs of the codemachine-pipeline: configuration schema, domain model types, validation utilities, and CLI commands.

---

## Table of Contents

- [Configuration Schema (RepoConfig)](#configuration-schema-repoconfig)
  - [Top-Level Structure](#top-level-structure)
  - [project](#project)
  - [github](#github)
  - [linear](#linear)
  - [runtime](#runtime)
  - [safety](#safety)
  - [feature\_flags](#feature_flags)
  - [validation](#validation)
  - [constraints](#constraints)
  - [execution](#execution)
  - [governance](#governance)
  - [config\_history](#config_history)
  - [Environment Variable Overrides](#environment-variable-overrides)
  - [Configuration Loading](#configuration-loading)
- [Domain Models](#domain-models)
  - [Feature](#feature)
  - [ExecutionTask](#executiontask)
  - [PlanArtifact](#planartifact)
  - [ResearchTask](#researchtask)
  - [ApprovalRecord](#approvalrecord)
  - [Specification](#specification)
- [Validation Utilities](#validation-utilities)
  - [validateOrThrow](#validateorthrow)
  - [validateOrResult](#validateorresult)
- [CLI Commands](#cli-commands)

---

## Configuration Schema (RepoConfig)

**Source:** `src/core/config/RepoConfig.ts`

Repository configuration is stored in `.codepipe/config.json` and validated at load time using Zod schemas. Create a default config with `codepipe init`.

### Top-Level Structure

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `schema_version` | `string` (semver) | Yes | — | Schema version for migrations |
| `project` | `Project` | Yes | — | Project metadata |
| `github` | `GitHub` | Yes | — | GitHub integration settings |
| `linear` | `Linear` | Yes | — | Linear integration settings |
| `runtime` | `Runtime` | Yes | — | Runtime execution settings |
| `safety` | `Safety` | Yes | — | Safety and redaction settings |
| `feature_flags` | `FeatureFlags` | Yes | — | Feature toggle switches |
| `validation` | `ValidationSettings` | No | — | Validation command configuration |
| `constraints` | `Constraints` | No | — | Resource constraints and rate limits |
| `execution` | `ExecutionConfig` | No | — | CodeMachine CLI execution settings |
| `governance` | `Governance` | No | — | Approval workflow and accountability |
| `config_history` | `ConfigHistoryEntry[]` | No | `[]` | Schema migration history |

### project

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Project identifier (min 1 char) |
| `repo_url` | `string` | Yes | — | Repository URL (`https://` or `git@`) |
| `default_branch` | `string` | No | `"main"` | Default branch name |
| `context_paths` | `string[]` | No | `["src/", "docs/", "README.md"]` | Paths to scan for context |
| `project_leads` | `string[]` | No | `[]` | Project lead identifiers |

### github

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | `boolean` | Yes | — | Enable GitHub integration |
| `token_env_var` | `string` | No | `"GITHUB_TOKEN"` | Env var name for GitHub token |
| `api_base_url` | `string` (URL) | No | `"https://api.github.com"` | GitHub API base URL |
| `required_scopes` | `Array<"repo" \| "workflow" \| "read:org" \| "write:org">` | No | `["repo", "workflow"]` | Required token scopes |
| `default_reviewers` | `string[]` | No | `[]` | Default PR reviewer usernames |
| `branch_protection` | `object` | No | — | Branch protection settings |
| `branch_protection.respect_required_reviews` | `boolean` | No | `true` | Honor required review counts |
| `branch_protection.respect_status_checks` | `boolean` | No | `true` | Honor required status checks |

### linear

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | `boolean` | Yes | — | Enable Linear integration |
| `api_key_env_var` | `string` | No | `"LINEAR_API_KEY"` | Env var name for Linear API key |
| `team_id` | `string` | No | — | Linear team ID |
| `project_id` | `string` | No | — | Linear project ID |
| `auto_link_issues` | `boolean` | No | `true` | Auto-link issues to features |

### runtime

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent_endpoint` | `string` (URL) | No | — | Agent API endpoint URL |
| `agent_endpoint_env_var` | `string` | No | `"AGENT_ENDPOINT"` | Env var for agent endpoint |
| `max_concurrent_tasks` | `integer` | No | `3` | Max concurrent tasks (1–10) |
| `timeout_minutes` | `integer` | No | `30` | Per-task timeout (5–120 min) |
| `context_token_budget` | `integer` | No | `32000` | Token budget (1000–100000) |
| `context_cost_budget_usd` | `number` | No | `5` | Max USD for context summarization |
| `logs_format` | `"ndjson" \| "json" \| "text"` | No | `"ndjson"` | Log output format |
| `run_directory` | `string` | No | `".codepipe/runs"` | Run state directory path |

### safety

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `redact_secrets` | `boolean` | No | `true` | Redact secrets in output |
| `require_approval_for_prd` | `boolean` | No | `true` | **Deprecated:** Use `governance.approval_workflow` |
| `require_approval_for_plan` | `boolean` | No | `true` | **Deprecated:** Use `governance.approval_workflow` |
| `require_approval_for_pr` | `boolean` | No | `true` | **Deprecated:** Use `governance.approval_workflow` |
| `prevent_force_push` | `boolean` | No | `true` | **Deprecated:** Use `governance.risk_controls` |
| `allowed_file_patterns` | `string[]` | No | `["**/*.ts", "**/*.js", "**/*.md", "**/*.json"]` | Glob patterns for allowed files |
| `blocked_file_patterns` | `string[]` | No | `[".env", "**/*.key", "**/*.pem", "**/credentials.*"]` | Glob patterns for blocked files |

### feature_flags

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enable_auto_merge` | `boolean` | No | `false` | Auto-merge PRs after checks pass |
| `enable_deployment_triggers` | `boolean` | No | `false` | Trigger deployment workflows |
| `enable_linear_sync` | `boolean` | No | `false` | Sync status with Linear issues |
| `enable_context_summarization` | `boolean` | No | `true` | Summarize context for agent prompts |
| `enable_resumability` | `boolean` | No | `true` | Enable run resume after failure |
| `enable_developer_preview` | `boolean` | No | `false` | Enable preview features |

### validation

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `commands` | `ValidationCommandConfig[]` | Yes (if section present) | — | Validation commands (min 1) |
| `template_context` | `Record<string, string>` | No | — | Template variable substitutions |

### constraints

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `max_file_size_kb` | `integer` | No | `1000` | Max file size in KB (100–10000) |
| `max_context_files` | `integer` | No | `100` | Max files in context (10–1000) |
| `rate_limits` | `object` | No | — | API rate limit settings |
| `rate_limits.github_requests_per_hour` | `integer` | No | `5000` | GitHub API rate limit |
| `rate_limits.linear_requests_per_minute` | `integer` | No | `60` | Linear API rate limit |
| `rate_limits.agent_requests_per_hour` | `integer` | No | `100` | Agent API rate limit |

### execution

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `codemachine_cli_path` | `string` | No | `"codemachine"` | Path to CodeMachine CLI binary |
| `default_engine` | `"claude" \| "codex" \| "openai"` | No | `"claude"` | Default execution engine |
| `workspace_dir` | `string` | No | — | Workspace directory override |
| `spec_path` | `string` | No | — | Specification file path override |
| `task_timeout_ms` | `integer` | No | `1800000` | Per-task timeout in ms (60s–2h) |
| `max_parallel_tasks` | `integer` | No | `1` | Max parallel execution tasks (1–10) |
| `max_log_buffer_size` | `integer` | No | `10485760` | Log buffer size in bytes (1KB–100MB) |
| `env_allowlist` | `string[]` | No | `[]` | Env vars to pass to execution |
| `max_retries` | `integer` | No | `3` | Max retry attempts (0–10) |
| `retry_backoff_ms` | `integer` | No | `5000` | Base retry backoff in ms |
| `log_rotation_mb` | `integer` | No | `100` | Log rotation threshold in MB |
| `log_rotation_keep` | `integer` | No | `3` | Number of rotated logs to keep |
| `log_rotation_compress` | `boolean` | No | `false` | Compress rotated logs |

### governance

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `approval_workflow` | `object` | Yes (if section present) | — | Gate-by-gate approval requirements |
| `approval_workflow.require_approval_for_prd` | `boolean` | No | `true` | Require PRD approval |
| `approval_workflow.require_approval_for_spec` | `boolean` | No | `true` | Require spec approval |
| `approval_workflow.require_approval_for_plan` | `boolean` | No | `true` | Require plan approval |
| `approval_workflow.require_approval_for_code` | `boolean` | No | `true` | Require code approval |
| `approval_workflow.require_approval_for_pr` | `boolean` | No | `true` | Require PR approval |
| `approval_workflow.require_approval_for_deploy` | `boolean` | No | `true` | Require deploy approval |
| `accountability` | `object` | Yes (if section present) | — | Accountability tracking settings |
| `accountability.record_approver_identity` | `boolean` | No | `true` | Record who approved |
| `accountability.require_approval_reason` | `boolean` | No | `false` | Require rationale with approval |
| `accountability.audit_log_retention_days` | `integer` | No | `365` | Days to retain audit logs (1–3650) |
| `risk_controls` | `object` | Yes (if section present) | — | Risk containment controls |
| `risk_controls.prevent_auto_merge` | `boolean` | No | `true` | Prevent auto-merge |
| `risk_controls.prevent_force_push` | `boolean` | No | `true` | Prevent force push |
| `risk_controls.require_branch_protection` | `boolean` | No | `true` | Require branch protection |
| `risk_controls.max_files_per_pr` | `integer` | No | `100` | Max files per PR (1–1000) |
| `risk_controls.max_lines_changed_per_pr` | `integer` | No | `5000` | Max lines per PR (1–50000) |
| `compliance_tags` | `string[]` | No | `[]` | Compliance tags (e.g., SOC2, GDPR) |
| `governance_notes` | `string` | No | — | Free-form governance notes |

### config_history

Each entry in the `config_history` array:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `timestamp` | `string` (ISO 8601) | Yes | — | When change was made |
| `schema_version` | `string` (semver) | Yes | — | Schema version after change |
| `changed_by` | `string` | Yes | — | Who made the change |
| `change_description` | `string` | Yes | — | What changed |
| `migration_applied` | `boolean` | No | `false` | Whether a migration ran |
| `backup_path` | `string` | No | — | Backup file path |

### Environment Variable Overrides

Configuration values can be overridden via environment variables following the `CODEPIPE_<SECTION>_<FIELD>` convention:

| Variable | Config Path | Type |
|----------|-------------|------|
| `CODEPIPE_GITHUB_TOKEN` | `github.token_env_var` | string |
| `CODEPIPE_LINEAR_API_KEY` | `linear.api_key_env_var` | string |
| `CODEPIPE_RUNTIME_AGENT_ENDPOINT` | `runtime.agent_endpoint` | URL |
| `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` | `runtime.max_concurrent_tasks` | integer |
| `CODEPIPE_RUNTIME_TIMEOUT_MINUTES` | `runtime.timeout_minutes` | integer |
| `CODEPIPE_EXECUTION_CLI_PATH` | `execution.codemachine_cli_path` | string |
| `CODEPIPE_EXECUTION_DEFAULT_ENGINE` | `execution.default_engine` | enum |
| `CODEPIPE_EXECUTION_TIMEOUT_MS` | `execution.task_timeout_ms` | integer |

### Configuration Loading

```typescript
import { loadRepoConfig } from './src/core/config/RepoConfig.js';

const result = await loadRepoConfig('.codepipe/config.json');
if (result.success) {
  console.log(result.config);   // RepoConfig
  console.log(result.warnings); // string[] | undefined
} else {
  console.error(result.errors); // ValidationError[]
}
```

**`loadRepoConfig(configPath: string): Promise<ValidationResult>`**

1. Checks file existence and readability
2. Parses JSON
3. Validates against `RepoConfigSchema` (Zod)
4. Applies environment variable overrides
5. Checks credential env vars and emits warnings
6. Returns `{ success, config?, errors?, warnings? }`

**`createDefaultConfig(repoUrl: string, options?): RepoConfig`**

Creates a config template with sensible defaults. Options:
- `includeGovernance` (default `true`) — include governance section
- `changedBy` (default `"codepipe init"`) — initial history entry author

---

## Domain Models

All domain models are Zod-validated, exported from `src/core/models/index.ts`, and follow a consistent pattern: schema, type, parse/serialize/create helpers.

### Feature

**Source:** `src/core/models/Feature.ts`

Represents a complete feature execution lifecycle record.

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `string` (semver) | Schema version |
| `feature_id` | `string` | Unique feature ID (ULID/UUIDv7) |
| `title` | `string?` | Human-readable title |
| `source` | `string?` | Origin (e.g., `linear:PROJ-123`) |
| `repo` | `RepoMetadata` | `{ url, default_branch }` |
| `status` | `FeatureStatus` | `pending \| in_progress \| paused \| completed \| failed` |
| `execution` | `ExecutionTracking` | `{ last_step, last_error, current_step, total_steps, completed_steps }` |
| `timestamps` | `Timestamps` | `{ created_at, updated_at, started_at?, completed_at? }` |
| `approvals` | `Approvals` | `{ approvals_file?, pending[], completed[] }` |
| `artifacts` | `ArtifactReferences` | `{ prd?, spec?, plan?, hash_manifest? }` |
| `telemetry` | `TelemetryReferences` | `{ logs_dir, metrics_file?, traces_file?, costs_file?, trace_id? }` |
| `rate_limits` | `RateLimitReferences?` | `{ rate_limits_file? }` |
| `metadata` | `Record<string, unknown>?` | Extensible metadata |

**Helpers:**
- `parseFeature(json)` — validate unknown input, returns `{ success, data } | { success, errors }`
- `serializeFeature(feature, pretty?)` — JSON stringify
- `createFeature(featureId, repoUrl, options?)` — factory with defaults

### ExecutionTask

**Source:** `src/core/models/ExecutionTask.ts`

Unit of work with retry logic, cost tracking, and rate limit budgets.

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | `string` | Unique task ID |
| `feature_id` | `string` | Parent feature ID |
| `title` | `string` | Task description |
| `task_type` | `ExecutionTaskType` | `code_generation \| testing \| pr_creation \| deployment \| review \| refactoring \| documentation \| other` |
| `status` | `ExecutionTaskStatus` | `pending \| running \| completed \| failed \| skipped \| cancelled` |
| `config` | `Record<string, unknown>?` | Task-specific parameters |
| `assigned_agent` | `string?` | Agent/executor ID |
| `dependency_ids` | `string[]` | Task IDs this depends on |
| `retry_count` | `integer` | Attempts made (default 0) |
| `max_retries` | `integer` | Max attempts (default 3) |
| `last_error` | `TaskError?` | `{ message, code?, details?, timestamp, recoverable }` |
| `cost` | `CostTracking?` | `{ total_usd, breakdown?, api_calls, tokens_consumed }` |
| `rate_limit_budget` | `RateLimitBudget?` | `{ provider, remaining_requests, total_requests, reset_at?, retry_after_seconds? }` |

**Helpers:**
- `parseExecutionTask(json)` — validate unknown input
- `createExecutionTask(taskId, featureId, title, taskType, options?)` — factory
- `canRetry(task)` — check if task is retryable
- `areDependenciesCompleted(task, allTasks)` — check dependency graph
- `getTaskDuration(task)` — calculate elapsed ms

### PlanArtifact

**Source:** `src/core/models/PlanArtifact.ts`

Execution plan DAG with task dependencies and checksum.

| Field | Type | Description |
|-------|------|-------------|
| `feature_id` | `string` | Parent feature ID |
| `tasks` | `TaskNode[]` | DAG task nodes |
| `dag_metadata` | `DAGMetadata` | `{ total_tasks, parallel_paths?, estimated_total_duration_minutes?, generated_at, generated_by? }` |
| `checksum` | `string?` | SHA-256 for idempotence |

**TaskNode:**

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | `string` | Unique task ID |
| `title` | `string` | Task description |
| `task_type` | `string` | Task type identifier |
| `dependencies` | `TaskDependency[]` | `{ task_id, type: "required" \| "optional" }` |
| `estimated_duration_minutes` | `integer?` | Estimated duration |
| `config` | `Record<string, unknown>?` | Task configuration |

**Helpers:**
- `parsePlanArtifact(json)` — validate unknown input
- `createPlanArtifact(featureId, tasks, options?)` — factory
- `validateDAG(plan)` — check for cycles, duplicates, missing deps
- `getEntryTasks(plan)` — tasks with no dependencies
- `getDependentTasks(plan, taskId)` — tasks depending on a given task

### ResearchTask

**Source:** `src/core/models/ResearchTask.ts`

Investigation unit with objectives, sources, caching, and confidence scoring.

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | `string` | Unique research task ID |
| `feature_id` | `string` | Parent feature ID |
| `title` | `string` | Research task title |
| `objectives` | `string[]` | Research questions/goals (min 1) |
| `sources` | `ResearchSource[]` | `{ type, identifier, description? }` — types: `codebase \| web \| documentation \| api \| linear \| github \| other` |
| `cache_key` | `string?` | SHA-256 cache key |
| `freshness_requirements` | `FreshnessRequirement?` | `{ max_age_hours (default 24), force_fresh }` |
| `status` | `ResearchStatus` | `pending \| in_progress \| completed \| failed \| cached` |
| `results` | `ResearchResult?` | `{ summary, details?, confidence_score (0–1), timestamp, sources_consulted[] }` |

**Helpers:**
- `parseResearchTask(json)` — validate unknown input
- `createResearchTask(taskId, featureId, title, objectives, options?)` — factory
- `generateCacheKey(objectives, sources)` — SHA-256 hash
- `isCachedResultFresh(result, requirements)` — check cache validity

### ApprovalRecord

**Source:** `src/core/models/ApprovalRecord.ts`

Gate approval referencing artifacts, signers, and rationale.

| Field | Type | Description |
|-------|------|-------------|
| `approval_id` | `string` | Unique approval ID |
| `feature_id` | `string` | Parent feature ID |
| `gate_type` | `ApprovalGateType` | `prd \| spec \| plan \| code \| pr \| deploy \| other` |
| `verdict` | `ApprovalVerdict` | `approved \| rejected \| requested_changes` |
| `signer` | `string` | Signer identifier |
| `signer_name` | `string?` | Display name |
| `approved_at` | `string` (ISO 8601) | Approval timestamp |
| `artifact_hash` | `string?` | SHA-256 of approved artifact |
| `artifact_path` | `string?` | Path to approved artifact |
| `rationale` | `string?` | Approval rationale |

**Helpers:**
- `parseApprovalRecord(json)` — validate unknown input
- `createApprovalRecord(approvalId, featureId, gateType, verdict, signer, options?)` — factory

### Specification

**Source:** `src/core/models/Specification.ts`

Technical specification with reviewers, change log, risks, test plan, and rollout plan.

**Status values:** `draft | pending_review | approved | rejected | obsolete`

**Key helpers:**
- `parseSpecification(json)` — validate unknown input
- `createSpecification(featureId, title, options?)` — factory
- `addChangeLogEntry(spec, entry)` — append change
- `isFullyApproved(spec)` — all reviewers approved
- `getPendingReviewers(spec)` — reviewers still pending

---

## Validation Utilities

**Source:** `src/validation/helpers.ts`

Generic Zod validation wrappers for use at system boundaries.

### validateOrThrow

```typescript
function validateOrThrow<T>(schema: ZodSchema<T>, input: unknown, boundary: string): T
```

Validates input against a Zod schema. **Throws** `ValidationError` on failure. Use at hard boundaries where invalid input should halt execution (e.g., config loading, webhook payloads).

```typescript
import { validateOrThrow } from './src/validation/helpers.js';
import { FeatureSchema } from './src/core/models/Feature.js';

const feature = validateOrThrow(FeatureSchema, rawJson, 'feature-load');
// feature is typed as Feature — throws if invalid
```

### validateOrResult

```typescript
function validateOrResult<T>(schema: ZodSchema<T>, input: unknown, boundary: string): ValidationResult<T>
```

Returns a discriminated union instead of throwing. Use at soft boundaries where failures should be handled gracefully (e.g., AI output parsing, optional config sections).

```typescript
import { validateOrResult } from './src/validation/helpers.js';
import { ExecutionTaskSchema } from './src/core/models/ExecutionTask.js';

const result = validateOrResult(ExecutionTaskSchema, rawJson, 'task-parse');
if (result.success) {
  console.log(result.data); // ExecutionTask
} else {
  console.error(result.error); // ValidationError
}
```

**`ValidationResult<T>`** is:
- `{ success: true; data: T }` on success
- `{ success: false; error: ValidationError }` on failure

---

## CLI Commands

For the full CLI command reference (17 commands with flags, args, and examples), see:

**[CLI Reference](./cli-reference.md)** — auto-generated from `oclif.manifest.json`

Quick summary of available commands:

| Command | Description |
|---------|-------------|
| `codepipe approve` | Approve or deny a feature pipeline gate |
| `codepipe context summarize` | Generate or refresh cached context summaries |
| `codepipe doctor` | Run environment diagnostics and readiness checks |
| `codepipe health` | Quick runtime health check (config, disk, writable run dir) |
| `codepipe init` | Initialize codemachine-pipeline with schema-validated configuration |
| `codepipe plan` | Display the execution plan DAG, task summaries, and dependency graph |
| `codepipe pr create` | Create a pull request on GitHub for the feature branch |
| `codepipe pr disable-auto-merge` | Disable auto-merge for a pull request |
| `codepipe pr reviewers` | Request reviewers for a pull request |
| `codepipe pr status` | Show pull request status and merge readiness |
| `codepipe rate-limits` | Display rate limit status and telemetry for API providers |
| `codepipe research create` | Create a ResearchTask manually via the CLI |
| `codepipe research list` | List ResearchTasks for the selected feature run directory |
| `codepipe resume` | Resume a failed or paused feature pipeline execution with safety checks |
| `codepipe start` | Start a new feature development pipeline |
| `codepipe status` | Show the current state of a feature development pipeline |
| `codepipe validate` | Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops |

---

## Related Documentation

- [Architecture Diagrams](../architecture/execution_flow.md) — execution engine state machines and data flow
- [Component Index](../architecture/component_index.md) — system architecture with inline diagrams
- [Run Directory Schema](../requirements/run_directory_schema.md) — on-disk state persistence
- [Data Model Dictionary](../requirements/data_model_dictionary.md) — full field-level data model docs
- [Configuration Schema Reference](../requirements/RepoConfig_schema.md) — extended config docs
