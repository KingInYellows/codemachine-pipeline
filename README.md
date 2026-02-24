# codemachine-pipeline

Autonomous AI-powered feature development pipeline CLI

## Overview

`codemachine-pipeline` is a command-line tool that automates the entire feature development lifecycle using AI agents. From initial specification to pull request creation, the pipeline manages PRD generation, technical specifications, task breakdown, implementation, testing, and deployment.

## Features

- **Autonomous Feature Development**: AI-driven end-to-end feature implementation
- **Git-Native**: Designed for Git/GitHub-centric workflows
- **Resumable Execution**: Idempotent pipeline steps with automatic state management
- **Integration Ready**: Supports GitHub and Linear integrations
- **Deterministic Builds**: Node v24 LTS, containerized execution
- **CodeMachine CLI Adapter**: External execution engine integration with retry logic and artifact capture
- **Production-Ready Runtime**: O(1) queue operations, parallel execution, telemetry, log rotation, and security hardening

## Documentation

Full documentation is in [`docs/README.md`](docs/README.md).

| Resource        | Link                                                       |
| --------------- | ---------------------------------------------------------- |
| Getting Started | [Init Playbook](docs/playbooks/init_playbook.md)           |
| CLI Reference   | [CLI Reference](docs/reference/cli/cli-reference.md)       |
| Troubleshooting | [Doctor Reference](docs/reference/cli/doctor_reference.md) |

## Installation

### From GitHub Packages

```bash
# Configure npm for GitHub Packages
echo "@kinginyellows:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc

# Install globally
npm install -g @kinginyellows/codemachine-pipeline

# Verify
codepipe --version
```

**Security Note:** Create a GitHub Personal Access Token with `read:packages` scope at https://github.com/settings/tokens. Store your PAT securely. Do NOT commit `.npmrc` files containing tokens.

### From source

```bash
git clone https://github.com/KingInYellows/codemachine-pipeline.git
cd codemachine-pipeline
npm install
npm run build
npm link
```

### Docker

```bash
docker build -t codemachine-pipeline .
docker run --rm -v $(pwd):/workspace -w /workspace codemachine-pipeline init
```

See the [Dockerfile](Dockerfile) for build details (multi-stage, Node v24 Alpine).

## Prerequisites

- **Node.js**: v24.0.0 or higher
- **Git**: Version control with initialized repository
- **npm**: Comes with Node.js
- **(Optional)** GitHub Personal Access Token, Linear API Key, Agent service endpoint

## Quick Start

### 1. Initialize in your repository

```bash
cd your-project
codepipe init
```

This creates a `.codepipe/` directory with schema-validated configuration files.

### 2. Configure integrations

```bash
export GITHUB_TOKEN=ghp_your_token_here
export LINEAR_API_KEY=lin_api_your_key_here
export AGENT_ENDPOINT=https://your-agent-service.com/v1
```

Edit `.codepipe/config.json` to enable integrations:

```json
{
  "github": { "enabled": true },
  "linear": { "enabled": true }
}
```

### 3. Validate configuration

```bash
codepipe init --validate-only
```

### 4. Start a feature

```bash
codepipe start --prompt "Add user authentication with OAuth"
codepipe start --linear ISSUE-123
codepipe start --spec ./specs/new-feature.md
```

## Available Commands

| Command                      | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `codepipe init`              | Initialize pipeline in a git repository                            |
| `codepipe start`             | Start a feature pipeline from prompt, Linear issue, or spec        |
| `codepipe status`            | Show pipeline state for a feature                                  |
| `codepipe doctor`            | Run environment diagnostics and readiness checks                   |
| `codepipe health`            | Quick runtime health check                                         |
| `codepipe approve <gate>`    | Approve or deny pipeline gates (prd, spec, plan, code, pr, deploy) |
| `codepipe plan`              | Display execution plan DAG and dependency graph                    |
| `codepipe resume`            | Resume a failed or paused pipeline execution                       |
| `codepipe validate`          | Run validation commands (lint, test, typecheck, build)             |
| `codepipe rate-limits`       | Display API rate limit status and telemetry                        |
| `codepipe context summarize` | Generate or refresh context summaries                              |
| `codepipe research <sub>`    | Research task management (create, list)                            |
| `codepipe pr <sub>`          | PR management (create, status, reviewers, disable-auto-merge)      |

All commands support `--json` for machine-readable output. For full options and examples, see the [CLI Reference](docs/reference/cli/cli-reference.md).

## Development

### Setup & Build

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

### Linting & Formatting

```bash
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run format        # Prettier
npm run format:check  # Prettier check
```

### Local Development

```bash
./bin/dev.js init
./bin/dev.js start --prompt "test feature"
```

### Smoke Tests

```bash
npm run smoke          # All smoke tests
npm run smoke:version  # Test --version
npm run smoke:help     # Test --help
npm run smoke:init     # Test init help
```

For fixture updates and integration testing, see [Integration Testing](docs/reference/integration_testing.md).

## Project Structure

```
codemachine-pipeline/
├── src/
│   ├── cli/               # CLI presentation layer (oclif commands)
│   ├── core/              # Configuration and domain models
│   ├── adapters/          # GitHub, Linear, HTTP adapters
│   ├── workflows/         # Business logic workflows
│   ├── persistence/       # Run directory and state management
│   ├── telemetry/         # Logging, metrics, and tracing
│   ├── utils/             # Shared utilities (errors, safe JSON parsing)
│   └── validation/        # Zod schema validation helpers
├── config/schemas/        # JSON Schema definitions
├── docs/                  # Full documentation (see docs/README.md)
├── examples/              # Sample configurations
├── tests/                 # Unit, integration, and fixture tests
├── scripts/               # Build and utility scripts
└── .github/workflows/     # CI/CD pipeline
```

## CI/CD

The project uses GitHub Actions for continuous integration:

- **Linting**: ESLint with TypeScript support
- **Testing**: Vitest with coverage reporting
- **Building**: TypeScript compilation
- **Docker**: Multi-stage build verification

All checks run on Node v24.x.

## Architecture

The pipeline operates on a state machine model with phases: Initialize, Specify, Plan, Implement, Review, Deploy. Each phase is idempotent and resumable. Artifacts are stored in `.codepipe/runs/<feature-id>/`.

See [Execution Flow](docs/reference/architecture/execution_flow.md) for details.

## Execution Engine

The pipeline supports multiple AI execution engines via the CodeMachine CLI adapter.

| Engine   | Description                |
| -------- | -------------------------- |
| `claude` | Anthropic Claude (default) |
| `codex`  | OpenAI Codex               |
| `openai` | OpenAI                     |

For configuration and setup, see [CodeMachine Adapter Guide](docs/reference/config/codemachine_adapter_guide.md).

## Configuration

Configuration is stored in `.codepipe/config.json` and validated against a JSON Schema. Key sections: `project`, `github`, `linear`, `runtime`, `safety`, `feature_flags`, `constraints`.

Credentials are provided via environment variables:

```bash
export GITHUB_TOKEN=ghp_xxxxx
export LINEAR_API_KEY=lin_api_xxxxx
export AGENT_ENDPOINT=https://agent.example.com/v1
```

See [RepoConfig Schema](docs/reference/config/RepoConfig_schema.md) for details. Full schema: `config/schemas/repo_config.schema.json`. Sample: `examples/sample_repo_config/`.

## License

MIT

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, workflow, and coding guidelines.

## Support

For issues and questions:

- GitHub Issues: https://github.com/KingInYellows/codemachine-pipeline/issues
- Documentation: [docs/README.md](docs/README.md)
