# Cycle 13 Release Health Audit

Date: 2026-05-01

Team: `codemachine-pipeline`

Cycle: 13 (`2026-05-08` to `2026-05-22`)

## Summary

Cycle 13 was seeded as a release-health and backlog-hygiene cycle because Linear had no active open work for the `codemachine-pipeline` team. The repository is locally shippable after applying formatting, lint cleanup, dependency lock refreshes, CLI docs generation, and test mock cleanup.

## Verification Results

Passed:

- `npm ci`
- `npm run build`
- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run exports:check`
- `npm run deps:check`
- `npm audit --audit-level=moderate`
- `npm run docs:cli`
- `npm run docs:cli:check`
- `npm run docs:validate`
- `npm run smoke`
- Representative command help checks for `init`, `start`, `status`, `doctor`, `plan`, `validate`, and `pr status`

Known non-blocking warnings:

- `npm run docs:validate` reports redacted email-address findings from `docs:security:check`, but the security scan exits successfully with no sensitive data found.

## Fixes Applied

- Refreshed `package-lock.json` with safe in-range dependency updates.
- Cleared npm audit findings: audit now reports 0 vulnerabilities.
- Generated current CLI reference, adding the existing `codepipe cycle` command to `docs/reference/cli/cli-reference.md`.
- Applied Prettier formatting to drifted TypeScript files.
- Removed unnecessary type assertions surfaced by the updated lint toolchain.
- Fixed `tests/unit/persistence/lockManager.spec.ts` mock cleanup so Vitest no longer warns about nested `vi.unmock()`.
- Added `config/unused-exports-baseline.json` and `scripts/tooling/check_unused_exports.js` so `npm run exports:check` fails on new unused exports instead of failing on known dynamic/public exports.
- Removed remaining test `Record<string, unknown>` lint warnings; `npm run lint` now exits without warnings.
- Evaluated TypeScript 6 and Undici 8 major upgrades. Both were intentionally deferred: TypeScript 6 causes `npm ls` to report an invalid tree because `madge@8.0.0` still declares a `typescript@^5.4.4` peer dependency, and Undici 8 breaks the HTTP mock-agent unit suite with missed intercepts/network failures.

## Remaining Follow-Ups

The following items are intentionally follow-up work rather than silent cycle-closeout changes:

- `npm outdated --json` still reports TypeScript 6 and Undici 8 as major-version drift. Keep TypeScript on 5.9.x until the dependency toolchain, specifically `madge`, accepts TypeScript 6 as a peer. Keep Undici on 7.x until the HTTP adapter tests are compatible with Undici 8 mock-agent behavior. Tracked as `CDMCH-264`.
- The currently open Dependabot PRs are superseded by this lock refresh once this branch lands, but should not be closed against `main` before the replacement changes are merged.

## Linear/GitHub Reconciliation Notes

Linear created GitHub issues for the Cycle 13 work:

- GitHub #903 / CDMCH-255: full repo quality gate
- GitHub #904 / CDMCH-256: CLI docs and docs validation
- GitHub #905 / CDMCH-257: smoke checks
- GitHub #906 / CDMCH-258: Linear/GitHub reconciliation
- GitHub #907 / CDMCH-259: fresh backlog audit

Recent GitHub state shows active dependency-related PRs:

- #902 minor-and-patch dependency group
- #901 `basic-ftp`
- #900 Vite 8
- #896 `flatted`
- #887 `brace-expansion`
- #878 `picomatch`

Current local dependency evidence after the lock refresh:

- `picomatch` is at 4.0.4.
- `flatted` is at 3.4.2 through the Vitest/ESLint toolchain.
- `basic-ftp` is at 5.3.1 through `markdown-link-check` transitive dependencies.
- `brace-expansion` is at 2.1.0 and 5.0.5 through current minimatch dependencies.
- `vite` is at 8.0.10 through Vitest 4.1.5.

This audit did not reopen any completed or canceled CDMCH issues. The evidence found supports creating new follow-up issues for current repo state instead of resurrecting older completed work.
