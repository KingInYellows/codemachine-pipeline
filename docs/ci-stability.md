# CI Stability Playbook

This repo targets boring, deterministic CI on self-hosted runners. The goal is a fast,
trustworthy signal on PRs and a green `main`.

## Required vs Optional Checks

CI workflow: `.github/workflows/ci.yml`

Required (merge gate):
- `Test and Lint`
  - `npm run security:glob-guard`
  - `npm run lint`
  - `npm run format:check`
  - `npm test`
  - `npm run build`
- `Docker Build`
  - `docker build -t codemachine-pipeline:test .`
  - `docker run --rm codemachine-pipeline:test --help`
  - `docker run --rm codemachine-pipeline:test doctor --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`

Optional (non-blocking signal):
- `security/scan` (only the `npm audit` step is non-blocking; the advisory guard is still required)

## Local Reproduction

Use the same Node version as CI (Node 24+).

Core CI checks:

```bash
npm ci
npm run security:glob-guard
npm run lint
npm run format:check
npm test
npm run build
```

Smoke tests (non-blocking in CI):

```bash
./scripts/tooling/smoke_execution.sh
```

Docker checks:

```bash
docker build -t codemachine-pipeline:test .
docker run --rm codemachine-pipeline:test --help
docker run --rm codemachine-pipeline:test doctor --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"
```

If you need to reproduce CI determinism locally, use UTC:

```bash
TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm test
```

## Flake Policy (Quarantine + Unquarantine)

1. Confirm flakiness by re-running the exact command 3x.
2. File a tracking issue with a clear owner and reproduction steps.
3. Quarantine only the flaky portion by moving it behind a non-blocking job
   or an explicit opt-in flag.
4. Keep required checks fast and deterministic.
5. Unquarantine only after the root cause is fixed and verified.

## Common Failure Interpretation

- `no-useless-escape` / lint errors:
  - ESLint config is strict; fix the source file and re-run `npm run lint`.
- `npm audit --audit-level=high`:
  - Advisory signal only. Investigate, but it should not block merges.
- Docker build fails during `npm ci`:
  - Ensure Dockerfile build context includes required files (e.g., `scripts/`).
- `doctor --json` failure:
  - Indicates CLI output or JSON formatting regression; run locally with the same command.

## Self-Hosted Runner Expectations

- Node.js 24+ and npm available.
- Docker available and usable without elevated privileges.
- Node.js used for JSON validation in docker smoke test (no Python dependency).

If any of the above are missing, CI should fail fast with a clear error.

## Additional CI Features

- **`workflow_dispatch` manual trigger**: The CI workflow can be triggered manually from the
  GitHub Actions UI via the `workflow_dispatch` event. This is useful for re-running CI
  without pushing a new commit.
- **Graphite `optimize_ci` job**: The `optimize_ci` job uses the Graphite CI action
  (`withgraphite/graphite-ci-action`) to skip redundant CI runs on stacked PRs. Downstream
  jobs check `needs.optimize_ci.outputs.skip` and only run when the value is `'false'`.
- **Codecov upload step**: After tests pass, coverage data (`./coverage/lcov.info`) is
  uploaded to Codecov via `codecov/codecov-action@v4`. The upload is non-blocking
  (`fail_ci_if_error: false`) and only runs on success.
