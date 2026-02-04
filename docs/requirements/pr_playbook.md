# PR Automation Playbook

## Overview

This playbook documents the pull request automation workflow for the AI Feature Pipeline. PR automation ensures safe, auditable, and governed creation and management of pull requests, enforcing human-in-the-loop gates and respecting branch protection rules.

**Implements:**
- FR-15: PR automation
- Section 2: Communication Patterns (PR orchestration)
- Section 3.10.4: `codepipe pr` command flows
- ADR-3: Integration Layer design

---

## Table of Contents

1. [PR Creation Workflow](#pr-creation-workflow)
2. [PR Status Monitoring](#pr-status-monitoring)
3. [Reviewer Management](#reviewer-management)
4. [Auto-Merge Control](#auto-merge-control)
5. [Gating vs Auto-Merge](#gating-vs-auto-merge)
6. [Branch Protection Integration](#branch-protection-integration)
7. [Write Action Queue](#write-action-queue)
8. [Troubleshooting](#troubleshooting)
9. [Exit Codes](#exit-codes)

---

## PR Creation Workflow

### Prerequisites

Before creating a pull request, the following conditions must be met:

1. **Code Approval Gate Completed**: The "Code" gate must be approved in `approvals.json`
2. **Validations Passed**: Lint, test, and build validations must succeed
3. **Branch Exists**: Feature branch must exist locally and be pushed to remote
4. **GitHub Integration Enabled**: `config.github.enabled = true` in `.codepipe/config.json`
5. **GitHub Token Available**: `GITHUB_TOKEN` environment variable set with required scopes

### Command Usage

```bash
# Basic PR creation
codepipe pr create

# Create with reviewers
codepipe pr create --reviewers user1,user2,user3

# Create as draft
codepipe pr create --draft

# Specify custom title and body
codepipe pr create --title "feat: Add authentication" --body "Implements OAuth2 flow"

# Specify base branch (defaults to config.project.default_branch)
codepipe pr create --base develop

# JSON output for automation
codepipe pr create --json
```

### Workflow Steps

1. **Preflight Validation**:
   - Check if PR already exists (prevent duplicates)
   - Verify Code approval gate is completed
   - Ensure validations have passed
   - Confirm branch exists locally

2. **PR Creation**:
   - Call GitHub API: `POST /repos/{owner}/{repo}/pulls`
   - Use rate-limit aware HTTP client (obeys IR-7)
   - Capture PR number, URL, and metadata

3. **Reviewer Assignment** (if specified):
   - Queue reviewer request through WriteActionQueue
   - Call GitHub API: `POST /repos/{owner}/{repo}/pulls/{number}/requested_reviewers`
   - Log reviewer assignment to `approvals.json` for human-in-the-loop tracking

4. **Artifact Persistence**:
   - Write `pr.json` with PR metadata (atomic write)
   - Update `feature.json.external_links.github_pr_number`
   - Log PR creation event to `deployment.json`

5. **Output**:
   - Display PR URL and details
   - Provide next-step guidance

### Example Output

```
PR #42
URL: https://github.com/org/repo/pull/42
Branch: feature/add-auth
Base: main
Reviewers: alice, bob

Pull request created successfully. View at: https://github.com/org/repo/pull/42
```

### JSON Output Schema

```json
{
  "success": true,
  "pr_number": 42,
  "url": "https://github.com/org/repo/pull/42",
  "branch": "feature/add-auth",
  "base_branch": "main",
  "reviewers_requested": ["alice", "bob"],
  "message": "Pull request created successfully. View at: https://github.com/org/repo/pull/42"
}
```

---

## PR Status Monitoring

### Command Usage

```bash
# Check PR status
codepipe pr status

# Fail with exit code 1 if blockers present
codepipe pr status --fail-on-blockers

# JSON output
codepipe pr status --json
```

### Workflow Steps

1. **Load PR Metadata**: Read `pr.json` to get PR number
2. **Fetch Fresh Data**:
   - `GET /repos/{owner}/{repo}/pulls/{number}` - PR details
   - `GET /repos/{owner}/{repo}/commits/{sha}/check-suites` - Status checks
3. **Evaluate Merge Readiness**:
   - Check PR state (must be "open")
   - Verify not in draft mode
   - Confirm mergeable (no conflicts)
   - Validate status checks passed
   - Respect branch protection rules
4. **Update Artifacts**: Save fresh data to `pr.json`
5. **Output Status**: Display merge readiness and blockers

### Merge Readiness Checks

The `isPullRequestReadyToMerge` method evaluates:

- **PR State**: Must be "open" (not closed or merged)
- **Draft Mode**: Draft PRs are not ready to merge
- **Mergeable**: Must have no merge conflicts
- **Mergeable State**: GitHub's computed state (not "blocked")
- **Status Checks**: All required checks must pass
- **Reviews**: Required approvals present (if branch protection configured)

### Example Output

```
PR #42
URL: https://github.com/org/repo/pull/42
Branch: feature/add-auth
Base: main
Reviewers: alice, bob
Merge ready: ✗

Blockers:
  • PR is blocked by required status checks or reviews
  • 1 status check(s) failed

Status checks (3):
  ✓ lint (completed)
  ✓ test (completed)
  ✗ build (failed)
```

### Blocker Resolution

When blockers are detected:

1. **Status Check Failures**:
   - Review failing contexts in output
   - Fix underlying issues
   - Push new commits to trigger re-run
   - Use `codepipe pr status` to confirm resolution

2. **Required Reviews Missing**:
   - Request reviewers: `codepipe pr reviewers --add username`
   - Notify reviewers via external channels
   - Wait for approval

3. **Merge Conflicts**:
   - Rebase or merge base branch locally
   - Push resolved conflicts
   - Verify `mergeable` status changes to true

---

## Reviewer Management

### Command Usage

```bash
# Add reviewers
codepipe pr reviewers --add alice,bob,charlie

# JSON output
codepipe pr reviewers --add alice --json
```

### Workflow Steps

1. **Load PR Metadata**: Read `pr.json`
2. **Parse Reviewers**: Split comma-separated list
3. **Queue Request**: Route through WriteActionQueue for rate-limit safety
4. **Call GitHub API**: `POST /repos/{owner}/{repo}/pulls/{number}/requested_reviewers`
5. **Update Metadata**:
   - Merge new reviewers with existing list (deduplicate)
   - Save to `pr.json`
6. **Log Action**: Record reviewer assignment to `deployment.json` for audit trail

### Example Output

```
PR #42
URL: https://github.com/org/repo/pull/42
Reviewers: alice, bob, charlie

Reviewers requested: alice, charlie
```

---

## Auto-Merge Control

### Why Auto-Merge May Be Disabled

Auto-merge is a powerful feature but carries risk. The pipeline supports disabling auto-merge to enforce manual merge control for:

- **Compliance Requirements**: Regulations requiring manual approval for production changes
- **High-Risk Changes**: Large PRs exceeding `governance.risk_controls.max_lines_changed_per_pr`
- **Branch Protection**: Repositories with strict review requirements
- **Manual Testing**: Changes requiring manual QA verification before merge

### Command Usage

```bash
# Disable auto-merge
codepipe pr disable-auto-merge

# Provide reason (logged to deployment.json)
codepipe pr disable-auto-merge --reason "Manual merge required for SOC2 compliance"

# JSON output
codepipe pr disable-auto-merge --json
```

### Workflow Steps

1. **Load PR Metadata**: Read `pr.json`
2. **Check Current State**: Skip if auto-merge already disabled
3. **Call GitHub API**: `POST /graphql` with `disablePullRequestAutoMerge` mutation
4. **Update Metadata**: Set `auto_merge_enabled: false` in `pr.json`
5. **Log Governance Note**: Record reason to `deployment.json` for audit

### Example Output

```
PR #42
URL: https://github.com/org/repo/pull/42
Auto-merge: disabled
Reason: Manual merge required for SOC2 compliance

Auto-merge disabled successfully
```

---

## Gating vs Auto-Merge

### Approval Gates

Approval gates enforce **human-in-the-loop decision points** before code progression:

- **Code Gate**: Required before PR creation (validates generated code quality)
- **PR Gate**: Required before merge to target branch (validates CI/CD results)

**Key Characteristic**: Gates are **synchronous blockers** - the pipeline pauses until approval is granted.

**Configuration**: `governance.approval_workflow.require_approval_for_code` and `require_approval_for_pr`

### Auto-Merge

Auto-merge is a **conditional automation** feature:

- **Purpose**: Automatically merge PR when all required checks pass
- **Conditions**:
  - All status checks pass
  - Required reviews approved
  - No merge conflicts
  - Branch protection rules satisfied
- **Safety**: Respects `governance.risk_controls.prevent_auto_merge` flag

**Key Characteristic**: Auto-merge is **asynchronous** - it waits for conditions to be met without blocking the pipeline.

**Configuration**: `feature_flags.enable_auto_merge` and `governance.risk_controls.prevent_auto_merge`

### Decision Matrix

| Scenario | Gates Required | Auto-Merge Allowed |
|----------|---------------|-------------------|
| Development environment | Code only | Yes (if configured) |
| Staging environment | Code + PR | Yes (if branch protection allows) |
| Production environment | Code + PR + Deploy | No (manual merge enforced) |
| High-risk changes | All gates | No (manual review required) |
| Low-risk changes | Code + PR | Yes (if validations pass) |

### Example: Production Deployment

For a production deployment with strict governance:

```json
{
  "governance": {
    "approval_workflow": {
      "require_approval_for_code": true,
      "require_approval_for_pr": true,
      "require_approval_for_deploy": true
    },
    "risk_controls": {
      "prevent_auto_merge": true,
      "require_branch_protection": true
    }
  },
  "feature_flags": {
    "enable_auto_merge": false
  }
}
```

**Workflow**:
1. Code generated → **Pause** for Code approval
2. `codepipe approve code --signer user@example.com`
3. PR created → CI/CD runs
4. **Pause** for PR approval after CI/CD passes
5. `codepipe approve pr --signer user@example.com`
6. **Manual merge** required (auto-merge disabled)
7. Merge completed → **Pause** for Deploy approval
8. `codepipe approve deploy --signer user@example.com`
9. Deployment triggered

---

## Branch Protection Integration

### Respecting Branch Protection Rules

The PR automation system respects GitHub branch protection settings:

- **Required Reviews**: Detected via `isPullRequestReadyToMerge` (surfaces as blocker)
- **Required Status Checks**: Evaluated via `getStatusChecks` (surfaces as blocker)
- **Enforce Admins**: Respected (no bypass logic)
- **Require Linear History**: Detected via `mergeable_state`

**Configuration**: `github.branch_protection.respect_required_reviews` and `respect_status_checks`

### Handling Branch Protection Blockers

When branch protection blocks merge:

1. **Blocker Detection**: `isPullRequestReadyToMerge` returns `{ready: false, reasons: [...]}`
2. **Surface to User**: `codepipe pr status` displays specific blockers
3. **Resolution Guidance**:
   - Request required reviews
   - Wait for status checks to pass
   - Address merge conflicts
4. **Retry**: `codepipe pr status` to confirm resolution
5. **Proceed**: Manual merge or auto-merge (if enabled)

### Example: Required Reviews Blocker

```
codepipe pr status

PR #42
Merge ready: ✗

Blockers:
  • PR is blocked by required status checks or reviews
  • 2 required review(s) not approved

Resolution:
  • Request reviewers: codepipe pr reviewers --add reviewer1,reviewer2
  • Wait for approvals
  • Re-check status: codepipe pr status
```

---

## Write Action Queue

### Purpose

The Write Action Queue serializes all GitHub write operations (PR comments, reviewer requests, label changes, auto-merge toggles) to prevent GitHub from flagging abuse patterns.

**Implements**: Section 2 (Communication Patterns - Write Action Queue)

### How It Works

1. **Queuing**: All write operations route through shared queue
2. **Serialization**: Actions execute one at a time with configurable delays
3. **Rate-Limit Monitoring**: Queue observes GitHub rate-limit headers
4. **Backpressure**: Queue throttles requests when limits approach
5. **Persistence**: Queue state saved to disk for crash recovery
6. **Observability**: Backlog metrics exported to Prometheus

### Future Integration (I4.T7)

Currently, PR commands call GitHub adapter directly. Future work will:

- Route reviewer requests through WriteActionQueue
- Queue PR comments for deployment summaries
- Serialize label additions/removals
- Implement queue draining on `codepipe resume`

**Design Principle**: Commands are designed to be queue-compatible (shared helper instead of direct adapter calls).

---

## Troubleshooting

### Error: "Code approval gate is required before creating PR"

**Symptom**: PR creation fails with exit code 30

**Cause**: Code approval gate not completed

**Resolution**:
```bash
# Review generated code
cat .codepipe/runs/<feature-id>/code/**/*.ts

# Approve code gate
codepipe approve code --signer "your-email@example.com"

# Retry PR creation
codepipe pr create
```

---

### Error: "Validations (lint/test/build) must pass before creating PR"

**Symptom**: PR creation fails with exit code 30

**Cause**: `validation.json` indicates failures

**Resolution**:
```bash
# Run validations
codepipe validate

# Fix failing validations
# (e.g., fix lint errors, broken tests)

# Re-run validations
codepipe validate

# Retry PR creation
codepipe pr create
```

---

### Error: "No pull request found for this feature"

**Symptom**: `codepipe pr status` or `codepipe pr reviewers` fails with exit code 10

**Cause**: `pr.json` doesn't exist (PR not created yet)

**Resolution**:
```bash
# Create PR first
codepipe pr create

# Then retry status/reviewers command
codepipe pr status
```

---

### Error: "PR already exists: #42"

**Symptom**: `codepipe pr create` fails with exit code 10

**Cause**: `pr.json` already exists with PR number

**Resolution**:
- PR already created, no action needed
- View PR: `codepipe pr status`
- If you need to recreate PR, delete `pr.json` and close/delete PR on GitHub first (manual operation)

---

### Warning: "Auto-merge already disabled"

**Symptom**: `codepipe pr disable-auto-merge` exits successfully but shows warning

**Cause**: `pr.json` shows `auto_merge_enabled: false`

**Resolution**: No action needed, auto-merge is already disabled

---

## Exit Codes

All PR commands use standardized exit codes:

| Exit Code | Meaning | Description | Remediation |
|-----------|---------|-------------|-------------|
| `0` | Success | Command completed successfully | None |
| `1` | General Error | Unexpected error during execution | Check logs; contact support if persistent |
| `10` | Validation Error | Invalid inputs, feature not found, or PR state invalid | Review error message; validate inputs |
| `30` | Human Action Required | Approvals missing, validations failed, or blockers present | Complete required approvals or fix blockers |

**Special Case**: `codepipe pr status --fail-on-blockers` exits with code `1` if blockers are present (instead of `0`).

---

## Related Documentation

- [PR Automation Sequence Diagram](../diagrams/pr_automation_sequence.mmd) - Visual workflow
- [GitHub Endpoints Reference](./github_endpoints.md) - API specifications
- [Approval Playbook](../ops/approval_playbook.md) - Governance workflow
- [ADR-3: Integration Layer](../adr/003-integration-layer.md) - Design decisions

---

## Quick Reference

### Create PR
```bash
codepipe pr create [--reviewers user1,user2] [--draft]
```

### Check Status
```bash
codepipe pr status [--fail-on-blockers]
```

### Request Reviewers
```bash
codepipe pr reviewers --add user1,user2
```

### Disable Auto-Merge
```bash
codepipe pr disable-auto-merge [--reason "<text>"]
```

### JSON Output (All Commands)
```bash
codepipe pr <command> --json
```

---

**End of PR Automation Playbook**
