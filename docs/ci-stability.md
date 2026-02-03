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
  - `docker build -t ai-feature-pipeline:test .`
  - `docker run --rm ai-feature-pipeline:test --help`
  - `docker run --rm ai-feature-pipeline:test doctor --json | python3 -m json.tool`

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
docker build -t ai-feature-pipeline:test .
docker run --rm ai-feature-pipeline:test --help
docker run --rm ai-feature-pipeline:test doctor --json | python3 -m json.tool
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
- Python 3 available for JSON validation in docker smoke test.

If any of the above are missing, CI should fail fast with a clear error.
