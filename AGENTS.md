# PROJECT KNOWLEDGE BASE

**Generated:** 2025-12-30
**Commit:** f0128c9
**Branch:** main

## OVERVIEW

AI-powered feature pipeline CLI (`ai-feature`) - enterprise-grade autonomous development orchestrator. Not a typical CLI tool. Orchestrates PRD authoring, task planning, research, PR automation with resumable execution. Built with TypeScript, oclif framework, Node.js 24+.

## STRUCTURE

```
codemachine-pipeline/
├── src/
│   ├── workflows/       # 20 coordinators/engines (core pipeline logic)
│   ├── core/models/     # 16 Zod domain models (schema-driven)
│   ├── cli/commands/    # oclif commands (namespaced: pr/, research/, context/)
│   ├── telemetry/       # 9 modules: logging, metrics, cost, rate limits
│   ├── adapters/        # GitHub, Linear, HTTP, Agent integrations
│   ├── persistence/     # Run directory & hash manifest (resumable state)
│   └── core/config/     # Schema-driven config with migration support
├── bin/
│   ├── run.js           # Production entry (npm bin: ai-feature)
│   └── dev.js           # Development entry (ts-node bypass compilation)
├── tests/               # Vitest unit/integration tests
├── test/                # Jest CLI command tests (dual framework)
├── docs/                # Requirements (20+), ops guides, diagrams
├── .codemachine/        # Generated artifacts (plans, tasks, PRDs)
└── .ai-feature-pipeline/ # Telemetry, templates, runs/ (stateful execution)
```

## WHERE TO LOOK

| Task                      | Location                        | Notes                                         |
| ------------------------- | ------------------------------- | --------------------------------------------- |
| Add CLI command           | `src/cli/commands/`             | Extend oclif Command class                    |
| Add subcommand            | `src/cli/commands/{namespace}/` | pr/, research/, context/                      |
| New workflow              | `src/workflows/`                | Follow *Coordinator/*Engine pattern           |
| New domain model          | `src/core/models/`              | Zod schema + parse/serialize helpers          |
| GitHub/Linear integration | `src/adapters/`                 | Extend existing adapters                      |
| Logging/metrics           | `src/telemetry/`                | Use structured logger, cost tracker           |
| Test fixtures             | `tests/fixtures/`               | SHA-256 hashes in manifest.json               |
| Configuration             | `src/core/config/`              | Update RepoConfig + schema, handle migrations |

## CODE MAP

Core export: `src/index.ts` (minimal, delegates to `src/cli/index.ts`)

| Module          | Exports                             | Role                                                 |
| --------------- | ----------------------------------- | ---------------------------------------------------- |
| `core/models/`  | 16 domain models via barrel export  | Central data contracts with Zod schemas              |
| `workflows/`    | 20 coordinators/engines             | Pipeline orchestration (PRD, plan, research, resume) |
| `telemetry/`    | Logger, metrics, cost, rate limits  | Observability infrastructure                         |
| `adapters/`     | GitHub, Linear, HTTP, Agent clients | External service integrations                        |
| `cli/commands/` | 16 oclif commands                   | User-facing CLI surface                              |

### Module Dependencies

```
bin/run.js ──> src/index.ts ──> src/cli/index.ts ──> @oclif/core.run()
                                      │
                                      ├──> cli/commands/* ──> workflows/* ──> core/models/
                                      │                            │
                                      └──> adapters/* <────────────┘
                                                │
                                                └──> telemetry/*
```

## CONVENTIONS

### TypeScript

- **Node.js 24+ required** (unusual - most CLIs target LTS 18/20)
- ES2022 target, Node16 modules
- `exactOptionalPropertyTypes: true` - distinguish `T | undefined` vs `T?`
- Node built-ins prefixed: `import * as fs from 'node:fs/promises'`
- Unused params: prefix with `_` (e.g., `_unused`)

### Formatting

- Semicolons required
- Single quotes
- 100 char line width
- 2-space indent
- Trailing commas (ES5 style)

### Code Patterns

- Barrel exports via `index.ts`
- Zod schemas for all domain models (parse/serialize helpers)
- Error taxonomy: Transient → Permanent → HumanActionRequired
- Named exports preferred over default
- Workflow naming: `*Coordinator` (orchestrates) vs `*Engine` (executes)

### Testing

- **Dual framework split** (unusual):
  - Jest (`test/`) for CLI command integration tests
  - Vitest (`tests/`) for unit/integration tests
- **Fixture integrity**: SHA-256 hashes in `manifest.json`
- **Provider fixtures**: Organized by service (github/, linear/)
- Update fixtures: `scripts/tooling/update_fixtures.sh`

## ANTI-PATTERNS (THIS PROJECT)

| Don't                            | Why                   | Instead                                                    |
| -------------------------------- | --------------------- | ---------------------------------------------------------- |
| Use deprecated config fields     | Migration in progress | `governance.approval_workflow`, `governance.risk_controls` |
| Store tokens in rate_limits.json | Security              | Only non-sensitive headers persisted                       |
| Leave TODO markers in PRDs       | Validation warnings   | Complete all `_TODO:` placeholders                         |
| Mix Jest/Vitest in same dir      | Dual framework split  | Jest→`test/`, Vitest→`tests/`                              |
| Skip hash verification on resume | Data integrity        | Only use `--force` if necessary                            |
| Bypass oclif Command class       | Framework patterns    | Extend Command, use proper flags/args                      |
| Skip rate limit handling         | API quota exhaustion  | Use HTTPClient with retry-after                            |

### Deprecated Config Fields (migrate these)

- `require_approval_for_prd` → `governance.approval_workflow.require_approval_for_prd`
- `require_approval_for_plan` → `governance.approval_workflow.require_approval_for_plan`
- `require_approval_for_pr` → `governance.approval_workflow.require_approval_for_pr`
- `prevent_force_push` → `governance.risk_controls.prevent_force_push`
- `governance_notes` → `governance.governance_notes`

See `docs/requirements/config_migrations.md` for migration checklist.

## UNIQUE PATTERNS

- **Stateful CLI**: Run directory persistence for resumable workflows (unusual for CLIs)
- **Rate limit infrastructure**: Built-in exponential backoff, retry-after, cost tracking
- **Schema-driven config**: JSON Schema validation + Zod schemas + env var overrides
- **Artifact versioning**: SHA-256 hash manifests for deterministic builds
- **Queue-based execution**: Backlog tracking with failure recovery
- **Branch protection awareness**: Detects auto-merge, prevents force push
- **Multi-provider agents**: OpenAI-compatible agent endpoints (BYOA)

## COMMANDS

```bash
# Development
npm install
npm run dev -- <command>     # Run via ts-node (bypasses build)
npm run build                # TypeScript → dist/ + oclif manifest

# Testing
npm test                     # All frameworks (Jest + Vitest)
npm run test:coverage        # With coverage
npm run smoke                # CLI smoke tests

# Code Quality
npm run lint                 # ESLint
npm run lint:fix             # Auto-fix
npm run format               # Prettier
npm run format:check         # Validate

# Docker
docker build -f docker/Dockerfile -t ai-feature-pipeline .
docker run --rm -v $(pwd):/workspace ai-feature-pipeline init
```

## CLI COMMANDS

| Command                        | Description                   |
| ------------------------------ | ----------------------------- |
| `ai-feature init`              | Initialize repo configuration |
| `ai-feature start`             | Start new feature pipeline    |
| `ai-feature plan`              | Generate/view execution plan  |
| `ai-feature status`            | Pipeline status               |
| `ai-feature resume`            | Resume interrupted feature    |
| `ai-feature approve`           | Approval management           |
| `ai-feature doctor`            | Diagnostics/health checks     |
| `ai-feature validate`          | Configuration validation      |
| `ai-feature rate-limits`       | Rate limit monitoring         |
| `ai-feature pr create`         | Create pull request           |
| `ai-feature pr status`         | PR status checks              |
| `ai-feature research create`   | Create research task          |
| `ai-feature context summarize` | Summarize context             |

## BRANCHING STRATEGY (GitHub Flow + Graphite)

**Strategy**: GitHub Flow with Graphite for stacked PRs

### Workflow

1. **All changes go through PRs** - Never push directly to `main`
2. **Use Graphite CLI (`gt`)** for branch/PR management
3. **Stack related changes** - Keep PRs small, focused, reviewable

### Graphite Commands

```bash
# Core workflow
gt create -m "feat: description"   # Create branch + commit (replaces git commit)
gt submit --no-interactive         # Push + create PR (replaces git push)
gt sync --force                    # Pull trunk, delete merged branches
gt modify                          # Amend current branch, rebase upstack

# Navigation
gt checkout                        # Interactive branch selection
gt up / gt down                    # Navigate stack
gt state                           # Show repository state

# Stacking
gt submit --stack                  # Submit entire stack as linked PRs
gt restack                         # Rebase all PRs on latest changes
```

### Rules

| Rule                    | Rationale                                |
| ----------------------- | ---------------------------------------- |
| Never `git commit`      | Use `gt create -m "message"` instead     |
| Never `git push`        | Use `gt submit --no-interactive` instead |
| Keep PRs < 400 lines    | Easier review, faster merge              |
| Stack related changes   | PR #2 depends on #1? Stack them          |
| Run `gt sync` regularly | Cleans merged branches, updates trunk    |

### Branch Naming

Graphite auto-generates branch names from commit messages:

- `12-30-feat_add_user_authentication`
- `12-30-fix_validation_bug`

### PR Workflow

```bash
# Single PR
gt create -m "feat: add feature"
gt submit --no-interactive

# Stacked PRs (3 related changes)
gt create -m "refactor: extract types"
gt create -m "feat: add new module"
gt create -m "test: add integration tests"
gt submit --stack --no-interactive
```

### After PR Merge

```bash
gt sync --force    # Deletes merged branches, updates main
gt checkout main   # Switch to updated trunk
```

## CI/CD INFRASTRUCTURE

- **Self-hosted runners**: All GitHub Actions run on self-hosted runners, NOT GitHub-hosted
- **Runner label**: Use `runs-on: self-hosted` in all workflow jobs
- **Docker**: Available on runners, use native `docker build` instead of buildx actions
- **Node.js**: Use `actions/setup-node@v4` with version '24' for consistency
- **No GHA caching**: Self-hosted runners don't use GitHub's hosted cache; local disk cache instead

### Workflow Configuration

```yaml
jobs:
  example:
    runs-on: self-hosted # REQUIRED - never use ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
```

## NOTES

- **Not a typical CLI**: Enterprise AI pipeline platform, not simple command tool
- **Node.js 24 requirement**: Bleeding edge, most projects use LTS (18/20)
- **Dual test frameworks**: Jest for CLI commands, Vitest for core logic
- **Fixture integrity**: SHA-256 hashes prevent drift
- **Queue health warnings**: Backlog >50 or failures >5 triggers warnings
- **Exit codes**: 0=success, 10=config error (see doctor command)
- **oclif manifest**: Auto-generated post-build, don't edit manually
- **Rate limit handling**: HTTP client includes retry-after, exponential backoff
- **GitHub API**: Uses REST API v2022-11-28 with explicit version headers
- **Linear API**: Developer Preview with agent integration
