# GitHub Branch Protection API Reference

**Document Version:** 1.0.0
**Last Updated:** 2025-12-17
**GitHub API Version:** 2022-11-28
**Related Documents:** branch_protection_playbook.md, validation_playbook.md

---

## Table of Contents

1. [Overview](#overview)
2. [API Endpoints](#api-endpoints)
3. [Data Structures](#data-structures)
4. [Authentication & Headers](#authentication--headers)
5. [Rate Limiting](#rate-limiting)
6. [Error Handling](#error-handling)
7. [Examples](#examples)
8. [Integration Patterns](#integration-patterns)

---

## Overview

This document provides technical reference for integrating with GitHub's Branch Protection API. The system uses these endpoints to detect protection rules, validate compliance, and surface deployment blockers.

### API Documentation

- **Official Docs**: https://docs.github.com/en/rest/branches/branch-protection
- **Status Checks**: https://docs.github.com/en/rest/commits/statuses
- **Check Runs**: https://docs.github.com/en/rest/checks/runs
- **Pull Request Reviews**: https://docs.github.com/en/rest/pulls/reviews

---

## API Endpoints

### Get Branch Protection

Fetches protection rules for a specific branch.

**Endpoint:**
```
GET /repos/{owner}/{repo}/branches/{branch}/protection
```

**Parameters:**
- `owner` (string, required): Repository owner (organization or user)
- `branch` (string, required): Branch name (e.g., "main", "develop")
- `repo` (string, required): Repository name

**Required Headers:**
```
Accept: application/vnd.github+json
Authorization: Bearer {token}
X-GitHub-Api-Version: 2022-11-28
```

**Response (200 OK):**
```json
{
  "url": "https://api.github.com/repos/owner/repo/branches/main/protection",
  "required_status_checks": {
    "url": "https://api.github.com/repos/owner/repo/branches/main/protection/required_status_checks",
    "strict": true,
    "contexts": [
      "ci/build",
      "test/unit",
      "security/scan"
    ],
    "checks": [
      {
        "context": "ci/build",
        "app_id": 12345
      }
    ],
    "contexts_url": "https://api.github.com/repos/owner/repo/branches/main/protection/required_status_checks/contexts"
  },
  "required_pull_request_reviews": {
    "url": "https://api.github.com/repos/owner/repo/branches/main/protection/required_pull_request_reviews",
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 2,
    "require_last_push_approval": false,
    "dismissal_restrictions": {
      "users": [],
      "teams": [],
      "apps": []
    }
  },
  "enforce_admins": {
    "url": "https://api.github.com/repos/owner/repo/branches/main/protection/enforce_admins",
    "enabled": true
  },
  "required_linear_history": {
    "enabled": false
  },
  "allow_force_pushes": {
    "enabled": false
  },
  "allow_deletions": {
    "enabled": false
  },
  "block_creations": {
    "enabled": false
  },
  "required_conversation_resolution": {
    "enabled": true
  },
  "lock_branch": {
    "enabled": false
  },
  "allow_fork_syncing": {
    "enabled": true
  }
}
```

**Response (404 Not Found):**
```json
{
  "message": "Branch not protected",
  "documentation_url": "https://docs.github.com/rest/branches/branch-protection#get-branch-protection"
}
```

**Interpretation:**
- 200 response → Branch is protected, parse rules
- 404 response → Branch is not protected, allow unrestricted merge

---

### Get Commit Statuses

Fetches commit statuses (legacy status API) for a specific commit.

**Endpoint:**
```
GET /repos/{owner}/{repo}/commits/{ref}/statuses
```

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `ref` (string, required): Commit SHA or branch name

**Response (200 OK):**
```json
[
  {
    "url": "https://api.github.com/repos/owner/repo/statuses/abc123",
    "id": 987654321,
    "node_id": "MDY6U3RhdHVzOTg3NjU0MzIx",
    "state": "success",
    "description": "Build finished successfully",
    "target_url": "https://ci.example.com/builds/123",
    "context": "ci/build",
    "created_at": "2025-12-17T10:00:00Z",
    "updated_at": "2025-12-17T10:05:00Z"
  },
  {
    "state": "failure",
    "description": "Security vulnerabilities detected",
    "context": "security/scan",
    "created_at": "2025-12-17T10:02:00Z",
    "updated_at": "2025-12-17T10:06:00Z"
  }
]
```

**Status States:**
- `pending`: Check in progress
- `success`: Check passed
- `failure`: Check failed
- `error`: Check encountered error

---

### Get Check Runs

Fetches check runs (newer checks API) for a specific commit.

**Endpoint:**
```
GET /repos/{owner}/{repo}/commits/{ref}/check-runs
```

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `ref` (string, required): Commit SHA

**Response (200 OK):**
```json
{
  "total_count": 2,
  "check_runs": [
    {
      "id": 123456789,
      "head_sha": "abc123def456",
      "node_id": "MDg6Q2hlY2tSdW4xMjM0NTY3ODk=",
      "external_id": "build-789",
      "url": "https://api.github.com/repos/owner/repo/check-runs/123456789",
      "html_url": "https://github.com/owner/repo/runs/123456789",
      "details_url": "https://ci.example.com/builds/789",
      "status": "completed",
      "conclusion": "success",
      "started_at": "2025-12-17T10:00:00Z",
      "completed_at": "2025-12-17T10:05:00Z",
      "name": "ci/build",
      "check_suite": {
        "id": 456789123
      },
      "app": {
        "id": 12345,
        "slug": "github-actions",
        "name": "GitHub Actions"
      },
      "pull_requests": []
    }
  ]
}
```

**Check Status:**
- `queued`: Check queued
- `in_progress`: Check running
- `completed`: Check finished (see `conclusion`)

**Check Conclusion:**
- `success`: Check passed
- `failure`: Check failed
- `neutral`: Check completed without pass/fail
- `cancelled`: Check cancelled
- `skipped`: Check skipped
- `timed_out`: Check exceeded timeout
- `action_required`: Manual action needed

---

### Get Pull Request Reviews

Fetches all reviews for a pull request.

**Endpoint:**
```
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `pull_number` (integer, required): Pull request number

**Response (200 OK):**
```json
[
  {
    "id": 987654321,
    "node_id": "PRR_kwDOBw5R4s5M0...",
    "user": {
      "login": "reviewer1",
      "id": 12345,
      "avatar_url": "https://avatars.githubusercontent.com/u/12345",
      "type": "User"
    },
    "body": "Looks good to me!",
    "state": "APPROVED",
    "html_url": "https://github.com/owner/repo/pull/123#pullrequestreview-987654321",
    "pull_request_url": "https://api.github.com/repos/owner/repo/pulls/123",
    "submitted_at": "2025-12-17T10:00:00Z",
    "commit_id": "abc123def456",
    "author_association": "MEMBER"
  },
  {
    "id": 987654322,
    "user": {
      "login": "reviewer2",
      "id": 67890
    },
    "state": "CHANGES_REQUESTED",
    "submitted_at": "2025-12-17T09:00:00Z",
    "commit_id": "old123commit"
  }
]
```

**Review States:**
- `APPROVED`: Reviewer approved changes
- `CHANGES_REQUESTED`: Reviewer requested changes
- `COMMENTED`: Reviewer left comments without approval/rejection
- `DISMISSED`: Review was dismissed (invalidated)

**Important Notes:**
- Reviews are per-commit (`commit_id` field)
- If `dismiss_stale_reviews: true`, reviews on old commits are invalid
- Only count most recent review per reviewer

---

### Compare Commits

Compares two commits to determine if head is up-to-date with base.

**Endpoint:**
```
GET /repos/{owner}/{repo}/compare/{base}...{head}
```

**Parameters:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `base` (string, required): Base commit SHA or branch
- `head` (string, required): Head commit SHA or branch

**Response (200 OK):**
```json
{
  "url": "https://api.github.com/repos/owner/repo/compare/main...feature-branch",
  "html_url": "https://github.com/owner/repo/compare/main...feature-branch",
  "permalink_url": "https://github.com/owner/repo/compare/owner:abc123...owner:def456",
  "diff_url": "https://github.com/owner/repo/compare/main...feature-branch.diff",
  "patch_url": "https://github.com/owner/repo/compare/main...feature-branch.patch",
  "base_commit": {
    "sha": "abc123def456",
    "commit": {
      "message": "Update README"
    }
  },
  "merge_base_commit": {
    "sha": "xyz789abc123"
  },
  "status": "ahead",
  "ahead_by": 5,
  "behind_by": 0,
  "total_commits": 5,
  "commits": []
}
```

**Status Values:**
- `ahead`: Head has commits not in base (normal for feature branches)
- `behind`: Head is missing commits from base (needs rebase)
- `diverged`: Head and base have diverged (needs merge or rebase)
- `identical`: Head and base are the same

**Up-to-Date Check:**
- Branch is up-to-date if `behind_by === 0`
- Branch is stale if `behind_by > 0`

---

## Data Structures

### RequiredStatusChecks

```typescript
{
  strict: boolean;           // Require branch to be up-to-date
  contexts: string[];        // Legacy status contexts (e.g., "ci/build")
  checks: Array<{            // Check runs (newer API)
    context: string;
    app_id: number;
  }>;
}
```

**Notes:**
- `strict: true` → Branch must be up-to-date before merge (no `behind_by`)
- `contexts` → Legacy commit statuses
- `checks` → Modern check runs (GitHub Actions, third-party apps)

---

### RequiredPullRequestReviews

```typescript
{
  dismiss_stale_reviews: boolean;              // Invalidate old reviews on new push
  require_code_owner_reviews: boolean;         // Require CODEOWNERS approval
  required_approving_review_count: number;     // Minimum approvals needed
  require_last_push_approval: boolean;         // Require approval after last push
  dismissal_restrictions: {                    // Who can dismiss reviews
    users: string[];
    teams: string[];
    apps: string[];
  };
}
```

---

## Authentication & Headers

### Required Headers

All requests MUST include:

```
Accept: application/vnd.github+json
Authorization: Bearer {token}
X-GitHub-Api-Version: 2022-11-28
```

**Why These Headers Matter:**
- `Accept`: Specifies GitHub API v3 JSON format
- `Authorization`: Authenticates request (personal access token or app token)
- `X-GitHub-Api-Version`: Pins API version for stability

### Token Scopes

The GitHub token MUST have the following scopes:

| Scope | Required For |
|-------|-------------|
| `repo` | Read branch protection, commit statuses, reviews |
| `read:org` | Access team-based restrictions (optional) |

**Generate Token:**
1. GitHub Settings → Developer Settings → Personal Access Tokens
2. Select `repo` scope
3. Copy token and store securely (e.g., environment variable)

---

## Rate Limiting

### GitHub Rate Limits

| Endpoint Type | Rate Limit | Reset Interval |
|---------------|------------|----------------|
| **Authenticated API** | 5,000 requests/hour | 1 hour |
| **Search API** | 30 requests/minute | 1 minute |
| **GraphQL API** | 5,000 points/hour | 1 hour |

### Rate Limit Headers

GitHub includes rate limit info in response headers:

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1702819200
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

### Rate Limit Handling

The `HttpClient` automatically:
- Records rate limit envelopes to run directory ledgers
- Implements exponential backoff on 429 responses
- Retries transient errors (503, network resets)

**Best Practices:**
- Cache branch protection results (TTL: 5 minutes)
- Batch status check queries when possible
- Use conditional requests (`If-None-Match` with ETags)

---

## Error Handling

### Error Taxonomy

| HTTP Status | Error Type | Meaning | Retry? |
|-------------|------------|---------|--------|
| **404** | `PERMANENT` | Branch not protected or resource not found | No |
| **401** | `HUMAN_ACTION_REQUIRED` | Invalid or expired token | No (request new token) |
| **403** | `HUMAN_ACTION_REQUIRED` | Insufficient permissions or rate limited | Check scopes or wait |
| **429** | `TRANSIENT` | Rate limit exceeded | Yes (with backoff) |
| **503** | `TRANSIENT` | GitHub service unavailable | Yes (with backoff) |
| **500/502** | `TRANSIENT` | GitHub server error | Yes (with backoff) |

### Error Response Format

```json
{
  "message": "Not Found",
  "documentation_url": "https://docs.github.com/rest/branches/branch-protection#get-branch-protection"
}
```

### Handling 404 on Branch Protection

A 404 response when fetching branch protection is **not an error**—it indicates the branch is unprotected.

**Correct Handling:**

```typescript
try {
  const protection = await adapter.getBranchProtection(branch);
  // protection = { ... rules ... }
} catch (error) {
  if (error.statusCode === 404) {
    // Branch not protected → compliant by default
    return { protected: false, compliant: true };
  }
  throw error; // Re-throw other errors
}
```

---

## Examples

### Example 1: Fetch Protection and Evaluate Compliance

```typescript
import { createBranchProtectionAdapter } from './adapters/github/branchProtection';

const adapter = createBranchProtectionAdapter({
  owner: 'acme-corp',
  repo: 'api-service',
  token: process.env.GITHUB_TOKEN!,
  runDir: '.ai-feature-pipeline/runs/feature-auth-123',
});

const compliance = await adapter.evaluateCompliance({
  branch: 'main',
  sha: 'abc123def456',
  base_sha: 'xyz789abc123',
  pull_number: 42,
});

console.log('Compliant:', compliance.compliant);
console.log('Blockers:', compliance.blockers);
```

---

### Example 2: Detect Missing Status Checks

```typescript
const protection = await adapter.getBranchProtection('main');

if (protection?.required_status_checks) {
  const requiredContexts = protection.required_status_checks.contexts;
  const actualStatuses = await adapter.getCommitStatuses('abc123');

  const passingContexts = new Set(
    actualStatuses
      .filter(s => s.state === 'success')
      .map(s => s.context)
  );

  const missingChecks = requiredContexts.filter(
    ctx => !passingContexts.has(ctx)
  );

  if (missingChecks.length > 0) {
    console.error('Missing checks:', missingChecks);
  }
}
```

---

### Example 3: Count Approving Reviews

```typescript
const reviews = await adapter.getPullRequestReviews(42);

// Group by user ID, keep most recent review per user
const latestReviews = new Map();
for (const review of reviews) {
  const existing = latestReviews.get(review.user.id);
  if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
    latestReviews.set(review.user.id, review);
  }
}

const approvedCount = Array.from(latestReviews.values())
  .filter(r => r.state === 'APPROVED')
  .length;

console.log('Approved reviews:', approvedCount);
```

---

## Integration Patterns

### Pattern 1: Periodic Protection Refresh

Refresh branch protection report on:
- PR creation
- Pre-deployment checks
- Manual `ai-feature status` invocation

**Implementation:**

```typescript
import { persistReport, loadReport, generateReport } from './workflows/branchProtectionReporter';

// Check if cached report is stale (>5 minutes)
const cached = await loadReport(runDir);
const now = Date.now();
const cacheAge = cached ? now - new Date(cached.evaluated_at).getTime() : Infinity;

if (!cached || cacheAge > 5 * 60 * 1000) {
  // Refresh from GitHub API
  const compliance = await adapter.evaluateCompliance({ ... });
  const report = generateReport(featureId, compliance, metadata);
  await persistReport(runDir, report);
}
```

---

### Pattern 2: Pre-Merge Compliance Check

Block merge operations if branch protection requirements not met.

**Implementation:**

```typescript
import { canProceedWithDeployment } from './workflows/branchProtectionReporter';

const report = await loadReport(runDir);
if (!report) {
  throw new Error('Branch protection report not found. Run "ai-feature status" first.');
}

const { proceed, reason } = canProceedWithDeployment(report);

if (!proceed) {
  throw new Error(`Deployment blocked: ${reason}`);
}

// Proceed with merge
await adapter.mergePullRequest({ ... });
```

### Validation Mismatch Diagnostics

Each persisted `branch_protection.json` record now includes a `validation_mismatch` block, derived from ExecutionTask validation outputs (`validation/commands.json`). The CLI uses this section to highlight when GitHub requires checks that the pipeline never scheduled or when extra ExecutionTasks can be removed:

```json
"validation_mismatch": {
  "missing_in_registry": ["security/scan"],
  "extra_in_registry": ["validation/custom-lint"],
  "recommendations": [
    "Add validation commands for: security/scan",
    "Consider removing unnecessary validations: validation/custom-lint"
  ]
}
```

Operators should address these recommendations to keep ExecutionTask coverage aligned with branch protection rules and avoid unexpected deployment blockers.

---

### Pattern 3: Validation Registry Alignment

Compare GitHub required checks against validation registry.

**Implementation:**

```typescript
import { detectValidationMismatch } from './workflows/branchProtectionReporter';

const report = await loadReport(runDir);
const mismatch = await detectValidationMismatch(runDir, report.required_checks);

if (mismatch.missing_in_registry.length > 0) {
  console.warn('Missing validation commands:');
  mismatch.recommendations.forEach(rec => console.warn(`  - ${rec}`));
}
```

---

## Related Documentation

- **Branch Protection Playbook**: `docs/requirements/branch_protection_playbook.md`
- **Validation Playbook**: `docs/requirements/validation_playbook.md`
- **GitHub API Docs**: https://docs.github.com/en/rest/branches/branch-protection
- **FR-15**: Status Checks Mandate (specification.md)

---

## Changelog

### 1.0.0 (2025-12-17)

- Initial GitHub Branch Protection API reference
- Documented endpoints, data structures, and error handling
- Added integration patterns and examples
