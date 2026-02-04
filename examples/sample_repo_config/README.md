# Sample Repository Configuration

This directory contains a complete sample configuration for `codemachine-pipeline`.

## Quick Start

1. Initialize your repository:
   ```bash
   codepipe init
   ```

2. Review the generated `.codepipe/config.json`

3. Customize settings for your project

## Configuration Sections

### Schema Version
- **Field**: `schema_version`
- **Purpose**: Tracks configuration schema version for migrations
- **Format**: Semantic versioning (e.g., "1.0.0")

### Project
Core project metadata and repository information.

**Required Fields**:
- `id`: Unique project identifier
- `repo_url`: Repository URL (GitHub HTTPS or SSH)
- `default_branch`: Default branch for PRs

**Optional Fields**:
- `context_paths`: Files/directories to include in context gathering
- `project_leads`: GitHub usernames of project leads

### GitHub Integration
Configuration for GitHub API integration.

**Environment Variables**:
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

**Required Scopes**: `repo`, `workflow`

**Key Settings**:
- `enabled`: Enable/disable GitHub integration
- `default_reviewers`: Auto-assign PR reviewers
- `branch_protection`: Respect branch protection rules

### Linear Integration
Configuration for Linear issue tracking.

**Environment Variables**:
```bash
export LINEAR_API_KEY=lin_api_your_key_here
```

**Key Settings**:
- `enabled`: Enable/disable Linear integration
- `team_id`: Linear team identifier
- `auto_link_issues`: Automatically link Linear issues to PRs

### Runtime
Execution environment and resource settings.

**Environment Variables**:
```bash
export AGENT_ENDPOINT=https://your-agent-service.com/v1
```

**Key Settings**:
- `max_concurrent_tasks`: Parallel execution limit (1-10)
- `timeout_minutes`: Task execution timeout (5-120)
- `context_token_budget`: Token limit for context (1000-100000)
- `logs_format`: Log format (`ndjson`, `json`, `text`)

### Safety
Security controls and approval workflows.

**Key Settings**:
- `redact_secrets`: Enable secret redaction in logs
- `require_approval_for_*`: Human-in-the-loop gates
- `prevent_force_push`: Prevent force pushes
- `allowed_file_patterns`: Whitelist for modifications
- `blocked_file_patterns`: Blacklist for sensitive files

### Feature Flags
Experimental and optional functionality.

**Available Flags**:
- `enable_auto_merge`: Auto-merge PRs after approval
- `enable_deployment_triggers`: Trigger deployments
- `enable_linear_sync`: Sync with Linear issues
- `enable_context_summarization`: Summarize large codebases
- `enable_resumability`: Resume from checkpoints
- `enable_developer_preview`: Enable preview features

### Constraints
Resource limits and rate limiting.

**Key Settings**:
- `max_file_size_kb`: Max file size for context (100-10000)
- `max_context_files`: Max files in context (10-1000)
- `rate_limits`: API rate limit configurations

## Environment Variable Overrides

Configuration values can be overridden with environment variables following the pattern:
```
CODEPIPE_<SECTION>_<FIELD>
```

**Examples**:
```bash
export CODEPIPE_GITHUB_TOKEN=ghp_override_token
export CODEPIPE_LINEAR_API_KEY=lin_override_key
export CODEPIPE_RUNTIME_AGENT_ENDPOINT=https://override.com/v1
```

## Validation

Validate your configuration:
```bash
codepipe init --validate-only
```

This will:
- Check JSON syntax
- Validate against schema
- Verify required fields
- Check credential environment variables
- Display warnings for missing credentials

## Common Configuration Patterns

### Minimal Configuration (GitHub Only)
```json
{
  "schema_version": "1.0.0",
  "project": {
    "id": "my-project",
    "repo_url": "https://github.com/org/repo.git",
    "default_branch": "main"
  },
  "github": {
    "enabled": true
  },
  "linear": {
    "enabled": false
  },
  "runtime": {},
  "safety": {},
  "feature_flags": {}
}
```

### High-Security Configuration
```json
{
  "safety": {
    "redact_secrets": true,
    "require_approval_for_prd": true,
    "require_approval_for_plan": true,
    "require_approval_for_pr": true,
    "prevent_force_push": true,
    "blocked_file_patterns": [
      ".env*",
      "**/*.key",
      "**/*.pem",
      "**/credentials.*",
      "**/secrets.*",
      "**/.aws/**",
      "**/.ssh/**"
    ]
  },
  "feature_flags": {
    "enable_auto_merge": false
  }
}
```

### Experimental/Development Configuration
```json
{
  "feature_flags": {
    "enable_auto_merge": true,
    "enable_deployment_triggers": true,
    "enable_linear_sync": true,
    "enable_developer_preview": true
  }
}
```

## Schema Reference

Full JSON Schema: `config/schemas/repo_config.schema.json`

## Troubleshooting

### Validation Errors
If you encounter validation errors, the CLI will display:
- Error path (e.g., `project.repo_url`)
- Error message
- Actionable hints

Exit code `10` indicates validation failure.

### Missing Credentials
Warnings about missing credentials won't prevent initialization but will affect functionality:
```
⚠ GitHub integration enabled but GITHUB_TOKEN not set.
  Set GITHUB_TOKEN with scopes: repo, workflow
```

Set the appropriate environment variables to resolve.

### Invalid Schema Version
Schema version must follow semantic versioning:
```
✗ schema_version: Invalid schema version format
```

Use format: `X.Y.Z` (e.g., "1.0.0")

## Next Steps

1. Initialize: `codepipe init`
2. Validate: `codepipe init --validate-only`
3. Set credentials (see above)
4. Start a feature: `codepipe start --prompt "Add user authentication"`
5. Check status: `codepipe status <feature_id>`
