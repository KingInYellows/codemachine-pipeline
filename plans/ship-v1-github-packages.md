# Feature: Ship v1.0.0 to GitHub Packages

## Problem Statement

The v1.0.0 GitHub Release was cut on 2026-02-15, but `npm publish` failed
during the release workflow. The package is not available on GitHub Packages.
Two prerequisite issues (circular deps CDMCH-233, flaky test CDMCH-232) have
since been resolved on main, leaving only the publish fix and release
verification outstanding.

<!-- deepen-plan: codebase -->
> **Codebase:** The actual failure was **E403: Account has reached its billing
> limit** on the GitHub Packages quota. The error message from the failed run
> (`gh run view 22028709015`) reads: `npm error 403 403 Forbidden - PUT
> https://npm.pkg.github.com/@kinginyellows%2fcodemachine-pipeline - Permission
> permission_denied: Account has reached its billing limit.` The publish step
> successfully authenticated and uploaded the tarball — the 403 was a billing
> quota issue, not an auth or config problem.
<!-- /deepen-plan -->

## Linear Issues

- CDMCH-231: fix: debug and trigger npm publish to GitHub Packages
- CDMCH-230: Release: Ship v1.0.0 to GitHub Packages

## Current State (updated 2026-03-16)

| Check              | Status |
|--------------------|--------|
| CI on main         | **RED** — redaction tests fail in publish workflow |
| PR #859            | **RED** — ESLint lint step fails (Record<string,unknown> warnings) |
| Build              | PASS (locally) |
| Lint               | FAIL in CI — 10 `Record<string,unknown>` warnings treated as errors |
| Tests              | 1913 pass, 0 flaky (locally); redaction tests may pass after #857 fix |
| Circular deps      | 0 cycles |
| Smoke              | PASS |
| GitHub Release     | exists (v1.0.0, tagged 2026-02-15) |
| npm Package        | NOT PUBLISHED (GitHub Packages API returns empty `[]`) |
| Publish workflow   | 3 runs, all failed (E403 billing on 2026-02-15, test failures on 2026-03-15) |
| `access: public`   | Removed (PR #856 merged) |
| Main vs v1.0.0     | 107 commits ahead |
| GitHub Packages    | User requests stale version cleanup across org |

## Proposed Solution

~~Re-trigger the publish workflow via `workflow_dispatch` after verifying the
configuration is correct. If it fails again, diagnose from fresh logs and fix.~~

**Revised (post-research):** Resolve the GitHub Packages billing quota at the
account level (Settings > Billing > Packages), then re-trigger the publish
workflow. No code or config changes are needed — the existing workflow
configuration is correct.

<!-- deepen-plan: codebase -->
> **Codebase:** All four hypothesized failure causes below are **incorrect**.
> The auth token was propagated correctly (npm authenticated and reached PUT).
> The `access: public` setting did not cause the failure. Lifecycle scripts
> completed successfully (tarball was 628.1 kB, 530 files). The error was
> deterministic (billing), not transient.
<!-- /deepen-plan -->

### Key Configuration (verified)

- `package.json`: `@kinginyellows/codemachine-pipeline@1.0.0`, not private
- `publishConfig`: `registry: https://npm.pkg.github.com` (access:public removed in PR #856)
- `.npmrc`: `@kinginyellows:registry=https://npm.pkg.github.com`
- `publish.yml`: `permissions.packages: write`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
- `setup-node`: passes `registry-url` and `scope` to `actions/setup-node@v4.1.0`
- `bin/run.js`: included via `files: ["/bin"]` in package.json
- Lifecycle scripts: `prepack` runs `clean && build`, `postpack` runs `clean`

<!-- deepen-plan: codebase -->
> **Codebase:** Minor inaccuracy: the `setup-node` description applies to the
> current `main` workflow (composite action wrapping `actions/setup-node@v4.1.0`
> pinned by hash). The failed run on 2026-02-15 used the `v1.0.0` tag's
> workflow, which called `actions/setup-node@v4` directly (unpinned). The
> current workflow is an improvement. Also: `.npmrc` additionally contains
> `legacy-peer-deps=true` (benign, not mentioned in original plan).
<!-- /deepen-plan -->

### Likely Failure Causes ~~(ordered by probability)~~ — ALL INCORRECT

~~1. **Auth token not propagated** — `setup-node` creates `~/.npmrc` with token
   placeholder but repo `.npmrc` may shadow it for registry resolution~~
~~2. **`access: public` unsupported** — GitHub Packages may reject `access: public`
   for user-scoped packages (not org-scoped)~~
~~3. **Lifecycle script failure** — `prepack` runs `clean && build`; if build
   failed, `npm publish` exits non-zero~~
~~4. **Transient network/registry error** — GitHub Packages outage on 2026-02-15~~

**Actual cause:** GitHub Packages billing quota exceeded (E403).

<!-- deepen-plan: external -->
> **Research:** While the billing quota was the actual blocker, the `"access":
> "public"` in `publishConfig` is still worth removing as a best practice.
> GitHub Packages does not use the npm `access` field — package visibility is
> determined by repository visibility. Setting `"access": "public"` can cause
> silent failures or unexpected behavior depending on the npm version. The
> correct `publishConfig` for GitHub Packages should only contain `"registry"`.
> See: [npm Docs: publishConfig](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/)
<!-- /deepen-plan -->

## Implementation Plan

### Phase 0: Fix CI on main and PR #859 (BLOCKING)

Two CI blockers remain:

**A. ESLint lint failures (PR #859):** 10 instances of `Record<string,unknown>`
flagged by `@typescript-eslint/no-restricted-types` (warn severity, but CI
treats warnings as errors). All are defensible uses (logging context, JSON.parse
results, type guards). Fix: add `// eslint-disable-next-line` suppressions.

Files requiring lint suppression:
- `src/adapters/github/GitHubAdapter.ts` (lines 98, 102, 106) — logging context
- `src/workflows/resumeTypes.ts` (line 61) — diagnostic context
- `tests/integration/linearAdapter.spec.ts` (line 215) — HTTP metadata cast
- `tests/integration/github_linear_regression.spec.ts` (line 105) — type guard
- `tests/integration/commands_pr_create_reviewers_automerge.spec.ts` (lines 386, 406) — action metadata + JSON.parse
- `tests/integration/cli_status_plan.spec.ts` (lines 182, 328) — JSON.parse of config

**B. Redaction test failures (publish workflow):** Tests in
`contextSummarizer.spec.ts` (lines 554, 572) and `commandRunner.spec.ts`
(line 259) expected `[REDACTED_GITHUB_TOKEN]` but got `[example-github-token]`.
Commit `77adfcb3` (PR #857) fixed this by replacing placeholders with realistic
`ghp_*` tokens that match the redaction regex. Verify the fix is sufficient by
re-running tests.

- [ ] 0.1: Add ESLint disable-next-line suppressions to all 10 `Record<string,unknown>` instances
- [ ] 0.2: Verify redaction tests pass locally: `npx vitest run tests/unit/contextSummarizer.spec.ts tests/unit/commandRunner.spec.ts`
- [ ] 0.3: Push lint fixes to PR #859 branch (`fix/cdmch-231-npm-publish`)
- [ ] 0.4: Verify CI is green on PR #859: `gh run watch`
- [ ] 0.5: Merge PR #859 to main
- [ ] 0.6: Verify CI is green on main: `gh run list --branch=main --workflow=ci.yml --limit=1`

### Phase 1: Resolve Billing and Publish (CDMCH-231)

- [ ] 1.1: Check GitHub Packages billing quota: Settings > Billing > Packages
- [ ] 1.2: Resolve quota — upgrade plan, increase storage, or clear old packages
- [ ] 1.3: Decide publish source — **DECISION REQUIRED** (see options below)
- [ ] 1.4: Pre-publish check: `npm view @kinginyellows/codemachine-pipeline@<version> --registry=https://npm.pkg.github.com` (confirm 404)
- [ ] 1.5: Re-trigger publish workflow
- [ ] 1.6: Monitor run: `gh run watch` — verify success
- [x] ~~1.7: Remove `"access": "public"` from `publishConfig`~~ (done in PR #856)

**Publish source decision (step 1.3):**

| Option | What | Pros | Cons |
|--------|------|------|------|
| A | Publish from `v1.0.0` tag via new Release | Exact tagged content | Old workflow (pre-#855 runner migration) |
| B | Publish main as `1.0.0` via `workflow_dispatch` | Uses current workflow | Misleading — 107 commits != tagged v1.0.0 |
| **C** | **Bump to `1.1.0` on main, publish** | **Honest versioning, current workflow** | **Changes scope slightly** |

<!-- deepen-plan: codebase -->
> **Codebase:** Critical decision at step 1.3 — **what to publish:**
>
> - **Option A: Publish from `v1.0.0` tag** (exact release content). Create a
>   new GitHub Release pointing at the same tag, which re-triggers `release:
>   [published]` using the v1.0.0 tag's workflow.
> - **Option B: Publish from `main`** via `workflow_dispatch`. This publishes
>   main's current code (107 commits ahead of v1.0.0) as version `1.0.0`. The
>   checkout step uses `${{ github.event.release.target_commitish || github.ref }}`
>   which defaults to `refs/heads/main` for `workflow_dispatch`.
> - **Option C: Bump version to `1.1.0`** and publish from `main`. Reflects
>   the 107 commits of actual changes since the v1.0.0 tag.
>
> Option B is technically misleading (publishing different code under the same
> version). Option A or C is recommended.
<!-- /deepen-plan -->

### Phase 2: Stale Package Cleanup (user request)

Delete old GitHub Package versions across the org to free storage. Only retain
the latest 2 versions per package per repository.

- [ ] 2.1: Create `.github/workflows/package-cleanup.yml` — scheduled (weekly) + manual trigger
- [ ] 2.2: Use `actions/delete-package-versions@v5` to prune old npm package versions
- [ ] 2.3: Retain `min-versions-to-keep: 2` per package
- [ ] 2.4: Test via `workflow_dispatch` before relying on schedule
- [ ] 2.5: Verify storage freed: `gh api /orgs/KingInYellows/settings/billing/packages`

### Phase 3: Verify Release (CDMCH-230 + CDMCH-234)

- [ ] 3.1: Confirm package exists: `npm view @kinginyellows/codemachine-pipeline@<version>`
- [ ] 3.2: Create `scripts/tooling/verify_install.sh` — automated smoke test:
      - Check Node.js 24+ available
      - `npm install -g @kinginyellows/codemachine-pipeline`
      - `codepipe --version` shows correct version
      - `codepipe doctor` exits 0
      - `codepipe --help` lists commands
      - `codepipe init --dry-run` in a temp git repo
- [ ] 3.3: Run verify_install.sh on homelab
- [ ] 3.4: Verify CI: all jobs green on main
- [ ] 3.5: Close CDMCH-231, CDMCH-234, and CDMCH-230 in Linear

## Technical Details

### Files to Modify (if fix needed)

- `package.json` — optional: remove `"access": "public"` from `publishConfig`

<!-- deepen-plan: codebase -->
> **Codebase:** No file modifications are required for the actual fix. The
> billing quota is resolved at the GitHub account level, not in code. The
> `.github/workflows/publish.yml`, `.npmrc`, and core `package.json` fields are
> all correctly configured and do not need changes.
<!-- /deepen-plan -->

### Recommended Workflow Improvements

- `.github/workflows/publish.yml` — add `concurrency: { group: publish, cancel-in-progress: false }` to prevent parallel publish races
- `.github/workflows/publish.yml` — consider increasing timeout from 15min to 30min (CI uses 45min for same build+test steps)
- `.github/workflows/publish.yml` — strengthen post-publish verification (currently best-effort, exits 0 on failure)

### Files NOT to Modify

- `.npmrc` — correctly configured (scoped registry + `legacy-peer-deps=true`)
- `package.json` publishConfig — already correct after PR #856

## Acceptance Criteria

1. CI green on main (Phase 0 prerequisite)
2. `npm view @kinginyellows/codemachine-pipeline@<version>` returns package metadata
3. `npm install -g @kinginyellows/codemachine-pipeline` installs successfully
4. Publish workflow runs successfully
5. `codepipe --version` shows correct version after install

> Criteria 5-6 from original plan (zero circular deps, zero flaky tests) are
> CI health checks tracked under CDMCH-230, not CDMCH-231 scope.

## Edge Cases & Error Handling

- **Package already published under different version:** Check `npm view`
  before publishing — `npm publish` will fail if version exists
- **Rate limiting:** GitHub Packages has rate limits; if hit, wait and retry
- **Scope visibility:** If package doesn't appear after publish, check repo
  Settings > Packages to verify visibility
- **Version mismatch:** If publishing from `main` (107 commits ahead of v1.0.0
  tag), consider whether `1.0.0` accurately represents the published code

<!-- deepen-plan: external -->
> **Research:** Common GitHub Packages publish errors and their meanings:
> - **E401 Unauthorized:** `NODE_AUTH_TOKEN` not reaching npm, or missing
>   `permissions: packages: write`
> - **E403 Forbidden (billing):** Account storage/bandwidth quota exceeded
> - **E403 Forbidden (permission_denied: owner not found):** Scope doesn't
>   match GitHub owner
> - **E404 Not Found:** Registry URL wrong or scope mismatch
> - **E422 Unprocessable Entity:** Republishing existing version (not allowed)
>
> For `.npmrc` conflicts with `setup-node`: project-level `.npmrc` takes
> precedence over runner-level. If both set the registry, the project file
> wins. Best practice is to either let `setup-node` manage everything (remove
> project `.npmrc`) or ensure the project `.npmrc` includes the `_authToken`
> line. See: [actions/setup-node#53](https://github.com/actions/setup-node/issues/53),
> [actions/setup-node#130](https://github.com/actions/setup-node/issues/130)
<!-- /deepen-plan -->

## References

<!-- deepen-plan: external -->
> **Research sources:**
> - [GitHub Docs: Publishing Node.js packages](https://docs.github.com/en/enterprise-cloud@latest/actions/tutorials/publish-packages/publish-nodejs-packages)
> - [actions/setup-node#53](https://github.com/actions/setup-node/issues/53) — E401 auth wiring
> - [actions/setup-node#130](https://github.com/actions/setup-node/issues/130) — registry URL mismatch
> - [npm/cli#8730](https://github.com/npm/cli/issues/8730) — .npmrc precedence with setup-node
> - [GitHub Community#161277](https://github.com/orgs/community/discussions/161277) — org-scoped permission errors
> - [npm Docs: publishConfig](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/) — access field behavior
<!-- /deepen-plan -->

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. fix/cdmch-231-fix-ci-blockers
- **Type:** fix
- **Description:** Resolve lint errors and redaction test failures blocking publish
- **Scope:** src/adapters/github/GitHubAdapter.ts, src/workflows/resumeTypes.ts, tests/unit/contextSummarizer.spec.ts, tests/unit/commandRunner.spec.ts, tests/integration/*.spec.ts
- **Tasks:** 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.1–1.6
- **Depends on:** (none)
- **Linear:** CDMCH-231
- **PR:** #859 (update existing branch)

### 2. chore/stale-package-cleanup
- **Type:** chore
- **Description:** Add workflow to prune stale GitHub Package versions
- **Scope:** .github/workflows/package-cleanup.yml
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5
- **Depends on:** (none — parallel to #1)
- **Linear:** (none — user request)

### 3. chore/cdmch-234-verify-local-install
- **Type:** chore
- **Description:** Add post-release install verification script and run on homelab
- **Scope:** scripts/tooling/verify_install.sh
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5
- **Depends on:** #1
- **Linear:** CDMCH-234

## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. fix/cdmch-231-fix-ci-blockers (completed 2026-03-16, PR #859 — CI green)
- [x] 2. chore/stale-package-cleanup (completed 2026-03-16, PR #861)
- [x] 3. chore/cdmch-234-verify-local-install (completed 2026-03-16, PR #862)
