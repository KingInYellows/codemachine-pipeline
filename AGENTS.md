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

## Common Commands

```bash
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
gt create <branch-name> --message "Brief description"
git add <files>
git commit -m "type: short description"
gt submit --no-interactive --publish
gh pr ready <pr-number>
```

See [`docs/archive/development/submission-workflow.md`](docs/archive/development/submission-workflow.md) for the longer workflow reference.

## Testing Guidance

- `npm test` runs the main suite: config, unit/http, integration, and command tests.
- Smoke checks are available through `npm run smoke`.
- Integration tests use temporary on-disk workspaces; do not point tests at the real project tree.
- Build before relying on generated CLI artifacts or manifest-driven docs checks.

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
