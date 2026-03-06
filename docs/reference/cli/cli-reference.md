<!-- AUTO-GENERATED from oclif.manifest.json. Do not edit manually. -->
<!-- Run: npm run docs:cli to regenerate. -->

# CLI Command Reference

The `codepipe` CLI is the primary interface for managing feature development pipelines. This reference is auto-generated from the oclif command manifest.

**Total commands:** 18

## Table of Contents

### Core Commands

- [`codepipe approve`](#codepipe-approve) — Approve or deny a feature pipeline gate
- [`codepipe base`](#codepipe-base)
- [`codepipe doctor`](#codepipe-doctor) — Run environment diagnostics and readiness checks
- [`codepipe health`](#codepipe-health) — Quick runtime health check (config, disk, writable run dir)
- [`codepipe init`](#codepipe-init) — Initialize codemachine-pipeline with schema-validated configuration
- [`codepipe plan`](#codepipe-plan) — Display the execution plan DAG, task summaries, and dependency graph
- [`codepipe rate-limits`](#codepipe-rate-limits) — Display rate limit status and telemetry for API providers
- [`codepipe resume`](#codepipe-resume) — Resume a failed or paused feature pipeline execution with safety checks
- [`codepipe start`](#codepipe-start) — Start a new feature development pipeline
- [`codepipe status`](#codepipe-status) — Show the current state of a feature development pipeline
- [`codepipe validate`](#codepipe-validate) — Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops

### Context Commands

- [`codepipe context summarize`](#codepipe-context-summarize) — Generate or refresh cached context summaries

### Pull Request Commands

- [`codepipe pr create`](#codepipe-pr-create) — Create a pull request on GitHub for the feature branch
- [`codepipe pr disable-auto-merge`](#codepipe-pr-disable-auto-merge) — Disable auto-merge for a pull request
- [`codepipe pr reviewers`](#codepipe-pr-reviewers) — Request reviewers for a pull request
- [`codepipe pr status`](#codepipe-pr-status) — Show pull request status and merge readiness

### Research Commands

- [`codepipe research create`](#codepipe-research-create) — Create a ResearchTask manually via the CLI
- [`codepipe research list`](#codepipe-research-list) — List ResearchTasks for the selected feature run directory

---

## Commands

### Core Commands

#### codepipe approve

Approve or deny a feature pipeline gate

##### Synopsis

```bash
codepipe approve GATE [FLAGS]
```

##### Arguments

| Argument | Description | Required | Options |
|----------|-------------|----------|---------|
| `gate` | Approval gate type (prd, spec, plan, code, pr, deploy) | Yes | `prd`, `spec`, `plan`, `code`, `pr`, `deploy` |

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--approve` | `-a` | boolean | Grant approval |  |
| `--comment` | `-c` | string | Approval or denial rationale |  |
| `--deny` | `-d` | boolean | Deny approval |  |
| `--feature` | `-f` | string | Feature ID (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--signer` | `-s` | string | Signer identity (email or username) **(required)** |  |
| `--signer-name` |  | string | Signer display name |  |
| `--skip-hash-check` |  | boolean | Skip artifact hash validation (use with caution) |  |

##### Examples

```bash
codepipe approve prd --approve --signer "user@example.com"
codepipe approve spec --deny --signer "reviewer@example.com" --comment "Missing acceptance criteria"
codepipe approve prd --approve --signer "user@example.com" --feature FEAT-abc123
codepipe approve prd --approve --signer "user@example.com" --json
```

---

#### codepipe base

_No description available._

##### Synopsis

```bash
codepipe base [FLAGS]
```

---

#### codepipe doctor

Run environment diagnostics and readiness checks

##### Synopsis

```bash
codepipe doctor [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--json` |  | boolean | Output results in JSON format |  |
| `--verbose` | `-v` | boolean | Show detailed diagnostic information |  |

##### Examples

```bash
codepipe doctor
codepipe doctor --json
codepipe doctor --verbose
```

---

#### codepipe health

Quick runtime health check (config, disk, writable run dir)

##### Synopsis

```bash
codepipe health [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--json` |  | boolean | Output results in JSON format |  |

##### Examples

```bash
codepipe health
codepipe health --json
```

---

#### codepipe init

Initialize codemachine-pipeline with schema-validated configuration

##### Synopsis

```bash
codepipe init [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--dry-run` |  | boolean | Compute config and validation without creating files |  |
| `--force` | `-f` | boolean | Force re-initialization even if config already exists |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--validate-only` |  | boolean | Only validate existing config without creating new files |  |
| `--yes` | `-y` | boolean | Skip interactive confirmations (assume yes) |  |

##### Examples

```bash
codepipe init
codepipe init --force
codepipe init --validate-only
codepipe init --dry-run --json
codepipe init --yes
```

---

#### codepipe plan

Display the execution plan DAG, task summaries, and dependency graph

##### Synopsis

```bash
codepipe plan [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--feature` | `-f` | string | Feature ID to query (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--show-diff` |  | boolean | Compare plan against spec hash to detect changes |  |
| `--verbose` | `-v` | boolean | Show detailed task breakdown and dependency chains |  |

##### Examples

```bash
codepipe plan
codepipe plan --feature feature-auth-123
codepipe plan --json
codepipe plan --show-diff
codepipe plan --verbose
```

---

#### codepipe rate-limits

Display rate limit status and telemetry for API providers

##### Synopsis

```bash
codepipe rate-limits [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--clear` |  | string | Clear cooldown for specified provider (requires confirmation) |  |
| `--feature` | `-f` | string | Feature ID to query (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--provider` | `-p` | string | Filter output to specific provider (github, linear, etc.) |  |
| `--verbose` | `-v` | boolean | Show detailed rate limit history and diagnostics |  |

##### Examples

```bash
codepipe rate-limits
codepipe rate-limits --feature feature-auth-123
codepipe rate-limits --json
codepipe rate-limits --provider github
codepipe rate-limits --clear github --feature feature-auth-123
```

---

#### codepipe resume

Resume a failed or paused feature pipeline execution with safety checks

##### Synopsis

```bash
codepipe resume [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--dry-run` | `-d` | boolean | Analyze resume eligibility without executing |  |
| `--feature` | `-f` | string | Feature ID to resume (defaults to current/latest) |  |
| `--force` |  | boolean | Override blockers (integrity warnings) - use with caution |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--max-parallel` |  | string | Maximum parallel tasks during execution (1-10) | `1` |
| `--skip-hash-verification` |  | boolean | Skip artifact integrity checks (dangerous, for debugging only) |  |
| `--validate-queue` |  | boolean | Validate queue files before resuming |  |
| `--verbose` | `-v` | boolean | Show detailed diagnostics |  |

##### Examples

```bash
codepipe resume
codepipe resume --feature feature-auth-123
codepipe resume --dry-run
codepipe resume --force
codepipe resume --validate-queue
```

---

#### codepipe start

Start a new feature development pipeline

##### Synopsis

```bash
codepipe start [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--dry-run` |  | boolean | Simulate execution without making changes |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--linear` | `-l` | string | Linear issue ID to import as feature specification |  |
| `--max-parallel` |  | string | Maximum parallel tasks during execution (1-10) | `1` |
| `--prompt` | `-p` | string | Feature description prompt |  |
| `--skip-execution` |  | boolean | Skip task execution phase (stop after PRD) |  |
| `--spec` | `-s` | string | Path to existing specification file |  |

##### Examples

```bash
codepipe start --prompt "Add user authentication"
codepipe start --linear ISSUE-123
codepipe start --spec ./specs/feature.md
codepipe start --prompt "OAuth integration" --json
```

---

#### codepipe status

Show the current state of a feature development pipeline

##### Synopsis

```bash
codepipe status [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--feature` | `-f` | string | Feature ID to query (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--show-costs` |  | boolean | Include token usage and cost estimates |  |
| `--verbose` | `-v` | boolean | Show detailed execution logs and task breakdown |  |

##### Examples

```bash
codepipe status
codepipe status --feature feature-auth-123
codepipe status --json
codepipe status --verbose
```

---

#### codepipe validate

Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops

##### Synopsis

```bash
codepipe validate [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--auto-fix` |  | boolean | Enable auto-fix for supported commands (e.g., lint --fix) |  |
| `--command` | `-c` | string | Specific validation command to run (lint, test, typecheck, build) |  |
| `--feature` | `-f` | string | Feature ID to validate (defaults to current/latest) |  |
| `--init` |  | boolean | Initialize validation registry from config (run this first) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--max-retries` |  | string | Override maximum retry attempts (ignores configured limits) |  |
| `--timeout` |  | string | Override command timeout in seconds |  |
| `--verbose` | `-v` | boolean | Show detailed execution logs |  |

##### Examples

```bash
codepipe validate
codepipe validate --feature feature-auth-123
codepipe validate --command lint
codepipe validate --command test --no-auto-fix
codepipe validate --json
codepipe validate --max-retries 5
```

---

### Context Commands

#### codepipe context summarize

Generate or refresh cached context summaries

##### Synopsis

```bash
codepipe context summarize [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--chunk-overlap` |  | string | Chunk overlap percentage (default 10) |  |
| `--feature` | `-f` | string | Feature ID to summarize (defaults to most recent) |  |
| `--force` | `-F` | boolean | Force re-summarization even if cache is warm |  |
| `--json` |  | boolean | Emit machine-readable JSON output |  |
| `--max-chunk-tokens` |  | string | Override maximum tokens per chunk (default 4000) |  |
| `--path` | `-p` | string | Glob pattern of files to re-summarize (repeatable) |  |

##### Examples

```bash
codepipe context summarize
codepipe context summarize --feature 01JXYZ --json
codepipe context summarize --path "src/**/*.ts" --path README.md
codepipe context summarize --force --max-chunk-tokens 2000
```

---

### Pull Request Commands

#### codepipe pr create

Create a pull request on GitHub for the feature branch

##### Synopsis

```bash
codepipe pr create [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--base` |  | string | Base branch (defaults to default branch from config) |  |
| `--body` | `-b` | string | PR body/description (defaults to generated summary) |  |
| `--draft` | `-d` | boolean | Create PR as draft |  |
| `--feature` | `-f` | string | Feature ID (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--reviewers` | `-r` | string | Comma-separated list of reviewer usernames |  |
| `--title` | `-t` | string | PR title (defaults to feature title) |  |

##### Examples

```bash
codepipe pr create
codepipe pr create --feature feature-auth-123
codepipe pr create --reviewers user1,user2
codepipe pr create --draft
codepipe pr create --json
```

---

#### codepipe pr disable-auto-merge

Disable auto-merge for a pull request

##### Synopsis

```bash
codepipe pr disable-auto-merge [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--feature` | `-f` | string | Feature ID (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |
| `--reason` | `-r` | string | Reason for disabling auto-merge (logged to deployment.json) |  |

##### Examples

```bash
codepipe pr disable-auto-merge
codepipe pr disable-auto-merge --feature feature-auth-123
codepipe pr disable-auto-merge --reason "Manual merge required for compliance"
codepipe pr disable-auto-merge --json
```

---

#### codepipe pr reviewers

Request reviewers for a pull request

##### Synopsis

```bash
codepipe pr reviewers [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--add` | `-a` | string | Comma-separated list of reviewer usernames to add **(required)** |  |
| `--feature` | `-f` | string | Feature ID (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |

##### Examples

```bash
codepipe pr reviewers --add user1,user2
codepipe pr reviewers --feature feature-auth-123 --add reviewer
codepipe pr reviewers --json
```

---

#### codepipe pr status

Show pull request status and merge readiness

##### Synopsis

```bash
codepipe pr status [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--fail-on-blockers` |  | boolean | Exit with code 1 if blockers present |  |
| `--feature` | `-f` | string | Feature ID (defaults to current/latest) |  |
| `--json` |  | boolean | Output results in JSON format |  |

##### Examples

```bash
codepipe pr status
codepipe pr status --feature feature-auth-123
codepipe pr status --fail-on-blockers
codepipe pr status --json
```

---

### Research Commands

#### codepipe research create

Create a ResearchTask manually via the CLI

##### Synopsis

```bash
codepipe research create [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--feature` | `-f` | string | Feature ID to attach the research task to (defaults to latest run) |  |
| `--force-fresh` |  | boolean | Force new research even if cache exists |  |
| `--json` |  | boolean | Emit machine-readable JSON output |  |
| `--max-age` |  | string | Freshness window in hours for cached results (default 24) |  |
| `--objective` | `-o` | string | Research objective/question (repeat for multiples) **(required)** |  |
| `--source` | `-s` | string | Source to consult formatted as type:identifier or type:identifier\|description |  |
| `--title` | `-t` | string | Research task title **(required)** |  |

##### Examples

```bash
codepipe research create --title "Clarify rate limits" --objective "What are the GitHub API quotas?"
codepipe research create -f feat-123 --title "Investigate auth flow" --objective "What scopes are required?" --source codebase:src/auth.ts --source documentation:docs/auth.md
```

---

#### codepipe research list

List ResearchTasks for the selected feature run directory

##### Synopsis

```bash
codepipe research list [FLAGS]
```

##### Options

| Option | Short | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--feature` | `-f` | string | Feature ID to inspect (defaults to most recent run) |  |
| `--json` |  | boolean | Emit machine-readable JSON output |  |
| `--limit` |  | string | Limit the number of tasks returned |  |
| `--stale` |  | boolean | Show only tasks whose cached results are stale |  |
| `--status` | `-s` | string | Filter by task status (repeatable) |  |

##### Examples

```bash
codepipe research list
codepipe research list --feature feat-123
codepipe research list --status pending --status in_progress
codepipe research list --stale --limit 5
codepipe research list --json
```

---
