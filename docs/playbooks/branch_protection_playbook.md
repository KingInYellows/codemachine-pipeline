# Branch Protection Intelligence Playbook

**Document Version:** 1.0.0
**Last Updated:** 2025-12-17
**Related ADRs:** ADR-2 (State Persistence), ADR-7 (Validation Auto-Fix Loop)
**Related FRs:** FR-15 (Status Checks), IR-5 (Branch Protection Awareness)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Branch Protection Rules](#branch-protection-rules)
4. [Status Checks](#status-checks)
5. [Review Requirements](#review-requirements)
6. [Deployment Readiness](#deployment-readiness)
7. [CLI Integration](#cli-integration)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## Overview

The Branch Protection Intelligence module provides comprehensive detection and reporting of GitHub branch protection rules, enabling deployment automation to make informed decisions about merge readiness. This system implements FR-15 (status checks mandate) and ensures that all merge operations respect repository protection policies.

### Key Features

- **Protection Detection**: Automatically fetch branch protection rules from GitHub API
- **Status Check Validation**: Verify required checks are passing before merge
- **Review Requirement Tracking**: Ensure sufficient approvals are obtained
- **Stale Commit Detection**: Identify when branches need rebasing
- **Auto-Merge Eligibility**: Determine if auto-merge can be safely enabled
- **CLI Integration**: Surface protection status in `codepipe status` and `codepipe deploy`

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│              Branch Protection Intelligence                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────┐            │
│  │  CLI Commands    │         │ Branch Protection│            │
│  │  status, deploy  │────────▶│     Adapter      │            │
│  └──────────────────┘         └──────────────────┘            │
│           │                            │                       │
│           │                            │                       │
│           ▼                            ▼                       │
│  ┌──────────────────────────────────────────────┐             │
│  │    Branch Protection Reporter                │             │
│  │  - Load/persist compliance reports           │             │
│  │  - Generate summaries                        │             │
│  │  - Detect validation mismatches              │             │
│  │  - Format output (JSON/human)                │             │
│  └──────────────────────────────────────────────┘             │
│           │                                                    │
│           ▼                                                    │
│  ┌──────────────────────────────────────────────┐             │
│  │         Run Directory Storage                │             │
│  │  status/                                     │             │
│  │    └── branch_protection.json                │             │
│  └──────────────────────────────────────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Detection**: CLI command triggers branch protection fetch via adapter
2. **Evaluation**: Adapter queries GitHub API for protection rules, statuses, reviews
3. **Compliance Check**: Reporter evaluates compliance against protection requirements
4. **Persistence**: Report saved to `status/branch_protection.json` in run directory
5. **Display**: CLI surfaces compliance status and blockers to user

---

## Branch Protection Rules

### Rule Types

GitHub branch protection supports several rule types:

| Rule Type                  | Purpose                         | Impact on Merge                       |
| -------------------------- | ------------------------------- | ------------------------------------- |
| **Required Status Checks** | Mandate CI/CD checks pass       | Blocks merge until checks succeed     |
| **Required Reviews**       | Require code review approvals   | Blocks merge until approvals obtained |
| **Enforce Admins**         | Apply rules to administrators   | Prevents admin bypass                 |
| **Restrictions**           | Limit who can push              | Controls contributor access           |
| **Force Push Prevention**  | Disable force pushes            | Protects history integrity            |
| **Linear History**         | Require merge commits or rebase | Enforces commit graph structure       |

### Fetching Protection Rules

The system uses the GitHub API endpoint:

```
GET /repos/{owner}/{repo}/branches/{branch}/protection
```

**Response Structure:**

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci/build", "test/unit", "security/scan"]
  },
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 2
  },
  "enforce_admins": {
    "enabled": true
  },
  "restrictions": null,
  "allow_force_pushes": {
    "enabled": false
  }
}
```

Every invocation of `codepipe status` refreshes `status/branch_protection.json` by calling the GitHub Branch Protection API, ensuring CLI and deployment flows always read current protection data without requiring manual refreshes.

### Unprotected Branches

If a branch is not protected (404 response), the system:

- Reports `protected: false`
- Sets `compliant: true` by default
- Allows merge to proceed without checks

---

## Status Checks

### Required vs Actual Checks

**Required Checks** are defined in branch protection rules (`contexts` array).

**Actual Checks** are fetched from:

1. Commit statuses: `GET /repos/{owner}/{repo}/commits/{sha}/statuses`
2. Check runs: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`

### Check States

| State     | Meaning                 | Blocks Merge? |
| --------- | ----------------------- | ------------- |
| `success` | Check passed            | No            |
| `pending` | Check in progress       | Yes           |
| `failure` | Check failed            | Yes           |
| `error`   | Check encountered error | Yes           |

### Validation Registry Alignment

The system compares GitHub required checks against the validation registry (`validation/commands.json`), which is generated from **ExecutionTask** validation outputs. This ensures the CLI can highlight when pipeline validations fail to cover GitHub-required checks or when unnecessary ExecutionTasks are still configured.

**Mismatch Detection:**

- **Missing in Registry**: GitHub requires checks not defined in validation config
- **Extra in Registry**: Validation commands defined but not required by GitHub

**Recommendations:**

- Add missing validation commands to align with branch protection
- Remove unnecessary validations to reduce CI overhead

**Example Mismatch Report:**

```json
{
  "missing_in_registry": ["security/scan", "performance/benchmark"],
  "extra_in_registry": ["validation/custom-lint"],
  "recommendations": [
    "Add validation commands for: security/scan, performance/benchmark",
    "Consider removing unnecessary validations: validation/custom-lint"
  ]
}
```

---

### Real-Time Head Commit Resolution

`codepipe status` refreshes branch protection data by loading the latest PR head/base references directly from GitHub before evaluating compliance. The persisted artifact therefore records:

- `branch`: Current PR head ref (e.g., `feature/payments-updates`)
- `sha`: Exact head commit SHA resolved at refresh time
- `base_sha`: Base branch ref used for comparison

By pinning to explicit SHAs the reporter avoids issues with feature branches that contain path separators (e.g., `feature/auth/login`), keeps check-run queries valid, and guarantees stale-commit detection works even if developers have not run `codepipe pr status` after pushing new commits.

---

## Review Requirements

### Review Counting

The system counts **approving reviews** from the most recent review per user:

1. Fetch all reviews: `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
2. Group by reviewer user ID
3. Keep only most recent review per user (by `submitted_at`)
4. Count reviews with `state: "APPROVED"`

### Review States

| State               | Counts Toward Approval? |
| ------------------- | ----------------------- |
| `APPROVED`          | Yes                     |
| `CHANGES_REQUESTED` | No (blocks merge)       |
| `COMMENTED`         | No (neutral)            |
| `DISMISSED`         | No (invalidated)        |

### Stale Review Dismissal

If `dismiss_stale_reviews: true`, new commits invalidate prior reviews. The system:

- Compares review `commit_id` against PR head SHA
- Marks reviews as stale if commit_id ≠ head SHA
- Requires fresh approvals after new pushes

---

## Deployment Readiness

### Compliance Evaluation

The system evaluates compliance across multiple dimensions:

```typescript
interface BranchProtectionCompliance {
  protected: boolean; // Branch has protection rules
  compliant: boolean; // All requirements satisfied
  checks_passing: boolean; // Required checks succeeded
  reviews_satisfied: boolean; // Sufficient approvals
  up_to_date: boolean; // Branch not behind base
  stale_commit: boolean; // Branch needs rebase
  allows_auto_merge: boolean; // Safe for auto-merge
  blockers: string[]; // Reasons for non-compliance
}
```

### Blocker Examples

| Blocker                                                  | Meaning                 | Resolution                 |
| -------------------------------------------------------- | ----------------------- | -------------------------- |
| `Required status check missing or failing: ci/build`     | Check not run or failed | Fix build errors, rerun CI |
| `Requires 2 approving review(s), has 1`                  | Insufficient approvals  | Request additional reviews |
| `Branch is 3 commit(s) behind base - must be up-to-date` | Stale branch            | Merge/rebase base branch   |

### Auto-Merge Eligibility

Auto-merge is considered safe when:

- Branch protection is enabled
- All compliance checks pass
- Force pushes are disabled (`allow_force_pushes: false`)

**Workflow:**

```bash
# Check if auto-merge is allowed
codepipe status --json | jq '.branch_protection.allows_auto_merge'

# Enable auto-merge if eligible
codepipe deploy --auto-merge
```

---

## CLI Integration

### `codepipe status`

Displays branch protection summary alongside other feature status:

**Human-Readable Output:**

```
Branch Protection Status:
  Protected: Yes
  Compliant: No

Blockers (2):
  1. Required status check missing or failing: security/scan
  2. Requires 2 approving review(s), has 1

Missing or Failing Checks:
  - security/scan

Validation Alignment:
  Missing ExecutionTask validations for: security/scan

Reviews:
  Required: 2
  Completed: 1
  Satisfied: No

Branch Status:
  Up-to-date: Yes
  Stale: No

Auto-merge:
  Allowed: No
  Enabled: No
```

**JSON Output:**

```bash
codepipe status --json
```

```json
{
  "feature_id": "feature-auth-123",
  "branch_protection": {
    "protected": true,
    "compliant": false,
    "blockers_count": 2,
    "blockers": [
      "Required status check missing or failing: security/scan",
      "Requires 2 approving review(s), has 1"
    ],
    "missing_checks": ["security/scan"],
    "reviews_status": {
      "required": 2,
      "completed": 1,
      "satisfied": false
    },
    "branch_status": {
      "up_to_date": true,
      "stale": false
    },
    "auto_merge": {
      "allowed": false,
      "enabled": false
    },
    "validation_mismatch": {
      "missing_in_registry": ["security/scan"],
      "extra_in_registry": [],
      "recommendations": ["Add validation commands for: security/scan"]
    }
  }
}
```

### `codepipe deploy`

Before deploying (merging), the command:

1. Loads branch protection report from `status/branch_protection.json`
2. Checks compliance
3. Blocks deployment if `compliant: false`
4. Surfaces actionable error messages

**Example Deployment Blocked:**

```
❌ Deployment blocked by branch protection requirements:

Required actions:
  1. Wait for 1 required check(s) to pass: security/scan
  2. Request 1 more approving review(s)

Run 'codepipe status' for detailed information.
```

### Recommended Actions

The system provides context-aware recommendations:

| Scenario                                 | Recommendation                                                        |
| ---------------------------------------- | --------------------------------------------------------------------- |
| All requirements met, auto-merge allowed | "Consider enabling auto-merge for automatic merging when checks pass" |
| Missing status checks                    | "Wait for required checks to pass: ci/build, security/scan"           |
| Insufficient reviews                     | "Request 1 more approving review(s)"                                  |
| Branch behind base                       | "Update branch with latest changes from base branch"                  |

---

## Troubleshooting

### Problem: "Branch protection rules not found"

**Cause:** Branch is not protected or API permissions insufficient.

**Solution:**

1. Verify branch name is correct
2. Check GitHub repository settings → Branches → Protection rules
3. Ensure API token has `repo` scope (read repository metadata)

---

### Problem: "Required check missing but CI passed"

**Cause:** Check context name mismatch between CI and branch protection.

**Solution:**

1. Run `codepipe status --json` and inspect `branch_protection.required_checks`
2. Compare against actual check names in GitHub PR checks tab
3. Update branch protection rules or CI workflow to align names

**Example:**

Branch protection expects: `ci/build`
CI workflow reports: `build`

Update workflow to use matching context:

```yaml
name: ci/build # Must match branch protection rule
```

---

### Problem: "Branch requires 2 reviews but only 1 shown"

**Cause:** Stale reviews dismissed or reviewer left organization.

**Solution:**

1. Check PR timeline for review dismissal events
2. Verify reviewers still have repository access
3. Request fresh reviews from active team members

---

### Problem: "Branch is behind base despite recent rebase"

**Cause:** SHA comparison detects commits in base not in head.

**Solution:**

1. Ensure rebase completed successfully (no conflicts)
2. Force push rebased branch if needed: `git push --force-with-lease`
3. Wait for GitHub to update commit comparison cache (~30 seconds)

---

### Problem: "Auto-merge not allowed despite compliance"

**Cause:** Force pushes are enabled in branch protection.

**Solution:**

1. Disable "Allow force pushes" in GitHub branch protection settings
2. Re-fetch branch protection: `codepipe status`
3. Verify `allows_auto_merge: true` in report

---

## Best Practices

### 1. Align Validation Registry with Branch Protection

**Recommended Workflow:**

```bash
# Initialize validation registry
codepipe validate --init

# Fetch branch protection
codepipe status --json > status.json

# Compare required checks
jq '.branch_protection.required_checks' status.json

# Update validation config to match
vi .codepipe/config.json
```

Ensure every required check has a corresponding validation command.

---

### 2. Use Strict Status Checks for Critical Branches

Enable `strict: true` for main/production branches to require up-to-date branches:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci/build", "test/unit"]
  }
}
```

This prevents merging stale branches that may conflict with recent changes.

---

### 3. Cache Branch Protection Reports

Branch protection rules change infrequently. Cache reports and refresh only when:

- Creating a new PR
- Deploying
- Branch protection settings change

**TTL Recommendation:** 5 minutes for active development, 1 hour for stable branches.

---

### 4. Monitor for Validation Mismatches

Regularly audit validation registry alignment:

```bash
codepipe status --verbose | grep "validation mismatch"
```

Address mismatches to avoid:

- Running unnecessary CI checks
- Missing required validations before merge

---

### 5. Enable Auto-Merge for Clean Workflows

When branch protection is correctly configured:

- Auto-merge eliminates manual merge step
- Ensures merge happens immediately after checks pass
- Reduces window for conflicts

**Setup:**

1. Configure branch protection with required checks
2. Disable force pushes
3. Enable auto-merge on PR creation:

```bash
codepipe pr create --auto-merge
```

---

### 6. Handle Stale Commits Proactively

If `strict: true` is enabled, rebase frequently:

```bash
# Before requesting final review
git fetch origin main
git rebase origin/main
git push --force-with-lease

# Verify up-to-date status
codepipe status
```

---

### 7. Document Custom Status Checks

If your repository uses custom status check contexts, document them:

```markdown
## Required Status Checks

- `ci/build`: Runs TypeScript build and linting
- `test/unit`: Executes Jest unit test suite
- `security/scan`: Runs npm audit and SAST analysis
- `performance/benchmark`: Validates performance regressions
```

Share this documentation with contributors to clarify validation requirements.

---

## Related Documentation

- **FR-15**: Status Checks Mandate (functional requirements)
- **IR-5**: Branch Protection Awareness (integration requirements)
- **Validation Playbook**: `docs/playbooks/validation_playbook.md`
- **GitHub Branch Protection Guide**: `docs/reference/github_branch_protection.md`
- **Deployment Module**: `.codemachine/artifacts/architecture/01_Blueprint_Foundation.md`

---

## Changelog

### 1.0.0 (2025-12-17)

- Initial branch protection playbook
- Documented protection rules, status checks, and reviews
- Added CLI integration examples
- Included troubleshooting guide and best practices
