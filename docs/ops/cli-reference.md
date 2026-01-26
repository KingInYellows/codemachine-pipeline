# CLI Reference

This document provides comprehensive documentation for the `ai-feature` command-line interface.

## Overview

The `ai-feature` CLI is the primary interface for managing feature development pipelines. It provides commands for initializing projects, starting features, checking status, managing approvals, and more.

## Installation

```bash
# Install globally
npm install -g ai-feature-pipeline

# Or run via npx
npx ai-feature-pipeline <command>
```

---

## Commands

### ai-feature init

Initialize ai-feature-pipeline with schema-validated configuration.

#### Description

Creates the `.ai-feature-pipeline/` directory structure and generates a default `config.json` file based on your repository settings. This command must be run from within a git repository.

#### Synopsis

```bash
ai-feature init [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--force` | `-f` | Force re-initialization even if config already exists | `false` |
| `--validate-only` | | Only validate existing config without creating new files | `false` |
| `--dry-run` | | Compute config and validation without creating files | `false` |
| `--json` | | Output results in JSON format | `false` |
| `--yes` | `-y` | Skip interactive confirmations (assume yes) | `false` |

#### Examples

```bash
# Initialize in current repository
ai-feature init

# Force re-initialization
ai-feature init --force

# Validate existing configuration
ai-feature init --validate-only

# Preview what would be created (no files written)
ai-feature init --dry-run --json

# Non-interactive initialization
ai-feature init --yes
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `10` | Validation error (config schema, missing required fields) |
| `20` | Environment issue (missing tools, not a git repo, filesystem permissions) |
| `30` | Credential issue (missing tokens, invalid scopes) |

#### Directory Structure Created

```
.ai-feature-pipeline/
├── config.json       # Repository configuration
├── runs/             # Feature run directories
├── logs/             # Command logs
└── artifacts/        # Shared artifacts
```

---

### ai-feature start

Start a new feature development pipeline.

#### Description

Creates a new feature run directory, aggregates repository context, detects research tasks, and generates a PRD (Product Requirements Document). The pipeline can be initialized from a text prompt, a Linear issue, or an existing specification file.

#### Synopsis

```bash
ai-feature start [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--prompt` | `-p` | Feature description prompt | |
| `--linear` | `-l` | Linear issue ID to import as feature specification | |
| `--spec` | `-s` | Path to existing specification file | |
| `--json` | | Output results in JSON format | `false` |
| `--dry-run` | | Simulate execution without making changes | `false` |
| `--max-parallel` | | Maximum parallel tasks during execution (1-10) | `1` |
| `--skip-execution` | | Skip task execution phase (stop after PRD) | `false` |

**Note:** `--prompt`, `--linear`, and `--spec` are mutually exclusive. You must provide exactly one.

#### Examples

```bash
# Start from a text prompt
ai-feature start --prompt "Add user authentication with OAuth support"

# Start from a Linear issue
ai-feature start --linear PROJ-123

# Start from an existing specification file
ai-feature start --spec ./specs/authentication.md

# Preview execution plan without making changes
ai-feature start --prompt "OAuth integration" --dry-run

# Get JSON output for automation
ai-feature start --prompt "Add logging" --json

# Run with parallel task execution
ai-feature start --prompt "Refactor database layer" --max-parallel 4

# Stop after PRD generation (skip execution)
ai-feature start --prompt "New API endpoints" --skip-execution
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (pipeline completed) |
| `1` | General error |
| `10` | Validation error (must provide input source, repo not initialized) |
| `30` | Approval required (PRD awaiting approval before execution) |

#### Output

The command creates a run directory at `.ai-feature-pipeline/runs/FEAT-<uuid>/` containing:

- `manifest.json` - Run state and metadata
- `context/` - Aggregated repository context
- `artifacts/prd.md` - Generated PRD document
- `research/` - Research task tracking
- `logs/` - Execution logs

---

### ai-feature status

Show the current state of a feature development pipeline.

#### Description

Displays comprehensive status information including pipeline state, queue status, approvals, context summaries, traceability links, branch protection compliance, rate limits, and research task progress.

#### Synopsis

```bash
ai-feature status [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to query (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed execution logs and task breakdown | `false` |
| `--show-costs` | | Include token usage and cost estimates | `false` |

#### Examples

```bash
# Show status of latest feature
ai-feature status

# Show status of specific feature
ai-feature status --feature FEAT-abc123

# Get JSON output for parsing
ai-feature status --json

# Show verbose details including task breakdown
ai-feature status --verbose

# Include cost telemetry
ai-feature status --show-costs
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found) |

#### Output Sections

The status output includes:

- **Feature Info**: ID, title, source, manifest path
- **Pipeline Status**: Current state (in_progress, paused, completed, failed)
- **Queue State**: Pending, completed, and failed task counts
- **Approvals**: Pending and completed approval gates
- **Context**: File count, token usage, summaries
- **Plan**: Task count, entry points, DAG metadata
- **Traceability**: PRD-to-spec-to-task link counts
- **Branch Protection**: Compliance status, blockers, review requirements
- **Rate Limits**: API quota status for GitHub/Linear
- **Research**: Research task counts and status

---

### ai-feature doctor

Run environment diagnostics and readiness checks.

#### Description

Validates that your system meets all prerequisites for ai-feature-pipeline operations. Checks runtime environment, repository setup, network connectivity, configuration validity, and credential availability.

#### Synopsis

```bash
ai-feature doctor [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed diagnostic information | `false` |

#### Examples

```bash
# Run all diagnostic checks
ai-feature doctor

# Get JSON output for CI/automation
ai-feature doctor --json

# Show detailed information
ai-feature doctor --verbose
```

#### Checks Performed

| Check | Description | Exit Code on Failure |
|-------|-------------|---------------------|
| Node.js Version | Validates Node.js v20+ (v24 preferred) | 20 |
| Git CLI | Verifies git is installed | 20 |
| npm | Validates npm is available | 20 |
| Docker | Checks Docker installation (optional) | Warning only |
| Git Repository | Verifies current directory is a git repo | 20 |
| Filesystem Permissions | Tests write access to pipeline directory | 20 |
| Outbound HTTPS | Tests connectivity to api.github.com | Warning only |
| RepoConfig | Validates config.json schema | 10 |
| CodeMachine CLI | Checks codemachine execution engine | Warning only |
| GITHUB_TOKEN | Verifies GitHub token when enabled | 30 |
| LINEAR_API_KEY | Verifies Linear API key when enabled | 30 |
| Agent Endpoint | Checks agent service configuration | Warning only |

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed (warnings allowed) |
| `10` | Configuration validation errors |
| `20` | Environment issues (missing tools, permissions) |
| `30` | Credential issues (missing tokens/keys) |

---

### ai-feature approve

Approve or deny a feature pipeline gate.

#### Description

Grants or denies approval for human-in-the-loop governance gates. Records signer identity, computes artifact hashes, and updates the approval registry.

#### Synopsis

```bash
ai-feature approve <gate> [FLAGS]
```

#### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `gate` | Approval gate type: `prd`, `spec`, `plan`, `code`, `pr`, `deploy` | Yes |

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID (defaults to current/latest) | |
| `--approve` | `-a` | Grant approval | |
| `--deny` | `-d` | Deny approval | |
| `--signer` | `-s` | Signer identity (email or username) | Required |
| `--signer-name` | | Signer display name | |
| `--comment` | `-c` | Approval or denial rationale | |
| `--json` | | Output results in JSON format | `false` |
| `--skip-hash-check` | | Skip artifact hash validation (use with caution) | `false` |

**Note:** Either `--approve` or `--deny` must be specified.

#### Gate Types

| Gate | Description | Artifact |
|------|-------------|----------|
| `prd` | Product Requirements Document | `artifacts/prd.md` |
| `spec` | Technical Specification | `artifacts/spec.md` |
| `plan` | Execution Plan | `plan.json` |
| `code` | Implementation Code | `manifest.json` |
| `pr` | Pull Request | `manifest.json` |
| `deploy` | Deployment | `manifest.json` |

#### Examples

```bash
# Approve PRD
ai-feature approve prd --approve --signer "user@example.com"

# Deny spec with comment
ai-feature approve spec --deny --signer "reviewer@example.com" \
  --comment "Missing acceptance criteria"

# Approve specific feature
ai-feature approve prd --approve --signer "user@example.com" \
  --feature FEAT-abc123

# Get JSON output
ai-feature approve prd --approve --signer "user@example.com" --json

# Skip hash validation (debugging only)
ai-feature approve prd --approve --signer "user@example.com" --skip-hash-check
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (approval granted/denied) |
| `1` | General error |
| `10` | Validation error (invalid gate type, feature not found, no pending approval) |
| `30` | Human action required (artifact modified since approval requested) |

---

### ai-feature plan

Display the execution plan DAG, task summaries, and dependency graph.

#### Description

Shows the generated execution plan including task counts, entry points, dependency chains, and DAG metadata. Can also compare the plan against the current spec to detect staleness.

#### Synopsis

```bash
ai-feature plan [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to query (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed task breakdown and dependency chains | `false` |
| `--show-diff` | | Compare plan against spec hash to detect changes | `false` |

#### Examples

```bash
# Show plan for latest feature
ai-feature plan

# Show plan for specific feature
ai-feature plan --feature FEAT-abc123

# Get JSON output
ai-feature plan --json

# Show detailed task list
ai-feature plan --verbose

# Check if plan is stale
ai-feature plan --show-diff
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found) |

---

### ai-feature resume

Resume a failed or paused feature pipeline execution with safety checks.

#### Description

Analyzes the current state of a feature pipeline and resumes execution from the last checkpoint. Performs integrity checks, queue validation, and rate limit verification before continuing.

#### Synopsis

```bash
ai-feature resume [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to resume (defaults to current/latest) | |
| `--dry-run` | `-d` | Analyze resume eligibility without executing | `false` |
| `--force` | | Override blockers (integrity warnings) - use with caution | `false` |
| `--skip-hash-verification` | | Skip artifact integrity checks (dangerous, debugging only) | `false` |
| `--validate-queue` | | Validate queue files before resuming | `true` |
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed diagnostics | `false` |
| `--max-parallel` | | Maximum parallel tasks during execution (1-10) | `1` |

#### Resume Eligibility

A feature can be resumed when:

- Pipeline status is `paused`, `failed`, or `in_progress`
- No fatal errors prevent continuation
- All required approvals are granted
- Queue integrity is valid (unless `--force` is used)

#### Examples

```bash
# Resume latest feature
ai-feature resume

# Analyze resume eligibility without executing
ai-feature resume --dry-run

# Resume specific feature
ai-feature resume --feature FEAT-abc123

# Force resume despite warnings
ai-feature resume --force

# Resume with parallel execution
ai-feature resume --max-parallel 4

# Verbose output with queue validation details
ai-feature resume --verbose
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Resume successful or dry-run completed |
| `1` | General error |
| `10` | Resume blocked (blockers present, pending approvals) |
| `20` | Integrity check failed (artifact hash mismatch, missing files) |
| `30` | Queue validation failed |

---

### ai-feature validate

Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops.

#### Description

Runs configured validation commands with automatic retry and fix capabilities. Supports running all validations or specific command types.

#### Synopsis

```bash
ai-feature validate [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to validate (defaults to current/latest) | |
| `--command` | `-c` | Specific validation command to run | |
| `--auto-fix` | | Enable auto-fix for supported commands | `true` |
| `--no-auto-fix` | | Disable auto-fix | |
| `--max-retries` | | Override maximum retry attempts (0-20) | |
| `--timeout` | | Override command timeout in seconds (10-600) | |
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed execution logs | `false` |
| `--init` | | Initialize validation registry from config | `false` |

#### Validation Types

| Type | Description | Auto-Fix Support |
|------|-------------|------------------|
| `lint` | Code linting (ESLint, etc.) | Yes |
| `test` | Unit/integration tests | No |
| `typecheck` | TypeScript type checking | No |
| `build` | Build compilation | No |

#### Examples

```bash
# Initialize validation registry (run first)
ai-feature validate --init

# Run all validations
ai-feature validate

# Run specific validation
ai-feature validate --command lint

# Run tests without auto-fix
ai-feature validate --command test --no-auto-fix

# Override retry limit
ai-feature validate --max-retries 5

# Get JSON output
ai-feature validate --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All validations passed |
| `1` | General error (config/setup issues) |
| `10` | Validation failed (one or more commands failed) |
| `11` | Retry limit exceeded (requires manual intervention) |

---

### ai-feature rate-limits

Display rate limit status and telemetry for API providers.

#### Description

Shows current rate limit state across all providers (GitHub, Linear, etc.). Surfaces cooldown timers, backlog states, and manual intervention requirements.

#### Synopsis

```bash
ai-feature rate-limits [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to query (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed rate limit history and diagnostics | `false` |
| `--provider` | `-p` | Filter output to specific provider (github, linear, etc.) | |
| `--clear` | | Clear cooldown for specified provider (requires confirmation) | |

#### Examples

```bash
# Show all rate limits
ai-feature rate-limits

# Show rate limits for specific feature
ai-feature rate-limits --feature FEAT-abc123

# Filter to specific provider
ai-feature rate-limits --provider github

# Get JSON output
ai-feature rate-limits --json

# Clear cooldown for a provider
ai-feature rate-limits --clear github --feature FEAT-abc123

# Show detailed history
ai-feature rate-limits --verbose
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Feature not found |

---

## Global Options

The following options are available on all commands:

| Option | Description |
|--------|-------------|
| `--help` | Show help for command |
| `--version` | Show CLI version |

### Help Examples

```bash
# Show general help
ai-feature --help

# Show help for specific command
ai-feature start --help
ai-feature approve --help
```

---

## Environment Variables

The CLI reads configuration from environment variables for credentials and runtime settings.

### Required Variables (when integrations enabled)

| Variable | Description | When Required |
|----------|-------------|---------------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | When `github.enabled: true` |
| `LINEAR_API_KEY` | Linear API Key | When `linear.enabled: true` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_ENDPOINT` | Agent service endpoint URL | From config |
| `JSON_OUTPUT` | Force JSON output mode (set by `--json` flag) | |
| `LINEAR_ENABLE_PREVIEW` | Enable Linear preview features | `false` |

### Configuration Override Variables

These variables override corresponding config.json settings:

| Variable | Config Path |
|----------|-------------|
| `AI_FEATURE_GITHUB_TOKEN` | `github.token_env_var` |
| `AI_FEATURE_LINEAR_API_KEY` | `linear.api_key_env_var` |
| `AI_FEATURE_RUNTIME_AGENT_ENDPOINT` | `runtime.agent_endpoint` |
| `AI_FEATURE_RUNTIME_MAX_CONCURRENT_TASKS` | `runtime.max_concurrent_tasks` |
| `AI_FEATURE_RUNTIME_TIMEOUT_MINUTES` | `runtime.timeout_minutes` |

### Setting Environment Variables

```bash
# Export in current shell
export GITHUB_TOKEN=ghp_your_token_here
export LINEAR_API_KEY=lin_api_your_key_here

# Add to shell profile for persistence
echo 'export GITHUB_TOKEN=ghp_your_token_here' >> ~/.bashrc
echo 'export LINEAR_API_KEY=lin_api_your_key_here' >> ~/.bashrc
source ~/.bashrc

# Or use a .env file with dotenv
# .env
GITHUB_TOKEN=ghp_your_token_here
LINEAR_API_KEY=lin_api_your_key_here
```

---

## Exit Codes Reference

All commands follow a consistent exit code scheme:

| Exit Code | Category | Description |
|-----------|----------|-------------|
| `0` | Success | Operation completed successfully |
| `1` | General Error | Unexpected error, see error message for details |
| `10` | Validation Error | Input validation failed, config issues, feature not found |
| `11` | Retry Exceeded | Auto-retry limit reached, manual intervention required |
| `20` | Environment Error | Missing tools, permissions issues, not in git repo |
| `30` | Credential/Approval Error | Missing credentials or approval required |

### Exit Code Priority

When multiple error conditions exist, exit codes are prioritized:

1. Credential/Approval issues (30)
2. Environment issues (20)
3. Retry exceeded (11)
4. Validation errors (10)
5. General errors (1)

### Using Exit Codes in Scripts

```bash
#!/bin/bash
set -e

ai-feature doctor
exit_code=$?

case $exit_code in
  0)
    echo "All checks passed"
    ;;
  10)
    echo "Configuration errors - run 'ai-feature init --validate-only'"
    ;;
  20)
    echo "Environment issues - check Node.js, git installation"
    ;;
  30)
    echo "Credential issues - set GITHUB_TOKEN, LINEAR_API_KEY"
    ;;
  *)
    echo "Unknown error: $exit_code"
    ;;
esac
```

---

## JSON Output Mode

All commands support `--json` for machine-readable output. JSON mode:

- Outputs structured JSON to stdout
- Suppresses human-readable formatting
- Includes all data fields for parsing
- Useful for CI/CD integration and scripting

### Example JSON Parsing

```bash
# Using jq to parse status
ai-feature status --json | jq -r '.status'

# Extract feature ID
ai-feature start --prompt "Test" --json | jq -r '.feature_id'

# Check if resumable
ai-feature resume --dry-run --json | jq -r '.can_resume'

# List failed checks
ai-feature doctor --json | jq -r '.checks[] | select(.status=="fail") | .name'
```

---

## Related Documentation

- [Doctor Reference](./doctor_reference.md) - Detailed diagnostic checks
- [Init Playbook](./init_playbook.md) - Initialization guide
- [Approval Playbook](./approval_playbook.md) - Approval workflow guide
- [Rate Limit Reference](./rate_limit_reference.md) - API rate limiting details
- [Observability Baseline](./observability_baseline.md) - Telemetry and logging

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-XX | Initial CLI reference (GitHub #211) |
