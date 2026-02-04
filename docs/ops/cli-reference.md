# CLI Reference

This document provides comprehensive documentation for the `codepipe` command-line interface.

## Overview

The `codepipe` CLI is the primary interface for managing feature development pipelines. It provides commands for initializing projects, starting features, checking status, managing approvals, and more.

## Installation

```bash
# Install globally
npm install -g codemachine-pipeline

# Or run via npx
npx codemachine-pipeline <command>
```

---

## Commands

### codepipe init

Initialize codemachine-pipeline with schema-validated configuration.

#### Description

Creates the `.codepipe/` directory structure and generates a default `config.json` file based on your repository settings. This command must be run from within a git repository.

#### Synopsis

```bash
codepipe init [FLAGS]
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
codepipe init

# Force re-initialization
codepipe init --force

# Validate existing configuration
codepipe init --validate-only

# Preview what would be created (no files written)
codepipe init --dry-run --json

# Non-interactive initialization
codepipe init --yes
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
.codepipe/
├── config.json       # Repository configuration
├── runs/             # Feature run directories
├── logs/             # Command logs
└── artifacts/        # Shared artifacts
```

---

### codepipe start

Start a new feature development pipeline.

#### Description

Creates a new feature run directory, aggregates repository context, detects research tasks, and generates a PRD (Product Requirements Document). The pipeline can be initialized from a text prompt, a Linear issue, or an existing specification file.

#### Synopsis

```bash
codepipe start [FLAGS]
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
codepipe start --prompt "Add user authentication with OAuth support"

# Start from a Linear issue
codepipe start --linear PROJ-123

# Start from an existing specification file
codepipe start --spec ./specs/authentication.md

# Preview execution plan without making changes
codepipe start --prompt "OAuth integration" --dry-run

# Get JSON output for automation
codepipe start --prompt "Add logging" --json

# Run with parallel task execution
codepipe start --prompt "Refactor database layer" --max-parallel 4

# Stop after PRD generation (skip execution)
codepipe start --prompt "New API endpoints" --skip-execution
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (pipeline completed) |
| `1` | General error |
| `10` | Validation error (must provide input source, repo not initialized) |
| `30` | Approval required (PRD awaiting approval before execution) |

#### Output

The command creates a run directory at `.codepipe/runs/FEAT-<uuid>/` containing:

- `manifest.json` - Run state and metadata
- `context/` - Aggregated repository context
- `artifacts/prd.md` - Generated PRD document
- `research/` - Research task tracking
- `logs/` - Execution logs

---

### codepipe status

Show the current state of a feature development pipeline.

#### Description

Displays comprehensive status information including pipeline state, queue status, approvals, context summaries, traceability links, branch protection compliance, rate limits, and research task progress.

#### Synopsis

```bash
codepipe status [FLAGS]
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
codepipe status

# Show status of specific feature
codepipe status --feature FEAT-abc123

# Get JSON output for parsing
codepipe status --json

# Show verbose details including task breakdown
codepipe status --verbose

# Include cost telemetry
codepipe status --show-costs
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

### codepipe doctor

Run environment diagnostics and readiness checks.

#### Description

Validates that your system meets all prerequisites for codemachine-pipeline operations. Checks runtime environment, repository setup, network connectivity, configuration validity, and credential availability.

#### Synopsis

```bash
codepipe doctor [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--json` | | Output results in JSON format | `false` |
| `--verbose` | `-v` | Show detailed diagnostic information | `false` |

#### Examples

```bash
# Run all diagnostic checks
codepipe doctor

# Get JSON output for CI/automation
codepipe doctor --json

# Show detailed information
codepipe doctor --verbose
```

#### Checks Performed

| Check | Description | Exit Code on Failure |
|-------|-------------|---------------------|
| Node.js Version | Validates Node.js v24+ | 20 |
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

### codepipe approve

Approve or deny a feature pipeline gate.

#### Description

Grants or denies approval for human-in-the-loop governance gates. Records signer identity, computes artifact hashes, and updates the approval registry.

#### Synopsis

```bash
codepipe approve <gate> [FLAGS]
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
codepipe approve prd --approve --signer "user@example.com"

# Deny spec with comment
codepipe approve spec --deny --signer "reviewer@example.com" \
  --comment "Missing acceptance criteria"

# Approve specific feature
codepipe approve prd --approve --signer "user@example.com" \
  --feature FEAT-abc123

# Get JSON output
codepipe approve prd --approve --signer "user@example.com" --json

# Skip hash validation (debugging only)
codepipe approve prd --approve --signer "user@example.com" --skip-hash-check
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (approval granted/denied) |
| `1` | General error |
| `10` | Validation error (invalid gate type, feature not found, no pending approval) |
| `30` | Human action required (artifact modified since approval requested) |

---

### codepipe plan

Display the execution plan DAG, task summaries, and dependency graph.

#### Description

Shows the generated execution plan including task counts, entry points, dependency chains, and DAG metadata. Can also compare the plan against the current spec to detect staleness.

#### Synopsis

```bash
codepipe plan [FLAGS]
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
codepipe plan

# Show plan for specific feature
codepipe plan --feature FEAT-abc123

# Get JSON output
codepipe plan --json

# Show detailed task list
codepipe plan --verbose

# Check if plan is stale
codepipe plan --show-diff
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found) |

---

### codepipe resume

Resume a failed or paused feature pipeline execution with safety checks.

#### Description

Analyzes the current state of a feature pipeline and resumes execution from the last checkpoint. Performs integrity checks, queue validation, and rate limit verification before continuing.

#### Synopsis

```bash
codepipe resume [FLAGS]
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
codepipe resume

# Analyze resume eligibility without executing
codepipe resume --dry-run

# Resume specific feature
codepipe resume --feature FEAT-abc123

# Force resume despite warnings
codepipe resume --force

# Resume with parallel execution
codepipe resume --max-parallel 4

# Verbose output with queue validation details
codepipe resume --verbose
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

### codepipe validate

Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops.

#### Description

Runs configured validation commands with automatic retry and fix capabilities. Supports running all validations or specific command types.

#### Synopsis

```bash
codepipe validate [FLAGS]
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
codepipe validate --init

# Run all validations
codepipe validate

# Run specific validation
codepipe validate --command lint

# Run tests without auto-fix
codepipe validate --command test --no-auto-fix

# Override retry limit
codepipe validate --max-retries 5

# Get JSON output
codepipe validate --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All validations passed |
| `1` | General error (config/setup issues) |
| `10` | Validation failed (one or more commands failed) |
| `11` | Retry limit exceeded (requires manual intervention) |

---

### codepipe rate-limits

Display rate limit status and telemetry for API providers.

#### Description

Shows current rate limit state across all providers (GitHub, Linear, etc.). Surfaces cooldown timers, backlog states, and manual intervention requirements.

#### Synopsis

```bash
codepipe rate-limits [FLAGS]
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
codepipe rate-limits

# Show rate limits for specific feature
codepipe rate-limits --feature FEAT-abc123

# Filter to specific provider
codepipe rate-limits --provider github

# Get JSON output
codepipe rate-limits --json

# Clear cooldown for a provider
codepipe rate-limits --clear github --feature FEAT-abc123

# Show detailed history
codepipe rate-limits --verbose
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Feature not found |

---

### codepipe health

Quick runtime health check (config, disk, writable run dir).

#### Description

Performs a lightweight health probe (target <1s) that validates configuration file validity, run directory writability, and available disk space. Useful for monitoring and liveness checks.

#### Synopsis

```bash
codepipe health [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--json` | | Output results in JSON format | `false` |

#### Checks Performed

| Check | Description |
|-------|-------------|
| Config | Validates `.codepipe/config.json` exists and parses correctly |
| Run Directory | Verifies `.codepipe/runs/` is writable (creates probe file) |
| Disk Space | Checks at least 100MB free disk space |

#### Examples

```bash
# Run health check
codepipe health

# Get JSON output for monitoring
codepipe health --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Healthy (all checks pass) |
| `1` | Unhealthy (one or more checks failed) |

---

### codepipe pr create

Create a pull request on GitHub for the feature branch.

#### Description

Creates a GitHub pull request with preflight validation. Checks that code approval gates have passed and validations (lint/test/build) are complete before creating the PR.

#### Synopsis

```bash
codepipe pr create [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--reviewers` | `-r` | Comma-separated list of reviewer usernames | |
| `--draft` | `-d` | Create PR as draft | `false` |
| `--title` | `-t` | PR title (defaults to feature title) | |
| `--body` | `-b` | PR body/description (defaults to generated summary) | |
| `--base` | | Base branch (defaults to default branch from config) | |

#### Examples

```bash
# Create PR for latest feature
codepipe pr create

# Create PR for specific feature
codepipe pr create --feature feature-auth-123

# Create PR with reviewers
codepipe pr create --reviewers user1,user2

# Create draft PR
codepipe pr create --draft

# Get JSON output
codepipe pr create --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found, invalid inputs) |
| `30` | Human action required (approvals missing, validations failed) |

---

### codepipe pr status

Show pull request status and merge readiness.

#### Description

Fetches fresh PR data from GitHub, checks status checks, and evaluates merge readiness. Can optionally fail with a non-zero exit code when blockers are present.

#### Synopsis

```bash
codepipe pr status [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--fail-on-blockers` | | Exit with code 1 if blockers present | `false` |

#### Examples

```bash
# Show PR status for latest feature
codepipe pr status

# Show PR status for specific feature
codepipe pr status --feature feature-auth-123

# Fail in CI if blockers exist
codepipe pr status --fail-on-blockers

# Get JSON output
codepipe pr status --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error (with `--fail-on-blockers`: blockers present) |
| `10` | Validation error (feature not found, no PR exists) |

---

### codepipe pr reviewers

Request reviewers for a pull request.

#### Description

Adds reviewer requests to an existing pull request. Merges newly added reviewers with any previously requested reviewers and updates PR metadata.

#### Synopsis

```bash
codepipe pr reviewers [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--add` | `-a` | Comma-separated list of reviewer usernames to add | Required |

#### Examples

```bash
# Add reviewers to PR
codepipe pr reviewers --add user1,user2

# Add reviewer for specific feature
codepipe pr reviewers --feature feature-auth-123 --add reviewer

# Get JSON output
codepipe pr reviewers --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found, no PR exists) |

---

### codepipe pr disable-auto-merge

Disable auto-merge for a pull request.

#### Description

Disables auto-merge on an existing pull request. Logs the action with an optional reason to `deployment.json` for governance tracking.

#### Synopsis

```bash
codepipe pr disable-auto-merge [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID (defaults to current/latest) | |
| `--json` | | Output results in JSON format | `false` |
| `--reason` | `-r` | Reason for disabling auto-merge (logged to deployment.json) | |

#### Examples

```bash
# Disable auto-merge for latest feature
codepipe pr disable-auto-merge

# Disable for specific feature
codepipe pr disable-auto-merge --feature feature-auth-123

# Provide reason for audit trail
codepipe pr disable-auto-merge --reason "Manual merge required for compliance"

# Get JSON output
codepipe pr disable-auto-merge --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found, no PR exists) |

---

### codepipe research create

Create a ResearchTask manually via the CLI.

#### Description

Creates a research task attached to a feature run directory. Supports specifying objectives, sources with type annotations, and freshness requirements for cached results.

#### Synopsis

```bash
codepipe research create [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to attach the research task to (defaults to latest run) | |
| `--title` | `-t` | Research task title | Required |
| `--objective` | `-o` | Research objective/question (repeat for multiples) | Required |
| `--source` | `-s` | Source to consult formatted as `type:identifier` or `type:identifier\|description` | |
| `--max-age` | | Freshness window in hours for cached results (default 24, minimum 1) | |
| `--force-fresh` | | Force new research even if cache exists | `false` |
| `--json` | | Emit machine-readable JSON output | `false` |

#### Source Types

Valid source types: `codebase`, `web`, `documentation`, `api`, `linear`, `github`, `other`

#### Examples

```bash
# Create a research task
codepipe research create --title "Clarify rate limits" --objective "What are the GitHub API quotas?"

# Create with multiple objectives and sources
codepipe research create -f feat-123 \
  --title "Investigate auth flow" \
  --objective "What scopes are required?" \
  --source codebase:src/auth.ts \
  --source documentation:docs/auth.md
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments (missing objective, invalid source format) |
| `10` | Validation error (feature not found) |

---

### codepipe research list

List ResearchTasks for the selected feature run directory.

#### Description

Lists research tasks with optional filtering by status and staleness. Includes diagnostics showing task counts by status.

#### Synopsis

```bash
codepipe research list [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to inspect (defaults to most recent run) | |
| `--status` | `-s` | Filter by task status (repeatable): `pending`, `in_progress`, `completed`, `failed`, `cached` | |
| `--stale` | | Show only tasks whose cached results are stale | `false` |
| `--limit` | | Limit the number of tasks returned (minimum 1) | |
| `--json` | | Emit machine-readable JSON output | `false` |

#### Examples

```bash
# List all research tasks
codepipe research list

# List tasks for specific feature
codepipe research list --feature feat-123

# Filter by status
codepipe research list --status pending --status in_progress

# Show stale tasks with limit
codepipe research list --stale --limit 5

# Get JSON output
codepipe research list --json
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found) |

---

### codepipe context summarize

Generate or refresh cached context summaries.

#### Description

Summarizes context documents using chunking and LLM-based summarization. Supports targeting specific file patterns for re-summarization and respects cost/token budgets configured in the repository settings. Requires the `enable_context_summarization` feature flag to be enabled.

#### Synopsis

```bash
codepipe context summarize [FLAGS]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--feature` | `-f` | Feature ID to summarize (defaults to most recent) | |
| `--path` | `-p` | Glob pattern of files to re-summarize (repeatable) | |
| `--force` | `-F` | Force re-summarization even if cache is warm | `false` |
| `--json` | | Emit machine-readable JSON output | `false` |
| `--max-chunk-tokens` | | Override maximum tokens per chunk (500-16000, default 4000) | |
| `--chunk-overlap` | | Chunk overlap percentage (0-50, default 10) | |

#### Examples

```bash
# Summarize context for latest feature
codepipe context summarize

# Summarize for specific feature with JSON output
codepipe context summarize --feature 01JXYZ --json

# Re-summarize specific files
codepipe context summarize --path "src/**/*.ts" --path README.md

# Force re-summarization with custom chunk size
codepipe context summarize --force --max-chunk-tokens 2000
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `10` | Validation error (feature not found, invalid config) |
| `30` | Context summarization disabled or context summary missing |

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
codepipe --help

# Show help for specific command
codepipe start --help
codepipe approve --help
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
| `CODEPIPE_GITHUB_TOKEN` | `github.token_env_var` |
| `CODEPIPE_LINEAR_API_KEY` | `linear.api_key_env_var` |
| `CODEPIPE_RUNTIME_AGENT_ENDPOINT` | `runtime.agent_endpoint` |
| `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` | `runtime.max_concurrent_tasks` |
| `CODEPIPE_RUNTIME_TIMEOUT_MINUTES` | `runtime.timeout_minutes` |

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

codepipe doctor
exit_code=$?

case $exit_code in
  0)
    echo "All checks passed"
    ;;
  10)
    echo "Configuration errors - run 'codepipe init --validate-only'"
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
codepipe status --json | jq -r '.status'

# Extract feature ID
codepipe start --prompt "Test" --json | jq -r '.feature_id'

# Check if resumable
codepipe resume --dry-run --json | jq -r '.can_resume'

# List failed checks
codepipe doctor --json | jq -r '.checks[] | select(.status=="fail") | .name'
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
