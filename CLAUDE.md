# CodeMachine Pipeline

Autonomous AI-powered feature development pipeline CLI (`codepipe`). Built with oclif, TypeScript (strict), vitest.

## Commands

```bash
npm run build          # TypeScript compilation (tsc → dist/)
npm test               # Full test suite (config + http + integration + commands)
npm run lint           # ESLint (type-checked, strict)
npm run lint:fix       # ESLint with auto-fix
npm run format:check   # Prettier check
npm run format         # Prettier write
npm run smoke          # Smoke tests (version, help, init)
npm run deps:check     # Circular dependency check (madge)
npm run docs:validate  # Validate doc links, commands, examples, security
```

### Running specific test suites

```bash
npm run test:config       # src/core/config tests
npm run test:http         # tests/unit
npm run test:integration  # tests/integration (6 specific spec files)
npm run test:commands     # tests/unit/commands + autoFix security + persistence
npm run test:smoke        # smoke_execution.spec.ts
```

### CLI (codepipe)

```bash
./bin/run.js <command>    # Run CLI commands directly
./bin/dev.js              # Dev mode (ts-node)
```

Commands: `init`, `start`, `plan`, `approve`, `resume`, `doctor`, `health`, `validate`, `status`, `rate-limits`, `pr create`, `pr status`, `pr reviewers`, `pr disable-auto-merge`, `research create`, `research list`, `context summarize`.

## Architecture

```
src/
├── cli/commands/     # oclif command definitions
│   ├── pr/           # PR management (create, status, reviewers, auto-merge)
│   ├── research/     # Research task management
│   ├── status/       # Pipeline status
│   └── context/      # Context summarization
├── core/
│   ├── config/       # RepoConfig schema + validation (Zod)
│   ├── models/       # Domain types (Feature, Specification, ExecutionTask, etc.)
│   └── validation/   # Validation command config
├── adapters/
│   ├── github/       # GitHub API (PRs, branch protection)
│   ├── linear/       # Linear issue tracking
│   ├── agents/       # Agent provider integration
│   ├── codemachine/  # CodeMachine binary resolver + CLI adapter
│   └── http/         # HTTP client utilities
├── workflows/        # Core pipeline logic (execution engines, queue, planning)
├── persistence/      # Run directory management, hash manifests
├── telemetry/        # Logging, metrics, traces, cost tracking, rate limits
├── validation/       # Input validation helpers
└── utils/            # Error handling, env filtering, safe JSON
```

### Key files

- `.codepipe/config.json` — Project configuration (integrations, safety, feature flags, constraints)
- `config/schemas/` — JSON schemas
- `vitest.config.ts` — Test configuration (30s timeout, v8 coverage)
- `eslint.config.cjs` — ESLint flat config (type-checked, prettier)
- `bin/run.js` / `bin/dev.js` — CLI entry points

## Code Style

- **TypeScript strict mode** with `exactOptionalPropertyTypes: true` — optional properties must use `| undefined` explicitly
- **No floating promises** — `@typescript-eslint/no-floating-promises: error`
- **No `any`** — `@typescript-eslint/no-explicit-any: warn`
- Prefer specific interfaces over `Record<string, unknown>`
- Unused vars must be prefixed with `_` (e.g., `_unused`)
- Prettier for formatting; eslint-config-prettier to avoid conflicts
- Test files have relaxed type-safety rules (unsafe assignment/call/return/member-access off)

## Environment

- **Node >= 24.0.0** required (see `engines` in package.json)
- `GITHUB_TOKEN` — GitHub API access (optional, `.codepipe/config.json` `github.enabled`)
- `LINEAR_API_KEY` — Linear integration (optional)
- `AGENT_ENDPOINT` — Agent provider endpoint

## Testing

- **vitest** with globals enabled, node environment
- Tests in `src/**/*.{test,spec}.ts` and `tests/**/*.{test,spec}.ts`
- Coverage: v8 provider, reporters: text/json/html/lcov
- `pretest` runs build automatically (with `OCLIF_SKIP_MANIFEST=1`)
- Integration tests require built output in `dist/`

## CI

- GitHub Actions on self-hosted Linux runners
- Graphite CI optimization (skip redundant PR builds)
- Jobs: workflow lint, build, test, smoke, docs validation, security scan
- Separate workflows: `ci.yml`, `docs-validation.yml`, `publish.yml`, `security-scan.yml`

## Gotchas

- `exactOptionalPropertyTypes` means `{ foo?: string }` does NOT accept `{ foo: undefined }` — use `{ foo?: string | undefined }` if you need to pass `undefined` explicitly
- oclif manifest (`oclif.manifest.json`) is auto-generated via `postbuild` — don't edit manually
- `.codepipe/runs/`, `.codepipe/logs/`, `.codepipe/metrics/`, `.codepipe/telemetry/` are gitignored runtime dirs
- `CLAUDE.md` itself is gitignored — it's local configuration, not shared with the team
- Build is required before running tests (`pretest` handles this)
- The `codemachine` package is an optional dependency — features degrade gracefully without it

## File Organization

- Never save working files, docs, or tests to the root folder
- Source code: `src/`, Tests: `tests/`, Docs: `docs/`, Config: `config/`, Scripts: `scripts/`

## Workflow Reminders

- Do what has been asked; nothing more, nothing less
- Prefer editing existing files over creating new ones
- Never proactively create documentation files unless explicitly requested
