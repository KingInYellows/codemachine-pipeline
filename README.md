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

This creates a `.ai-feature-pipeline/` directory with configuration files.

### 2. Configure integrations (optional)

Edit `.ai-feature-pipeline/config.json` to enable GitHub or Linear integrations:

```json
{
  "integrations": {
    "github": {
      "enabled": true,
      "token": "ghp_your_token_here"
    },
    "linear": {
      "enabled": true,
      "apiKey": "lin_api_your_key_here"
    }
  }
}
```

### 3. Start a feature

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

Initialize the pipeline in the current git repository.

**Options:**
- `-f, --force`: Force re-initialization even if config already exists

**Example:**
```bash
ai-feature init
ai-feature init --force
```

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
│   └── index.ts           # Entry point
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

Configuration is stored in `.ai-feature-pipeline/config.json`:

```json
{
  "version": "1.0.0",
  "repository": {
    "root": "/path/to/repo",
    "type": "git"
  },
  "integrations": {
    "github": {
      "enabled": false
    },
    "linear": {
      "enabled": false
    }
  },
  "settings": {
    "runDirectory": ".ai-feature-pipeline/runs",
    "logsFormat": "ndjson"
  }
}
```

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
