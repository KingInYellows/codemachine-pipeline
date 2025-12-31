# Alpha Release Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all critical blockers to achieve alpha release readiness for `ai-feature-pipeline` v0.1.0

**Architecture:** CLI completion + test coverage expansion + readiness verification

**Tech Stack:** TypeScript, oclif, Jest, Vitest, Node.js 24, GitHub Actions

---

## Current State Summary

**Version:** 0.1.0 (pre-alpha)  
**Architecture Completion:** ~60%  
**CLI Completion:** 8/13 commands (62%)  
**Test Coverage:** Partial (CLI integration gaps)  
**Readiness Checks:** 0/84 completed

**Critical Path to Alpha:**

1. Complete missing CLI commands (5 commands)
2. Add CLI integration tests (10+ tests)
3. Execute readiness verification (84 checks)
4. Resolve documentation drift
5. Create alpha release artifacts

**Estimated Timeline:** 4-6 weeks

---

## Phase 1: CLI Command Completion (2-3 weeks)

### Task 1: Implement `ai-feature pr create`

**Files:**

- Create: `src/cli/commands/pr/create.ts`
- Modify: `src/workflows/prAutomationCoordinator.ts:1-50` (connect CLI to workflow)
- Test: `test/commands/pr/create.test.ts`

**Step 1: Write the failing test**

```typescript
// test/commands/pr/create.test.ts
import { runCommand } from '@oclif/test';
import { expect } from '@jest/globals';

describe('pr create', () => {
  it('creates PR with feature ID', async () => {
    const { stdout } = await runCommand(['pr', 'create', '--feature', 'feat-test']);
    expect(stdout).toContain('Pull request created');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:jest test/commands/pr/create.test.ts`  
Expected: FAIL with "command not found"

**Step 3: Write minimal implementation**

```typescript
// src/cli/commands/pr/create.ts
import { Command, Flags } from '@oclif/core';
import { PRAutomationCoordinator } from '../../workflows/prAutomationCoordinator.js';

export default class PrCreate extends Command {
  static description = 'Create pull request for a completed feature';

  static flags = {
    feature: Flags.string({ char: 'f', description: 'Feature ID', required: true }),
    reviewers: Flags.string({ char: 'r', description: 'Comma-separated reviewer usernames' }),
    draft: Flags.boolean({ char: 'd', description: 'Create as draft PR', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PrCreate);
    const coordinator = new PRAutomationCoordinator();

    const result = await coordinator.createPR({
      featureId: flags.feature,
      reviewers: flags.reviewers?.split(','),
      isDraft: flags.draft,
    });

    this.log(`Pull request created: ${result.prUrl}`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:jest test/commands/pr/create.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/pr/create.ts test/commands/pr/create.test.ts
git commit -m "feat(cli): add pr create command"
```

---

### Task 2: Implement `ai-feature pr status`

**Files:**

- Create: `src/cli/commands/pr/status.ts`
- Modify: `src/adapters/github/GitHubAdapter.ts:200-250` (add status check methods if missing)
- Test: `test/commands/pr/status.test.ts`

**Step 1: Write the failing test**

```typescript
// test/commands/pr/status.test.ts
describe('pr status', () => {
  it('shows PR status with checks', async () => {
    const { stdout } = await runCommand(['pr', 'status', '--feature', 'feat-test']);
    expect(stdout).toContain('Status checks');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:jest test/commands/pr/status.test.ts`  
Expected: FAIL with "command not found"

**Step 3: Write minimal implementation**

```typescript
// src/cli/commands/pr/status.ts
import { Command, Flags } from '@oclif/core';
import { GitHubAdapter } from '../../adapters/github/GitHubAdapter.js';
import { loadRepoConfig } from '../../core/config/RepoConfig.js';

export default class PrStatus extends Command {
  static description = 'Show pull request status and checks';

  static flags = {
    feature: Flags.string({ char: 'f', description: 'Feature ID', required: true }),
    json: Flags.boolean({ description: 'Output in JSON format' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PrStatus);
    const config = await loadRepoConfig();
    const github = new GitHubAdapter(config);

    const prNumber = await this.findPRForFeature(flags.feature);
    const status = await github.getPRStatus(prNumber);

    if (flags.json) {
      this.log(JSON.stringify(status, null, 2));
    } else {
      this.log(`PR #${prNumber}: ${status.state}`);
      this.log(`Status checks: ${status.checksStatus}`);
    }
  }

  private async findPRForFeature(featureId: string): Promise<number> {
    // TODO: Implement feature-to-PR mapping lookup
    return 1; // Placeholder
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:jest test/commands/pr/status.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/pr/status.ts test/commands/pr/status.test.ts
git commit -m "feat(cli): add pr status command"
```

---

### Task 3: Implement `ai-feature research create`

**Files:**

- Create: `src/cli/commands/research/create.ts`
- Modify: `src/workflows/researchCoordinator.ts:1-100` (expose createTask method)
- Test: `test/commands/research/create.test.ts`

**Step 1: Write the failing test**

```typescript
// test/commands/research/create.test.ts
describe('research create', () => {
  it('creates research task from objective', async () => {
    const { stdout } = await runCommand([
      'research',
      'create',
      '--feature',
      'feat-test',
      '--objective',
      'Research OAuth providers',
    ]);
    expect(stdout).toContain('Research task created');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:jest test/commands/research/create.test.ts`  
Expected: FAIL with "command not found"

**Step 3: Write minimal implementation**

```typescript
// src/cli/commands/research/create.ts
import { Command, Flags } from '@oclif/core';
import { ResearchCoordinator } from '../../workflows/researchCoordinator.js';

export default class ResearchCreate extends Command {
  static description = 'Create a research task for a feature';

  static flags = {
    feature: Flags.string({ char: 'f', description: 'Feature ID', required: true }),
    objective: Flags.string({ char: 'o', description: 'Research objective', required: true }),
    priority: Flags.string({
      char: 'p',
      description: 'Priority (low|medium|high)',
      default: 'medium',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchCreate);
    const coordinator = new ResearchCoordinator();

    const task = await coordinator.createTask({
      featureId: flags.feature,
      objective: flags.objective,
      priority: flags.priority as 'low' | 'medium' | 'high',
    });

    this.log(`Research task created: ${task.id}`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:jest test/commands/research/create.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/research/create.ts test/commands/research/create.test.ts
git commit -m "feat(cli): add research create command"
```

---

### Task 4: Implement `ai-feature context summarize`

**Files:**

- Create: `src/cli/commands/context/summarize.ts`
- Modify: `src/workflows/contextSummarizer.ts:1-50` (expose CLI-friendly method)
- Test: `test/commands/context/summarize.test.ts`

**Step 1-5: Follow TDD pattern** (similar to above)

Key implementation points:

- Accept `--feature` flag for feature-specific context
- Support `--output` flag for file destination
- Respect `runtime.context_token_budget` from config

---

### Task 5: Implement `ai-feature rate-limits`

**Files:**

- Create: `src/cli/commands/rate-limits.ts`
- Modify: `src/telemetry/rateLimitReporter.ts:1-100` (add CLI-friendly formatting)
- Test: `test/commands/rate-limits.test.ts`

**Step 1-5: Follow TDD pattern**

Key implementation points:

- Show current rate limit status for GitHub, Linear, Agent providers
- Support `--provider` filter flag
- Support `--clear` to reset cooldowns (with confirmation)

---

## Phase 2: Test Coverage Expansion (1-2 weeks)

### Task 6: Add CLI Integration Tests

**Files:**

- Create: `test/commands/init.test.ts` (expand existing)
- Create: `test/commands/start.test.ts`
- Create: `test/commands/status.test.ts`
- Create: `test/commands/approve.test.ts`
- Create: `test/commands/plan.test.ts`
- Create: `test/commands/resume.test.ts`
- Create: `test/commands/validate.test.ts`
- Create: `test/commands/doctor.test.ts`

**Coverage Goal:** 100% of existing CLI commands tested

**Step 1: Write comprehensive test suite for each command**

```typescript
// Example: test/commands/start.test.ts
describe('start', () => {
  it('starts feature from prompt', async () => {
    const { stdout } = await runCommand(['start', '--prompt', 'Add auth']);
    expect(stdout).toContain('Feature created');
  });

  it('starts feature from Linear issue', async () => {
    const { stdout } = await runCommand(['start', '--linear', 'ISSUE-123']);
    expect(stdout).toContain('Feature created');
  });

  it('validates before starting', async () => {
    await expect(runCommand(['start'])).rejects.toThrow('prompt, linear, or spec required');
  });
});
```

**Step 2: Run all tests**

Run: `npm run test:jest`  
Expected: All CLI commands have passing integration tests

**Step 3: Commit**

```bash
git add test/commands/*.test.ts
git commit -m "test(cli): add comprehensive integration tests for all commands"
```

---

### Task 7: Add Workflow Integration Tests

**Files:**

- Create: `tests/integration/prd_to_pr_flow.spec.ts`
- Create: `tests/integration/approval_gates.spec.ts`
- Create: `tests/integration/rate_limit_handling.spec.ts`

**Step 1-3: Write end-to-end flow tests** covering full pipeline

---

## Phase 3: Readiness Verification (1 week)

### Task 8: Execute Readiness Checklist

**Files:**

- Modify: `plan/readiness_checklist.md` (update status for each check)
- Create: `scripts/verify-readiness.sh` (automate verification)

**Step 1: Create automated verification script**

```bash
#!/bin/bash
# scripts/verify-readiness.sh

echo "Running readiness verification..."

# Runtime Environment
node --version | grep -q "v24" && echo "✅ Node.js v24+" || echo "❌ Node.js v24+"
git --version && echo "✅ git installed" || echo "❌ git installed"
npm --version && echo "✅ npm installed" || echo "❌ npm installed"

# Configuration Validity
npm run build && echo "✅ Build passes" || echo "❌ Build fails"
npm run lint && echo "✅ Lint passes" || echo "❌ Lint fails"
npm test && echo "✅ Tests pass" || echo "❌ Tests fail"

# (Add all 84 checks...)
```

**Step 2: Run verification script**

Run: `./scripts/verify-readiness.sh > plan/verification-results.txt`

**Step 3: Update checklist with results**

Update each check status in `plan/readiness_checklist.md` based on script output

**Step 4: Commit**

```bash
git add plan/readiness_checklist.md scripts/verify-readiness.sh plan/verification-results.txt
git commit -m "docs(readiness): complete verification of 84 readiness checks"
```

---

### Task 9: Resolve Documentation Drift

**Files:**

- Review: All `docs/**/*.md` files
- Remove or mark as "planned": References to unimplemented commands

**Step 1: Search for non-existent command references**

Run: `grep -r "ai-feature deploy" docs/ | wc -l`  
Run: `grep -r "ai-feature export" docs/ | wc -l`

**Step 2: Update documentation**

For each unimplemented command:

- Add `(Planned for post-alpha)` marker
- OR move to `docs/future-features.md`
- OR implement the command (if critical)

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: resolve documentation drift for unimplemented commands"
```

---

## Phase 4: Alpha Release Artifacts (1 week)

### Task 10: Create Release Documentation

**Files:**

- Create: `CHANGELOG.md`
- Create: `docs/RELEASE_NOTES.md`
- Update: `README.md` (add alpha release notes)

**Step 1: Write CHANGELOG.md**

```markdown
# Changelog

## [0.1.0-alpha.1] - 2025-01-XX

### Added

- Complete CLI command surface (13 commands)
- Stateful execution with resumability
- GitHub and Linear integrations
- Approval workflow gates
- Rate limit handling
- Comprehensive telemetry

### Known Limitations

- Deployment automation planned for beta
- Export functionality planned for beta
- Limited test coverage in some edge cases

### Breaking Changes

- None (initial alpha release)
```

**Step 2: Write release notes**

**Step 3: Commit**

```bash
git add CHANGELOG.md docs/RELEASE_NOTES.md README.md
git commit -m "docs: add alpha release documentation"
```

---

### Task 11: Create Alpha Release Tag

**Files:**

- N/A (git operations only)

**Step 1: Ensure all tests pass**

Run: `npm test`  
Expected: All tests PASS

**Step 2: Build production bundle**

Run: `npm run build`  
Expected: Clean build with no errors

**Step 3: Create git tag**

```bash
git tag -a v0.1.0-alpha.1 -m "Alpha release 0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

**Step 4: Create GitHub release**

Run: `gh release create v0.1.0-alpha.1 --title "v0.1.0 Alpha 1" --notes-file docs/RELEASE_NOTES.md --prerelease`

---

## Success Criteria

- [ ] All 13 CLI commands implemented and tested
- [ ] 100% CLI integration test coverage
- [ ] 84/84 readiness checks passing
- [ ] Documentation drift resolved
- [ ] CHANGELOG and release notes created
- [ ] Alpha release tag created
- [ ] GitHub release published

---

## Rollback Plan

If alpha release reveals critical issues:

1. Document issues in GitHub Issues
2. Prioritize P0 blockers
3. Create hotfix branch: `hotfix/v0.1.0-alpha.2`
4. Fix critical issues
5. Release `v0.1.0-alpha.2` with fixes

---

## References

- Readiness Checklist: `plan/readiness_checklist.md`
- Milestone Notes: `plan/milestone_notes.md`
- Project Specification: `specification.md`
- Current Package Version: `package.json` (0.1.0)
