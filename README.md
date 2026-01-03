# ai-feature-pipeline

Autonomous AI-powered feature development pipeline CLI

## Overview

`ai-feature-pipeline` is a command-line tool that automates the entire feature development lifecycle using AI agents. From initial specification to pull request creation, the pipeline manages PRD generation, technical specifications, task breakdown, implementation, testing, and deployment.

## Features

- **Autonomous Feature Development**: AI-driven end-to-end feature implementation
- **Git-Native**: Designed for Git/GitHub-centric workflows
- **Resumable Execution**: Idempotent pipeline steps with automatic state management
- **Integration Ready**: Supports GitHub and Linear integrations
- **Deterministic Builds**: Node v24 LTS, containerized execution

## Installation

### From npm (when published)

```bash
npm install -g ai-feature-pipeline
```

### From source

```bash
git clone https://github.com/codemachine/ai-feature-pipeline.git
cd ai-feature-pipeline
npm install
npm run build
npm link
```

### Docker

Build and run the CLI in a containerized environment for reproducible execution:

```bash
# Build the Docker image (from project root)
docker build -f docker/Dockerfile -t ai-feature-pipeline .

# Run with help
docker run --rm ai-feature-pipeline --help

# Run commands with mounted repository context
docker run --rm -v $(pwd):/workspace -w /workspace ai-feature-pipeline init

# Set environment variables for integrations
docker run --rm \
  -e GITHUB_TOKEN=ghp_xxx \
  -e LINEAR_API_KEY=lin_xxx \
  -e AGENT_ENDPOINT=https://agent.example.com \
  -v $(pwd):/workspace -w /workspace \
  ai-feature-pipeline start --prompt "Add feature"
```

The Dockerfile uses a multi-stage build with Node v24 Alpine for deterministic, reproducible builds.

## Prerequisites

- **Node.js**: v24.0.0 or higher (required for deterministic builds)
- **Git**: Version control with initialized repository
- **npm**: Comes with Node.js, used for package management
- **(Optional)** GitHub Personal Access Token for GitHub integration
- **(Optional)** Linear API Key for Linear integration
- **(Optional)** Agent service endpoint for AI execution

### Verifying Prerequisites

```bash
# Check Node.js version (must be >= 24.0.0)
node --version

# Check Git is installed
git --version

# Verify you're in a Git repository
git status
```

## Quick Start

### 1. Initialize in your repository

```bash
cd your-project
ai-feature init
```

This creates a `.ai-feature-pipeline/` directory with schema-validated configuration files.

### 2. Configure integrations

Set environment variables for API credentials:

```bash
export GITHUB_TOKEN=ghp_your_token_here
export LINEAR_API_KEY=lin_api_your_key_here
export AGENT_ENDPOINT=https://your-agent-service.com/v1
```

Edit `.ai-feature-pipeline/config.json` to enable integrations:

```json
{
  "github": {
    "enabled": true
  },
  "linear": {
    "enabled": true
  }
}
```

### 3. Validate configuration

```bash
ai-feature init --validate-only
```

### 4. Start a feature

```bash
# From a prompt
ai-feature start --prompt "Add user authentication with OAuth"

# From a Linear issue
ai-feature start --linear ISSUE-123

# From a specification file
ai-feature start --spec ./specs/new-feature.md
```

## Available Commands

### `ai-feature init`

Initialize the pipeline in the current git repository with schema-validated configuration.

**Options:**

- `-f, --force`: Force re-initialization even if config already exists
- `--validate-only`: Validate existing config without creating new files

**Examples:**

```bash
# Initialize new configuration
ai-feature init

# Force re-initialization
ai-feature init --force

# Validate existing configuration
ai-feature init --validate-only
```

**Exit Codes:**

- `0`: Success
- `1`: General error (not a git repository, etc.)
- `10`: Configuration validation error

### `ai-feature start`

Start a new feature development pipeline from a prompt, Linear issue, or specification file.

**Options:**

- `-p, --prompt <text>`: Feature description prompt
- `-l, --linear <id>`: Linear issue ID to import as specification
- `-s, --spec <path>`: Path to existing specification file
- `--json`: Output results in JSON format
- `--dry-run`: Simulate execution without making changes

**Examples:**

```bash
# Start from a text prompt
ai-feature start --prompt "Add user authentication with OAuth"

# Import from Linear issue
ai-feature start --linear ISSUE-123

# Use existing specification file
ai-feature start --spec ./specs/new-feature.md

# JSON output for automation
ai-feature start --prompt "Add feature" --json
```

**Exit Codes:**

- `0`: Success
- `1`: General error
- `10`: Validation error
- `20`: External API error
- `30`: Human action required

**Behavior:** `ai-feature start` runs context aggregation, queues research tasks, and generates `artifacts/prd.md`. When PRD approval is required by RepoConfig, the command exits with code `30` after writing the PRD so you can review it and run `ai-feature approve prd` before the pipeline continues.

---

### `ai-feature status`

Show the current state of a feature development pipeline.

**Options:**

- `-f, --feature <id>`: Feature ID to query (defaults to current/latest)
- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed execution logs and task breakdown
- `--show-costs`: Include token usage and cost estimates

**Examples:**

```bash
# Show status of current feature
ai-feature status

# Check specific feature by ID
ai-feature status --feature feature-auth-123

# JSON output for automation
ai-feature status --json

# Verbose output with detailed logs
ai-feature status --verbose --show-costs
```

**Exit Codes:**

- `0`: Success
- `1`: General error
- `10`: Validation error (feature not found)

### `ai-feature doctor`

Run environment diagnostics and readiness checks.

**Options:**

- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed diagnostic information

**Examples:**

```bash
# Run environment checks
ai-feature doctor

# JSON output for automation
ai-feature doctor --json

# Verbose diagnostics
ai-feature doctor --verbose
```

**Exit Codes:**

- `0`: All checks passed (warnings allowed)
- `10`: Validation error (config issues)
- `20`: Environment issue (missing tools, version mismatches)
- `30`: Credential issue (missing tokens, invalid scopes)

**Checks Performed:**

- Node.js version (v20+ required, v24 preferred)
- Git installation and repository detection
- npm installation
- Docker availability (optional)
- Filesystem permissions
- Outbound HTTPS connectivity
- RepoConfig validation
- Environment variable verification

---

### `ai-feature approve`

Grant or deny approval for feature pipeline gates (PRD, Spec, Plan, Code, PR, Deploy).

**Options:**

- `-f, --feature <id>`: Feature ID (defaults to current/latest)
- `-a, --approve`: Grant approval
- `-d, --deny`: Deny approval
- `-s, --signer <email>`: Signer identity (required)
- `--signer-name <name>`: Signer display name
- `-c, --comment <text>`: Approval or denial rationale
- `--json`: Output results in JSON format
- `--skip-hash-check`: Skip artifact hash validation (use with caution)

**Examples:**

```bash
# Approve PRD gate
ai-feature approve prd --approve --signer "user@example.com"

# Deny spec gate with rationale
ai-feature approve spec --deny --signer "reviewer@example.com" --comment "Missing acceptance criteria"

# Approve specific feature
ai-feature approve prd --approve --signer "user@example.com" --feature FEAT-abc123
```

**Exit Codes:**

- `0`: Success
- `10`: Validation error (invalid gate type, feature not found)
- `30`: Human action required (artifact modified, missing artifact)

---

### `ai-feature plan`

Display the execution plan DAG, task summaries, and dependency graph.

**Options:**

- `-f, --feature <id>`: Feature ID to query (defaults to current/latest)
- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed task breakdown and dependency chains
- `--show-diff`: Compare plan against spec hash to detect changes

**Examples:**

```bash
# Show plan for current feature
ai-feature plan

# Check specific feature
ai-feature plan --feature feature-auth-123

# Verbose output with diff
ai-feature plan --verbose --show-diff
```

---

### `ai-feature resume`

Resume a failed or paused feature pipeline execution with safety checks.

**Options:**

- `-f, --feature <id>`: Feature ID to resume (defaults to current/latest)
- `-d, --dry-run`: Analyze resume eligibility without executing
- `--force`: Override blockers (use with caution)
- `--skip-hash-verification`: Skip artifact integrity checks (dangerous)
- `--validate-queue`: Validate queue files before resuming (default: true)
- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed diagnostics

**Examples:**

```bash
# Resume current feature
ai-feature resume

# Dry-run analysis
ai-feature resume --dry-run

# Force resume past blockers
ai-feature resume --force

# Resume specific feature with verbose output
ai-feature resume --feature feature-auth-123 --verbose
```

**Exit Codes:**

- `0`: Resume successful or dry-run completed
- `10`: Resume blocked (blockers present)
- `20`: Integrity check failed (without --force)
- `30`: Queue validation failed

---

### `ai-feature validate`

Execute validation commands (lint, test, typecheck, build) with auto-fix retry loops.

**Options:**

- `-f, --feature <id>`: Feature ID to validate (defaults to current/latest)
- `-c, --command <type>`: Specific validation command (lint, test, typecheck, build)
- `--auto-fix / --no-auto-fix`: Enable/disable auto-fix for supported commands (default: enabled)
- `--max-retries <n>`: Override maximum retry attempts (0-20)
- `--timeout <seconds>`: Override command timeout (10-600)
- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed execution logs
- `--init`: Initialize validation registry from config

**Examples:**

```bash
# Run all validations
ai-feature validate

# Initialize validation registry
ai-feature validate --init

# Run only lint with auto-fix disabled
ai-feature validate --command lint --no-auto-fix

# Validate specific feature
ai-feature validate --feature feature-auth-123
```

**Exit Codes:**

- `0`: All validations passed
- `1`: General error (config/setup issues)
- `10`: Validation failed
- `11`: Retry limit exceeded

---

### `ai-feature rate-limits`

Display rate limit status and telemetry for API providers.

**Options:**

- `-f, --feature <id>`: Feature ID to query (defaults to current/latest)
- `--json`: Output results in JSON format
- `-v, --verbose`: Show detailed rate limit history
- `-p, --provider <name>`: Filter output to specific provider (github, linear)
- `--clear <provider>`: Clear cooldown for specified provider

**Examples:**

```bash
# Show rate limit status
ai-feature rate-limits

# Filter to GitHub only
ai-feature rate-limits --provider github

# Clear cooldown for a provider
ai-feature rate-limits --clear github --feature feature-auth-123

# JSON output for monitoring
ai-feature rate-limits --json
```

---

### Planned Commands

The following commands are planned for future releases:

- `ai-feature pr create`: Create a pull request for a completed feature
- `ai-feature deploy`: Trigger deployment for a merged feature
- `ai-feature export`: Export feature artifacts in JSON or Markdown format

## Development

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Formatting

```bash
npm run format
npm run format:check
```

### Local Development

Use the `./bin/dev.js` script to run commands during development:

```bash
./bin/dev.js init
./bin/dev.js --help
./bin/dev.js start --prompt "test feature"
```

### Smoke Tests

Run smoke tests to verify CLI functionality:

```bash
# Run all smoke tests
npm run smoke

# Individual smoke tests
npm run smoke:version    # Test --version output
npm run smoke:help       # Test --help output
npm run smoke:init       # Test init command help
```

### Git Hooks (Optional)

To maintain code quality, you can set up Git hooks for automatic linting and testing:

**Using Husky (Recommended):**

```bash
# Install Husky
npm install --save-dev husky

# Initialize Git hooks
npx husky init

# Add pre-commit hook for linting
echo "npm run lint" > .husky/pre-commit

# Add pre-push hook for tests
echo "npm run test -- --runInBand" > .husky/pre-push
```

**Manual Git Hook Setup:**

Create `.git/hooks/pre-commit` with:

```bash
#!/bin/sh
npm run lint
```

Create `.git/hooks/pre-push` with:

```bash
#!/bin/sh
npm run test -- --runInBand
```

Make them executable:

```bash
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

### JSON Output for Automation

All commands support `--json` flag for machine-readable output, making them suitable for CI/CD integration:

```bash
# Initialize with JSON output
ai-feature init --validate-only --json

# Start feature with JSON response
ai-feature start --prompt "Add feature" --json

# Query status programmatically
ai-feature status --json | jq '.current_state'
```

JSON output follows a consistent schema with `status`, `message`, and command-specific fields for reliable parsing in automated workflows.

## Project Structure

```
ai-feature-pipeline/
├── src/
│   ├── cli/               # CLI presentation layer
│   │   ├── commands/      # oclif command implementations
│   │   │   ├── init.ts       # Repository initialization
│   │   │   ├── start.ts      # Start feature pipeline
│   │   │   ├── status.ts     # Show pipeline status
│   │   │   ├── doctor.ts     # Environment diagnostics
│   │   │   ├── approve.ts    # Approval gate management
│   │   │   ├── plan.ts       # Execution plan display
│   │   │   ├── resume.ts     # Pipeline resumption
│   │   │   ├── validate.ts   # Validation commands
│   │   │   └── rate-limits.ts # Rate limit monitoring
│   │   ├── utils/         # CLI utilities
│   │   └── index.ts       # CLI bootstrap + version banner
│   ├── core/
│   │   ├── config/        # Configuration management
│   │   └── models/        # Domain models
│   ├── adapters/          # External service adapters
│   │   ├── github/        # GitHub API integration
│   │   ├── linear/        # Linear API integration
│   │   └── http/          # HTTP client with rate limiting
│   ├── workflows/         # Business logic workflows
│   ├── persistence/       # Run directory and state management
│   ├── telemetry/         # Logging, metrics, and tracing
│   └── index.ts           # Re-exports CLI run() for bin/dev + bin/run
├── config/
│   └── schemas/           # JSON Schema definitions
│       └── repo_config.schema.json
├── docs/
│   ├── architecture/      # Architecture documentation
│   ├── requirements/      # Technical specifications
│   ├── ops/               # Operational guides
│   ├── diagrams/          # PlantUML and Mermaid diagrams
│   ├── templates/         # Document templates
│   └── ui/                # CLI pattern guidelines
├── examples/
│   └── sample_repo_config/
│       ├── config.json    # Sample configuration
│       └── README.md      # Configuration guide
├── tests/
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── fixtures/          # Test fixtures
├── scripts/               # Build and utility scripts
├── docker/                # Docker configuration
├── .github/
│   └── workflows/
│       └── ci.yml         # CI/CD pipeline
├── package.json
├── tsconfig.json
└── README.md
```

## CI/CD

The project uses GitHub Actions for continuous integration:

- **Linting**: ESLint with TypeScript support
- **Testing**: Jest with coverage reporting
- **Building**: TypeScript compilation
- **Docker**: Multi-stage build verification

All checks run on Node v24.x.

## Updating Integration Fixtures

Regression tests for the GitHub and Linear adapters replay recorded HTTP fixtures stored under `tests/fixtures/{github,linear}`. Refresh them whenever adapter logic or API payloads change:

1. Run `./scripts/tooling/update_fixtures.sh [--provider github|linear|all] [--dry-run]` to validate fixture structure, recompute SHA256 hashes, and update each provider's `manifest.json` with the latest metadata.
2. Follow the workflow documented in `docs/ops/integration_testing.md` when adding new fixtures—record the response, describe the scenario in the manifest, and rerun the update script so hashes stay in sync.
3. Execute `npm run test tests/integration/github_linear_regression.spec.ts` to confirm both adapters still pass the regression suite before committing the refreshed fixtures.

Every manifest entry serves as an audit log (`file`, `scenario`, `endpoint/query`, `hash`, timestamps, source branch), so never edit hashes manually—always rely on the update script.

## Architecture

The pipeline operates on a state machine model with the following phases:

1. **Initialize**: Repository configuration and integration validation
2. **Specify**: PRD and technical specification generation
3. **Plan**: Task breakdown and dependency graph creation
4. **Implement**: Autonomous code generation and testing
5. **Review**: PR creation and review request
6. **Deploy**: Merge and deployment automation

Each phase is idempotent and resumable. Artifacts are stored in `.ai-feature-pipeline/runs/<feature-id>/`.

## Execution Engine

The pipeline supports multiple AI execution engines for task processing via the CodeMachine CLI adapter.

### Supported Engines

| Engine     | Description                |
| ---------- | -------------------------- |
| `claude`   | Anthropic Claude (default) |
| `codex`    | OpenAI Codex               |
| `opencode` | OpenCode CLI               |
| `cursor`   | Cursor IDE                 |
| `auggie`   | Auggie AI                  |
| `ccr`      | Claude Code Runner         |

### Setup

1. **Install CodeMachine CLI** (optional but recommended):

   ```bash
   npm install -g codemachine-cli
   ```

2. **Configure execution settings** in `.ai-feature-pipeline/config.json`:

   ```json
   {
     "execution": {
       "default_engine": "claude",
       "codemachine_cli_path": "codemachine-cli",
       "task_timeout_ms": 300000,
       "max_retries": 3
     }
   }
   ```

3. **Verify installation**:
   ```bash
   ai-feature doctor
   ```
   The doctor command will show CodeMachine CLI status (warning if not installed, pass if available).

### Engine Selection

Engines can be specified per-task or use the default:

```bash
# Use default engine from config
ai-feature start --prompt "Add feature"

# Specify engine explicitly (when supported)
ai-feature start --prompt "Add feature" --engine codex
```

For detailed configuration options, see [docs/ops/codemachine_adapter_guide.md](docs/ops/codemachine_adapter_guide.md).

## Configuration

Configuration is stored in `.ai-feature-pipeline/config.json` and validated against a JSON Schema.

### Schema Sections

The configuration includes the following sections:

- **schema_version**: Version for configuration migrations (e.g., "1.0.0")
- **project**: Project metadata (id, repo_url, default_branch, context_paths, project_leads)
- **github**: GitHub integration settings (enabled, token_env_var, api_base_url, required_scopes, default_reviewers)
- **linear**: Linear integration settings (enabled, api_key_env_var, team_id, project_id)
- **runtime**: Execution settings (agent_endpoint, max_concurrent_tasks, timeout_minutes, context_token_budget, logs_format)
- **safety**: Security controls (redact_secrets, approval gates, file patterns)
- **feature_flags**: Experimental features (auto_merge, deployment_triggers, etc.)
- **constraints**: Resource limits (max_file_size_kb, max_context_files, rate_limits)
- **governance_notes**: Free-form compliance notes

### Example Configuration

```json
{
  "schema_version": "1.0.0",
  "project": {
    "id": "my-project",
    "repo_url": "https://github.com/org/repo.git",
    "default_branch": "main",
    "context_paths": ["src/", "docs/", "README.md"]
  },
  "github": {
    "enabled": true,
    "token_env_var": "GITHUB_TOKEN",
    "required_scopes": ["repo", "workflow"]
  },
  "linear": {
    "enabled": false
  },
  "runtime": {
    "max_concurrent_tasks": 3,
    "timeout_minutes": 30,
    "context_token_budget": 32000,
    "logs_format": "ndjson"
  },
  "safety": {
    "redact_secrets": true,
    "require_approval_for_prd": true,
    "require_approval_for_plan": true,
    "require_approval_for_pr": true
  },
  "feature_flags": {
    "enable_resumability": true,
    "enable_context_summarization": true
  }
}
```

### Environment Variables

Credentials and sensitive values should be provided via environment variables:

```bash
# Required for GitHub integration
export GITHUB_TOKEN=ghp_xxxxx

# Required for Linear integration
export LINEAR_API_KEY=lin_api_xxxxx

# Required for AI agent service
export AGENT_ENDPOINT=https://agent.example.com/v1
```

The CLI validates that these are set when integrations are enabled.

### Configuration Override Pattern

Environment variables can override config values using the pattern:

```
AI_FEATURE_<SECTION>_<FIELD>
```

Examples:

```bash
export AI_FEATURE_GITHUB_TOKEN=ghp_override
export AI_FEATURE_RUNTIME_AGENT_ENDPOINT=https://override.com
```

### Schema Reference

Full schema: `config/schemas/repo_config.schema.json`
Sample configuration: `examples/sample_repo_config/config.json`
Configuration guide: `examples/sample_repo_config/README.md`

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

For issues and questions:

- GitHub Issues: https://github.com/codemachine/ai-feature-pipeline/issues
- Documentation: See `specification.md` for detailed requirements

---

**Note**: This project implements the core pipeline commands (`init`, `start`, `status`, `doctor`, `approve`, `plan`, `resume`, `validate`, `rate-limits`). Additional commands for PR creation and deployment are under development. See `specification.md` for the complete roadmap and [docs/README.md](docs/README.md) for detailed documentation.
