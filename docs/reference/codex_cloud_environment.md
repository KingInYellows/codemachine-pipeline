# Codex Cloud Environment Setup (Online Setup + Offline Agent)

This repository can run in Codex Cloud with a two-phase model:

1. **Setup phase (internet + secrets available):** install dependencies and prepare artifacts.
2. **Agent phase (offline, secrets removed):** run static checks and local CLI operations without external credentials.

## Scripts

### 1) Setup script (online, deterministic)

- Path: `scripts/tooling/codex_cloud_setup.sh`
- Purpose:
  - validates Node version against `package.json#engines.node`
  - performs deterministic dependency install via `npm ci --ignore-scripts`
  - builds generated artifacts (`dist/`, `oclif.manifest.json`)
  - writes a non-secret runtime config at `.codepipe/config.json` only when one does not already exist
  - stores lockfile fingerprint at `.codex-cloud/package-lock.sha256`
  - uses a temporary npm user config for registry auth without modifying a repo `.npmrc`

Run:

```bash
bash scripts/tooling/codex_cloud_setup.sh
```

### 2) Maintenance script (cached container resume)

- Path: `scripts/tooling/codex_cloud_maintenance.sh`
- Purpose:
  - verifies `package-lock.json` fingerprint when available
  - safely re-syncs dependencies from lockfile with `npm ci --prefer-offline --ignore-scripts`
  - rebuilds `dist/` with `OCLIF_SKIP_MANIFEST=1` so offline maintenance does not invoke `npx oclif manifest`

Run:

```bash
bash scripts/tooling/codex_cloud_maintenance.sh
```

## Environment variables

### Non-secret (safe in agent phase)

- `CI=true` (stable non-interactive behavior)
- `OCLIF_SKIP_MANIFEST=1` (required for offline rebuilds that cannot refresh `oclif.manifest.json`)
- `AGENT_ENDPOINT=http://127.0.0.1:8080/v1` (only if local/offline-compatible agent endpoint is used)

### Secrets (setup phase only; removed before agent phase)

- `NODE_AUTH_TOKEN` (required only if private registry auth is needed for install)
- `GITHUB_TOKEN` (only if setup performs GitHub API/bootstrap tasks)
- `LINEAR_API_KEY` (only if setup performs Linear bootstrap tasks)

> Keep secret scope limited to setup. Do not persist them into `.codepipe/config.json`, `.env` files, or command logs.

## Validation plan (agent phase, no secrets)

These checks require no network credentials:

1. Verify build artifacts exist:
   - `test -f dist/index.js`
   - `test -f oclif.manifest.json`
2. CLI boot checks:
   - `./bin/run.js --version`
   - `./bin/run.js --help`
3. Static quality checks:
   - `npm run lint`
   - `npm run format:check`
4. Unit/integration checks that do not require external credentials:
   - `npm test`
5. Docs consistency checks:
   - `npm run docs:cli:check`
   - `npm run docs:validate`

If the container is strictly offline with no pre-populated npm cache, run setup once online before entering offline agent mode.

Generated setup artifacts under `.codepipe/config.json` and `.codex-cloud/` are ignored by git.
