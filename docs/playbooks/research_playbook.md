# Research Task Playbook

**Version:** 1.0.0
**Last Updated:** 2025-12-15
**Status:** Active

---

## 1. Overview

The **Research Coordinator** is a core workflow component that identifies unknowns from user prompts, PRD/spec requirements, and repository context, then queues structured ResearchTasks to fill knowledge gaps before planning and execution.

This playbook describes:

- How to use CLI commands to manage research tasks
- Caching and freshness policies for deterministic results
- Fallback flows when external services (Linear, GitHub) are offline
- Integration with context aggregation and PRD/spec authoring

---

## 2. Key Concepts

### 2.1 ResearchTask Entity

A **ResearchTask** represents a single investigation unit with:

| Field                    | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `task_id`                | Unique identifier (e.g., `RT-1702345678-abc123`)                          |
| `feature_id`             | Parent feature identifier                                                 |
| `title`                  | Human-readable task title                                                 |
| `objectives`             | Array of questions or goals to answer                                     |
| `sources`                | Array of sources to consult (codebase, web, API, documentation)           |
| `cache_key`              | SHA-256 hash of objectives + sources for result reuse                     |
| `freshness_requirements` | Policy defining when cached results expire                                |
| `status`                 | Current state: `pending`, `in_progress`, `completed`, `failed`, `cached`  |
| `results`                | Research findings (summary, details, confidence score, sources consulted) |
| `created_at`             | ISO 8601 timestamp of task creation                                       |
| `updated_at`             | ISO 8601 timestamp of last update                                         |
| `started_at`             | ISO 8601 timestamp when task began execution                              |
| `completed_at`           | ISO 8601 timestamp when task finished                                     |

### 2.2 Caching Strategy

The coordinator uses **deterministic caching** to avoid redundant research:

1. **Cache Key Generation**: `SHA-256(objectives + sources)`
2. **Freshness Check**: Compare `results.timestamp` against `freshness_requirements.max_age_hours`
3. **Force Fresh Flag**: Override cache with `freshness_requirements.force_fresh = true`

If a cached task exists and is fresh, its results are reused immediately without re-execution.

### 2.3 Research Sources

Each source specifies where to consult for information:

| Type            | Identifier Example                  | Description                                  |
| --------------- | ----------------------------------- | -------------------------------------------- |
| `codebase`      | `src/api/endpoints.ts`              | File paths or patterns within the repository |
| `web`           | `https://docs.example.com/api`      | External documentation or API references     |
| `documentation` | `README.md`, `docs/architecture.md` | Markdown or text documentation               |
| `api`           | `https://api.linear.app/graphql`    | REST or GraphQL API endpoints                |
| `linear`        | `issue:PROJ-123`                    | Linear issue or project reference            |
| `github`        | `repo:owner/name/issues/456`        | GitHub issue or PR reference                 |
| `other`         | Custom identifier                   | Extensible for future integrations           |

---

## 3. CLI Commands

### 3.1 List Research Tasks

**Command:**

```bash
codepipe research list [options]
```

**Options:**

- `--status <status>`: Filter by status (`pending`, `in_progress`, `completed`, `failed`, `cached`) — repeatable flag
- `--stale`: Show only tasks with stale cached results
- `--limit <n>`: Limit output to n tasks (integer)
- `--json`: Output as JSON for programmatic consumption

**Example:**

```bash
# List all pending tasks
codepipe research list --status pending

# List stale cached tasks that need refresh
codepipe research list --stale

# Get diagnostics in JSON
codepipe research list --json
```

**Output (Human-Readable):**

```
Research Tasks for Feature: feat-abc123

PENDING (2 tasks):
  [RT-123456-abc] Clarify authentication flow requirements
    Objectives: 3 | Sources: 2 | Created: 2025-12-15T10:30:00Z

  [RT-123456-def] Identify missing API endpoints
    Objectives: 1 | Sources: 1 | Created: 2025-12-15T10:32:00Z

COMPLETED (1 task):
  [RT-123456-xyz] Verify database schema constraints
    Objectives: 2 | Sources: 3 | Completed: 2025-12-15T10:35:00Z
    Confidence: 0.85 | Sources Consulted: 3

Total: 3 tasks (2 pending, 1 completed)
```

**Output (JSON):**

```json
{
  "feature_id": "feat-abc123",
  "tasks": [
    {
      "task_id": "RT-123456-abc",
      "title": "Clarify authentication flow requirements",
      "status": "pending",
      "objectives": ["What OAuth scopes are required?", "..."],
      "sources": [{ "type": "documentation", "identifier": "docs/auth.md" }],
      "cache_key": "a1b2c3d4...",
      "created_at": "2025-12-15T10:30:00Z",
      "updated_at": "2025-12-15T10:30:00Z"
    }
  ],
  "diagnostics": {
    "totalTasks": 3,
    "pendingTasks": 2,
    "completedTasks": 1,
    "cachedTasks": 0
  }
}
```

### 3.2 Create Research Task (Manual)

**Command:**

```bash
codepipe research create [options]
```

**Options:**

- `--title <title>`: Task title (required)
- `--objective <objective>`: Research objective (repeatable)
- `--source <type:identifier>`: Source to consult (repeatable)
- `--max-age <hours>`: Cache freshness in hours (default: 24)
- `--force-fresh`: Force new research even if cache exists

Sources accept `type:identifier` or `type:identifier|description`. Allowed source types:
`codebase`, `web`, `documentation`, `api`, `linear`, `github`, `other`.

**Example:**

```bash
codepipe research create \
  --title "Clarify rate limit policies" \
  --objective "What is the GitHub API rate limit for authenticated requests?" \
  --objective "Are there ways to request higher limits?" \
  --source "web:https://docs.github.com/rest/rate-limit" \
  --source "api:https://api.github.com/rate_limit" \
  --max-age 48
```

**Output:**

```
Created research task: RT-123456-ghi
  Status: pending
  Cache Key: cache-key-example

Use 'codepipe research list' to view all tasks.
```

---

## 4. Integration with Context Aggregation

### 4.1 Workflow Sequence

1. **Context Aggregation**
   CLI triggers `contextAggregator.aggregateContext()` to discover, hash, rank, and budget repository files.

2. **Research Detection**
   Orchestrator calls `researchCoordinator.detectUnknownsFromContext(contextDoc)` to identify missing information.

3. **Task Queueing**
   For each unknown, coordinator generates a ResearchTask with objectives, sources, and cache key.

4. **Caching**
   If a task with the same cache key exists and is fresh, reuse its results. Otherwise, queue new task.

5. **Execution**
   Agent adapter queries sources (codebase search, web fetch, API calls) and records structured results.

6. **PRD/Spec Authoring**
   Research results feed into PRD and specification engines as additional context for requirements drafting.

### 4.2 Context Document References

ResearchTasks can reference specific files from the ContextDocument:

```typescript
{
  "task_id": "RT-123456-abc",
  "sources": [
    {
      "type": "codebase",
      "identifier": "src/api/auth.ts",
      "description": "Referenced in context document as high-relevance file"
    }
  ],
  "metadata": {
    "context_file_id": "src/api/auth.ts",
    "context_hash": "sha256:abc123..."
  }
}
```

This provenance allows traceability from research findings back to the exact context files that triggered the investigation.

### 4.3 Unknown Detection Heuristics

`researchCoordinator.detectUnknownsFromContext()` runs lightweight heuristics before queuing tasks:

1. **Prompt / Spec Scans** – the orchestrator passes prompt + spec text, the coordinator scans for `TBD`, `TODO`, `FIXME`, or multi-question markers (`???`, `??`). Each match becomes a research objective tied to a documentation source (`prompt` or `spec`).
2. **Context File Scans** – up to 12 high-signal files (README/docs/config) are opened from the repo and scanned for the same markers. Matches become codebase sources with metadata linking back to file path + line number so traceability is preserved.
3. **Metadata / Manual Inputs** – if the ContextDocument metadata contains `unknowns` or `research_unknowns`, or the CLI/orchestrator passes `manualUnknowns`, each entry is queued directly with the supplied objectives/sources.

Every generated task stores detection metadata:

```json
{
  "metadata": {
    "detection": {
      "origin": "context_file",
      "file_path": "docs/README.md",
      "line": 17,
      "pattern": "tbd",
      "snippet": "Document webhook authentication details"
    }
  }
}
```

This makes it easy to trace why a task exists and to filter stale cached results with `--stale`.

---

## 5. Fallback Flows for Offline/Rate-Limited Services

### 5.1 Rate Limit Handling

When a rate limit is hit (GitHub, Linear, etc.), the coordinator:

1. **Records Rate Limit Event**
   Logs to `telemetry/rate_limits.json` with provider, endpoint, reset timestamp.

2. **Marks Task as Pending**
   Keeps task in `pending` state with metadata indicating rate limit.

3. **Queues for Retry**
   Orchestrator schedules retry after `reset_timestamp`.

4. **User Notification**
   CLI displays warning: `"Research task deferred due to GitHub rate limit. Will retry at 15:30 UTC."`

**Example Diagnostic:**

```json
{
  "task_id": "RT-123456-def",
  "status": "pending",
  "metadata": {
    "rate_limit": {
      "provider": "github",
      "endpoint": "/search/code",
      "remaining": 0,
      "reset_at": "2025-12-15T15:30:00Z"
    }
  }
}
```

### 5.2 Service Offline (Linear, GitHub)

When an external service is unreachable:

1. **Fallback to Local Context**
   Prioritize codebase and documentation sources over API/web sources.

2. **Mark Task as Pending**
   Log warning: `"Linear API unavailable. Task will be retried on next run."`

3. **Continue Without Blocking**
   Orchestrator proceeds with PRD/spec authoring using available context.

4. **Manual Resolution**
   User can manually provide answers via CLI or approve PRD/spec without research completion.

**Example CLI Output:**

```
⚠ WARNING: 1 research task could not be completed due to service outage.

  [RT-123456-ghi] Fetch Linear issue details (PROJ-456)
    Status: pending
    Reason: Linear API unreachable (connection timeout)

You can:
  1. Retry later: run `codepipe resume` to re-queue pending tasks on next run
  2. Skip: codepipe approve prd --skip-research
```

### 5.3 Mitigation Summary

| Scenario            | Mitigation                       | Impact                              |
| ------------------- | -------------------------------- | ----------------------------------- |
| GitHub rate limit   | Queue for retry after `reset_at` | Deferred research, non-blocking     |
| Linear offline      | Fallback to cached/local context | Reduced research quality, continues |
| Network timeout     | Log error, mark task pending     | Manual retry required               |
| Invalid credentials | Block execution, user warning    | User must fix credentials           |

---

## 6. Storage and Persistence

### 6.1 Directory Structure

All research artifacts are stored under `.codepipe/<feature_id>/research/`:

```
.codepipe/
└── <feature_id>/
    └── research/
        ├── tasks.jsonl           # JSONL append log of all task events
        └── tasks/
            ├── RT-123456-abc.json
            ├── RT-123456-def.json
            └── RT-123456-xyz.json
```

### 6.2 JSONL Event Log

Each task lifecycle event is appended to `tasks.jsonl`:

```jsonl
{"timestamp":"2025-12-15T10:30:00Z","event_type":"created","task_id":"RT-123456-abc","status":"pending","metadata":{"objectives_count":3}}
{"timestamp":"2025-12-15T10:31:00Z","event_type":"started","task_id":"RT-123456-abc","status":"in_progress"}
{"timestamp":"2025-12-15T10:35:00Z","event_type":"completed","task_id":"RT-123456-abc","status":"completed","metadata":{"confidence_score":0.85}}
{"timestamp":"2025-12-15T10:36:00Z","event_type":"cached","task_id":"RT-123456-abc","status":"cached","metadata":{"cache_key":"a1b2c3d4..."}}
```

This log enables auditing, debugging, and time-series analysis of research activities.

### 6.3 Task File Format

Each task is stored as a standalone JSON file conforming to the `ResearchTaskSchema`:

```json
{
  "schema_version": "1.0.0",
  "task_id": "RT-123456-abc",
  "feature_id": "feat-abc123",
  "title": "Clarify authentication flow requirements",
  "objectives": [
    "What OAuth scopes are required?",
    "Are refresh tokens supported?",
    "What is the token expiration policy?"
  ],
  "sources": [
    {
      "type": "documentation",
      "identifier": "docs/auth.md",
      "description": "Authentication documentation"
    },
    {
      "type": "codebase",
      "identifier": "src/api/auth.ts",
      "description": "Auth implementation"
    }
  ],
  "cache_key": "cache-key-example",
  "freshness_requirements": {
    "max_age_hours": 24,
    "force_fresh": false
  },
  "status": "completed",
  "results": {
    "summary": "OAuth scopes required: read:user, repo. Refresh tokens are supported with 90-day expiration.",
    "details": "...",
    "confidence_score": 0.85,
    "timestamp": "2025-12-15T10:35:00Z",
    "sources_consulted": [
      {
        "type": "documentation",
        "identifier": "docs/auth.md"
      }
    ]
  },
  "created_at": "2025-12-15T10:30:00Z",
  "updated_at": "2025-12-15T10:35:00Z",
  "started_at": "2025-12-15T10:31:00Z",
  "completed_at": "2025-12-15T10:35:00Z"
}
```

---

## 7. Metrics and Observability

### 7.1 Prometheus Metrics

The coordinator exports the following metrics to `metrics/prometheus.txt`:

| Metric                           | Type    | Labels       | Description                        |
| -------------------------------- | ------- | ------------ | ---------------------------------- |
| `research_tasks_created_total`   | Counter | `feature_id` | Total research tasks created       |
| `research_tasks_cached_total`    | Counter | `feature_id` | Total tasks reused from cache      |
| `research_tasks_completed_total` | Counter | `feature_id` | Total tasks completed successfully |
| `research_tasks_failed_total`    | Counter | `feature_id` | Total tasks failed                 |

### 7.2 Structured Logs

All coordinator operations emit structured logs to `logs/logs.ndjson`:

```json
{
  "timestamp": "2025-12-15T10:30:00Z",
  "level": "info",
  "component": "research-coordinator",
  "run_id": "feat-abc123",
  "message": "Queueing research task",
  "context": {
    "title": "Clarify authentication flow requirements",
    "objectivesCount": 3
  }
}
```

---

## 8. Best Practices

### 8.1 Writing Effective Objectives

**Good:**

- "What OAuth scopes are required for GitHub API access?"
- "Are there foreign key constraints on the users table?"
- "What is the recommended deployment strategy for this service?"

**Bad:**

- "Check the docs" (too vague)
- "Everything about authentication" (too broad)
- "Look at the code" (no clear goal)

### 8.2 Choosing Sources

- **Codebase**: Use glob patterns or specific file paths for targeted search
- **Documentation**: Prefer Markdown or structured docs over raw comments
- **Web**: Provide authoritative URLs (official docs, RFCs, API references)
- **API**: Include authentication requirements and rate limit info in metadata

### 8.3 Cache Freshness Tuning

| Use Case                           | Recommended `max_age_hours` |
| ---------------------------------- | --------------------------- |
| Static architecture docs           | 168 (7 days)                |
| API schemas (rarely change)        | 72 (3 days)                 |
| Issue status (frequently updated)  | 6 (6 hours)                 |
| Real-time metrics                  | 1 (1 hour)                  |
| Force fresh for critical decisions | 0 + `force_fresh=true`      |

---

## 9. Troubleshooting

### 9.1 Task Stuck in 'pending'

**Symptom:** Task remains pending for extended period.

**Causes:**

- Rate limit not yet reset
- External service offline
- Missing required credentials

**Resolution:**

1. Check `codepipe research list --json` for task metadata
2. Verify credentials: `codepipe doctor`
3. Retry by resuming the run: `codepipe resume`

### 9.2 Cache Not Reusing Results

**Symptom:** New task created despite identical objectives/sources.

**Causes:**

- Source identifiers differ (e.g., absolute vs. relative paths)
- Objectives have whitespace/formatting differences
- `force_fresh=true` set in freshness requirements

**Resolution:**

1. Normalize source identifiers before task creation
2. Trim and deduplicate objectives
3. Check freshness policy in task metadata

### 9.3 Low Confidence Scores

**Symptom:** Research results have `confidence_score < 0.5`.

**Causes:**

- Ambiguous objectives
- Insufficient sources
- Conflicting information across sources

**Resolution:**

1. Refine objectives to be more specific
2. Add authoritative sources
3. Manually review results and adjust confidence if needed

---

## 10. Future Enhancements

### 10.1 Roadmap

- **LLM-Based Unknown Detection**: Automatically analyze context documents and requirements to identify knowledge gaps
- **Multi-Agent Research**: Distribute research tasks across multiple agent sessions for parallel execution
- **Interactive Research**: Prompt user for clarifications when research uncovers ambiguities
- **Research Templates**: Predefined task templates for common scenarios (API discovery, schema validation, etc.)
- **Cross-Feature Caching**: Share research results across features when cache keys match

### 10.2 Integration Points

- **PRD Engine**: Incorporate research results as structured evidence in requirement sections
- **Spec Composer**: Reference research findings in acceptance criteria and test cases
- **Traceability System**: Link ResearchTasks to ExecutionTasks for audit trail
- **Approval Gates**: Require research completion before PRD approval

---

## 11. References

- **FR-6**: Research Task Queueing Requirements
- **FR-7**: Context Ingestion & Summarization
- **ADR-4**: Context Gathering & Refresh Policies
- **Section 2.1**: Context & Research Sequence Diagram
- **Data Model Dictionary**: ResearchTask Schema Definition

---

**Document Owner:** Platform Team
**Review Cycle:** Quarterly
**Feedback:** File issues at `<repo-url>/issues` with label `research-coordinator`
