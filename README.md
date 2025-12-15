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

```bash
docker build -t ai-feature-pipeline .
docker run --rm ai-feature-pipeline --help
```

## Requirements

- Node.js >= 24.0.0
- Git repository
- (Optional) GitHub/Linear API credentials for integrations

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

### `ai-feature start` (Planned)

Start a new feature development pipeline.

### `ai-feature status` (Planned)

Show the current state of a feature.

### `ai-feature resume` (Planned)

Resume a paused or failed feature pipeline.

### `ai-feature pr create` (Planned)

Create a pull request for a completed feature.

### `ai-feature deploy` (Planned)

Trigger deployment for a merged feature.

### `ai-feature export` (Planned)

Export feature artifacts in JSON or Markdown format.

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
```

## Project Structure

```
ai-feature-pipeline/
├── src/
│   ├── commands/          # CLI command implementations
│   │   └── init.ts        # Initialize command
│   ├── core/
│   │   └── config/        # Configuration management
│   │       └── repo_config.ts  # Schema validation & loaders
│   └── index.ts           # Entry point
├── config/
│   └── schemas/           # JSON Schema definitions
│       └── repo_config.schema.json
├── examples/
│   └── sample_repo_config/
│       ├── config.json    # Sample configuration
│       └── README.md      # Configuration guide
├── test/
│   └── commands/          # Command tests
│       └── init.test.ts
├── .github/
│   └── workflows/
│       └── ci.yml         # CI/CD pipeline
├── Dockerfile             # Container build
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

## Architecture

The pipeline operates on a state machine model with the following phases:

1. **Initialize**: Repository configuration and integration validation
2. **Specify**: PRD and technical specification generation
3. **Plan**: Task breakdown and dependency graph creation
4. **Implement**: Autonomous code generation and testing
5. **Review**: PR creation and review request
6. **Deploy**: Merge and deployment automation

Each phase is idempotent and resumable. Artifacts are stored in `.ai-feature-pipeline/runs/<feature-id>/`.

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

**Note**: This is a scaffold release (v0.1.0). Additional commands and features are under development. See `specification.md` for the complete roadmap.
