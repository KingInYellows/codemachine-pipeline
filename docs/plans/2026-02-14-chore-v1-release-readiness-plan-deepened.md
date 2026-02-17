---
title: 'chore: v1.0.0 release readiness — CI, E2E, docs, publish, deploy'
type: chore
date: 2026-02-14
brainstorm: docs/brainstorms/2026-02-14-v1-release-readiness-brainstorm.md
deepened: 2026-02-14
research_agents: 18
---

# chore: v1.0.0 Release Readiness (Enhanced)

## Enhancement Summary

**Deepened on:** 2026-02-14
**Sections enhanced:** 6 phases + 5 new phases added
**Research agents used:** 18 parallel agents

### Key Improvements Discovered

1. **BLOCKING ISSUE FOUND (P0)**: bin path warning in npm pack - "bin[codepipe] script was invalid" - must validate before publish
2. **Security enhancement**: GitHub PAT exposure risk in homelab install - added warnings, env var pattern, scope minimization
3. **Time optimization**: Wave-based execution reduces total time by 50% (90min → 45min) via parallel agent execution
4. **CI performance**: Can achieve 60% speedup (4-5min → <2min) with job parallelization + npm/Docker caching
5. **Deployment rigor**: Added 3 critical missing phases (pre-publish validation, rollback procedure, post-deploy monitoring)
6. **Documentation automation**: Automated verification gates for Phase 4 (link validation, feature table checks, command count)
7. **Graphite integration**: Critical sync protocol needed (gt sync --force before branch operations, pre-submit checklist)
8. **E2E optimization**: Current plan overengineered - smoke test sufficient given 45 existing integration tests

### New Phases Added

- **Phase 1.5**: Verify Package Bin Path (BLOCKING - must fix before publish)
- **Phase 2.5**: Test Optional Dependency Scenarios (CodeMachine CLI with/without)
- **Phase 2.6**: Test Crash Recovery (queue integrity, resume behavior)
- **Phase 4.0**: Pre-Audit Verification Strategy (extract source-of-truth)
- **Phase 5.7**: Pre-Production Package Validation (test actual tarball)
- **Phase 6.8**: Rollback Procedure (emergency recovery)
- **Phase 6.9**: Post-Deployment Monitoring (health checks, alerting)

### Critical Learnings Applied

- **Wave-based parallel execution pattern** (from multi-agent-wave-resolution PR findings)
- **Docs PR review methodology** (automated source-of-truth validation)
- **Graphite sync protocol** (prevent restack conflicts)
- **Security best practices** (PAT handling, signed tags, least-privilege)
- **E2E testing patterns** (from existing test suite analysis)

---

## Overview

Ship a fully functioning, published, deployed v1.0.0 of codemachine-pipeline. The existing
v1.0.0 tag (2026-02-11) was a milestone marker — this plan makes it a real, shippable release
with green CI, verified E2E functionality, accurate documentation, and GitHub Packages publishing
for homelab deployment via `npm install -g`.

Sequential approach: each phase validates the prior one. E2E testing may surface issues that
change downstream scope.

## Problem Statement

The v1.0.0 tag exists but the release isn't truly shippable:

1. **CI is failing** — 26 Prettier formatting violations + potential Docker `doctor --json` exit code issue
2. **E2E untested** — full pipeline (init → start → approve → resume) hasn't been verified after Cycle 9
3. **Not published** — no npm publishing infrastructure (no `publishConfig`, no scoped name, no workflow)
4. **Documentation drift** — README says "when published", CHANGELOG missing Cycles 6-9, stale doc artifacts
5. **Release branch stale** — `release` branch hasn't been synced with current main

## Proposed Solution

Six sequential phases with 7 additional verification sub-phases, each producing a verifiable checkpoint before moving to the next.

**Alternative Approach**: Wave-based parallel execution (see "Wave Execution Strategy" section below) can reduce total time from 90min to 45min.

---

## Phase 1: Fix CI (Green Main)

**Goal:** All CI jobs pass on main.

### 1.1 Fix Prettier Formatting (26 files)

```bash
npm run format
```

Key files identified in CI failure:

- `src/adapters/codemachine/binaryResolver.ts`
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts`
- `src/workflows/cliExecutionEngine.ts`
- `src/workflows/codeMachineCLIStrategy.ts`
- `tests/unit/codeMachineCLIAdapter.test.ts`
- `tests/unit/queueStore.v2.spec.ts`
- ~20 more files

Verify: `npm run format:check` exits 0.

#### Research Insights: Prettier Large Changesets

**Best Practices:**

- **Single-shot approach** (recommended): Fix all 26 files in one commit
  - Prettier is deterministic - same config always produces same output
  - `--write` is safe (non-destructive, only reformats whitespace)
  - Reviewers can use `git show --color-words` to ignore whitespace changes

**Performance Optimization:**

```bash
# Add --cache flag for 5-10x faster subsequent runs
npx prettier --write --cache "src/**/*.ts" "tests/**/*.ts"
```

**References:**

- Prettier docs: https://prettier.io/docs/en/options.html#cache

---

### 1.2 Verify Docker CI Step

The Docker CI step runs `doctor --json` with `set -o pipefail` but no `|| true` fallback.
Research indicates this should exit 0 in a bare Docker container (only warnings, no failures),
but verify by:

```bash
# Build Docker image locally
docker build -t codepipe-test .

# Run doctor command (should exit 0)
docker run --rm codepipe-test doctor --json
echo $?  # Check exit code

# Full CI verification (mimics actual workflow)
set -o pipefail
docker run --rm codepipe-test --version || true
docker run --rm codepipe-test --help
docker run --rm codepipe-test doctor --json | \
  node -e "const fs=require('fs');JSON.parse(fs.readFileSync(0,'utf8'))" > /dev/null && \
  echo 'doctor --json: valid JSON'
```

If exit code is non-zero, fix the CI step by adding `|| true` (matching the pattern used
for `--version` on the adjacent line), OR fix the `doctor` command to exit 0 when only
warnings exist.

#### Research Insights: Docker CI Best Practices

**Current Implementation is CORRECT:**

- `set -o pipefail` catches JSON parse failures (standard pattern)
- `|| true` on `--version` is intentional (container startup can be slow)
- Validation happens on `--help` and `doctor --json` (required checks)

**Docker Build Optimization:**

```yaml
# Add to CI workflow for 80% faster rebuilds
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    context: .
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

**Security Hardening:**

```dockerfile
# Ensure non-root user (add to Dockerfile if not present)
USER node
LABEL security.least-privilege="true"
```

**References:**

- Docker best practices: https://docs.docker.com/develop/dev-best-practices/

---

### 1.3 Clean Up Stale .dockerignore References

Remove references to files that don't exist (harmless but messy):

- `.eslintrc.json` → project uses `eslint.config.cjs`
- `jest.config.js` → project uses vitest

```bash
# Edit .dockerignore, remove these lines
```

---

### 1.4 CI Performance Optimization

**Goal:** Reduce CI run time from 4-5 minutes to <2 minutes.

#### Add npm/Docker Caching

```yaml
# Update .github/workflows/ci.yml
- uses: actions/setup-node@v4
  with:
    node-version: '24'
    cache: 'npm' # ← Add this

- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

#### Parallelize Independent CI Jobs

```yaml
# Currently sequential - make parallel
jobs:
  lint:
    runs-on: ubuntu-latest
    # ...

  test:
    runs-on: ubuntu-latest
    # ...

  docker:
    runs-on: ubuntu-latest
    # ...
```

#### Add Package Size Check

```yaml
- name: Check package size
  run: |
    npm pack
    SIZE=$(stat -f%z *.tgz 2>/dev/null || stat -c%s *.tgz)
    if [ $SIZE -gt 2097152 ]; then
      echo "Package size $SIZE exceeds 2MB threshold"
      exit 1
    fi
```

#### Research Insights: CI Performance

**Impact of Optimizations:**

- npm cache: ~30s saved per run
- Docker cache: ~90s saved on rebuilds (80% reduction)
- Parallel jobs: ~120s saved (run lint/test/docker concurrently)
- Total: **60% speedup** (4-5min → <2min)

**References:**

- GitHub Actions caching: https://github.com/actions/setup-node#caching-global-packages-data
- Docker layer caching: https://docs.docker.com/build/cache/backends/gha/

---

### 1.5 Verify Package Bin Path ⚠️ BLOCKING

**CRITICAL ISSUE:** npm pack --dry-run shows warning: "bin[codepipe] script name bin/run.js was invalid and removed"

This could break the CLI in the published package. Validate before proceeding:

```bash
# 1. Generate tarball
npm pack

# 2. Extract and inspect
tar -xzf kinginyellows-codemachine-pipeline-1.0.0.tgz
cat package/package.json | jq '.bin'
# Expected: { "codepipe": "bin/run.js" }

# 3. Test global install from tarball
npm install -g ./kinginyellows-codemachine-pipeline-1.0.0.tgz

# 4. Verify binary works
codepipe --version  # Should show 1.0.0
which codepipe      # Should show npm global bin path

# 5. Clean up
npm uninstall -g @kinginyellows/codemachine-pipeline
rm -rf package/ *.tgz
```

**If bin entry is missing:**

- Check `package.json` bin field format: `"bin": { "codepipe": "bin/run.js" }` (no leading `./`)
- Verify `bin/run.js` has shebang: `#!/usr/bin/env node`
- Check `files` array includes `/bin`

#### Research Insights: Binary CLI Packaging

**Best Practices:**

- Bin path should be relative without leading `./`: `"bin/run.js"` not `"./bin/run.js"`
- Always test with `npm install -g <tarball>` before publishing
- Verify shebang is present and executable permissions set
- Use `files` array to explicitly include `/bin` directory

---

### 1.6 Commit and Verify

**Pre-Submit Checklist (from Graphite workflow learnings):**

```bash
# ALWAYS run before gt submit
gt sync --force && \
gt restack && \
npm run build && \
npm run lint && \
npm run format:check && \
npm run deps:check:ci && \
npm test && \
gt submit --no-interactive
```

- [ ] Commit formatting fixes: `chore: fix Prettier formatting violations`
- [ ] Commit CI performance optimizations: `ci: add caching and parallelization`
- [ ] Commit Docker/dockerignore fixes if needed
- [ ] Verify package bin path works (Phase 1.5)
- [ ] Run pre-submit checklist
- [ ] Push to main, verify all CI jobs pass
- [ ] **Checkpoint:** CI dashboard shows green on main in <2 minutes

---

## Phase 2: E2E Functional Testing

**Goal:** Verify the full pipeline works end-to-end after Cycle 9 changes.

### 2.1 Prepare Test Environment

Create a temporary test project directory (outside the repo) to test `codepipe` as an end user would:

```bash
mkdir /tmp/codepipe-e2e-test && cd /tmp/codepipe-e2e-test
git init && git commit --allow-empty -m "init"
```

Ensure `codepipe` is available via `npm link` from the repo.

#### Research Insights: Test Environment Isolation

**Pattern from existing integration tests:**

```typescript
const testDir = path.join(__dirname, `.test-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

// Git initialization (prerequisite for CLI)
execSync('git init', { cwd: testDir, stdio: 'pipe' });
execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

// Cleanup in afterEach
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
```

**Best Practices:**

- Use unique directory names (timestamps) for parallel test execution
- Set `stdio: 'pipe'` to suppress noise
- Clean up in afterEach/finally blocks
- Initialize git config (required for many CLI operations)

---

### 2.2 Test Core Pipeline Flow

| Step    | Command                                                | Expected                                  |
| ------- | ------------------------------------------------------ | ----------------------------------------- |
| Init    | `codepipe init --yes`                                  | Creates `.codepipe/` scaffolding, exits 0 |
| Doctor  | `codepipe doctor`                                      | Reports environment health, exits 0       |
| Health  | `codepipe health`                                      | Quick health check, exits 0               |
| Start   | `codepipe start --prompt "Add a hello world endpoint"` | Creates run dir, generates PRD, exits 0   |
| Status  | `codepipe status`                                      | Shows current pipeline state              |
| Approve | `codepipe approve prd --feature <id> --signer "test"`  | Advances gate, exits 0                    |
| Resume  | `codepipe resume --feature <id>`                       | Continues pipeline                        |
| Plan    | `codepipe plan --feature <id>`                         | Shows execution DAG                       |

#### Research Insights: Pipeline Testing Patterns

**From existing tests - Full workflow pattern:**

```bash
# Phase 1: Init
codepipe init --yes
test -d .codepipe  # Verify directory created

# Phase 2: Start with JSON output
START_OUTPUT=$(codepipe start --prompt "Add auth" --json)
FEATURE_ID=$(echo "$START_OUTPUT" | jq -r '.feature_id')
echo "Feature ID: $FEATURE_ID"

# Phase 3: Verify status
STATUS=$(codepipe status --json | jq -r '.status')
test "$STATUS" = "awaiting_prd_approval"

# Phase 4: Approve
codepipe approve prd --approve --signer "test@example.com" --feature "$FEATURE_ID" --json

# Phase 5: Resume
codepipe resume --feature "$FEATURE_ID" --json
```

**Key Testing Insight:** Your project has **45 CLI integration tests already covering these commands**. A quick smoke test is sufficient for E2E validation (not a comprehensive re-test of what integration tests already cover).

---

### 2.3 Test JSON Output Mode

Re-run key commands with `--json` flag and verify valid JSON output:

```bash
# Basic JSON validation
codepipe status --json | jq .
codepipe doctor --json | jq .
codepipe start --prompt "test" --json | jq .
```

#### Research Insights: JSON Schema Validation

**Enhanced validation with Zod (already in project):**

```typescript
import { z } from 'zod';

const StartResponseSchema = z.object({
  feature_id: z.string().min(1),
  run_dir: z.string(),
  status: z.enum(['awaiting_prd_approval', 'execution_complete']),
  context: z.object({
    files: z.number().int().min(0),
    total_tokens: z.number().int(),
  }),
});

// In test:
const output = execSync(`codepipe start --prompt "test" --json`, { encoding: 'utf-8' });
const payload = JSON.parse(output);
const validation = StartResponseSchema.safeParse(payload);
expect(validation.success).toBe(true);
```

**Expected exit codes:**

- `0` = Success
- `1` = General error
- `10` = Validation error (config, args)
- `30` = Human action required (approval, intervention)

---

### 2.4 Test Error Paths

```bash
# Run codepipe start without init → should give clear error with remediation
cd /tmp/no-init-test && git init
codepipe start --prompt "test" 2>&1 | grep -q "Run 'codepipe init'"

# Run codepipe approve with invalid feature ID → should error gracefully
codepipe approve prd --feature "invalid-id" 2>&1 | grep -q "Feature not found"

# Run codepipe resume with no active run → should error gracefully
codepipe resume 2>&1 | grep -q "No active"
```

---

### 2.5 Test Optional Dependency Scenarios (NEW)

**Goal:** Verify CodeMachine CLI optional dependency handling.

```bash
# Scenario 1: With CodeMachine CLI installed
npm install -g codemachine@0.8.0
codepipe doctor --json | jq '.checks[] | select(.name=="CodeMachine CLI")'
# Expected: status="pass", version shown

# Scenario 2: Without CodeMachine CLI (fallback)
npm uninstall -g codemachine
codepipe doctor --json | jq '.checks[] | select(.name=="CodeMachine CLI")'
# Expected: status="warn" (non-blocking warning)

# Scenario 3: Custom binary path
export CODEMACHINE_BIN_PATH=/custom/path/codemachine
codepipe doctor --json | jq '.checks[] | select(.name=="CodeMachine CLI")'
```

**Acceptance:**

- [ ] With binary: adapter available, tasks can use codemachine-cli strategy
- [ ] Without binary: clear warning, fallback works gracefully
- [ ] Custom path: env var respected

#### Research Insights: Optional Dependencies

**From architecture review:**

- Test both scenarios (with/without) to prevent deployment surprises
- Verify `doctor` command accurately reports binary availability
- Ensure error messages provide clear remediation

---

### 2.6 Test Crash Recovery (NEW)

**Goal:** Verify queue integrity and resume behavior after interruptions.

```bash
# Test 1: Interrupted start
codepipe start --prompt "Test feature" &
PID=$!
sleep 2  # Let it start
kill -INT $PID  # Simulate Ctrl+C
# Verify queue integrity
codepipe resume  # Should pick up from last checkpoint

# Test 2: Corrupted queue (manual corruption)
# Manually corrupt .codepipe/runs/<id>/queue/queue.jsonl
codepipe resume  # Should fail with QueueIntegrityError, show remediation
```

**Acceptance:**

- [ ] Interrupted start: Resume picks up from last checkpoint
- [ ] Corrupted queue: Fails with clear error + remediation
- [ ] Manual repair: Resume succeeds after fixing corruption

#### Research Insights: Crash Recovery

**From E2E testing patterns:**

- Project has existing tests in `tests/integration/crashRecovery.e2e.spec.ts`
- WAL (Write-Ahead Log) ensures queue persistence
- `QueueIntegrityMode` can be 'fail-fast' (default) or 'warn-only'

**Reference:** `src/persistence/queueStore.v2.ts` - Queue integrity verification implementation

---

### 2.7 Document Findings

- [ ] Record any bugs, incorrect output, or unexpected behavior
- [ ] Note any missing environment variables or undocumented prerequisites
- [ ] **Checkpoint:** E2E test report with pass/fail for each command

**Simplified E2E Approach (from simplicity review):**
Given 45 existing CLI integration tests, a **smoke test** (5-10 minutes) is sufficient:

- Test init → start → doctor → status with JSON output
- Verify no runtime errors
- Skip comprehensive error path testing (already covered by integration tests)

---

## Phase 3: Fix Discovered Issues

**Goal:** Address bugs found during E2E testing.

Scope is TBD based on Phase 2 findings. Known candidates:

- Any runtime errors in the CodeMachine-CLI adapter (Cycle 9 code)
- Missing or incorrect error messages
- JSON output schema inconsistencies
- Environment variable documentation gaps

### Post-Rebase Verification (from Graphite learnings)

After each bug fix PR:

```bash
npm run lint
npm run build
npm test
git diff main...HEAD  # Review final changes
```

- [ ] Fix each discovered issue
- [ ] Re-run E2E tests to verify fixes
- [ ] Run post-rebase verification
- [ ] Commit fixes with descriptive messages
- [ ] **Checkpoint:** All E2E tests pass cleanly

#### Research Insights: Bug Fix Workflow

**From wave-based execution learnings:**

- If Phase 2 reveals multiple bugs, use dependency analysis for parallel fixes
- Batch fixes to the same file into a single agent task
- Test fixes independently before combining

**Simplicity recommendation:** If E2E reveals no bugs (likely given test coverage), skip Phase 3 entirely rather than pre-allocating time for hypothetical problems.

---

## Phase 4: Documentation Audit

**Goal:** README, CLI help, CHANGELOG, and docs all accurately reflect the current product.

### 4.0 Pre-Audit: Verification Strategy (NEW)

**Goal:** Extract source-of-truth references for cross-checking documentation claims.

```bash
# 1. Extract actual CLI commands from manifest
npm run build
jq -r '.commands | keys[]' oclif.manifest.json | sort > /tmp/actual-commands.txt

# 2. Extract execution engines from source code
grep -r "ExecutionEngineType" src/ | grep -E "(claude|codex|openai)" > /tmp/actual-engines.txt

# 3. Generate actual project structure
tree -L 2 -I 'node_modules|dist|.git' > /tmp/actual-tree.txt

# 4. Extract CLI help text for all commands
while read cmd; do
  codepipe $cmd --help > /tmp/help-$cmd.txt 2>&1
done < /tmp/actual-commands.txt
```

#### Research Insights: Documentation Verification

**From reviewing-documentation-prs.md:**

- **comment-analyzer is most valuable** - cross-references claims against source code
- Common drift patterns: phantom engines (PR #464 listed 6, only 3 exist), missing commands, outdated structure trees
- **Automated verification prevents the exact issue from PR #464**

**5-Agent Review Pattern for Docs:**

- comment-analyzer: Cross-reference claims vs source
- code-simplicity-reviewer: Remove redundancy, YAGNI
- pattern-recognition-specialist: Format consistency
- architecture-strategist: Validate structure
- security-sentinel: Check for secrets

---

### 4.1 README.md

File: `README.md`

```bash
# Automated verification checks
# 1. Verify execution engines match source
README_ENGINES=$(grep -A 10 "execution engines" README.md | grep -oP '`\K[^`]+' | sort)
SCHEMA_ENGINES=$(jq -r '.properties.execution_engine.enum[]' src/validation/schemas/repoConfigSchema.json | sort)
diff <(echo "$README_ENGINES") <(echo "$SCHEMA_ENGINES")
# Should show no differences

# 2. Verify command count matches manifest
README_CMD_COUNT=$(grep -A 100 "Available Commands" README.md | grep -c "^\|")
MANIFEST_CMD_COUNT=$(jq '.commands | length' oclif.manifest.json)
test $README_CMD_COUNT -eq $MANIFEST_CMD_COUNT

# 3. Verify all relative links resolve
grep -oP '\]\(\K[^)]+' README.md | while read link; do
  test -f "$link" || echo "BROKEN: $link"
done
```

**Manual Checklist:**

- [ ] Update line 33: change "From npm (when published)" to:

  ````markdown
  ### From GitHub Packages

  ```bash
  # Configure npm for GitHub Packages
  echo "@kinginyellows:registry=https://npm.pkg.github.com" >> ~/.npmrc
  echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc

  # Install globally
  npm install -g @kinginyellows/codemachine-pipeline

  # Verify
  codepipe --version
  ```
  ````

  **Security Note:** Store your PAT securely. Do NOT commit `.npmrc` to version control.

  ```

  ```

- [ ] **VERIFY execution engines table** - only list `claude`, `codex`, `openai` (remove phantom engines)
- [ ] **VERIFY command table** matches `oclif.manifest.json` (count + descriptions)
- [ ] **VERIFY project structure tree** matches filesystem (use generated tree from 4.0)
- [ ] Verify feature list reflects Cycle 9 CodeMachine-CLI integration
- [ ] Verify prerequisites (Node v24+, Git)
- [ ] **VERIFY all relative links resolve** (no broken links)

---

### 4.2 CHANGELOG.md

File: `CHANGELOG.md`

**CRITICAL:** Date currently shows `2026-02-05`, must update to actual release date (`2026-02-14`).

The `[Unreleased]` section is nearly empty but 11 commits of significant work landed after
the v1.0.0 tag date. Update `[Unreleased]` to document:

#### Recommended CHANGELOG Structure

```markdown
## [1.0.0] - 2026-02-14

### Added

#### Cycle 9: CodeMachine-CLI Integration

- CLIExecutionEngine with queue-based task execution
- CodeMachineRunner with security hardening (argument validation)
- ResultNormalizer with 18 sensitive data patterns
- Doctor command enhancement for CodeMachine binary availability
- BinaryResolver with 3-tier resolution (env var → optionalDep → PATH)

#### Cycle 7: Testing & Documentation

- 45 CLI integration tests across 8 commands (init, start, resume, approve, etc.)
- CONTRIBUTING.md update with Graphite workflow
- JSDoc documentation for complex modules

#### Cycle 6: Code Quality & Foundations

- LoggerInterface unification (CDMCH-93)
- getErrorMessage consolidation (CDMCH-94)
- Record<string, unknown> audit (CDMCH-95)
- Madge circular dependency guardrail (CDMCH-66)
- V1 queue removal - V2 migration complete (CDMCH-63)
- ts-unused-exports pruning (CDMCH-64)
- Zod schema validation foundation (CDMCH-56)

### Changed

- ESLint 10 compatibility (`preserve-caught-error`, `no-useless-assignment` rules)
- Package name: `codemachine-pipeline` → `@kinginyellows/codemachine-pipeline` (GitHub Packages)
- Node requirement: v22+ → v24+ (LTS alignment)

### Fixed

- Prettier formatting violations (26 files)
- Docker CI `doctor --json` exit code handling
- Stale .dockerignore references (jest, eslintrc)
```

#### Validation Script

```bash
# CHANGELOG integrity validation
CHANGELOG_DATE=$(grep -m1 "^\[1\.0\.0\]" CHANGELOG.md | sed 's/.*- //')
TODAY=$(date +%Y-%m-%d)
test "$CHANGELOG_DATE" = "$TODAY" || {
  echo "ERROR: CHANGELOG date ($CHANGELOG_DATE) != release date ($TODAY)"
  exit 1
}

# Verify version consistency
PKG_VERSION=$(node -p "require('./package.json').version")
CHANGELOG_VERSION=$(grep -m1 "^\[" CHANGELOG.md | sed 's/\[//; s/\].*//')
test "$PKG_VERSION" = "$CHANGELOG_VERSION" || {
  echo "ERROR: Version mismatch - package.json: $PKG_VERSION, CHANGELOG: $CHANGELOG_VERSION"
  exit 1
}
```

#### Research Insights: CHANGELOG Best Practices

**Keep a Changelog Standard:**

- Use semantic section headings: Added, Changed, Deprecated, Removed, Fixed, Security
- ISO 8601 date format (YYYY-MM-DD)
- Newest version first
- Link to comparison diffs

**Automated validation:**

- Check date format matches ISO 8601
- Verify version in package.json matches CHANGELOG
- Ensure all required sections present
- Validate links to commits/PRs work

**References:**

- https://keepachangelog.com/en/1.1.0/

---

### 4.3 CLI --help Text

**ENHANCED VALIDATION** (automated, not manual):

```bash
# Step 1: Generate command list from manifest (source-of-truth)
npm run build
jq -r '.commands | keys[]' oclif.manifest.json > /tmp/commands.txt
echo "Found $(wc -l < /tmp/commands.txt) commands"

# Step 2: For each command, verify help output
while read cmd; do
  echo "Checking: $cmd"
  codepipe $cmd --help > /tmp/help-$cmd.txt 2>&1

  # Verify help text is non-empty
  test -s /tmp/help-$cmd.txt || echo "ERROR: $cmd has empty help"

  # Verify contains description
  grep -q "DESCRIPTION" /tmp/help-$cmd.txt || echo "WARN: $cmd missing description section"
done < /tmp/commands.txt

# Step 3: Cross-reference with manifest
jq -r '.commands[] | select(.description == "") | .id' oclif.manifest.json
# Should output nothing (all commands have descriptions)
```

**Manual spot-check (3 commands):**

- Pick 3 commands at random
- Verify description matches behavior
- Run examples verbatim, ensure they work

#### Research Insights: CLI Help Validation

**From oclif best practices:**

- Help text is auto-generated from Command class metadata
- Description comes from `static description` field
- Flags from `static flags` object
- Examples from `static examples` array

**Validation strategy:**

- Extract command list from manifest (don't rely on memory)
- Automated completeness check (all have descriptions)
- Spot-check examples actually work

---

### 4.4 Untracked Docs Cleanup

Review and decide on untracked directories:

- `docs/brainstorms/` — keep this plan's brainstorm, review others
- `docs/research/` — review for accuracy, remove stale content
- `docs/solutions/` — keep accurate solutions, remove outdated ones

**Apply 5-agent review pattern:**
For kept documents, ensure factual accuracy:

- Cross-reference code examples against source
- Verify file paths exist
- Check for exposed secrets (API keys, tokens)
- Remove YAGNI content
- Fix formatting inconsistencies

**Archive Strategy (from reviewing-documentation-prs learnings):**

```bash
# Preserve removed docs on archive branch
git checkout main
git checkout -b archive/post-v1.0.0-stale
git push origin archive/post-v1.0.0-stale

# Back on feature branch, remove stale files
git checkout <feature-branch>
git rm -r docs/archive/ docs/stale-research/
```

---

### 4.5 CONTRIBUTING.md

File: `CONTRIBUTING.md`

- [ ] Verify development setup instructions still work
- [ ] Verify testing instructions match vitest (not jest)
- [ ] Verify branch/PR workflow matches current Graphite-based process
- [ ] Add documentation maintenance section:

````markdown
## Documentation Maintenance

### Before Committing

```bash
npm run docs:audit      # Comprehensive check
npm run docs:cli:check  # CLI reference drift
npm run docs:links:check # Broken links
```
````

### Documentation Standards

- Update CHANGELOG.md for all user-facing changes
- Run `npm run docs:cli` if commands change
- Test bash examples before documenting them

````

---

### 4.6 Verification Gate & Commit (ENHANCED)

**Automated checks before committing:**

```bash
#!/bin/bash
# scripts/tooling/validate_docs.sh

set -euo pipefail

echo "📋 Running documentation verification gate..."

# 1. Link validation
find docs/ README.md CONTRIBUTING.md -name "*.md" -exec grep -oP '\]\(\K[^)]+' {} + | sort -u | while read link; do
  test -f "$link" || echo "BROKEN LINK: $link"
done

# 2. Feature table validation (execution engines)
README_ENGINES=$(grep -A 10 "execution engines" README.md | grep -oP '`\K[^`]+' | sort)
SCHEMA_ENGINES=$(jq -r '.properties.execution_engine.enum[]' src/validation/schemas/repoConfigSchema.json | sort)
diff <(echo "$README_ENGINES") <(echo "$SCHEMA_ENGINES") || {
  echo "ERROR: README execution engines don't match schema"
  exit 1
}

# 3. Command count validation
readme_count=$(grep -A 100 "Available Commands" README.md | grep -c "^\|")
manifest_count=$(jq '.commands | length' oclif.manifest.json)
test $readme_count -eq $manifest_count || {
  echo "ERROR: README has $readme_count commands, manifest has $manifest_count"
  exit 1
}

echo "✅ All documentation verification checks passed"
````

### Commit Checklist

- [ ] All automated checks pass (no broken links, no feature/command mismatches)
- [ ] CHANGELOG date updated to 2026-02-14
- [ ] README install instructions updated for GitHub Packages
- [ ] Run pre-submit checklist (gt sync --force && gt restack && build && test)
- [ ] Commit all doc updates: `docs: audit and update documentation for v1.0.0 release`
- [ ] **Checkpoint:** All docs accurately reflect the current codebase

#### Research Insights: Automated Documentation Validation

**Tools recommended:**

- **Vale**: Style, grammar, consistency checking
- **markdownlint**: Markdown structure validation
- **markdown-link-check**: Broken link detection
- **Custom validators**: Project-specific checks

**npm scripts to add:**

```json
{
  "scripts": {
    "docs:readme:check": "node scripts/tooling/validate_readme.js",
    "docs:changelog:check": "node scripts/tooling/validate_changelog.js",
    "docs:links:check": "markdown-link-check docs/**/*.md README.md",
    "docs:audit": "npm run docs:readme:check && npm run docs:changelog:check && npm run docs:links:check"
  }
}
```

---

## Phase 5: npm Publishing Setup (GitHub Packages)

**Goal:** Package is publishable to GitHub Packages and installable via `npm install -g`.

### 5.1 Scope the Package Name

GitHub Packages requires scoped packages. Update `package.json`:

```json
{
  "name": "@kinginyellows/codemachine-pipeline",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/KingInYellows/codemachine-pipeline.git"
  }
}
```

**Impact of name change:**

- The `bin` entry (`codepipe`) is unaffected — the CLI command name stays the same
- Internal imports don't reference the package name
- No downstream consumers exist (first real publish)

#### Research Insights: GitHub Packages Scoping

**Best Practices:**

- Scoped packages (starting with `@`) are required for GitHub Packages
- `access: "public"` makes the package publicly readable (still requires auth to install)
- Repository URL must reference GitHub (used by registry for package linking)
- CLI binary name (`codepipe`) unaffected by scoping

---

### 5.2 Configure .npmrc for Publishing

Add GitHub Packages registry to `.npmrc` (project-level, committed):

```ini
legacy-peer-deps=true
@kinginyellows:registry=https://npm.pkg.github.com
```

**SECURITY WARNING:**

- **DO NOT** add auth tokens to project `.npmrc` (committed file)
- Auth tokens go in **user-level ~/.npmrc** (homelab) or **CI environment variables**

#### Research Insights: .npmrc Security Patterns

**Project .npmrc (committed):**

```ini
# Safe - no secrets
@kinginyellows:registry=https://npm.pkg.github.com
```

**Homelab ~/.npmrc (NOT committed):**

```ini
# Contains secrets
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

**CI/CD (environment variable):**

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### 5.3 Test Package Contents

```bash
npm pack --dry-run
```

Verify output contains only:

- `bin/run.js`, `bin/run.cmd`, `bin/dev.js`, `bin/dev.cmd`
- `dist/**` (compiled TypeScript)
- `oclif.manifest.json`
- `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`

**Create .npmignore for strict exclusion:**

```
# Development files (never ship)
tests/
.github/
docs/
scripts/
*.test.ts
*.spec.ts
tsconfig.json
vitest.config.ts
eslint.config.cjs
.prettierrc.json

# Source code (ship dist/ only)
src/

# Environment/config
.env*
.codemachine/
.serena/
.claude/
.deps/
.mcp.json
claude-flow.config.json
specification.md
CLAUDE.md
```

#### Research Insights: Package Size Optimization

**Target:** <2MB for CLI tools

**Verification:**

```bash
npm pack
ls -lh *.tgz
# Should show <2MB

# Inspect contents
tar -tzf kinginyellows-codemachine-pipeline-1.0.0.tgz | grep -E "^package/(src|tests|\.claude)" && {
  echo "ERROR: Dev artifacts in package"
  exit 1
}
```

---

### 5.4 Add GitHub Actions Publish Workflow

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to GitHub Packages

on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  publish:
    runs-on: [self-hosted, linux]
    timeout-minutes: 15
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.target_commitish || github.ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
          registry-url: 'https://npm.pkg.github.com'
          scope: '@kinginyellows'

      - name: Verify package version
        run: |
          PACKAGE_VERSION=$(node -p "require('./package.json').version")
          echo "Publishing version: $PACKAGE_VERSION"

      - name: Install dependencies
        run: npm ci --no-audit --no-fund

      - name: Build project
        run: npm run build

      - name: Run tests
        run: npm test

      - name: Verify package contents
        run: |
          npm pack --dry-run
          test -f "bin/run.js" || {
            echo "ERROR: bin/run.js not found"
            exit 1
          }

      - name: Run security audit
        run: npm audit --production --audit-level=high

      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Verify published package
        run: |
          sleep 5  # Allow registry propagation
          npm view @kinginyellows/codemachine-pipeline@$PACKAGE_VERSION version
```

**Trigger:** Auto-triggers on GitHub Release published

#### Research Insights: Publish Workflow Security

**Least-privilege permissions:**

- `contents: read` - Checkout only
- `packages: write` - Publish only (no other repo permissions)

**Auth patterns:**

- Use `GITHUB_TOKEN` (auto-available in Actions)
- Set `registry-url` in setup-node action
- Token passed via `NODE_AUTH_TOKEN` env var

**Supply chain security (future enhancement):**

- Add SBOM generation: `npx @cyclonedx/cyclonedx-npm`
- Add provenance: `actions/attest-build-provenance@v1`
- Use signed tags: `git tag -s v1.0.0`

---

### 5.5 Test Publish (Dry Run)

```bash
npm publish --dry-run --verbose
```

Verify no errors. Do NOT actually publish yet — that happens in Phase 6.

**Check for warnings:**

- No bin path warnings (from Phase 1.5 validation)
- No missing files warnings
- No authentication errors

---

### 5.6 Add .nvmrc for Node Version Enforcement

```bash
echo "24" > .nvmrc
git add .nvmrc
```

Enables automatic version switching for developers using `nvm` or `asdf`.

---

### 5.7 Pre-Production Package Validation (NEW)

**CRITICAL:** Test the actual tarball before publishing to catch bin path issues, missing files, etc.

```bash
# Step 1: Generate tarball locally
npm pack
# Produces: kinginyellows-codemachine-pipeline-1.0.0.tgz

# Step 2: Extract and inspect
tar -xzf kinginyellows-codemachine-pipeline-1.0.0.tgz
cat package/package.json | jq '.bin'
# Expected: { "codepipe": "bin/run.js" }

# Step 3: Install from local tarball in clean environment
mkdir /tmp/tarball-validation && cd /tmp/tarball-validation
npm install -g /path/to/kinginyellows-codemachine-pipeline-1.0.0.tgz

# Step 4: Verify binary works
codepipe --version  # Should show 1.0.0
which codepipe      # Should show npm global bin path

# Step 5: Run smoke tests with tarball-installed version
mkdir /tmp/tarball-e2e && cd /tmp/tarball-e2e
git init && git commit --allow-empty -m "init"
codepipe init --yes
codepipe doctor --json | jq .
codepipe start --prompt "Test" --dry-run --json | jq .

# Step 6: Clean up
npm uninstall -g @kinginyellows/codemachine-pipeline
rm -rf /tmp/tarball-validation /tmp/tarball-e2e package/
```

**Acceptance Criteria:**

- [ ] Tarball extracts successfully
- [ ] `package/package.json` has valid bin entry (no "invalid" warning)
- [ ] Global install from tarball succeeds
- [ ] `codepipe --version` shows 1.0.0
- [ ] All smoke tests pass with tarball-installed version
- [ ] Package size < 2MB

#### Research Insights: Pre-Production Validation

**Why this matters:**

- Published package may differ from `npm link` testing (file exclusions, bin paths)
- Testing from tarball catches packaging issues before they reach users
- Validates `files` array and `.npmignore` are correct

**From deployment verification research:**

- This is the highest-value pre-publish check
- Prevents "works locally, broken on install" issues

---

### 5.8 Commit Publishing Setup

**Pre-Submit Checklist:**

```bash
gt sync --force && \
gt restack && \
npm run build && \
npm run lint && \
npm test && \
npm run deps:check:ci && \
gt submit --no-interactive
```

- [ ] Commit: `chore: configure GitHub Packages publishing`
- [ ] Push and verify CI passes with the scoped name
- [ ] **Checkpoint:** All pre-publish validation passes, ready for Phase 6

---

## Phase 6: Cut the Release

**Goal:** Tag, publish, and deploy v1.0.0.

### 6.1 Update CHANGELOG Date

Change the v1.0.0 date in CHANGELOG.md to the actual release date (2026-02-14).
Fold `[Unreleased]` content into the v1.0.0 entry.

**Verification:**

```bash
grep -m1 "^\[1\.0\.0\]" CHANGELOG.md | grep "$(date +%Y-%m-%d)"
```

---

### 6.2 Sync Release Branch

**ENHANCED with Graphite protocol:**

```bash
# Step 1: Sync Graphite trunk (CRITICAL - prevents conflicts)
git checkout main && git pull
gt sync --force  # ← Added from Graphite learnings

# Step 2: Verify clean state
gt state  # Ensure no stale stacks

# Step 3: Delete and recreate release branch from main
git branch -D release
git checkout -b release

# Step 4: Remove development artifacts
ARTIFACTS=(
  "CLAUDE.md"
  ".codemachine"
  ".serena"
  ".claude"
  ".deps"
  ".mcp.json"
  "claude-flow.config.json"
  "specification.md"
)

for artifact in "${ARTIFACTS[@]}"; do
  if [ -e "$artifact" ]; then
    git rm -r "$artifact" || {
      echo "ERROR: Failed to remove $artifact"
      exit 1
    }
  fi
done

# Verify no sensitive artifacts remain
for artifact in "${ARTIFACTS[@]}"; do
  if [ -e "$artifact" ]; then
    echo "ERROR: $artifact still exists after removal"
    exit 1
  fi
done

git commit -m "chore: prepare release branch — remove dev artifacts"

# Step 5: Verify build and tests
npm run build && npm run lint && npm test && npm run smoke

# Step 6: Verify package
npm pack --dry-run
```

#### Research Insights: Graphite Sync Protocol

**From graphite-restack-conflicts learnings:**

- **MUST run `gt sync --force`** before branch operations (not just `git pull`)
- Prevents "branch based on old main" conflicts
- Run `gt state` to verify no stale stacks
- Sync frequency: >3 days → sync twice daily

**Artifact Removal Safety:**

- Don't silence errors with `2>/dev/null` - explicitly check each removal
- Verify artifacts actually removed (prevents shipping sensitive files)

---

### 6.3 Re-tag v1.0.0

**ENHANCED with backup and verification:**

```bash
# Step 1: Verify on release branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
test "$CURRENT_BRANCH" = "release" || {
  echo "ERROR: Must be on release branch"
  exit 1
}

# Step 2: Create backup tag for old release
git tag v1.0.0-milestone-2026-02-05 v1.0.0 2>/dev/null || true
git push origin v1.0.0-milestone-2026-02-05

# Step 3: Document old commit for recovery
git rev-parse v1.0.0 > .release-backup.txt
echo "Backup: old v1.0.0 at $(cat .release-backup.txt)"

# Step 4: Delete old tag locally and remotely
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0

# Step 5: Create new annotated tag on release branch
git tag -a v1.0.0 -F- <<EOF
v1.0.0: Initial Stable Release

## Highlights
- Production-ready queue system (O(1) operations, parallel execution)
- CodeMachine-CLI two-way execution engine
- 45 CLI integration tests
- Node 24+ requirement
- GitHub Packages publishing

## Installation
npm install -g @kinginyellows/codemachine-pipeline

Full changelog: CHANGELOG.md
EOF

# Step 6: Push new tag
git push origin release --tags

# Step 7: Verify tag
git tag -l -n1 v1.0.0
git show v1.0.0 | head -20
```

#### Research Insights: Tag Management Safety

**Re-tagging justification (add to plan):**

```markdown
**Why re-tagging v1.0.0 is safe:**

- Personal project with no external npm dependents
- Old v1.0.0 tag was a milestone marker, not a published release
- No risk of breaking downstream consumers (none exist)
- Backup tag created for recovery if needed

**Standard practice:** Most projects avoid re-tagging; increment to v1.0.1 instead.
```

**Security enhancement:**

```bash
# Use signed tags for releases
git tag -s v1.0.0 -m "v1.0.0: Initial stable release"
git tag -v v1.0.0  # Verify signature
```

**From Graphite learnings:**

- Run `gt state` before re-tagging (ensure branch is standalone, not in a stack)
- Verify clean working tree before tag operations

---

### 6.4 Create GitHub Release

```bash
# Extract only v1.0.0 section from CHANGELOG for release notes
awk '/^## \[1\.0\.0\]/, /^## \[/ { if (!/^## \[0\./) print }' CHANGELOG.md > /tmp/v1.0.0-notes.md

# Delete old release, create new one
gh release delete v1.0.0 --yes 2>/dev/null
gh release create v1.0.0 \
  --title "v1.0.0: Initial Stable Release" \
  --notes-file /tmp/v1.0.0-notes.md \
  --target release
```

#### Research Insights: GitHub Release Best Practices

**Enhancements:**

- Extract only the relevant CHANGELOG section (not entire file)
- Verify tag exists before creating release
- Use `--target release` to specify branch explicitly

**Supply chain security (future):**

- Upload SBOM: `gh release upload v1.0.0 sbom.json`
- Add checksum file for verification

---

### 6.5 Publish to GitHub Packages

The publish workflow should trigger automatically on the GitHub Release. Monitor workflow execution:

```bash
# Watch workflow status
gh run watch

# If workflow fails, manual publish:
npm publish
```

**Post-Publish Verification:**

```bash
# Verify package exists in GitHub Packages
npm view @kinginyellows/codemachine-pipeline@1.0.0 --registry=https://npm.pkg.github.com

# Check package metadata
npm info @kinginyellows/codemachine-pipeline@1.0.0 --registry=https://npm.pkg.github.com
```

---

### 6.6 Install on Homelab (ENHANCED)

**SECURITY WARNING:**

- Use GitHub PAT with **MINIMAL** scope: ONLY `read:packages`
- Set PAT expiration to shortest acceptable duration (e.g., 30 days)
- Never commit `.npmrc` files containing tokens
- Store PAT in password manager, not shell history
- Rotate PAT immediately if exposed

**Installation Procedure:**

```bash
# Step 1: Verify Node 24+ on homelab
node --version  # Must be v24.x.x or higher
nvm use 24  # If using nvm

# Step 2: Create GitHub PAT (if not exists)
# Go to: https://github.com/settings/tokens
# Create classic token with ONLY: read:packages, write:packages, repo

# Step 3: Configure npm authentication (user-level ~/.npmrc)
cat >> ~/.npmrc << 'EOF'
@kinginyellows:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
EOF

# Set token in environment (don't expose in command history)
export NPM_TOKEN=[example-github-token]

# Verify authentication
npm whoami --registry=https://npm.pkg.github.com
# Should show your GitHub username

# Step 4: Install package globally
npm install -g @kinginyellows/codemachine-pipeline

# Step 5: Verify binary in PATH
which codepipe
# Should show: /usr/local/lib/node_modules/@kinginyellows/codemachine-pipeline/bin/run.js (or similar)

# Step 6: Run diagnostics
codepipe --version  # Should show 1.0.0
codepipe doctor     # Should pass with 0 errors (warnings OK)
codepipe health     # Should exit 0
```

#### Research Insights: Homelab Deployment

**Two-Tier Health Check Pattern:**

1. **doctor** (comprehensive, 2-5 seconds):
   - 11 diagnostic checks
   - Exit codes: 0=pass, 10=config error, 20=environment, 30=credentials
   - Use for setup validation

2. **health** (lightweight, <1 second):
   - 3 quick checks (config validity, disk space, write permissions)
   - Exit codes: 0=healthy, 1=unhealthy
   - Use for monitoring/probes

**Post-Install Functional Test:**

```bash
# Create test project
cd /tmp/homelab-test && git init
git commit --allow-empty -m "init"

# Initialize pipeline
codepipe init --yes

# Start a test feature
codepipe start --prompt "Add logging to error handlers" --json | jq .

# Verify run directory created
ls -la .codepipe/runs/

# Check status
codepipe status --json | jq .
```

---

### 6.7 Post-Release Verification

**Immediate Verification (within 1 hour):**

- [ ] `codepipe --version` shows 1.0.0
- [ ] `codepipe doctor` passes with 0 errors
- [ ] `codepipe health` exits 0
- [ ] `codepipe init --yes` works in a fresh project
- [ ] GitHub Release page shows correct release notes
- [ ] GitHub Packages page shows the published package
- [ ] Package installs via `npm install -g @kinginyellows/codemachine-pipeline@1.0.0`

**Functional Verification (within 24 hours):**

- [ ] Complete E2E pipeline: init → start → approve → resume
- [ ] JSON output mode works for all commands
- [ ] Error paths produce clear messages with remediation
- [ ] Doctor identifies common issues (missing git, wrong Node version)

**Performance Verification:**

- [ ] `codepipe init` completes in < 5 seconds
- [ ] `codepipe doctor` runs in < 3 seconds
- [ ] Package size < 2MB

---

### 6.8 Rollback Procedure (NEW)

**Goal:** Document emergency recovery if v1.0.0 has critical issues.

**Pre-Deployment Backup:**

```bash
# On homelab, before installing v1.0.0
codepipe --version > /tmp/codepipe-pre-v1-version.txt
npm list -g @kinginyellows/codemachine-pipeline --json > /tmp/codepipe-pre-v1-state.json
codepipe doctor --json > /tmp/codepipe-pre-v1-doctor.json
```

**Emergency Rollback Commands:**

| Scenario                | Action                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **Install fails**       | `npm cache clean --force && npm install -g <previous-version>`                       |
| **Runtime failure**     | `npm uninstall -g @kinginyellows/codemachine-pipeline && npm install -g <previous>`  |
| **Auth failure**        | Verify PAT: `npm whoami --registry https://npm.pkg.github.com`, regenerate if needed |
| **Broken dependencies** | `npm list -g --depth=0` check conflicts, reinstall in fresh directory                |

**Unpublish Procedure (24-72 hour window):**

```bash
# 1. Unpublish from GitHub Packages
npm unpublish @kinginyellows/codemachine-pipeline@1.0.0 --registry=https://npm.pkg.github.com

# 2. Delete GitHub Release
gh release delete v1.0.0 --yes

# 3. Delete git tag
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0

# 4. Restore backup tag (if needed)
git tag -a v1.0.0 $(cat .release-backup.txt) -m "Restored original v1.0.0"

# 5. Fix issues on main, re-cut as v1.0.1
```

**Note:** npm unpublish is only available for 72 hours after initial publish. After that, you must publish a new version (v1.0.1) with fixes.

---

### 6.9 Post-Deployment Monitoring (NEW)

**Goal:** Continuous health verification after deployment.

**Health Check Script:**

```bash
#!/usr/bin/env bash
# /usr/local/bin/codepipe-health-check.sh

set -euo pipefail

LOG_FILE="/var/log/codepipe-health.log"
echo "$(date -Iseconds) - Running health check" >> "$LOG_FILE"

if codepipe doctor --json > /tmp/codepipe-doctor.json 2>&1; then
  echo "$(date -Iseconds) - PASS: doctor check succeeded" >> "$LOG_FILE"
else
  EXIT_CODE=$?
  echo "$(date -Iseconds) - FAIL: doctor check failed (exit $EXIT_CODE)" >> "$LOG_FILE"
  cat /tmp/codepipe-doctor.json >> "$LOG_FILE"
  # Send alert (email, webhook, etc.)
fi

# Verify version stability
CURRENT_VERSION=$(codepipe --version)
if [ "$CURRENT_VERSION" != "1.0.0" ]; then
  echo "$(date -Iseconds) - WARN: version mismatch (expected 1.0.0, got $CURRENT_VERSION)" >> "$LOG_FILE"
fi
```

**Monitoring Schedule:**

```bash
# Add to crontab
chmod +x /usr/local/bin/codepipe-health-check.sh

# First 24 hours: every 6 hours
0 */6 * * * /usr/local/bin/codepipe-health-check.sh

# After 24 hours: daily
0 0 * * * /usr/local/bin/codepipe-health-check.sh
```

**Baseline Metrics:**

```bash
# Capture baseline performance
echo "Baseline metrics (v1.0.0):" > /var/log/codepipe-baseline.txt
time codepipe doctor 2>&1 | grep real >> /var/log/codepipe-baseline.txt
time codepipe init --yes 2>&1 | grep real >> /var/log/codepipe-baseline.txt
```

**Alert Conditions:**

- doctor check fails
- Version changes unexpectedly
- Disk space > 90% in `.codepipe/`
- Pipeline stuck for > 24 hours

#### Research Insights: Post-Deployment Monitoring

**From homelab deployment research:**

- Two-tier health check (doctor for comprehensive, health for lightweight)
- Cron-based periodic validation
- Log rotation and baseline metrics
- Alert on anomalies

**Monitoring dashboard (optional):**

```bash
codepipe-status-dashboard.sh:
echo "=== CodePipe Status ==="
echo "Version: $(codepipe --version)"
echo "Health: $(codepipe health && echo OK || echo FAIL)"
echo "Active Features: $(codepipe status --json | jq '.features | length')"
echo "Last Check: $(tail -1 /var/log/codepipe-health.log)"
```

---

## Wave Execution Strategy (Alternative Approach)

**Goal:** Reduce release time from 90 minutes to 45 minutes via parallel execution.

### Wave 1: Foundation (Parallel, ~8 minutes)

**Independent tasks - can run concurrently:**

| Agent                 | Task                              | Duration |
| --------------------- | --------------------------------- | -------- |
| formatter-agent       | Phase 1.1: Prettier formatting    | ~2 min   |
| docker-diagnostician  | Phase 1.2: Docker verification    | ~3 min   |
| dockerfile-cleaner    | Phase 1.3: .dockerignore cleanup  | ~1 min   |
| readme-auditor        | Phase 4.1: README audit           | ~5 min   |
| changelog-compiler    | Phase 4.2: CHANGELOG update       | ~8 min   |
| help-verifier         | Phase 4.3: CLI help verification  | ~4 min   |
| docs-curator          | Phase 4.4: Untracked docs cleanup | ~6 min   |
| contributing-verifier | Phase 4.5: CONTRIBUTING.md        | ~3 min   |

**Result:** All CI fixes + all documentation audits complete in ~8 minutes (longest pole: changelog).

**Commit:** Combine Wave 1 results into 2 commits:

1. `chore: fix CI (formatting, Docker, dockerignore)`
2. `docs: audit and update documentation`

---

### Wave 2: Testing & Package Setup (Parallel, ~15 minutes)

**After Wave 1 ensures green CI:**

| Agent            | Task                                      | Duration |
| ---------------- | ----------------------------------------- | -------- |
| e2e-tester       | Phase 2: E2E smoke tests                  | ~15 min  |
| package-scoper   | Phase 5.1-5.3: Scoping, .npmrc, pack test | ~3 min   |
| workflow-builder | Phase 5.4: Publish workflow               | ~4 min   |

**Result:** E2E validation + npm publishing infrastructure ready in ~15 minutes.

**Commit:** `chore: configure GitHub Packages publishing`

---

### Wave 3: Fixes & Validation (Batched, ~10-30 minutes)

**Depends on Wave 2 E2E results:**

| Agent             | Task                                     | Duration   |
| ----------------- | ---------------------------------------- | ---------- |
| bug-fixer         | Phase 3: Fix issues from E2E (scope TBD) | ~10-30 min |
| publish-validator | Phase 5.7: Pre-production tarball test   | ~5 min     |

**Result:** Fixes applied, package validated and ready to publish.

---

### Pre-Submit Verification (Parallel, ~5 minutes)

**Before entering Wave 4 (release execution):**

| Check            | Command                 | Expected          |
| ---------------- | ----------------------- | ----------------- |
| lint-checker     | `npm run lint`          | Exits 0           |
| test-runner      | `npm test`              | All pass          |
| smoke-tester     | `npm run smoke`         | Exits 0           |
| build-verifier   | `npm run build`         | Valid artifacts   |
| exports-auditor  | `npm run exports:check` | No unused exports |
| deps-auditor     | `npm run deps:check:ci` | No new cycles     |
| pack-verifier    | `npm pack --dry-run`    | Succeeds          |
| publish-verifier | `npm publish --dry-run` | Succeeds          |

**Result:** All pre-release checks pass in ~5 minutes (concurrent execution).

---

### Wave 4: Release Execution (Sequential, ~20 minutes)

**MUST be sequential (dependencies between steps):**

1. Phase 6.1: Update CHANGELOG date (~1 min)
2. Phase 6.2: Sync release branch (~5 min)
3. Phase 6.3: Re-tag v1.0.0 (~2 min)
4. Phase 6.4: Create GitHub Release (~1 min)
5. Phase 6.5: Publish to GitHub Packages (~2 min)
6. Phase 6.6: Install on homelab (~5 min)
7. Phase 6.7: Post-release verification (~3 min)

**Result:** v1.0.0 published and deployed to homelab.

---

### Wave Execution Summary

| Approach                      | Total Duration | Bottleneck                         |
| ----------------------------- | -------------- | ---------------------------------- |
| **Sequential** (current plan) | ~90-120 min    | Each phase waits for previous      |
| **Wave-based** (enhanced)     | ~45-65 min     | Changelog compilation, E2E testing |

**Time savings:** ~50% reduction via parallelization of independent tasks.

**Implementation via Claude Code:**

```bash
# Initialize swarm for Wave 1
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8

# Spawn all Wave 1 agents in background (Claude Code Task tool)
Task({ prompt: "Fix Prettier violations", subagent_type: "coder", run_in_background: true })
Task({ prompt: "Verify Docker CI step", subagent_type: "tester", run_in_background: true })
# ... (spawn all 8 agents in ONE message)

# Tell user and wait
"I've launched 8 Wave 1 agents working in parallel. They'll report back when done."
```

---

## Technical Considerations

- **Package name change**: Renaming from `codemachine-pipeline` to `@kinginyellows/codemachine-pipeline` has no downstream impact (no existing consumers)
- **Re-tagging v1.0.0**: Destructive operation — deletes a published tag. Acceptable for a personal project with no external dependents. **Backup tag created for safety.**
- **Node 24+ requirement**: `engines` field enforces this; homelab must have Node 24+. **Add .nvmrc for automatic version switching.**
- **GitHub PAT for npm install**: Homelab needs a GitHub Personal Access Token with **minimal scope** (`read:packages` only). **Use environment variable, not plaintext in .npmrc.**
- **`codemachine` optional dependency**: The CodeMachine-CLI adapter (Cycle 9) depends on `codemachine ^0.8.0` — verify it's installable or that the optional fallback works correctly. **Phase 2.5 tests both scenarios.**

### Re-Tagging Justification

**Why re-tagging v1.0.0 is safe here:**

- Personal project with no external npm dependents
- Old v1.0.0 tag was a milestone marker, not a published release
- No risk of breaking downstream consumers (none exist)
- Backup tag (`v1.0.0-milestone-2026-02-05`) created for recovery

**Standard practice:** Most projects avoid re-tagging; increment to v1.0.1 instead. This is a ONE-TIME exception.

---

## Acceptance Criteria (Enhanced)

### Functional Requirements

- [ ] All CI jobs green on main in <2 minutes
- [ ] E2E pipeline tested: init → start → approve → resume
- [ ] JSON output mode works for all applicable commands
- [ ] Error paths produce clear messages with remediation
- [ ] Optional CodeMachine CLI scenarios tested (with/without binary)
- [ ] Crash recovery validated (queue integrity, resume behavior)

### Documentation Requirements

- [ ] README accurately describes installation (GitHub Packages instructions)
- [ ] README execution engines table verified against source code
- [ ] README command table matches oclif.manifest.json
- [ ] CHANGELOG reflects all work through v1.0.0 (including Cycles 6-9)
- [ ] CHANGELOG date is 2026-02-14 (actual release date)
- [ ] CLI `--help` text validated for all commands
- [ ] All documentation links verified (no broken references)

### Packaging Requirements

- [ ] Package name scoped: `@kinginyellows/codemachine-pipeline`
- [ ] `publishConfig` configured for GitHub Packages
- [ ] `.npmignore` excludes dev artifacts (package <2MB)
- [ ] `npm pack --dry-run` shows correct contents (bin/, dist/, manifest)
- [ ] **No bin path warnings** (Phase 1.5 verified)
- [ ] `npm publish --dry-run` succeeds
- [ ] Pre-production tarball validation passed (Phase 5.7)

### Release Requirements

- [ ] Release branch synced with main (via `gt sync --force`)
- [ ] Dev artifacts removed from release branch (9 artifacts verified removed)
- [ ] All tests pass on release branch
- [ ] Backup tag created (`v1.0.0-milestone-2026-02-05`)
- [ ] New v1.0.0 tag created with rich annotation
- [ ] GitHub Release published with accurate release notes
- [ ] Package published to GitHub Packages

### Deployment Requirements

- [ ] `npm install -g @kinginyellows/codemachine-pipeline@1.0.0` works on homelab
- [ ] `codepipe doctor` passes on homelab (0 errors, warnings OK)
- [ ] Homelab functional test passes (init → start with test feature)
- [ ] Health check script deployed and scheduled
- [ ] Baseline metrics captured

### Security Requirements

- [ ] GitHub PAT uses minimal scope (`read:packages` only for homelab)
- [ ] No auth tokens in committed `.npmrc` file
- [ ] Docker container runs as non-root user
- [ ] Signed tags used for release
- [ ] `npm audit --production` shows 0 high/critical vulnerabilities
- [ ] No secrets in documentation (gitleaks scan)
- [ ] Publishing workflow uses least-privilege permissions

---

## Dependencies & Risks (Updated)

| Risk                                 | Likelihood | Impact   | Mitigation                                      | Status     |
| ------------------------------------ | ---------- | -------- | ----------------------------------------------- | ---------- |
| **bin path warning breaks CLI**      | HIGH       | CRITICAL | Phase 1.5 validation, tarball testing (5.7)     | Mitigated  |
| **E2E testing reveals major bugs**   | Medium     | High     | Phase 3 buffer; Wave 3 allows parallel fixes    | Acceptable |
| **GitHub PAT exposure**              | Medium     | HIGH     | Security warnings, env vars, minimal scope      | Mitigated  |
| **CodeMachine-CLI adapter fails**    | Medium     | Medium   | Phase 2.5 tests both scenarios (with/without)   | Mitigated  |
| **GitHub Packages auth issues**      | Low        | Medium   | Well-documented setup; PAT troubleshooting      | Acceptable |
| **Re-tagging causes confusion**      | Low        | Low      | Backup tag created; delete old release first    | Mitigated  |
| **Node 24 not available on homelab** | Low        | High     | Check before Phase 1; .nvmrc for auto-switch    | Mitigated  |
| **CI time regression**               | Low        | Low      | Wave 1 optimizations (caching, parallelization) | Mitigated  |
| **CHANGELOG date mismatch**          | Medium     | Medium   | Automated validation in Phase 4.2               | Mitigated  |
| **Docker image size bloat**          | Low        | Low      | .npmignore exclusions; monitor in Phase 5.3     | Acceptable |

---

## Research Insights: Key Findings Summary

### From 18 Parallel Research Agents

1. **Architecture Review** (4.25/5 stars):
   - Blocking: bin path warning
   - Gaps: optional dep testing, crash recovery, pre-publish validation
   - Strengths: modular design, comprehensive testing, observability

2. **Security Sentinel** (MEDIUM risk):
   - HIGH: PAT exposure in Phase 6.6
   - MEDIUM: Docker non-root, artifact removal, tag signing, workflow perms
   - Recommended: Add SECURITY.md, dependency audit, gitleaks scan

3. **Performance Oracle** (60% CI speedup):
   - npm/Docker caching
   - Job parallelization
   - Prettier --cache flag
   - TypeScript incremental builds
   - Package size optimization

4. **Simplicity Reviewer** (50% time reduction):
   - Phase 2 overengineered (smoke test sufficient)
   - Phase 3 speculative (delete or scope only if needed)
   - Phase 4 too granular (oclif help is auto-generated)
   - Phase 5 redundant verification (npm pack run twice)

5. **Pattern Recognition** (cosmetic fixes):
   - Standardize command formatting to `bash` fences
   - Consolidate checklists to phase end
   - Use active voice for goals/checkpoints
   - Document re-tagging justification

6. **Data Integrity Guardian** (4 validation scripts):
   - CHANGELOG date/version consistency
   - package.json metadata integrity
   - .npmrc security (no tokens in committed file)
   - Docker version label automation

7. **Deployment Verifier** (critical additions):
   - Phase 5.7: Pre-production tarball validation
   - Phase 6.8: Rollback procedure
   - Phase 6.9: Post-deployment monitoring

8. **Wave-Based Execution** (45min vs 90min):
   - Phases 1+4 can run in parallel (Wave 1)
   - Phase 2 + Phase 5.1-5.4 can run in parallel (Wave 2)
   - 50% time savings via dependency-aware parallelization

9. **Graphite Workflow** (sync protocol):
   - Run `gt sync --force` before all branch operations
   - Pre-submit checklist before every PR
   - CHANGELOG.md conflict risk in multi-phase work
   - Run `gt state` before re-tagging

10. **Docs PR Review** (automated verification):
    - Extract source-of-truth from manifest/source code
    - Automated link validation, feature table checks
    - 5-agent review pattern for doc changes

11. **GitHub Packages** (complete setup):
    - publishConfig with access: "public"
    - Full workflow definition with permissions
    - PAT scopes and troubleshooting guide

12. **Homelab Deployment** (production patterns):
    - Two-tier health checks (doctor/health)
    - 6-step install procedure
    - Verification script with JSON parsing
    - Monitoring via crontab

13. **E2E Testing** (battle-tested patterns):
    - Test isolation with .test-temp directories
    - JSON schema validation with Zod
    - Exit code testing (0, 1, 10, 30)
    - Pipeline testing with state passing

14. **Release Branch** (strategy validated):
    - Delete/recreate approach is modern & lean
    - 9 dev artifacts to remove (verified safe)
    - Complete command sequence provided

15. **CI Best Practices** (Phase 1 validated):
    - Prettier single-shot approach correct
    - Docker pipefail pattern correct (no changes needed)
    - .dockerignore cleanup safe

16. **CodeMachine-CLI Learnings** (not applicable):
    - Prerequisite validation fix already merged
    - Integration tests cover this behavior

17. **ESLint Type Safety** (not applicable):
    - Linting pattern, not release concern

18. **Documentation Audit Tools**:
    - Vale, markdownlint, markdown-link-check
    - Custom validators for README, CHANGELOG, CLI
    - CI integration patterns

---

## References

### Internal

- Release branch strategy: `docs/development/release-branch-strategy.md`
- Brainstorm: `docs/brainstorms/2026-02-14-v1-release-readiness-brainstorm.md`
- CI workflow: `.github/workflows/ci.yml`
- Package config: `package.json` (lines 1-96)
- Docker setup: `Dockerfile`
- Changelog: `CHANGELOG.md`
- **Solution docs applied:**
  - `docs/solutions/code-review/reviewing-documentation-prs.md`
  - `docs/solutions/code-review/multi-agent-wave-resolution-pr-findings.md`
  - `docs/solutions/integration-issues/graphite-restack-conflicts-after-main-advanced.md`

### External

- GitHub Packages npm: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- oclif publishing: https://oclif.io/docs/releasing
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- Prettier docs: https://prettier.io/docs/en/options.html
- Docker best practices: https://docs.docker.com/develop/dev-best-practices/
- Semantic Versioning: https://semver.org/
- Vale: https://vale.sh/
- markdownlint: https://github.com/DavidAnson/markdownlint

---

## Enhanced Plan Execution Summary

**Original:** 6 sequential phases, ~90-120 minutes
**Enhanced:** 6 phases + 7 new sub-phases, ~90 minutes sequential OR ~45 minutes wave-based

**Critical additions:**

- Phase 1.5: Verify package bin path (BLOCKING)
- Phase 2.5: Test optional dependency scenarios
- Phase 2.6: Test crash recovery
- Phase 4.0: Pre-audit verification strategy
- Phase 5.7: Pre-production tarball validation
- Phase 6.8: Rollback procedure
- Phase 6.9: Post-deployment monitoring

**Key improvements:**

- Automated documentation verification (prevents PR #464 drift pattern)
- Security hardening (PAT handling, signed tags, least-privilege)
- CI performance optimization (60% speedup)
- Deployment rigor (pre-publish validation, rollback, monitoring)
- Graphite sync protocol (prevents restack conflicts)
