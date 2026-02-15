# Data Model Dictionary

**Version:** 1.0.0
**Status:** Active
**Last Updated:** 2025-12-15

## Overview

This document provides a comprehensive field-by-field reference for all data models in the AI Feature Pipeline system. Each entity includes field descriptions, data types, validation rules, units/semantics, ADR references, FR/IR cross-links, and CLI command usage.

## Table of Contents

- [Core Models](#core-models)
  - [Feature](#feature)
  - [RunArtifact](#runartifact)
  - [PlanArtifact](#planartifact)
- [Task Models](#task-models)
  - [ResearchTask](#researchtask)
  - [Specification](#specification)
  - [ExecutionTask](#executiontask)
- [Supporting Models](#supporting-models)
  - [ContextDocument](#contextdocument)
  - [RateLimitEnvelope](#ratelimitenvelope)
  - [ApprovalRecord](#approvalrecord)
  - [DeploymentRecord](#deploymentrecord)
  - [IntegrationCredential](#integrationcredential)
  - [AgentProviderCapability](#agentprovidercapability)
  - [NotificationEvent](#notificationevent)
  - [ArtifactBundle](#artifactbundle)
  - [TraceLink](#tracelink)

---

## Core Models

### Feature

**Purpose:** Represents a complete feature execution lifecycle record including metadata, status, artifacts, telemetry, approvals, and resumability information.

**Implements:** FR-2 (Run Directory), FR-3 (Resumability), ADR-5 (Approval Workflow), ADR-7 (Validation Policy)

**CLI Commands:** `init`, `start`, `status`, `resume`

**Cardinality:** 1 Feature : N ExecutionTasks, 1 Feature : 1 RunArtifact, 1 Feature : 1 PlanArtifact

| Field                          | Type   | Required | Description                          | Units/Semantics                                           | ADR/FR Reference    |
| ------------------------------ | ------ | -------- | ------------------------------------ | --------------------------------------------------------- | ------------------- |
| `schema_version`               | string | Yes      | Schema version for future migrations | Semver format (e.g., "1.0.0")                             | ADR-7               |
| `feature_id`                   | string | Yes      | Unique feature identifier            | ULID or UUIDv7                                            | FR-2                |
| `title`                        | string | No       | Human-readable feature title         | Free text                                                 | FR-2                |
| `source`                       | string | No       | Feature source origin                | Format: `linear:PROJ-123`, `manual:prompt`                | FR-1                |
| `repo.url`                     | string | Yes      | Repository URL                       | Valid Git URL                                             | FR-1                |
| `repo.default_branch`          | string | Yes      | Default branch name                  | Branch name (default: "main")                             | FR-1                |
| `status`                       | enum   | Yes      | Current execution status             | `pending`, `in_progress`, `paused`, `completed`, `failed` | FR-3                |
| `execution.last_step`          | string | No       | Last successfully completed step     | Step identifier                                           | FR-3                |
| `execution.last_error`         | object | No       | Most recent error encountered        | See LastError schema                                      | FR-3                |
| `execution.current_step`       | string | No       | Current step being executed          | Step identifier                                           | FR-3                |
| `execution.total_steps`        | number | No       | Total steps in execution plan        | Non-negative integer                                      | FR-2                |
| `execution.completed_steps`    | number | Yes      | Steps completed so far               | Non-negative integer (default: 0)                         | FR-3                |
| `timestamps.created_at`        | string | Yes      | When feature record was created      | ISO 8601 datetime                                         | ADR-2               |
| `timestamps.updated_at`        | string | Yes      | When feature record was last updated | ISO 8601 datetime                                         | ADR-2               |
| `timestamps.started_at`        | string | No       | When feature execution started       | ISO 8601 datetime or null                                 | FR-3                |
| `timestamps.completed_at`      | string | No       | When feature execution completed     | ISO 8601 datetime or null                                 | FR-3                |
| `approvals.approvals_file`     | string | No       | Path to approvals.json file          | Relative path from run directory                          | ADR-5               |
| `approvals.pending`            | array  | Yes      | Required approvals not yet granted   | Array of approval gate identifiers                        | ADR-5               |
| `approvals.completed`          | array  | Yes      | Approvals already granted            | Array of approval gate identifiers                        | ADR-5               |
| `artifacts.prd`                | string | No       | Path to PRD markdown file            | Relative path                                             | FR-2                |
| `artifacts.spec`               | string | No       | Path to specification markdown file  | Relative path                                             | FR-2                |
| `artifacts.plan`               | string | No       | Path to execution plan JSON file     | Relative path                                             | FR-2                |
| `artifacts.hash_manifest`      | string | No       | Path to hash manifest JSON file      | Relative path                                             | ADR-2               |
| `telemetry.logs_dir`           | string | Yes      | Directory containing log files       | Relative path (default: "logs")                           | FR-2                |
| `telemetry.metrics_file`       | string | No       | Path to metrics JSON file            | Relative path                                             | Telemetry tracking  |
| `telemetry.traces_file`        | string | No       | Path to traces JSON file             | Relative path                                             | Distributed tracing |
| `telemetry.costs_file`         | string | No       | Path to cost estimates JSON file     | Relative path                                             | Cost tracking       |
| `telemetry.trace_id`           | string | No       | Trace ID for distributed tracing     | UUID or similar                                           | Distributed tracing |
| `rate_limits.rate_limits_file` | string | No       | Path to rate limits tracking JSON    | Relative path                                             | Rate limit tracking |
| `metadata`                     | object | No       | Extensible metadata                  | Key-value pairs                                           | Extension point     |

---

### RunArtifact

**Purpose:** Tracks paths and integrity hashes for artifacts generated during feature execution.

**Implements:** FR-2 (Run Directory), ADR-2 (State Persistence), ADR-7 (Validation Policy)

**CLI Commands:** `status`, `export`, `verify`

**Cardinality:** 1 Feature : 1 RunArtifact

| Field                         | Type   | Required | Description                      | Units/Semantics                                                                      | ADR/FR Reference |
| ----------------------------- | ------ | -------- | -------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| `schema_version`              | string | Yes      | Schema version                   | Semver format                                                                        | ADR-7            |
| `feature_id`                  | string | Yes      | Feature identifier               | ULID/UUIDv7                                                                          | FR-2             |
| `created_at`                  | string | Yes      | Collection creation timestamp    | ISO 8601 datetime                                                                    | ADR-2            |
| `updated_at`                  | string | Yes      | Collection last update timestamp | ISO 8601 datetime                                                                    | ADR-2            |
| `artifacts[id].artifact_type` | enum   | Yes      | Artifact type                    | `prd`, `spec`, `plan`, `log`, `trace`, `metrics`, `cost_estimate`, `bundle`, `other` | FR-2             |
| `artifacts[id].path`          | string | Yes      | Relative path to artifact        | From run directory root                                                              | FR-2             |
| `artifacts[id].hash`          | string | Yes      | SHA-256 hash of contents         | 64-character hex string                                                              | ADR-2            |
| `artifacts[id].size`          | number | Yes      | File size                        | Bytes (non-negative integer)                                                         | ADR-2            |
| `artifacts[id].timestamp`     | string | Yes      | Artifact creation timestamp      | ISO 8601 datetime                                                                    | ADR-2            |
| `artifacts[id].metadata`      | object | No       | Artifact-specific metadata       | Key-value pairs                                                                      | Extension point  |
| `metadata`                    | object | No       | Collection-level metadata        | Key-value pairs                                                                      | Extension point  |

---

### PlanArtifact

**Purpose:** Defines the execution plan DAG with task dependencies, metadata, and checksum for idempotence.

**Implements:** FR-2 (Run Directory), FR-3 (Resumability), ADR-7 (Validation Policy)

**CLI Commands:** `start`, `resume`, `status`

**Cardinality:** 1 Feature : 1 PlanArtifact, 1 PlanArtifact : N ExecutionTasks

| Field                                           | Type   | Required | Description                 | Units/Semantics                                | ADR/FR Reference   |
| ----------------------------------------------- | ------ | -------- | --------------------------- | ---------------------------------------------- | ------------------ |
| `schema_version`                                | string | Yes      | Schema version              | Semver format                                  | ADR-7              |
| `feature_id`                                    | string | Yes      | Feature identifier          | ULID/UUIDv7                                    | FR-2               |
| `created_at`                                    | string | Yes      | Plan creation timestamp     | ISO 8601 datetime                              | ADR-2              |
| `updated_at`                                    | string | Yes      | Plan last update timestamp  | ISO 8601 datetime                              | ADR-2              |
| `tasks[].task_id`                               | string | Yes      | Unique task identifier      | String                                         | FR-3               |
| `tasks[].title`                                 | string | Yes      | Task title or description   | Free text                                      | FR-2               |
| `tasks[].task_type`                             | string | Yes      | Task type                   | E.g., "research", "code_generation", "testing" | FR-2               |
| `tasks[].dependencies[].task_id`                | string | Yes      | Dependent task ID           | Task identifier                                | FR-3               |
| `tasks[].dependencies[].type`                   | enum   | Yes      | Dependency type             | `required`, `optional` (default: required)     | FR-3               |
| `tasks[].estimated_duration_minutes`            | number | No       | Estimated execution time    | Minutes (non-negative integer)                 | Planning           |
| `tasks[].config`                                | object | No       | Task-specific configuration | Key-value pairs                                | Task execution     |
| `dag_metadata.total_tasks`                      | number | Yes      | Total task count            | Non-negative integer                           | FR-2               |
| `dag_metadata.parallel_paths`                   | number | No       | Parallel execution paths    | Non-negative integer                           | Planning           |
| `dag_metadata.estimated_total_duration_minutes` | number | No       | Total estimated duration    | Minutes (non-negative integer)                 | Planning           |
| `dag_metadata.generated_at`                     | string | Yes      | Plan generation timestamp   | ISO 8601 datetime                              | ADR-2              |
| `dag_metadata.generated_by`                     | string | No       | Generator agent/tool ID     | Free text                                      | Provenance         |
| `checksum`                                      | string | No       | SHA-256 checksum of plan    | 64-character hex string                        | FR-3 (idempotence) |
| `metadata`                                      | object | No       | Plan-level metadata         | Key-value pairs                                | Extension point    |

---

## Task Models

### ResearchTask

**Purpose:** Investigation units with objectives, sources, cache keys, freshness requirements, and confidence-scored results.

**Implements:** FR-1 (Initialize), ADR-7 (Validation Policy)

**CLI Commands:** `research`, `start`

**Cardinality:** 1 Feature : N ResearchTasks

| Field                                  | Type    | Required | Description                 | Units/Semantics                                                        | ADR/FR Reference |
| -------------------------------------- | ------- | -------- | --------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `schema_version`                       | string  | Yes      | Schema version              | Semver format                                                          | ADR-7            |
| `task_id`                              | string  | Yes      | Unique research task ID     | String                                                                 | Task tracking    |
| `feature_id`                           | string  | Yes      | Feature identifier          | ULID/UUIDv7                                                            | FR-2             |
| `title`                                | string  | Yes      | Research task title         | Free text                                                              | Task description |
| `objectives`                           | array   | Yes      | Research objectives         | Array of strings (min 1)                                               | Research goals   |
| `sources[].type`                       | enum    | Yes      | Source type                 | `codebase`, `web`, `documentation`, `api`, `linear`, `github`, `other` | FR-1             |
| `sources[].identifier`                 | string  | Yes      | Source URL or identifier    | Free text                                                              | FR-1             |
| `sources[].description`                | string  | No       | Source description          | Free text                                                              | Documentation    |
| `cache_key`                            | string  | No       | Cache key for result reuse  | SHA-256 hash or similar                                                | Caching          |
| `freshness_requirements.max_age_hours` | number  | No       | Max cached result age       | Hours (non-negative integer, default: 24)                              | Caching          |
| `freshness_requirements.force_fresh`   | boolean | No       | Force fresh research        | Boolean (default: false)                                               | Caching          |
| `status`                               | enum    | Yes      | Research status             | `pending`, `in_progress`, `completed`, `failed`, `cached`              | Task tracking    |
| `results.summary`                      | string  | No       | Research findings summary   | Free text                                                              | Research output  |
| `results.details`                      | string  | No       | Detailed results            | Free text                                                              | Research output  |
| `results.confidence_score`             | number  | No       | Confidence score            | 0.0 to 1.0 (default: 0.5)                                              | Result quality   |
| `results.timestamp`                    | string  | No       | Result generation timestamp | ISO 8601 datetime                                                      | ADR-2            |
| `results.sources_consulted`            | array   | No       | Sources consulted           | Array of ResearchSource                                                | Provenance       |
| `created_at`                           | string  | Yes      | Task creation timestamp     | ISO 8601 datetime                                                      | ADR-2            |
| `updated_at`                           | string  | Yes      | Task last update timestamp  | ISO 8601 datetime                                                      | ADR-2            |
| `started_at`                           | string  | No       | Task start timestamp        | ISO 8601 datetime or null                                              | Task tracking    |
| `completed_at`                         | string  | No       | Task completion timestamp   | ISO 8601 datetime or null                                              | Task tracking    |
| `metadata`                             | object  | No       | Task metadata               | Key-value pairs                                                        | Extension point  |

---

### Specification

**Purpose:** Structured technical specification with reviewer info, status, change log, risks, test plan, and rollout plan.

**Implements:** FR-2 (Run Directory), ADR-5 (Approval Workflow), ADR-7 (Validation Policy)

**CLI Commands:** `start`, `approve`, `status`

**Cardinality:** 1 Feature : N Specifications

| Field                               | Type   | Required | Description                 | Units/Semantics                                                           | ADR/FR Reference    |
| ----------------------------------- | ------ | -------- | --------------------------- | ------------------------------------------------------------------------- | ------------------- |
| `schema_version`                    | string | Yes      | Schema version              | Semver format                                                             | ADR-7               |
| `spec_id`                           | string | Yes      | Unique specification ID     | String                                                                    | Spec tracking       |
| `feature_id`                        | string | Yes      | Feature identifier          | ULID/UUIDv7                                                               | FR-2                |
| `title`                             | string | Yes      | Specification title         | Free text                                                                 | Spec identification |
| `content`                           | string | Yes      | Full specification content  | Markdown or structured text                                               | Spec body           |
| `status`                            | enum   | Yes      | Specification status        | `draft`, `pending_review`, `approved`, `rejected`, `obsolete`             | ADR-5               |
| `reviewers[].reviewer_id`           | string | Yes      | Reviewer identifier         | Username, email, or ID                                                    | ADR-5               |
| `reviewers[].name`                  | string | No       | Reviewer display name       | Free text                                                                 | Display             |
| `reviewers[].assigned_at`           | string | Yes      | Review assignment timestamp | ISO 8601 datetime                                                         | ADR-5               |
| `reviewers[].reviewed_at`           | string | No       | Review completion timestamp | ISO 8601 datetime or null                                                 | ADR-5               |
| `reviewers[].verdict`               | enum   | Yes      | Review verdict              | `approved`, `rejected`, `requested_changes`, `pending` (default: pending) | ADR-5               |
| `reviewers[].comments`              | string | No       | Review comments             | Free text                                                                 | Feedback            |
| `change_log[].timestamp`            | string | Yes      | Change timestamp            | ISO 8601 datetime                                                         | Audit trail         |
| `change_log[].author`               | string | Yes      | Change author               | Identifier                                                                | Audit trail         |
| `change_log[].description`          | string | Yes      | Change description          | Free text                                                                 | Audit trail         |
| `change_log[].version`              | string | No       | Version number/label        | Free text                                                                 | Versioning          |
| `risks[].description`               | string | Yes      | Risk description            | Free text                                                                 | Risk management     |
| `risks[].severity`                  | enum   | Yes      | Risk severity               | `low`, `medium`, `high`, `critical`                                       | Risk prioritization |
| `risks[].mitigation`                | string | No       | Mitigation strategy         | Free text                                                                 | Risk management     |
| `risks[].owner`                     | string | No       | Risk owner                  | Identifier                                                                | Accountability      |
| `test_plan[].test_id`               | string | Yes      | Test case identifier        | String                                                                    | Test tracking       |
| `test_plan[].description`           | string | Yes      | Test case description       | Free text                                                                 | Test definition     |
| `test_plan[].test_type`             | enum   | Yes      | Test type                   | `unit`, `integration`, `e2e`, `manual`                                    | Test categorization |
| `test_plan[].acceptance_criteria`   | array  | Yes      | Acceptance criteria         | Array of strings                                                          | Test validation     |
| `rollout_plan.strategy`             | enum   | No       | Rollout strategy            | `all_at_once`, `gradual`, `canary`, `blue_green` (default: gradual)       | Deployment          |
| `rollout_plan.phases[].phase_id`    | string | No       | Phase identifier            | String                                                                    | Deployment          |
| `rollout_plan.phases[].description` | string | No       | Phase description           | Free text                                                                 | Deployment          |
| `rollout_plan.phases[].percentage`  | number | No       | User/traffic percentage     | 0 to 100                                                                  | Deployment          |
| `rollout_plan.phases[].duration`    | string | No       | Phase duration              | Free text                                                                 | Deployment          |
| `rollout_plan.rollback_plan`        | string | No       | Rollback plan               | Free text                                                                 | Safety              |
| `created_at`                        | string | Yes      | Spec creation timestamp     | ISO 8601 datetime                                                         | ADR-2               |
| `updated_at`                        | string | Yes      | Spec last update timestamp  | ISO 8601 datetime                                                         | ADR-2               |
| `approved_at`                       | string | No       | Spec approval timestamp     | ISO 8601 datetime or null                                                 | ADR-5               |
| `metadata`                          | object | No       | Spec metadata               | Key-value pairs                                                           | Extension point     |

---

### ExecutionTask

**Purpose:** Units of work (code_generation, testing, pr_creation, deployment) with statuses, retries, logs, cost tracking, and assigned agents.

**Implements:** FR-2 (Run Directory), FR-3 (Resumability), ADR-7 (Validation Policy)

**CLI Commands:** `start`, `resume`, `status`

**Cardinality:** 1 Feature : N ExecutionTasks, ExecutionTask : M ExecutionTask dependencies

| Field                                   | Type    | Required | Description                      | Units/Semantics                                                                                              | ADR/FR Reference     |
| --------------------------------------- | ------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| `schema_version`                        | string  | Yes      | Schema version                   | Semver format                                                                                                | ADR-7                |
| `task_id`                               | string  | Yes      | Unique execution task ID         | String                                                                                                       | Task tracking        |
| `feature_id`                            | string  | Yes      | Feature identifier               | ULID/UUIDv7                                                                                                  | FR-2                 |
| `title`                                 | string  | Yes      | Task title                       | Free text                                                                                                    | Task description     |
| `task_type`                             | enum    | Yes      | Task type                        | `code_generation`, `testing`, `pr_creation`, `deployment`, `review`, `refactoring`, `documentation`, `other` | Task categorization  |
| `status`                                | enum    | Yes      | Task status                      | `pending`, `running`, `completed`, `failed`, `skipped`, `cancelled`                                          | FR-3                 |
| `config`                                | object  | No       | Task-specific configuration      | Key-value pairs                                                                                              | Task execution       |
| `assigned_agent`                        | string  | No       | Assigned agent/executor ID       | Free text                                                                                                    | Agent assignment     |
| `dependency_ids`                        | array   | Yes      | Task dependency IDs              | Array of task IDs (default: [])                                                                              | FR-3                 |
| `retry_count`                           | number  | Yes      | Retry attempts made              | Non-negative integer (default: 0)                                                                            | FR-3                 |
| `max_retries`                           | number  | Yes      | Max retry attempts               | Non-negative integer (default: 3)                                                                            | FR-3                 |
| `last_error.message`                    | string  | No       | Error message                    | Free text                                                                                                    | FR-3                 |
| `last_error.code`                       | string  | No       | Error code/type                  | Free text                                                                                                    | Error categorization |
| `last_error.details`                    | string  | No       | Error details/stack trace        | Free text                                                                                                    | Debugging            |
| `last_error.timestamp`                  | string  | No       | Error timestamp                  | ISO 8601 datetime                                                                                            | ADR-2                |
| `last_error.recoverable`                | boolean | No       | Whether error is recoverable     | Boolean (default: true)                                                                                      | FR-3                 |
| `logs_path`                             | string  | No       | Task execution logs path         | Relative path                                                                                                | FR-2                 |
| `cost.total_usd`                        | number  | No       | Total cost in USD                | USD (non-negative, default: 0)                                                                               | Cost tracking        |
| `cost.breakdown`                        | object  | No       | Provider cost breakdown          | Map of provider to USD                                                                                       | Cost tracking        |
| `cost.api_calls`                        | number  | No       | API calls made                   | Non-negative integer (default: 0)                                                                            | Usage tracking       |
| `cost.tokens_consumed`                  | number  | No       | Tokens consumed                  | Non-negative integer (default: 0)                                                                            | Usage tracking       |
| `rate_limit_budget.provider`            | string  | No       | Provider identifier              | E.g., "openai", "anthropic", "github"                                                                        | Rate limiting        |
| `rate_limit_budget.remaining_requests`  | number  | No       | Remaining request quota          | Non-negative integer                                                                                         | Rate limiting        |
| `rate_limit_budget.total_requests`      | number  | No       | Total request quota              | Non-negative integer                                                                                         | Rate limiting        |
| `rate_limit_budget.reset_at`            | string  | No       | Quota reset timestamp            | ISO 8601 datetime or null                                                                                    | Rate limiting        |
| `rate_limit_budget.retry_after_seconds` | number  | No       | Retry-after seconds              | Non-negative integer                                                                                         | Rate limiting        |
| `trace_id`                              | string  | No       | Trace ID for distributed tracing | UUID or similar                                                                                              | Distributed tracing  |
| `created_at`                            | string  | Yes      | Task creation timestamp          | ISO 8601 datetime                                                                                            | ADR-2                |
| `updated_at`                            | string  | Yes      | Task last update timestamp       | ISO 8601 datetime                                                                                            | ADR-2                |
| `started_at`                            | string  | No       | Task start timestamp             | ISO 8601 datetime or null                                                                                    | Task tracking        |
| `completed_at`                          | string  | No       | Task completion timestamp        | ISO 8601 datetime or null                                                                                    | Task tracking        |
| `metadata`                              | object  | No       | Task metadata                    | Key-value pairs                                                                                              | Extension point      |

---

## Supporting Models

### ContextDocument

**Purpose:** Hash manifests tying context files, summaries, token costs, and provenance data to Features.

**Implements:** FR-1 (Initialize), ADR-2 (State Persistence), ADR-7 (Validation Policy)

**CLI Commands:** `init`, `start`, `context`

**Cardinality:** 1 Feature : 1 ContextDocument

| Field                         | Type     | Required | Description                         | Units/Semantics                         | ADR/FR Reference      |
| ----------------------------- | -------- | -------- | ----------------------------------- | --------------------------------------- | --------------------- |
| `schema_version`              | string   | Yes      | Schema version                      | Semver format                           | ADR-7                 |
| `feature_id`                  | string   | Yes      | Feature identifier                  | ULID/UUIDv7                             | FR-2                  |
| `created_at`                  | string   | Yes      | Context creation timestamp          | ISO 8601 datetime                       | ADR-2                 |
| `updated_at`                  | string   | Yes      | Context last update timestamp       | ISO 8601 datetime                       | ADR-2                 |
| `files[path].path`            | string   | Yes      | Relative path to context file       | From repository root                    | FR-1                  |
| `files[path].hash`            | string   | Yes      | SHA-256 hash of file contents       | 64-character hex string                 | ADR-2                 |
| `files[path].size`            | number   | Yes      | File size                           | Bytes (non-negative integer)            | ADR-2                 |
| `files[path].file_type`       | string   | No       | File type or extension              | E.g., ".ts", ".md"                      | File classification   |
| `files[path].token_count`     | number   | No       | Token count for file                | Non-negative integer                    | Token budgeting       |
| `summaries[].chunk_id`        | string   | Yes      | Chunk identifier (16 hex chars)     | Hash-derived                            | Context summarization |
| `summaries[].file_path`       | string   | Yes      | Source file path                    | Repository-relative                     | Context summarization |
| `summaries[].file_sha`        | string   | Yes      | Source file SHA-256                 | 64-character hex string                 | ADR-2                 |
| `summaries[].chunk_index`     | number   | Yes      | Chunk index (0-based)               | Non-negative integer                    | Chunking heuristics   |
| `summaries[].chunk_total`     | number   | Yes      | Total chunks for file               | Positive integer                        | Chunking heuristics   |
| `summaries[].summary`         | string   | Yes      | Summary text                        | Free text                               | Context summarization |
| `summaries[].token_count`     | number   | Yes      | Summary token count                 | Non-negative integer                    | Token budgeting       |
| `summaries[].generated_at`    | string   | Yes      | Summary generation timestamp        | ISO 8601 datetime                       | ADR-2                 |
| `summaries[].generated_by`    | string   | No       | Generator model/tool                | Free text                               | Provenance            |
| `summaries[].method`          | string   | Yes      | Summarization method identifier     | `"single_chunk"`, `"multi_chunk"`, etc. | Context summarization |
| `summaries[].redaction_flags` | string[] | No       | Redaction markers applied to output | Pattern identifiers                     | Section 4 directives  |
| `total_token_count`           | number   | Yes      | Total token count                   | Non-negative integer (default: 0)       | Token budgeting       |
| `provenance.source`           | string   | Yes      | Source URL or identifier            | Free text                               | FR-1                  |
| `provenance.captured_at`      | string   | Yes      | Capture timestamp                   | ISO 8601 datetime                       | ADR-2                 |
| `provenance.commit_sha`       | string   | No       | Git commit SHA                      | 40-character hex string                 | Version control       |
| `provenance.branch`           | string   | No       | Branch name                         | Free text                               | Version control       |
| `provenance.metadata`         | object   | No       | Additional provenance metadata      | Key-value pairs                         | Extension point       |
| `metadata`                    | object   | No       | Context-level metadata              | Key-value pairs                         | Extension point       |

---

### RateLimitEnvelope

**Purpose:** Provider-specific budget tracking with remaining counts, reset timestamps, retry-after data, and last errors.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `status`, HTTP client

**Cardinality:** 1 Feature : N RateLimitEnvelopes (one per provider)

| Field                 | Type   | Required | Description                    | Units/Semantics                                 | ADR/FR Reference  |
| --------------------- | ------ | -------- | ------------------------------ | ----------------------------------------------- | ----------------- |
| `schema_version`      | string | Yes      | Schema version                 | Semver format                                   | ADR-7             |
| `provider`            | string | Yes      | Provider identifier            | E.g., "openai", "anthropic", "github", "linear" | Provider tracking |
| `remaining_requests`  | number | Yes      | Remaining request quota        | Non-negative integer                            | Rate limiting     |
| `total_requests`      | number | Yes      | Total request quota            | Non-negative integer                            | Rate limiting     |
| `remaining_tokens`    | number | No       | Remaining token quota          | Non-negative integer                            | Rate limiting     |
| `total_tokens`        | number | No       | Total token quota              | Non-negative integer                            | Rate limiting     |
| `reset_at`            | string | No       | Quota reset timestamp          | ISO 8601 datetime or null                       | Rate limiting     |
| `retry_after_seconds` | number | No       | Retry-after seconds            | Non-negative integer                            | Rate limiting     |
| `last_error`          | string | No       | Last rate limit error message  | Free text                                       | Error tracking    |
| `last_error_at`       | string | No       | Last error timestamp           | ISO 8601 datetime                               | Error tracking    |
| `updated_at`          | string | Yes      | Envelope last update timestamp | ISO 8601 datetime                               | ADR-2             |
| `metadata`            | object | No       | Envelope metadata              | Key-value pairs                                 | Extension point   |

---

### ApprovalRecord

**Purpose:** Gate approvals referencing artifacts, signers, timestamps, and rationale.

**Implements:** ADR-5 (Approval Workflow), ADR-7 (Validation Policy)

**CLI Commands:** `approve`, `status`

**Cardinality:** 1 Feature : N ApprovalRecords

| Field            | Type   | Required | Description                       | Units/Semantics                                        | ADR/FR Reference  |
| ---------------- | ------ | -------- | --------------------------------- | ------------------------------------------------------ | ----------------- |
| `schema_version` | string | Yes      | Schema version                    | Semver format                                          | ADR-7             |
| `approval_id`    | string | Yes      | Unique approval record ID         | String                                                 | Approval tracking |
| `feature_id`     | string | Yes      | Feature identifier                | ULID/UUIDv7                                            | FR-2              |
| `gate_type`      | enum   | Yes      | Approval gate type                | `prd`, `spec`, `plan`, `code`, `pr`, `deploy`, `other` | ADR-5             |
| `verdict`        | enum   | Yes      | Approval verdict                  | `approved`, `rejected`, `requested_changes`            | ADR-5             |
| `signer`         | string | Yes      | Signer identifier                 | Username, email, or ID                                 | ADR-5             |
| `signer_name`    | string | No       | Signer display name               | Free text                                              | Display           |
| `approved_at`    | string | Yes      | Approval timestamp                | ISO 8601 datetime                                      | ADR-5             |
| `artifact_hash`  | string | No       | SHA-256 hash of approved artifact | 64-character hex string                                | ADR-2             |
| `artifact_path`  | string | No       | Path to approved artifact         | Relative path                                          | FR-2              |
| `rationale`      | string | No       | Approval rationale/comments       | Free text                                              | Accountability    |
| `metadata`       | object | No       | Approval metadata                 | Key-value pairs                                        | Extension point   |

---

### DeploymentRecord

**Purpose:** Captures PR numbers, merge SHAs, status checks, required reviews, auto-merge state, and deployment job links.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `deploy`, `status`

**Cardinality:** 1 Feature : N DeploymentRecords

| Field                             | Type    | Required | Description                      | Units/Semantics                                                             | ADR/FR Reference    |
| --------------------------------- | ------- | -------- | -------------------------------- | --------------------------------------------------------------------------- | ------------------- |
| `schema_version`                  | string  | Yes      | Schema version                   | Semver format                                                               | ADR-7               |
| `deployment_id`                   | string  | Yes      | Unique deployment record ID      | String                                                                      | Deployment tracking |
| `feature_id`                      | string  | Yes      | Feature identifier               | ULID/UUIDv7                                                                 | FR-2                |
| `status`                          | enum    | Yes      | Deployment status                | `pending`, `in_progress`, `completed`, `failed`, `rolled_back`, `cancelled` | Deployment tracking |
| `pr_number`                       | number  | No       | Pull request number              | Positive integer                                                            | GitHub integration  |
| `pr_url`                          | string  | No       | Pull request URL                 | Valid URL                                                                   | GitHub integration  |
| `merge_sha`                       | string  | No       | Merge commit SHA                 | 40-character Git hash                                                       | Version control     |
| `source_branch`                   | string  | No       | Source branch name               | Free text                                                                   | Version control     |
| `target_branch`                   | string  | No       | Target branch name               | Free text                                                                   | Version control     |
| `status_checks[].name`            | string  | Yes      | Status check name                | Free text                                                                   | CI/CD               |
| `status_checks[].state`           | enum    | Yes      | Status check state               | `pending`, `success`, `failure`, `error`                                    | CI/CD               |
| `status_checks[].description`     | string  | No       | Status check description         | Free text                                                                   | CI/CD               |
| `status_checks[].target_url`      | string  | No       | Status check details URL         | Valid URL                                                                   | CI/CD               |
| `required_reviews[].reviewer`     | string  | Yes      | Reviewer username/ID             | Free text                                                                   | Code review         |
| `required_reviews[].state`        | enum    | Yes      | Review state                     | `approved`, `changes_requested`, `commented`, `pending`                     | Code review         |
| `required_reviews[].submitted_at` | string  | No       | Review submission timestamp      | ISO 8601 datetime or null                                                   | Code review         |
| `auto_merge_enabled`              | boolean | Yes      | Auto-merge enabled flag          | Boolean (default: false)                                                    | Automation          |
| `deployment_job_url`              | string  | No       | Deployment job/workflow URL      | Valid URL                                                                   | CI/CD               |
| `created_at`                      | string  | Yes      | Deployment creation timestamp    | ISO 8601 datetime                                                           | ADR-2               |
| `updated_at`                      | string  | Yes      | Deployment last update timestamp | ISO 8601 datetime                                                           | ADR-2               |
| `started_at`                      | string  | No       | Deployment start timestamp       | ISO 8601 datetime or null                                                   | Deployment tracking |
| `completed_at`                    | string  | No       | Deployment completion timestamp  | ISO 8601 datetime or null                                                   | Deployment tracking |
| `metadata`                        | object  | No       | Deployment metadata              | Key-value pairs                                                             | Extension point     |

---

### IntegrationCredential

**Purpose:** Metadata about tokens/app credentials (provider, auth method, scopes, expiry, redaction tokens).

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `init`, `validate-config`

| Field             | Type   | Required | Description                      | Units/Semantics                                    | ADR/FR Reference    |
| ----------------- | ------ | -------- | -------------------------------- | -------------------------------------------------- | ------------------- |
| `schema_version`  | string | Yes      | Schema version                   | Semver format                                      | ADR-7               |
| `credential_id`   | string | Yes      | Unique credential ID             | String                                             | Credential tracking |
| `provider`        | enum   | Yes      | Provider                         | `github`, `linear`, `anthropic`, `openai`, `other` | Integration         |
| `auth_method`     | enum   | Yes      | Authentication method            | `token`, `oauth`, `api_key`, `app_credentials`     | Security            |
| `scopes`          | array  | Yes      | Credential scopes                | Array of strings (default: [])                     | Authorization       |
| `expiry`          | string | No       | Expiry timestamp                 | ISO 8601 datetime or null                          | Security            |
| `redaction_token` | string | No       | Redacted token for logs          | Partial token                                      | Security            |
| `created_at`      | string | Yes      | Credential creation timestamp    | ISO 8601 datetime                                  | ADR-2               |
| `updated_at`      | string | Yes      | Credential last update timestamp | ISO 8601 datetime                                  | ADR-2               |
| `metadata`        | object | No       | Credential metadata              | Key-value pairs                                    | Extension point     |

---

### AgentProviderCapability

**Purpose:** Manifest entries describing models, max tokens, tool support, rate guidance, cost estimates.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** Agent selection, cost estimation

| Field                                     | Type    | Required | Description                   | Units/Semantics                | ADR/FR Reference  |
| ----------------------------------------- | ------- | -------- | ----------------------------- | ------------------------------ | ----------------- |
| `schema_version`                          | string  | Yes      | Schema version                | Semver format                  | ADR-7             |
| `provider`                                | string  | Yes      | Provider name                 | E.g., "openai", "anthropic"    | Provider tracking |
| `model_name`                              | string  | Yes      | Model name                    | E.g., "gpt-4", "claude-3-opus" | Model selection   |
| `max_tokens`                              | number  | Yes      | Maximum token limit           | Positive integer               | Token budgeting   |
| `supports_tools`                          | boolean | Yes      | Tool/function calling support | Boolean (default: false)       | Capability        |
| `supports_streaming`                      | boolean | Yes      | Streaming support             | Boolean (default: false)       | Capability        |
| `rate_limit_guidance.requests_per_minute` | number  | No       | Requests per minute guidance  | Non-negative integer           | Rate limiting     |
| `rate_limit_guidance.tokens_per_minute`   | number  | No       | Tokens per minute guidance    | Non-negative integer           | Rate limiting     |
| `cost_estimate.input_cost_per_1k_tokens`  | number  | No       | Input cost per 1K tokens      | USD (non-negative)             | Cost estimation   |
| `cost_estimate.output_cost_per_1k_tokens` | number  | No       | Output cost per 1K tokens     | USD (non-negative)             | Cost estimation   |
| `metadata`                                | object  | No       | Capability metadata           | Key-value pairs                | Extension point   |

---

### NotificationEvent

**Purpose:** Optional outbound message log referencing channels, audiences, delivery status, metadata.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `notify`, `status`

| Field             | Type   | Required | Description              | Units/Semantics                                          | ADR/FR Reference    |
| ----------------- | ------ | -------- | ------------------------ | -------------------------------------------------------- | ------------------- |
| `schema_version`  | string | Yes      | Schema version           | Semver format                                            | ADR-7               |
| `event_id`        | string | Yes      | Unique event ID          | String                                                   | Event tracking      |
| `feature_id`      | string | Yes      | Feature identifier       | ULID/UUIDv7                                              | FR-2                |
| `channel`         | enum   | Yes      | Notification channel     | `email`, `slack`, `linear`, `github`, `webhook`, `other` | Channel routing     |
| `audience`        | array  | Yes      | Notification audience    | Array of identifiers (default: [])                       | Recipient targeting |
| `message`         | string | Yes      | Notification message     | Free text                                                | Message content     |
| `delivery_status` | enum   | Yes      | Delivery status          | `pending`, `sent`, `failed`, `delivered`                 | Delivery tracking   |
| `sent_at`         | string | No       | Sent timestamp           | ISO 8601 datetime or null                                | Delivery tracking   |
| `delivered_at`    | string | No       | Delivered timestamp      | ISO 8601 datetime or null                                | Delivery tracking   |
| `error_message`   | string | No       | Delivery error message   | Free text                                                | Error tracking      |
| `created_at`      | string | Yes      | Event creation timestamp | ISO 8601 datetime                                        | ADR-2               |
| `metadata`        | object | No       | Event metadata           | Key-value pairs                                          | Extension point     |

---

### ArtifactBundle

**Purpose:** Export bundle manifest referencing included files, hashes, delivery targets, and CLI versions.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `export`, `bundle`

| Field                   | Type   | Required | Description               | Units/Semantics              | ADR/FR Reference   |
| ----------------------- | ------ | -------- | ------------------------- | ---------------------------- | ------------------ |
| `schema_version`        | string | Yes      | Schema version            | Semver format                | ADR-7              |
| `bundle_id`             | string | Yes      | Unique bundle ID          | String                       | Bundle tracking    |
| `feature_id`            | string | Yes      | Feature identifier        | ULID/UUIDv7                  | FR-2               |
| `included_files[].path` | string | Yes      | File path                 | Relative path                | Bundle contents    |
| `included_files[].hash` | string | Yes      | SHA-256 file hash         | 64-character hex string      | ADR-2              |
| `included_files[].size` | number | Yes      | File size                 | Bytes (non-negative integer) | Bundle contents    |
| `delivery_target`       | string | No       | Delivery target           | URL or identifier            | Export destination |
| `cli_version`           | string | Yes      | CLI version               | Semver format                | Version tracking   |
| `created_at`            | string | Yes      | Bundle creation timestamp | ISO 8601 datetime            | ADR-2              |
| `metadata`              | object | No       | Bundle metadata           | Key-value pairs              | Extension point    |

---

### TraceLink

**Purpose:** Connects PRD goals to spec requirements, ExecutionTasks, and resulting diffs for audit.

**Implements:** ADR-7 (Validation Policy)

**CLI Commands:** `trace`, `audit`, `status`

| Field            | Type   | Required | Description             | Units/Semantics                                                   | ADR/FR Reference |
| ---------------- | ------ | -------- | ----------------------- | ----------------------------------------------------------------- | ---------------- |
| `schema_version` | string | Yes      | Schema version          | Semver format                                                     | ADR-7            |
| `link_id`        | string | Yes      | Unique trace link ID    | String                                                            | Trace tracking   |
| `feature_id`     | string | Yes      | Feature identifier      | ULID/UUIDv7                                                       | FR-2             |
| `source_type`    | enum   | Yes      | Source entity type      | `prd_goal`, `spec_requirement`, `execution_task`, `diff`, `other` | Traceability     |
| `source_id`      | string | Yes      | Source entity ID        | String                                                            | Traceability     |
| `target_type`    | enum   | Yes      | Target entity type      | `prd_goal`, `spec_requirement`, `execution_task`, `diff`, `other` | Traceability     |
| `target_id`      | string | Yes      | Target entity ID        | String                                                            | Traceability     |
| `relationship`   | enum   | Yes      | Relationship type       | `implements`, `tests`, `depends_on`, `derived_from`, `validates`  | Traceability     |
| `created_at`     | string | Yes      | Link creation timestamp | ISO 8601 datetime                                                 | ADR-2            |
| `metadata`       | object | No       | Link metadata           | Key-value pairs                                                   | Extension point  |

---

## Cross-Reference Summary

### FR/IR to Model Mapping

- **FR-1 (Initialize):** RepoConfig, ContextDocument, ResearchTask
- **FR-2 (Run Directory):** Feature, RunArtifact, PlanArtifact, ExecutionTask, Specification
- **FR-3 (Resumability):** Feature (execution tracking), ExecutionTask (retry logic), PlanArtifact (DAG)

### ADR to Model Mapping

- **ADR-2 (State Persistence):** All models (timestamps, hashing, deterministic serialization)
- **ADR-5 (Approval Workflow):** Feature (approvals), Specification (reviewers), ApprovalRecord
- **ADR-7 (Validation Policy):** All models (Zod schemas)

### CLI Command to Model Mapping

- **init:** RepoConfig, ContextDocument, IntegrationCredential
- **start:** Feature, PlanArtifact, ExecutionTask, ResearchTask, Specification
- **status:** Feature, ExecutionTask, DeploymentRecord, RateLimitEnvelope, ApprovalRecord
- **resume:** Feature, ExecutionTask, PlanArtifact
- **approve:** ApprovalRecord, Specification
- **deploy:** DeploymentRecord
- **export:** ArtifactBundle, RunArtifact
- **trace:** TraceLink

---

## Diagram References

See [docs/diagrams/data_model.mmd](../../diagrams/data_model.mmd) for the Entity-Relationship Diagram.

---

## Version History

| Version | Date       | Author      | Changes                               |
| ------- | ---------- | ----------- | ------------------------------------- |
| 1.0.0   | 2025-12-15 | CodeMachine | Initial data model dictionary release |
