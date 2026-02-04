# Contributing to codemachine-pipeline

## Prerequisites

- **Node.js v24.0.0 or higher** (required -- see `engines` in package.json)
- **npm 9+**
- **Git**
- **Graphite CLI** (`gt`) -- used for branch management and PR submission

## Getting Started

1. Clone the repository:

   ```bash
   git clone <repo-url>
   cd codemachine-pipeline
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Run the full test suite:

   ```bash
   npm test
   ```

5. Verify your local setup:

   ```bash
   ./bin/run.js doctor
   ```

## Development Workflow

### Branch Strategy

This project uses [Graphite](https://graphite.dev/) for stacked PRs. See [docs/development/submission-workflow.md](development/submission-workflow.md) for the full workflow.

**Key Graphite commands:**

| Command                          | Purpose                           |
| -------------------------------- | --------------------------------- |
| `gt create <name> -m "msg"`      | Create a new branch               |
| `gt submit --no-edit`            | Submit PR through Graphite        |
| `gt log`                         | View stack status                 |
| `gt log --stack`                 | View current branch stack         |
| `gh pr ready <num>`              | Mark a draft PR as ready          |
| `gh pr view <num>`               | View PR details                   |

**Typical flow:**

```bash
# 1. Create a Graphite branch from main
gt create my-feature --message "Add widget support"

# 2. Make changes, stage, and commit
git add src/widgets/widget.ts tests/unit/widget.spec.ts
git commit -m "feat: add widget support"

# 3. Submit through Graphite (never push directly to main)
gt submit --no-edit

# 4. Mark ready for review if created as draft
gh pr ready $(gh pr list --head $(git branch --show-current) --json number -q '.[0].number')
```

Never push directly to `main` or create PRs with `gh pr create`. The main branch is protected and requires PRs submitted through Graphite.

### Running Tests

The project uses **Vitest** as its test runner. The following npm scripts are available:

| Script                         | What it runs                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| `npm test`                     | Full suite: config, HTTP/unit, integration, and command tests         |
| `npm run test:config`          | Config module tests (`src/core/config`)                               |
| `npm run test:config:watch`    | Config tests in watch mode                                            |
| `npm run test:config:coverage` | Config tests with coverage report                                     |
| `npm run test:http`            | HTTP client unit tests (`tests/unit`)                                 |
| `npm run test:integration`     | Integration tests (resume flow, CLI status/plan, execution engine)    |
| `npm run test:smoke`           | Smoke execution test                                                  |
| `npm run test:telemetry`       | Logger/telemetry unit test (`tests/unit/logger.spec.ts`)              |
| `npm run test:commands`        | CLI command tests, autoFix security tests, and persistence tests      |

**CLI smoke tests** (run the binary directly, no Vitest):

```bash
npm run smoke            # Runs all three smoke checks below
npm run smoke:version    # ./bin/run.js --version
npm run smoke:help       # ./bin/run.js --help
npm run smoke:init       # ./bin/run.js init --help
```

### Building

```bash
npm run build            # Compile TypeScript (tsc) + generate oclif manifest
npm run clean            # Remove dist/
```

### Code Style

- **TypeScript strict mode** is enforced throughout `src/` and `tests/`.
- **Formatting:** Prettier. Check with `npm run format:check`, auto-fix with `npm run format`.
- **Linting:** ESLint. Check with `npm run lint`, auto-fix with `npm run lint:fix`.
- **Validation:** Runtime schemas use Zod (see ADR-7).

Run both checks before submitting:

```bash
npm run format:check && npm run lint
```

### Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) style:

```
type: short description

Optional longer body explaining context or rationale.
```

Common type prefixes:

- `feat:` -- new feature
- `fix:` -- bug fix
- `refactor:` -- code restructuring without behavior change
- `test:` -- adding or updating tests
- `docs:` -- documentation only
- `chore:` -- tooling, CI, dependencies
- `ci:` -- CI/CD pipeline changes

Keep the subject line under 72 characters. Use the body for additional context when needed.

## Pull Request Process

1. Create a Graphite branch (`gt create <name> -m "description"`).
2. Make your changes, ensuring all tests pass (`npm test`).
3. Run formatting and lint checks (`npm run format:check && npm run lint`).
4. Submit via Graphite (`gt submit --no-edit`).
5. Mark as ready for review if created as draft (`gh pr ready <PR-number>`).
6. CI runs automatically on all PRs: unit + integration tests, security scans, Docker image builds, and code quality checks.
7. Address review feedback; the PR is merged through Graphite.

## Project Structure

```
src/
  adapters/            External service integrations
    agents/              Agent/LLM adapter and manifest loading
    github/              GitHub REST API adapter, branch protection
    http/                Rate-limit-aware HTTP client (undici-based)
    linear/              Linear GraphQL API adapter with snapshot caching
  cli/                 oclif-based CLI layer
    commands/            Command implementations (init, plan, resume, doctor, validate, etc.)
    pr/                  PR-related shared utilities
    utils/               CLI helpers (run directory, reporters)
  core/                Domain models and configuration
    config/              RepoConfig schema, loader, validator (Zod)
    models/              Zod-validated domain models (Feature, Specification, ExecutionTask, etc.)
    validation/          Validation command configuration
  persistence/         On-disk state and hash manifest
  telemetry/           Logging, metrics, cost tracking, rate-limit ledger
  utils/               Shared utilities (error handling, JSON helpers)
  workflows/           Orchestration logic
                         Context aggregation, PRD authoring, spec composition,
                         task planning, execution engine, deployment triggers,
                         write-action queue, resume coordination, and more

tests/
  unit/                Unit tests (HTTP client, commands, logger, persistence)
  integration/         Integration tests (resume flow, CLI execution, smoke)

docs/                  Documentation, ADRs, architecture diagrams
scripts/               Utility and tooling scripts
bin/                   CLI entry points (run.js, dev.js)
```
