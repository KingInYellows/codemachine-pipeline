# Deployment Playbook

**Document Version:** 1.0.0
**Last Updated:** 2025-12-18
**Related ADRs:** ADR-3 (Integration Layer), ADR-5 (Approval Workflow)
**Related FRs:** FR-15 (Status Checks), FR-16 (Deployment Automation)
**Related Task:** I5.T1 (Deployment Trigger Module)

---

## Table of Contents

1. [Overview](#overview)
2. [Deployment Strategies](#deployment-strategies)
3. [Prerequisites](#prerequisites)
4. [Automated Deployment Flows](#automated-deployment-flows)
5. [Manual Override Paths](#manual-override-paths)
6. [Blocker Resolution](#blocker-resolution)
7. [Deployment State Management](#deployment-state-management)
8. [Error Handling](#error-handling)
9. [Resume Scenarios](#resume-scenarios)
10. [Examples](#examples)

---

## Overview

The Deployment Trigger module orchestrates the final merge and deployment phase of the AI Feature Pipeline. It provides intelligent deployment automation that respects branch protection rules, validates merge readiness, and executes the appropriate deployment strategy based on configuration and repository state.

### Key Capabilities

- **Branch Protection Awareness**: Validates all GitHub branch protection requirements before attempting merge
- **Merge Readiness Assessment**: Comprehensive blocker detection across status checks, reviews, and branch state
- **Strategy Selection**: Automatically chooses between auto-merge, manual merge, or workflow dispatch
- **Audit Trail**: Complete deployment history with hashed references for compliance
- **Resume Support**: Blocked deployments can be retried after operators resolve blockers

### Design Principles

1. **Fail-Safe**: Never merge when branch protection requirements are unmet
2. **Observable**: All deployment attempts recorded in `deployment.json` for audit
3. **Deterministic**: Same inputs produce same strategy selection
4. **Resumable**: Blocked deployments can be retried without side effects

---

## Deployment Strategies

The deployment trigger supports four strategies, selected automatically based on configuration and repository state.

### 1. AUTO_MERGE

**When Used:**
- All merge readiness requirements satisfied
- `feature_flags.enable_auto_merge = true` in RepoConfig
- `governance.risk_controls.prevent_auto_merge = false`
- Branch protection allows auto-merge (`allows_auto_merge = true`)

**How It Works:**
1. Enables GitHub's auto-merge feature via GraphQL mutation
2. GitHub automatically merges PR when all required checks pass
3. Merge happens asynchronously - no need to poll
4. Deployment trigger returns immediately after enabling auto-merge

**Benefits:**
- Hands-off merge automation
- No polling required
- GitHub handles timing automatically
- Respects protection rules natively

**Limitations:**
- Requires repository auto-merge feature enabled
- Some protection rules may prevent auto-merge
- Cannot customize merge timing

**CLI Example:**
```bash
codepipe deploy --feature-id feature-auth-123
```

---

### 2. MANUAL_MERGE

**When Used:**
- Auto-merge disabled by feature flag or governance
- Branch protection disallows auto-merge
- Operator preference for direct control

**How It Works:**
1. Validates all merge readiness requirements
2. Directly merges PR via GitHub REST API (`PUT /pulls/:number/merge`)
3. Returns merge commit SHA immediately
4. Deployment completes synchronously

**Benefits:**
- Immediate merge execution
- Full control over merge timing
- Works when auto-merge not available
- Synchronous result

**Limitations:**
- Fails if checks/reviews incomplete
- No automatic retry on transient check failures
- Requires all protection rules satisfied at merge time

**CLI Example:**
```bash
codepipe deploy --feature-id feature-auth-123 --merge-method squash
```

---

### 3. WORKFLOW_DISPATCH

**When Used:**
- Custom deployment workflow configured in RepoConfig
- Workflow inputs provided via CLI options
- Deployment requires additional orchestration beyond merge

**How It Works:**
1. Validates merge readiness (optional - can skip with `--force`)
2. Triggers GitHub Actions workflow via workflow_dispatch event
3. Passes PR metadata and custom inputs to workflow
4. Workflow handles merge and/or deployment steps

**Benefits:**
- Supports complex deployment pipelines
- Can integrate with external systems
- Allows custom validation beyond branch protection
- Full workflow observability in GitHub Actions UI

**Limitations:**
- Requires workflow file in `.github/workflows/`
- Asynchronous - outcome determined by workflow
- More complex troubleshooting

**Configuration Example (RepoConfig):**
```json
{
  "deployment": {
    "workflow_dispatch": {
      "workflow_id": "deploy.yml",
      "inputs": {
        "environment": "production",
        "notify": "true"
      }
    }
  }
}
```

**CLI Example:**
```bash
codepipe deploy --feature-id feature-auth-123 \
  --workflow-inputs '{"environment":"staging","rollback_sha":"abc123"}'
```

---

### 4. BLOCKED

**When Used:**
- Merge readiness requirements not satisfied
- Blockers detected (failing checks, missing reviews, conflicts, etc.)
- `--force` flag not provided

**How It Works:**
1. Assesses merge readiness
2. Detects blockers with type classification
3. Returns detailed blocker report with recommended actions
4. Records blocked attempt in `deployment.json`
5. Exits with code 30 (human action required)

**Benefits:**
- Prevents premature merges
- Actionable blocker messages
- Audit trail of blocked attempts
- Resume-friendly (retry after fixes)

**Blocker Types:**
- `status_checks`: Required CI checks failing
- `reviews`: Insufficient approving reviews
- `branch_stale`: Branch behind base, needs rebase
- `conflicts`: Merge conflicts detected
- `draft`: PR in draft mode
- `closed`: PR not in open state
- `protection`: Branch protection violation

**CLI Example:**
```bash
$ codepipe deploy --feature-id feature-auth-123
❌ Deployment blocked

Blockers (2):
  1. [status_checks] 1 required status check(s) failing
     → Wait for the following checks to pass: ci/build
  2. [reviews] Insufficient approving reviews (0/2)
     → Request 2 more approving review(s) from authorized reviewers

Exit code: 30 (human action required)
```

---

## Prerequisites

Before triggering deployment, ensure:

### 1. PR Created
```bash
codepipe pr create --feature-id <feature-id>
```

PR metadata must exist in `<run-dir>/pr.json`.

### 2. Branch Protection Report (Recommended)
```bash
codepipe status --feature-id <feature-id>
```

Generates `<run-dir>/status/branch_protection.json` for detailed validation.

### 3. GitHub Token
```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
```

Token must have `repo` scope (and `workflow` if using workflow_dispatch).

### 4. Repository Configuration

**Minimum RepoConfig:**
```json
{
  "github": {
    "enabled": true,
    "token_env_var": "GITHUB_TOKEN"
  },
  "feature_flags": {
    "enable_deployment_triggers": true
  }
}
```

**With Auto-Merge:**
```json
{
  "feature_flags": {
    "enable_auto_merge": true,
    "enable_deployment_triggers": true
  },
  "governance": {
    "risk_controls": {
      "prevent_auto_merge": false
    }
  }
}
```

### 5. Deployment Approval

If governance requires deployment approvals (`governance.approval_workflow.require_approval_for_deploy = true`), ensure the deploy gate is approved before running `codepipe deploy`.

```bash
# Request deployment approval (records pending gate)
codepipe approve deploy --signer "approver@example.com" --comment "Ready for production"

# Verify approvals
codepipe status --feature-id <feature-id> --json | jq '.approvals'
```

The CLI will block deployment until the deploy gate is completed. Use `--force` only when your emergency procedures allow bypassing approvals.

---

## Automated Deployment Flows

### Flow 1: Auto-Merge (Recommended)

**Scenario:** All checks passing, auto-merge enabled

```bash
# Step 1: Ensure status report is fresh
codepipe status --feature-id feature-auth-123

# Step 2: Trigger deployment
codepipe deploy --feature-id feature-auth-123

# Output:
# ✓ Merge readiness assessed: eligible
# ✓ Strategy selected: AUTO_MERGE
# ✓ Auto-merge enabled on PR #42
# ✓ GitHub will merge automatically when checks pass
# Deployment outcome recorded: deployment.json
```

**Deployment.json:**
```json
{
  "schema_version": "1.0.0",
  "feature_id": "feature-auth-123",
  "outcomes": [
    {
      "timestamp": "2025-12-18T10:30:00Z",
      "strategy": "AUTO_MERGE",
      "action": "auto-merge",
      "success": true,
      "pr_number": 42,
      "head_sha": "abc123",
      "blockers": [],
      "metadata": {
        "pr_url": "https://github.com/acme/api/pull/42",
        "checks_passing": true,
        "reviews_satisfied": true,
        "branch_up_to_date": true
      }
    }
  ]
}
```

---

### Flow 2: Manual Merge

**Scenario:** Auto-merge disabled, immediate merge desired

```bash
codepipe deploy --feature-id feature-auth-123 --merge-method squash

# Output:
# ✓ Merge readiness assessed: eligible
# ✓ Strategy selected: MANUAL_MERGE
# ✓ PR #42 merged successfully
# Merge SHA: def456
# Deployment outcome recorded: deployment.json
```

---

### Flow 3: Workflow Dispatch

**Scenario:** Custom deployment workflow

```bash
codepipe deploy --feature-id feature-auth-123 \
  --workflow-inputs '{"environment":"production","notify_slack":"true"}'

# Output:
# ✓ Merge readiness assessed: eligible
# ✓ Strategy selected: WORKFLOW_DISPATCH
# ✓ Workflow 'deploy.yml' triggered on branch feature-auth-123
# Check workflow progress: https://github.com/acme/api/actions
# Deployment outcome recorded: deployment.json
```

---

## Manual Override Paths

### Override 1: Force Deployment (Admin Bypass)

**Use Case:** Administrator needs to merge despite blockers (emergency fix, hotfix)

```bash
codepipe deploy --feature-id feature-auth-123 --force

# ⚠️  WARNING: Forcing deployment despite blockers
# Blockers bypassed:
#   - [reviews] Insufficient approving reviews (0/2)
# ✓ Strategy selected: MANUAL_MERGE
# ✓ PR #42 merged successfully
```

**⚠️ Caution:**
- Bypasses all branch protection validation
- Use only in emergencies
- Audit trail records forced deployment
- May violate compliance policies

---

### Override 2: Dry Run (Assessment Only)

**Use Case:** Check deployment readiness without executing

```bash
codepipe deploy --feature-id feature-auth-123 --dry-run

# Deployment readiness assessment:
# ✓ PR state: open
# ✓ Status checks: passing (3/3)
# ✓ Reviews: satisfied (2/2)
# ✓ Branch: up-to-date
# Selected strategy: AUTO_MERGE
#
# Dry run mode - no action taken
```

---

### Override 3: Custom Merge Method

**Use Case:** Override default merge method

```bash
# Squash commits into single commit
codepipe deploy --feature-id feature-auth-123 --merge-method squash

# Rebase and fast-forward
codepipe deploy --feature-id feature-auth-123 --merge-method rebase
```

---

## Blocker Resolution

### Blocker: Failing Status Checks

**Symptom:**
```
❌ [status_checks] 2 required status check(s) failing
   → Wait for the following checks to pass: ci/build, security/scan
```

**Resolution:**
1. Check CI logs: `gh run list --branch <branch-name>`
2. Fix failing tests/lints in code
3. Push fixes to branch
4. Wait for checks to re-run
5. Retry deployment: `codepipe deploy --feature-id <feature-id>`

**Manual Investigation:**
```bash
# View check details
gh pr checks <pr-number>

# Re-run failed checks
gh run rerun <run-id>
```

---

### Blocker: Insufficient Reviews

**Symptom:**
```
❌ [reviews] Insufficient approving reviews (1/2)
   → Request 1 more approving review(s) from authorized reviewers
```

**Resolution:**
1. Request reviews: `gh pr review <pr-number> --request-reviewer @username`
2. Notify reviewers via Slack/email
3. Wait for approvals
4. Retry deployment: `codepipe deploy --feature-id <feature-id>`

**Bypass (if admin):**
```bash
# Force merge (emergency only)
codepipe deploy --feature-id <feature-id> --force
```

---

### Blocker: Branch Stale

**Symptom:**
```
❌ [branch_stale] Branch is not up-to-date with base branch
   → Update branch by merging or rebasing base branch
```

**Resolution:**
```bash
# Option 1: Update PR branch via GitHub UI
gh pr view <pr-number> --web
# Click "Update branch" button

# Option 2: Local rebase
git checkout <branch-name>
git fetch origin
git rebase origin/main
git push --force-with-lease

# Retry deployment
codepipe deploy --feature-id <feature-id>
```

---

### Blocker: Merge Conflicts

**Symptom:**
```
❌ [conflicts] PR has merge conflicts
   → Resolve merge conflicts by rebasing or merging base branch
```

**Resolution:**
```bash
# Resolve conflicts locally
git checkout <branch-name>
git merge origin/main

# Fix conflicts in editor
git add <resolved-files>
git commit

# Push resolution
git push

# Retry deployment
codepipe deploy --feature-id <feature-id>
```

---

### Blocker: Pending Approvals

**Symptom:**
```
❌ [approvals] 1 approval(s) pending: deploy
   → Collect required approvals with "codepipe approve <gate>" or rerun with --force when authorized
```

**Resolution:**
1. Identify pending gates: `codepipe status --feature-id <feature-id>`
2. Request or grant the necessary approval:
   ```bash
   codepipe approve deploy --signer "ops@example.com" \
     --comment "Deployment window confirmed"
   ```
3. Confirm that `deploy` moves from `pending` to `completed` in `manifest.json`
4. Retry deployment: `codepipe deploy --feature-id <feature-id>`

**Note:** `--force` bypasses approvals but should only be used for emergency remediation with documented sign-off.

---

## Deployment State Management

### State Persistence

All deployment attempts are recorded in `<run-dir>/deployment.json` with schema:

```json
{
  "schema_version": "1.0.0",
  "feature_id": "feature-auth-123",
  "outcomes": [
    {
      "timestamp": "2025-12-18T10:00:00Z",
      "strategy": "BLOCKED",
      "action": "none",
      "success": false,
      "pr_number": 42,
      "blockers": [
        {
          "type": "status_checks",
          "message": "1 required status check(s) failing",
          "recommended_action": "Wait for the following checks to pass: ci/build"
        }
      ],
      "metadata": {
        "checks_passing": false,
        "reviews_satisfied": true,
        "branch_up_to_date": true
      }
    },
    {
      "timestamp": "2025-12-18T10:30:00Z",
      "strategy": "AUTO_MERGE",
      "action": "auto-merge",
      "success": true,
      "pr_number": 42,
      "head_sha": "abc123",
      "blockers": [],
      "metadata": {
        "checks_passing": true,
        "reviews_satisfied": true,
        "branch_up_to_date": true
      }
    }
  ],
  "last_updated": "2025-12-18T10:30:00Z"
}
```

### Audit Trail Benefits

1. **Compliance**: Complete history of deployment attempts with timestamps
2. **Debugging**: Understand why previous deployments failed
3. **Resume Support**: Track blocker resolution progress
4. **Metrics**: Analyze deployment success rates and blocker frequency

---

## Error Handling

### Error Taxonomy

| Error Type | Exit Code | Meaning | Retry? |
|------------|-----------|---------|--------|
| `HUMAN_ACTION_REQUIRED` | 30 | Blockers prevent deployment | Yes (after resolution) |
| `VALIDATION_ERROR` | 10 | Invalid configuration or artifacts | No (fix config) |
| `UNEXPECTED_ERROR` | 1 | Unknown error | Maybe (check logs) |
| `SUCCESS` | 0 | Deployment successful | N/A |

### Rate Limit Handling

**Symptom:**
```
❌ GitHub API rate limit exceeded
Error type: TRANSIENT
```

**Automatic Recovery:**
- HttpClient implements exponential backoff
- Retries up to 3 times with jitter
- Rate limit headers recorded in ledger

**Manual Intervention:**
```bash
# Check rate limit status
gh api rate_limit

# Wait for reset (shown in X-RateLimit-Reset header)
# Or use different GitHub token
export GITHUB_TOKEN=ghp_alternative_token
```

---

### Missing PR Metadata

**Symptom:**
```
❌ PR metadata not found. Ensure PR has been created first
Error type: VALIDATION_ERROR
```

**Resolution:**
```bash
# Create PR first
codepipe pr create --feature-id <feature-id>

# Then retry deployment
codepipe deploy --feature-id <feature-id>
```

---

### GraphQL Node ID Missing (Auto-Merge)

**Symptom:**
```
❌ Failed to enable auto-merge: PR node_id not available
Error type: AUTO_MERGE_FAILED
```

**Cause:** Cached `pr.json` doesn't include `node_id` (required for GraphQL)

**Resolution:**
```bash
# Refresh PR metadata
codepipe status --feature-id <feature-id>

# Retry deployment
codepipe deploy --feature-id <feature-id>
```

---

## Resume Scenarios

### Scenario 1: Blocked → Checks Pass → Success

**Initial Attempt:**
```bash
$ codepipe deploy --feature-id feature-auth-123
❌ Deployment blocked
Blockers:
  1. [status_checks] 1 required status check(s) failing
Exit code: 30
```

**Resolution:**
- Fix failing test
- Push fix to branch
- CI re-runs and passes

**Resume:**
```bash
$ codepipe deploy --feature-id feature-auth-123
✓ Merge readiness assessed: eligible
✓ Strategy selected: AUTO_MERGE
✓ Auto-merge enabled on PR #42
```

**Deployment.json Result:**
```json
{
  "outcomes": [
    {
      "timestamp": "2025-12-18T10:00:00Z",
      "strategy": "BLOCKED",
      "success": false,
      "blockers": [...]
    },
    {
      "timestamp": "2025-12-18T10:30:00Z",
      "strategy": "AUTO_MERGE",
      "success": true,
      "blockers": []
    }
  ]
}
```

---

### Scenario 2: Auto-Merge Fails → Manual Merge Success

**Initial Attempt:**
```bash
$ codepipe deploy --feature-id feature-auth-123
✓ Strategy selected: AUTO_MERGE
❌ Failed to enable auto-merge: Repository auto-merge feature disabled
Exit code: 1
```

**Resolution:**
- Disable auto-merge in config
- Use manual merge instead

**Resume:**
```bash
# Update RepoConfig: set enable_auto_merge = false
$ codepipe deploy --feature-id feature-auth-123
✓ Strategy selected: MANUAL_MERGE
✓ PR #42 merged successfully
```

---

### Scenario 3: Multiple Blockers Resolved Incrementally

**Attempt 1:** Missing reviews + failing checks
```bash
❌ Blockers (2):
  1. [reviews] Insufficient approving reviews (0/2)
  2. [status_checks] 1 required status check(s) failing
```

**Attempt 2:** Reviews obtained, checks still failing
```bash
❌ Blockers (1):
  1. [status_checks] 1 required status check(s) failing
```

**Attempt 3:** All blockers resolved
```bash
✓ Auto-merge enabled on PR #42
```

---

## Examples

### Example 1: Standard Deployment with Auto-Merge

```bash
#!/bin/bash
set -e

FEATURE_ID="feature-auth-123"

# Step 1: Ensure PR created
codepipe pr create --feature-id "$FEATURE_ID"

# Step 2: Check status (generates branch protection report)
codepipe status --feature-id "$FEATURE_ID"

# Step 3: Trigger deployment
codepipe deploy --feature-id "$FEATURE_ID"

echo "✓ Deployment initiated"
```

---

### Example 2: CI/CD Pipeline Integration

```yaml
# .github/workflows/codepipe-deploy.yml
name: AI Feature Deploy

on:
  workflow_dispatch:
    inputs:
      feature_id:
        description: 'Feature ID to deploy'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install CLI
        run: npm install -g @codepipe/pipeline

      - name: Trigger Deployment
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          codepipe deploy \
            --feature-id "${{ github.event.inputs.feature_id }}" \
            --json > deployment-result.json

      - name: Upload Deployment Artifact
        uses: actions/upload-artifact@v4
        with:
          name: deployment-result
          path: deployment-result.json
```

---

### Example 3: Emergency Hotfix with Force

```bash
#!/bin/bash
# Emergency deployment script (use with caution)

FEATURE_ID="hotfix-security-patch"

# Deploy immediately, bypassing blockers
codepipe deploy \
  --feature-id "$FEATURE_ID" \
  --force \
  --merge-method squash

# Notify team
echo "⚠️  Emergency deployment completed"
echo "Review audit trail: .codepipe/runs/$FEATURE_ID/deployment.json"
```

---

## Related Documentation

- **Branch Protection Playbook**: `docs/requirements/branch_protection_playbook.md`
- **PR Automation Guide**: `docs/requirements/pr_automation.md`
- **Deployment State Diagram**: `docs/diagrams/deployment_resume_state.puml`
- **FR-15**: Status Checks Mandate (specification.md)
- **FR-16**: Deployment Automation (specification.md)
- **ADR-3**: Integration Layer Design
- **ADR-5**: Approval Workflow

---

## Changelog

### 1.0.0 (2025-12-18)

- Initial deployment playbook
- Documented all four deployment strategies
- Added blocker resolution procedures
- Included resume scenario examples
- Provided manual override paths
