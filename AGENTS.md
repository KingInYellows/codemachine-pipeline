# AGENTS

Shared repository guidance for coding agents working in `codemachine-pipeline`.

## Repository Snapshot

- CLI name: `codepipe`
- Runtime: Node.js `>=24.0.0`
- Language/tooling: TypeScript, oclif, Vitest, ESLint, Prettier
- Primary entrypoints: `./bin/run.js`, `./bin/dev.js`

## Setup

```bash
npm ci
npm run build
```

The build generates `dist/` and refreshes `oclif.manifest.json` in `postbuild`.

For Codex App worktrees, use `npm run worktree:setup` instead of the commands above. It handles dependency installation and building automatically, and also configures a fresh worktree without reading or printing secrets by linking `.env`, `.npmrc`, and local certificate directories from a secure local asset store when available, or by generating non-secret defaults when those files are absent. Pass `--skip-install` or `--skip-build` to skip those steps if you have already run them.

When shared `node_modules` are available, the setup script links them only when a `.node-version` or `.nvmrc` marker is present next to that shared dependency tree and the recorded Node major version is compatible. If the marker is missing or the shared dependency tree was prepared for a different Node major, the script falls back to a clean `npm ci --ignore-scripts` when a lockfile is present, then runs the explicit build step unless `--skip-build` is set.

## Common Commands

```bash
npm run worktree:setup
npm run build
npm test
npm run lint
npm run lint:fix
npm run format:check
npm run format
npm run deps:check
npm run exports:check
npm run docs:cli
npm run docs:cli:check
npm run docs:validate
npm run docs:links:check
```

Cross-platform worktree setup entrypoints:

```bash
npm run worktree:setup
./scripts/setup-worktree.sh
pwsh -File .\\scripts\\setup-worktree.ps1
```

## CLI Commands

Run the built CLI with:

```bash
./bin/run.js <command>
```

Current command surface includes:

- `init`
- `start`
- `status`
- `doctor`
- `health`
- `approve`
- `plan`
- `resume`
- `validate`
- `rate-limits`
- `context summarize`
- `research create`
- `research list`
- `pr create`
- `pr status`
- `pr reviewers`
- `pr disable-auto-merge`

## Workflow Expectations

- Use Graphite for branch and PR submission.
- Do not push directly to `main`.
- Do not create PRs with `gh pr create`.
- Preferred flow:

```bash
git add <files>
gt create <branch-name> --message "type: short description"
gt submit --no-interactive --publish
gh pr ready $(gh pr list --head $(git branch --show-current) --json number -q '.[0].number')
```

See [`docs/archive/development/submission-workflow.md`](docs/archive/development/submission-workflow.md) for the longer workflow reference.

## Testing Guidance

- `npm test` runs the main suite: config, unit/http, integration, and command tests.
- Smoke checks are available through `npm run smoke`.
- Integration tests use temporary on-disk workspaces; do not point tests at the real project tree.
- Build before relying on generated CLI artifacts or manifest-driven docs checks.

## Codex App Actions

- `Env Doctor`: `./bin/dev.js doctor --verbose`
- `Build`: `npm run build`
- `Test`: `npm test`
- `Run dev server`: `npm run dev -- --help`

This repository is a CLI, not a long-running web service. Use the dev entrypoint for the "Run dev server" action and replace `--help` with the command you want to exercise while iterating.

## Documentation Guidance

- Prefer targeted documentation edits over broad rewrites.
- Verify commands, scripts, paths, and env vars against the repo before changing docs.
- CLI reference is generated into [`docs/reference/cli/cli-reference.md`](docs/reference/cli/cli-reference.md).
- After changing command definitions, run:

```bash
npm run docs:cli
npm run docs:cli:check
```

## Codebase Notes

- Keep new files in the appropriate directory; avoid saving working files in the repo root.
- Runtime state under `.codepipe/` is operational data, not primary source.
- The optional `codemachine` dependency may be absent; features should degrade gracefully.
- TypeScript strict mode is enabled across the project.

## Environment Variables

These are used when the corresponding integrations are enabled:

- `GITHUB_TOKEN`
- `LINEAR_API_KEY`
- `AGENT_ENDPOINT`

Configuration lives in `.codepipe/config.json`; schema reference is in [`docs/reference/config/RepoConfig_schema.md`](docs/reference/config/RepoConfig_schema.md).
