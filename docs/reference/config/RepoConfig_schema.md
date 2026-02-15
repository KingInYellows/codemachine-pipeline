# RepoConfig Schema Documentation

**Version:** 1.0.0
**Last Updated:** 2025-12-15
**Related ADRs:** ADR-2 (State Persistence), ADR-5 (Approval Workflow)

## Overview

The RepoConfig schema defines the configuration structure for the codemachine-pipeline CLI tool. It provides:

- **Type-safe configuration** using Zod validation
- **Governance controls** for approval workflows and accountability (ADR-5)
- **Config history tracking** for deterministic migrations (ADR-2)
- **Environment variable overrides** following `CODEPIPE_<SECTION>_<FIELD>` convention
- **Integration toggles** for GitHub, Linear, and agent services
- **Runtime safety defaults** to contain risk and prevent misuse

## File Location

The configuration file must be located at:

```
.codepipe/config.json
```

## Schema Structure

### Root Object

| Field              | Type     | Required | Default | Description                                       | ADR Reference |
| ------------------ | -------- | -------- | ------- | ------------------------------------------------- | ------------- |
| `schema_version`   | `string` | ✓        | -       | Semver schema version (e.g., "1.0.0")             | ADR-2         |
| `project`          | `object` | ✓        | -       | Project metadata and repository info              | -             |
| `github`           | `object` | ✓        | -       | GitHub integration configuration                  | -             |
| `linear`           | `object` | ✓        | -       | Linear integration configuration                  | -             |
| `runtime`          | `object` | ✓        | -       | Runtime execution settings                        | ADR-2         |
| `safety`           | `object` | ✓        | -       | Security and safety controls                      | ADR-5         |
| `feature_flags`    | `object` | ✓        | -       | Feature flags for experimental functionality      | -             |
| `validation`       | `object` | ✗        | -       | Validation command registry (ADR-7)               | -             |
| `constraints`      | `object` | ✗        | -       | Resource constraints and limits                   | -             |
| `execution`        | `object` | ✗        | -       | CodeMachine CLI execution configuration           | -             |
| `governance`       | `object` | ✗        | -       | Governance controls and accountability            | ADR-5         |
| `config_history`   | `array`  | ✗        | `[]`    | Migration history tracking                        | ADR-2         |
| `governance_notes` | `string` | ✗        | -       | **DEPRECATED:** Use `governance.governance_notes` | -             |

### project

Project-level metadata and repository information.

| Field            | Type       | Required | Default                          | Description                                     | CLI Override |
| ---------------- | ---------- | -------- | -------------------------------- | ----------------------------------------------- | ------------ |
| `id`             | `string`   | ✓        | -                                | Unique project identifier (typically repo name) | -            |
| `repo_url`       | `string`   | ✓        | -                                | Repository URL (HTTPS or SSH format)            | -            |
| `default_branch` | `string`   | ✗        | `"main"`                         | Default branch for pull requests                | -            |
| `context_paths`  | `string[]` | ✗        | `["src/", "docs/", "README.md"]` | Paths to include in context gathering           | -            |
| `project_leads`  | `string[]` | ✗        | `[]`                             | GitHub usernames of project leads               | -            |

**Example:**

```json
{
  "id": "my-project",
  "repo_url": "https://github.com/org/my-project.git",
  "default_branch": "main",
  "context_paths": ["src/", "docs/", "README.md"],
  "project_leads": ["alice", "bob"]
}
```

### github

GitHub integration configuration and credentials.

| Field               | Type       | Required | Default                    | Description                              | CLI Override            |
| ------------------- | ---------- | -------- | -------------------------- | ---------------------------------------- | ----------------------- |
| `enabled`           | `boolean`  | ✓        | -                          | Enable GitHub integration                | -                       |
| `token_env_var`     | `string`   | ✗        | `"GITHUB_TOKEN"`           | Environment variable name for GitHub PAT | `CODEPIPE_GITHUB_TOKEN` |
| `api_base_url`      | `string`   | ✗        | `"https://api.github.com"` | GitHub API base URL (for Enterprise)     | -                       |
| `required_scopes`   | `string[]` | ✗        | `["repo", "workflow"]`     | Required PAT scopes                      | -                       |
| `default_reviewers` | `string[]` | ✗        | `[]`                       | Default PR reviewers (GitHub usernames)  | -                       |
| `branch_protection` | `object`   | ✗        | See below                  | Branch protection settings awareness     | -                       |

**branch_protection:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `respect_required_reviews` | `boolean` | `true` | Respect branch protection review requirements |
| `respect_status_checks` | `boolean` | `true` | Respect branch protection status check requirements |

**Environment Variable:**
Set `GITHUB_TOKEN` (or custom name) with required scopes before running CLI commands.

### linear

Linear integration configuration.

| Field              | Type      | Required | Default            | Description                                  | CLI Override              |
| ------------------ | --------- | -------- | ------------------ | -------------------------------------------- | ------------------------- |
| `enabled`          | `boolean` | ✓        | -                  | Enable Linear integration                    | -                         |
| `api_key_env_var`  | `string`  | ✗        | `"LINEAR_API_KEY"` | Environment variable name for Linear API key | `CODEPIPE_LINEAR_API_KEY` |
| `team_id`          | `string`  | ✗        | -                  | Linear team ID                               | -                         |
| `project_id`       | `string`  | ✗        | -                  | Linear project ID                            | -                         |
| `auto_link_issues` | `boolean` | ✗        | `true`             | Automatically link Linear issues to PRs      | -                         |

**Environment Variable:**
Set `LINEAR_API_KEY` (or custom name) before enabling Linear integration.

### runtime

Runtime execution settings for agent orchestration.

| Field                     | Type      | Required | Default            | Description                                      | CLI Override                            |
| ------------------------- | --------- | -------- | ------------------ | ------------------------------------------------ | --------------------------------------- |
| `agent_endpoint`          | `string`  | ✗        | -                  | AI agent service endpoint URL                    | `CODEPIPE_RUNTIME_AGENT_ENDPOINT`       |
| `agent_endpoint_env_var`  | `string`  | ✗        | `"AGENT_ENDPOINT"` | Environment variable for agent endpoint          | -                                       |
| `max_concurrent_tasks`    | `integer` | ✗        | `3`                | Maximum concurrent execution tasks (1-10)        | `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` |
| `timeout_minutes`         | `integer` | ✗        | `30`               | Task execution timeout in minutes (5-120)        | `CODEPIPE_RUNTIME_TIMEOUT_MINUTES`      |
| `context_token_budget`    | `integer` | ✗        | `32000`            | Token budget for context gathering (1000-100000) | -                                       |
| `context_cost_budget_usd` | `number`  | ✗        | `5`                | USD budget for context summarization             | -                                       |
| `logs_format`             | `string`  | ✗        | `"ndjson"`         | Log format: `"ndjson"`, `"json"`, or `"text"`    | -                                       |
| `run_directory`           | `string`  | ✗        | `".codepipe/runs"` | Base directory for feature runs (ADR-2)          | -                                       |

**Environment Variable:**
Set `AGENT_ENDPOINT` or configure `agent_endpoint` in config.

### safety

Security and safety controls to contain risk.

| Field                       | Type       | Required | Default            | Description                                        | CLI Override |
| --------------------------- | ---------- | -------- | ------------------ | -------------------------------------------------- | ------------ |
| `redact_secrets`            | `boolean`  | ✗        | `true`             | Enable secret redaction in logs                    | -            |
| `require_approval_for_prd`  | `boolean`  | ✗        | `true`             | **DEPRECATED:** Use `governance.approval_workflow` | -            |
| `require_approval_for_plan` | `boolean`  | ✗        | `true`             | **DEPRECATED:** Use `governance.approval_workflow` | -            |
| `require_approval_for_pr`   | `boolean`  | ✗        | `true`             | **DEPRECATED:** Use `governance.approval_workflow` | -            |
| `prevent_force_push`        | `boolean`  | ✗        | `true`             | **DEPRECATED:** Use `governance.risk_controls`     | -            |
| `allowed_file_patterns`     | `string[]` | ✗        | `["**/*.ts", ...]` | File patterns allowed for modification             | -            |
| `blocked_file_patterns`     | `string[]` | ✗        | `[".env", ...]`    | File patterns blocked from modification            | -            |

**Note:** Approval and force push settings are deprecated. Use `governance` section instead.

### feature_flags

Feature flags for experimental functionality.

| Field                          | Type      | Required | Default | Description                                          | CLI Override |
| ------------------------------ | --------- | -------- | ------- | ---------------------------------------------------- | ------------ |
| `enable_auto_merge`            | `boolean` | ✗        | `false` | Enable automatic PR merge after approval             | -            |
| `enable_deployment_triggers`   | `boolean` | ✗        | `false` | Enable deployment workflow triggers                  | -            |
| `enable_linear_sync`           | `boolean` | ✗        | `false` | Enable Linear issue synchronization                  | -            |
| `enable_context_summarization` | `boolean` | ✗        | `true`  | Enable context summarization for large codebases     | -            |
| `enable_resumability`          | `boolean` | ✗        | `true`  | Enable feature resumability from checkpoints (ADR-2) | -            |
| `enable_developer_preview`     | `boolean` | ✗        | `false` | Enable developer preview features                    | -            |

### validation

Validation command registry configuration (ADR-7 / FR-14).

| Field              | Type                    | Required | Default                            | Description                                      | CLI Override |
| ------------------ | ----------------------- | -------- | ---------------------------------- | ------------------------------------------------ | ------------ |
| `commands`         | `object[]`              | ✗        | lint/test/typecheck/build defaults | Validation command definitions                   | -            |
| `template_context` | `record<string,string>` | ✗        | `{}`                               | Global templating tokens applied to each command | -            |

**commands[] definition:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `enum("lint","test","typecheck","build")` | ✓ | - | Validation command type |
| `command` | `string` | ✓ | - | Shell command template |
| `auto_fix_command` | `string` | ✗ | - | Alternate command for auto-fix attempts |
| `supports_auto_fix` | `boolean` | ✗ | `false` | Enable auto-fix loop |
| `cwd` | `string` | ✗ | `"."` | Working directory (relative or absolute) |
| `env` | `record<string,string>` | ✗ | `{}` | Additional environment variables |
| `required` | `boolean` | ✗ | `true` | Whether the command blocks PR/deploy |
| `timeout_ms` | `integer` | ✗ | `120000` | Timeout per attempt (1000-600000 ms) |
| `max_retries` | `integer` | ✗ | `3` | Additional retries after the first attempt |
| `backoff_ms` | `integer` | ✗ | `1000` | Backoff multiplier between retries |
| `description` | `string` | ✗ | - | Human-friendly description |
| `template_context` | `record<string,string>` | ✗ | `{}` | Per-command templating tokens |

**Templating tokens:** Commands may include placeholders such as `{{feature_id}}`, `{{run_dir}}`, `{{repo_root}}`, `{{command_cwd}}`, and any keys defined in `template_context`. Run `codepipe validate --init` after editing this section so the run directory registry stays in sync.

### execution

_(Optional)_ CodeMachine CLI integration and execution settings. The entire `execution` block is optional in the config.

| Field                   | Type                              | Required | Default         | Description                                       | CLI Override                        |
| ----------------------- | --------------------------------- | -------- | --------------- | ------------------------------------------------- | ----------------------------------- |
| `codemachine_cli_path`  | `string`                          | ✗        | `"codemachine"` | Path to the CodeMachine CLI binary                | `CODEPIPE_EXECUTION_CLI_PATH`       |
| `default_engine`        | `enum("claude","codex","openai")` | ✗        | `"claude"`      | Default execution engine                          | `CODEPIPE_EXECUTION_DEFAULT_ENGINE` |
| `workspace_dir`         | `string`                          | ✗        | -               | Working directory for execution                   | -                                   |
| `spec_path`             | `string`                          | ✗        | -               | Path to specification file                        | -                                   |
| `task_timeout_ms`       | `integer`                         | ✗        | `1800000`       | Task timeout in milliseconds (60000-7200000)      | `CODEPIPE_EXECUTION_TIMEOUT_MS`     |
| `max_parallel_tasks`    | `integer`                         | ✗        | `1`             | Maximum parallel task executions (1-10)           | -                                   |
| `max_log_buffer_size`   | `integer`                         | ✗        | `10485760`      | Maximum log buffer size in bytes (1024-104857600) | -                                   |
| `env_allowlist`         | `string[]`                        | ✗        | `[]`            | Environment variables to pass through to tasks    | -                                   |
| `max_retries`           | `integer`                         | ✗        | `3`             | Maximum retry attempts per task (0-10)            | -                                   |
| `retry_backoff_ms`      | `integer`                         | ✗        | `5000`          | Backoff interval between retries in ms (min 1000) | -                                   |
| `log_rotation_mb`       | `integer`                         | ✗        | `100`           | Log file rotation threshold in MB (1-10240)       | -                                   |
| `log_rotation_keep`     | `integer`                         | ✗        | `3`             | Number of rotated log files to keep (1-20)        | -                                   |
| `log_rotation_compress` | `boolean`                         | ✗        | `false`         | Compress rotated log files                        | -                                   |

**Example:**

```json
{
  "codemachine_cli_path": "codemachine",
  "default_engine": "claude",
  "task_timeout_ms": 1800000,
  "max_parallel_tasks": 1,
  "max_retries": 3,
  "retry_backoff_ms": 5000,
  "log_rotation_mb": 100,
  "log_rotation_keep": 3,
  "log_rotation_compress": false
}
```

### constraints

Resource constraints and rate limits.

| Field               | Type      | Required | Default   | Description                                     | CLI Override |
| ------------------- | --------- | -------- | --------- | ----------------------------------------------- | ------------ |
| `max_file_size_kb`  | `integer` | ✗        | `1000`    | Maximum file size for context in KB (100-10000) | -            |
| `max_context_files` | `integer` | ✗        | `100`     | Maximum files to include in context (10-1000)   | -            |
| `rate_limits`       | `object`  | ✗        | See below | API rate limit configurations                   | -            |

**rate_limits:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `github_requests_per_hour` | `integer` | `5000` | GitHub API rate limit |
| `linear_requests_per_minute` | `integer` | `60` | Linear API rate limit |
| `agent_requests_per_hour` | `integer` | `100` | Agent service rate limit |

### governance

**New in 1.0.0** - Governance controls for approval workflows and accountability (ADR-5).

| Field               | Type       | Required | Default   | Description                            | CLI Override |
| ------------------- | ---------- | -------- | --------- | -------------------------------------- | ------------ |
| `approval_workflow` | `object`   | ✗        | See below | Gate-by-gate approval requirements     | -            |
| `accountability`    | `object`   | ✗        | See below | Accountability and audit settings      | -            |
| `risk_controls`     | `object`   | ✗        | See below | Risk containment controls              | -            |
| `compliance_tags`   | `string[]` | ✗        | `[]`      | Compliance tags (e.g., "SOC2", "GDPR") | -            |
| `governance_notes`  | `string`   | ✗        | -         | Free-form governance documentation     | -            |

**approval_workflow (ADR-5):**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `require_approval_for_prd` | `boolean` | `true` | Require approval at PRD gate |
| `require_approval_for_spec` | `boolean` | `true` | Require approval at spec gate |
| `require_approval_for_plan` | `boolean` | `true` | Require approval at plan gate |
| `require_approval_for_code` | `boolean` | `true` | Require approval at code gate |
| `require_approval_for_pr` | `boolean` | `true` | Require approval at PR gate |
| `require_approval_for_deploy` | `boolean` | `true` | Require approval at deploy gate |

**accountability:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `record_approver_identity` | `boolean` | `true` | Record approver identity in approvals.json |
| `require_approval_reason` | `boolean` | `false` | Require reason text for approvals |
| `audit_log_retention_days` | `integer` | `365` | Audit log retention period (1-3650 days) |

**risk_controls:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prevent_auto_merge` | `boolean` | `true` | Prevent automatic PR merge |
| `prevent_force_push` | `boolean` | `true` | Prevent force pushes to branches |
| `require_branch_protection` | `boolean` | `true` | Require branch protection enabled |
| `max_files_per_pr` | `integer` | `100` | Maximum files per PR (1-1000) |
| `max_lines_changed_per_pr` | `integer` | `5000` | Maximum lines changed per PR (1-50000) |

### config_history

**New in 1.0.0** - Migration history for schema version tracking (ADR-2).

Array of history entries with the following structure:

| Field                | Type      | Required | Description                          |
| -------------------- | --------- | -------- | ------------------------------------ |
| `timestamp`          | `string`  | ✓        | ISO 8601 datetime of change          |
| `schema_version`     | `string`  | ✓        | Schema version at time of change     |
| `changed_by`         | `string`  | ✓        | Identifier of who made the change    |
| `change_description` | `string`  | ✓        | Description of what changed          |
| `migration_applied`  | `boolean` | ✗        | Whether migration script was applied |
| `backup_path`        | `string`  | ✗        | Path to config backup if created     |

**Example:**

```json
{
  "config_history": [
    {
      "timestamp": "2025-12-15T10:24:00.000Z",
      "schema_version": "1.0.0",
      "changed_by": "codepipe init",
      "change_description": "Initial configuration created",
      "migration_applied": false
    }
  ]
}
```

## Environment Variable Overrides

The CLI supports environment variable overrides following the `CODEPIPE_<SECTION>_<FIELD>` naming convention:

| Environment Variable                    | Overrides                        | Example                                                         |
| --------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `CODEPIPE_GITHUB_TOKEN`                 | `github.token_env_var`           | `export CODEPIPE_GITHUB_TOKEN=ghp_xxx`                          |
| `CODEPIPE_LINEAR_API_KEY`               | `linear.api_key_env_var`         | `export CODEPIPE_LINEAR_API_KEY=lin_xxx`                        |
| `CODEPIPE_RUNTIME_AGENT_ENDPOINT`       | `runtime.agent_endpoint`         | `export CODEPIPE_RUNTIME_AGENT_ENDPOINT=https://...`            |
| `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` | `runtime.max_concurrent_tasks`   | `export CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=5`                |
| `CODEPIPE_RUNTIME_TIMEOUT_MINUTES`      | `runtime.timeout_minutes`        | `export CODEPIPE_RUNTIME_TIMEOUT_MINUTES=60`                    |
| `CODEPIPE_EXECUTION_CLI_PATH`           | `execution.codemachine_cli_path` | `export CODEPIPE_EXECUTION_CLI_PATH=/usr/local/bin/codemachine` |
| `CODEPIPE_EXECUTION_DEFAULT_ENGINE`     | `execution.default_engine`       | `export CODEPIPE_EXECUTION_DEFAULT_ENGINE=codex`                |
| `CODEPIPE_EXECUTION_TIMEOUT_MS`         | `execution.task_timeout_ms`      | `export CODEPIPE_EXECUTION_TIMEOUT_MS=3600000`                  |

**Precedence:** Environment variables override config file values.

## Validation

The schema is validated using Zod with the following rules:

1. **Required fields** must be present
2. **Type checking** ensures correct data types
3. **Format validation** for URLs, semver, datetime
4. **Range validation** for numeric constraints
5. **Enum validation** for limited choice fields
6. **Deprecation warnings** for legacy fields

### Validation Errors

When validation fails, the CLI provides actionable error messages:

```
Configuration validation failed:

  • schema_version: Invalid schema version format (must be semver)
    → Use semver format: "1.0.0"

  • project.repo_url: Invalid repository URL format
    → Use format: "https://github.com/org/repo.git"

For detailed schema documentation, see:
  docs/requirements/RepoConfig_schema.md
  .codepipe/templates/config.example.json
```

## Migration Guide

When upgrading schema versions:

1. **Backup current config:** `cp .codepipe/config.json .codepipe/config.json.backup`
2. **Review migration checklist:** See `docs/requirements/config_migrations.md`
3. **Update schema_version:** Change to target version
4. **Apply migrations:** Run any required migration scripts
5. **Add history entry:** Document the migration in `config_history`
6. **Validate:** Run `codepipe init --validate-only`

## Complete Example

See `.codepipe/templates/config.example.json` for a complete annotated example.

## Related Documentation

- **ADR-2:** State Persistence - Defines run directory structure and deterministic storage
- **ADR-5:** Approval Workflow - Defines human-in-the-loop gates and accountability
- **Migration Checklist:** `docs/requirements/config_migrations.md`
- **Example Config:** `.codepipe/templates/config.example.json`

## Schema Version History

| Version | Date       | Changes                                             |
| ------- | ---------- | --------------------------------------------------- |
| 1.0.0   | 2025-12-15 | Initial schema with governance and history tracking |
