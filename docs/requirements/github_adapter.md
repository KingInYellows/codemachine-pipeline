# GitHub Adapter

**Version:** 1.0.0
**Last Updated:** 2025-12-17

This document describes the GitHub adapter implementation, which provides integration with GitHub's REST API for repository operations, pull request management, and deployment automation.

## Overview

The GitHub adapter encapsulates all GitHub API interactions behind a typed interface, implementing:

- Repository metadata retrieval
- Branch creation and management
- Pull request creation and review requests
- Status check introspection
- Merge operations with safety checks
- GitHub Actions workflow dispatch
- Auto-merge enablement via GraphQL

**Key Features:**
- Rate-limit aware HTTP calls with automatic retries
- Required GitHub headers (`Accept`, `X-GitHub-Api-Version`)
- Error taxonomy (transient, permanent, human action required)
- Structured logging for observability
- OpenAPI specification for future remote endpoints

## Architecture

```
┌──────────────────────────────────────────┐
│     Orchestration Layer (CLI/Core)      │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│         GitHubAdapter                    │
│  - Authentication                        │
│  - Operation Methods                     │
│  - Error Handling                        │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│         HttpClient                       │
│  - Header Injection                      │
│  - Retry Logic                           │
│  - Rate Limit Tracking                   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│       GitHub REST API v3                 │
│   https://api.github.com                 │
└──────────────────────────────────────────┘
```

## Authentication

The adapter supports two authentication methods:

### 1. Personal Access Token (PAT)

**Recommended Scopes:**
- `repo` - Full repository access
- `workflow` - GitHub Actions workflow dispatch

**Configuration:**
```typescript
const adapter = new GitHubAdapter({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN,
});
```

**Environment Variable:**
```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 2. GitHub App Token

For organization-wide deployments, use GitHub App installation tokens:

```typescript
const adapter = new GitHubAdapter({
  owner: 'my-org',
  repo: 'my-repo',
  token: installationToken, // Obtained via GitHub App authentication flow
});
```

**Required Permissions:**
- Contents: Read and write
- Pull requests: Read and write
- Workflows: Read and write
- Metadata: Read-only

## API Headers

All GitHub API calls include the following headers (automatically injected by `HttpClient`):

| Header | Value | Purpose |
|--------|-------|---------|
| `Accept` | `application/vnd.github+json` | GitHub API v3 media type |
| `X-GitHub-Api-Version` | `2022-11-28` | API version pinning for deterministic behavior |
| `Authorization` | `Bearer <token>` | Authentication token |
| `X-Request-ID` | `req_<hex>` | Request tracing ID |
| `Idempotency-Key` | `idem_<hex>` | Idempotency key for POST/PUT/PATCH requests |

## Rate Limiting

The GitHub adapter integrates with the `HttpClient` rate limit tracking:

### Primary Rate Limit
- **Limit:** 5,000 requests/hour (authenticated users)
- **Headers:** `x-ratelimit-remaining`, `x-ratelimit-reset`
- **Cooldown Threshold:** 10 requests remaining
- **Behavior:** Log warning, continue processing

### Secondary Abuse Detection
- **Trigger:** 3 consecutive HTTP 429 responses
- **Behavior:** Log critical error, suggest manual cooldown clearing

### Retry Logic
- **Transient Errors:** 429, 503, 502, 504, network failures
- **Max Retries:** 3 (configurable)
- **Backoff:** Exponential with jitter (1s → 2s → 4s)
- **Retry-After:** Respects `retry-after` header when present

See `docs/ops/rate_limit_reference.md` for detailed rate limit behavior.

## Operations

### Repository Operations

#### Get Repository Metadata

Fetches repository information including default branch, visibility, and URLs.

```typescript
const repoInfo = await adapter.getRepository();
console.log(repoInfo.default_branch); // "main"
console.log(repoInfo.private); // true
```

**Returns:** `RepositoryInfo`

**Errors:**
- `404` - Repository not found (permanent)
- `401` - Authentication failed (human action required)
- `403` - Insufficient permissions (human action required)

**GitHub Endpoint:** `GET /repos/{owner}/{repo}`

### Branch Operations

#### Create Branch

Creates a new branch from a specific commit SHA.

```typescript
const branch = await adapter.createBranch({
  branch: 'feature/new-api',
  sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
});
console.log(branch.ref); // "refs/heads/feature/new-api"
```

**Parameters:**
- `branch` - Branch name (without `refs/heads/` prefix)
- `sha` - Commit SHA to branch from

**Returns:** `GitReference`

**Errors:**
- `422` - Branch already exists (permanent)
- `404` - Repository or commit not found (permanent)

**GitHub Endpoint:** `POST /repos/{owner}/{repo}/git/refs`

#### Get Branch Reference

Retrieves the current state of a branch.

```typescript
const branchRef = await adapter.getBranch('main');
console.log(branchRef.object.sha); // Current commit SHA
```

**GitHub Endpoint:** `GET /repos/{owner}/{repo}/git/ref/heads/{branch}`

### Pull Request Operations

#### Create Pull Request

Creates a new pull request.

```typescript
const pr = await adapter.createPullRequest({
  title: 'Add new feature',
  body: 'This PR implements the new API endpoints.',
  head: 'feature/new-api',
  base: 'main',
  draft: false,
});
console.log(pr.html_url); // "https://github.com/org/repo/pull/42"
```

**Parameters:**
- `title` - PR title (required)
- `body` - PR description (required)
- `head` - Source branch name (required)
- `base` - Target branch name (required)
- `draft` - Whether PR is a draft (optional, default: false)
- `maintainer_can_modify` - Allow maintainer edits (optional, default: true)

**Returns:** `PullRequest`

**Errors:**
- `422` - Validation failed (e.g., head branch doesn't exist, no commits between head and base)
- `404` - Repository not found

**GitHub Endpoint:** `POST /repos/{owner}/{repo}/pulls`

#### Get Pull Request

Fetches details of an existing pull request.

```typescript
const pr = await adapter.getPullRequest(42);
console.log(pr.state); // "open"
console.log(pr.mergeable); // true
```

**GitHub Endpoint:** `GET /repos/{owner}/{repo}/pulls/{pull_number}`

### Review Operations

#### Request Reviewers

Requests specific users or teams to review a pull request.

```typescript
await adapter.requestReviewers({
  pull_number: 42,
  reviewers: ['octocat', 'hubot'],
  team_reviewers: ['team-alpha'],
});
```

**Parameters:**
- `pull_number` - PR number (required)
- `reviewers` - Array of reviewer usernames (optional)
- `team_reviewers` - Array of team slugs (optional)

**Returns:** `PullRequest` (updated PR object)

**Errors:**
- `422` - Reviewer not found or cannot be assigned
- `404` - Pull request not found

**GitHub Endpoint:** `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`

### Status Check Operations

#### Get Status Checks

Retrieves status checks for a specific commit.

```typescript
const checks = await adapter.getStatusChecks('aa218f56...');
for (const check of checks) {
  console.log(check.status); // "completed"
  console.log(check.conclusion); // "success"
}
```

**Returns:** `StatusCheck[]`

**GitHub Endpoint:** `GET /repos/{owner}/{repo}/commits/{sha}/check-suites`

#### Check Merge Readiness

Validates whether a pull request is ready to merge.

```typescript
const { ready, reasons } = await adapter.isPullRequestReadyToMerge(42);
if (!ready) {
  console.log('Cannot merge:', reasons);
  // ["PR is in draft mode", "2 status check(s) failed"]
}
```

**Checks:**
- PR state is `open`
- PR is not a draft
- PR is mergeable (no conflicts)
- Mergeable state is not `blocked`
- Status checks have passed

**Returns:** `{ ready: boolean, reasons: string[] }`

### Merge Operations

#### Merge Pull Request

Merges a pull request after validation.

```typescript
const result = await adapter.mergePullRequest({
  pull_number: 42,
  merge_method: 'squash',
  commit_title: 'feat: add new API endpoints',
  commit_message: 'This implements the new REST API endpoints per RFC-123.',
});
console.log(result.merged); // true
console.log(result.sha); // Merge commit SHA
```

**Parameters:**
- `pull_number` - PR number (required)
- `merge_method` - Merge strategy: `merge`, `squash`, `rebase` (optional, default: `merge`)
- `commit_title` - Merge commit title (optional)
- `commit_message` - Merge commit body (optional)
- `sha` - Required head SHA for safety (optional)

**Returns:** `MergeResult`

**Errors:**
- `405` - Pull request not mergeable (merge conflicts, failed checks, blocked)
- `404` - Pull request not found
- `409` - SHA mismatch (head changed since check)

**GitHub Endpoint:** `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`

#### Enable Auto-Merge

Enables auto-merge for a pull request using GraphQL mutation.

```typescript
await adapter.enableAutoMerge(42, 'SQUASH');
```

**Parameters:**
- `pull_number` - PR number (required)
- `merge_method` - Merge method: `MERGE`, `SQUASH`, `REBASE` (optional, default: `MERGE`)

**Note:** This uses the GraphQL API wrapped in REST-like envelope metadata for consistent logging.

**GitHub Endpoint:** `POST /graphql` (mutation: `enablePullRequestAutoMerge`)

### Workflow Operations

#### Trigger Workflow Dispatch

Triggers a GitHub Actions workflow run.

```typescript
await adapter.triggerWorkflow({
  workflow_id: 'deploy.yml',
  ref: 'main',
  inputs: {
    environment: 'production',
    version: 'v1.2.3',
  },
});
```

**Parameters:**
- `workflow_id` - Workflow filename or ID (required)
- `ref` - Branch, tag, or SHA to run workflow on (required)
- `inputs` - Workflow input parameters (optional)

**Errors:**
- `404` - Workflow not found
- `422` - Invalid inputs or ref

**GitHub Endpoint:** `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`

## Error Handling

The adapter classifies errors into three taxonomies:

### Transient Errors (Retryable)

**HTTP Status Codes:** 429, 503, 502, 504
**Network Errors:** ECONNRESET, ETIMEDOUT, ECONNREFUSED

**Behavior:**
- Automatically retry with exponential backoff
- Respect `retry-after` header
- Log retry attempts with request IDs

**Example:**
```typescript
try {
  await adapter.createPullRequest(params);
} catch (error) {
  if (error instanceof GitHubAdapterError && error.errorType === ErrorType.TRANSIENT) {
    // Retry already attempted, operation failed after max retries
    console.error('GitHub API temporarily unavailable');
  }
}
```

### Permanent Errors (Non-Retryable)

**HTTP Status Codes:** 404, 422, 400
**Examples:** Resource not found, validation failed, branch already exists

**Behavior:**
- Fail fast without retries
- Provide actionable error messages

**Example:**
```typescript
try {
  await adapter.createBranch({ branch: 'main', sha: '...' });
} catch (error) {
  if (error instanceof GitHubAdapterError && error.statusCode === 422) {
    console.error('Branch already exists - use existing branch or choose different name');
  }
}
```

### Human Action Required (Non-Retryable)

**HTTP Status Codes:** 401, 403
**Examples:** Missing token, insufficient scopes, expired credentials

**Behavior:**
- Fail immediately
- Provide diagnostic guidance

**Example:**
```typescript
try {
  await adapter.createPullRequest(params);
} catch (error) {
  if (error instanceof GitHubAdapterError && error.errorType === ErrorType.HUMAN_ACTION_REQUIRED) {
    console.error('GitHub authentication failed');
    console.error('Ensure GITHUB_TOKEN has scopes: repo, workflow');
    console.error('Verify token at: https://github.com/settings/tokens');
  }
}
```

## Configuration

### Basic Configuration

```typescript
import { createGitHubAdapter } from './adapters/github/GitHubAdapter';

const adapter = createGitHubAdapter({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN!,
});
```

### Advanced Configuration

```typescript
const adapter = createGitHubAdapter({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN!,
  baseUrl: 'https://github.company.com/api/v3', // GitHub Enterprise
  runDir: '.ai-feature-pipeline/runs/feature-123', // Rate limit ledger
  logger: customLogger, // Custom logger
  timeout: 60000, // 60 second timeout
  maxRetries: 5, // More aggressive retries
});
```

### Repository Config Integration

The GitHub adapter integrates with `RepoConfig` for centralized configuration:

```json
{
  "github": {
    "enabled": true,
    "token_env_var": "GITHUB_TOKEN",
    "api_base_url": "https://api.github.com",
    "required_scopes": ["repo", "workflow"],
    "default_reviewers": ["tech-lead", "security-team"],
    "branch_protection": {
      "respect_required_reviews": true,
      "respect_status_checks": true
    }
  }
}
```

**Loading from Config:**
```typescript
import { loadRepoConfig } from './core/config/RepoConfig';

const config = loadRepoConfig('.ai-feature-pipeline/config.json');
if (!config.success) {
  throw new Error('Invalid config');
}

const adapter = createGitHubAdapter({
  owner: extractOwner(config.config!.project.repo_url),
  repo: extractRepo(config.config!.project.repo_url),
  token: process.env[config.config!.github.token_env_var]!,
  baseUrl: config.config!.github.api_base_url,
});
```

## Logging

The adapter emits structured logs for all operations:

### Log Levels

- `DEBUG` - Request/response metadata, rate limit state
- `INFO` - Operation start/success, merge actions, workflow triggers
- `WARN` - Retry attempts, rate limit warnings
- `ERROR` - Operation failures with error details

### Log Format

```json
{
  "level": "info",
  "message": "Pull request created successfully",
  "context": {
    "pr_number": 42,
    "html_url": "https://github.com/org/repo/pull/42"
  },
  "timestamp": "2025-12-17T12:34:56.789Z"
}
```

### Sensitive Data Redaction

All logs automatically redact:
- Authorization tokens
- API keys
- Query parameters containing `token`, `access_token`, `api_key`

## Testing

### Unit Testing

Mock the `HttpClient` to test adapter logic without hitting GitHub API:

```typescript
import { vi } from 'vitest';
import { GitHubAdapter } from './GitHubAdapter';

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
};

const adapter = new GitHubAdapter({
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
});

// Inject mock client
(adapter as any).client = mockClient;

mockClient.post.mockResolvedValue({
  data: { number: 42, html_url: 'https://...' },
});

const pr = await adapter.createPullRequest({
  title: 'Test PR',
  body: 'Test body',
  head: 'feature',
  base: 'main',
});

expect(pr.number).toBe(42);
expect(mockClient.post).toHaveBeenCalledWith(
  '/repos/test-owner/test-repo/pulls',
  expect.any(Object),
  expect.any(Object)
);
```

### Integration Testing

Use fixtures and mocked HTTP responses:

```typescript
import { describe, it, expect } from 'vitest';
import { GitHubAdapter } from './GitHubAdapter';

describe('GitHubAdapter Integration', () => {
  it('creates pull request with correct headers and payload', async () => {
    // Use nock or msw to intercept HTTP calls
    const adapter = createGitHubAdapter({
      owner: 'test-org',
      repo: 'test-repo',
      token: 'test-token',
    });

    const pr = await adapter.createPullRequest({
      title: 'Integration Test PR',
      body: 'Test description',
      head: 'feature-branch',
      base: 'main',
    });

    expect(pr).toMatchObject({
      title: 'Integration Test PR',
      head: { ref: 'feature-branch' },
      base: { ref: 'main' },
    });
  });
});
```

See `tests/integration/githubAdapter.spec.ts` for comprehensive integration tests.

## OpenAPI Specification

The adapter operations are documented in OpenAPI 3.1 format at `api/ai_feature.yaml`. This specification:

- Documents all adapter methods with request/response schemas
- Provides contract for future remote endpoints
- Enables automated client generation
- Supports API documentation tools (Swagger UI, Redoc)

**Viewing the Spec:**
```bash
npx @redocly/cli preview-docs api/ai_feature.yaml
```

## Security Considerations

### Token Scopes

Minimum required scopes for PAT:
- `repo` - Repository access (required)
- `workflow` - Workflow dispatch (optional, required for deployment automation)

### Secret Management

**Do NOT:**
- Commit tokens to version control
- Log tokens in plaintext
- Pass tokens via URL query parameters

**Do:**
- Store tokens in environment variables
- Use GitHub App installation tokens for organizations
- Rotate tokens regularly
- Use fine-grained tokens when available

### Rate Limit Abuse

To avoid secondary abuse detection:
- Respect cooldown warnings (`remaining < 10`)
- Use pagination for large result sets
- Cache repository metadata
- Implement backoff on repeated 429 responses

## Troubleshooting

### Error: "Authentication failed - token may be missing or invalid"

**Cause:** Missing or invalid `GITHUB_TOKEN`

**Resolution:**
```bash
# Verify token is set
echo $GITHUB_TOKEN

# Test token validity
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user

# Check scopes
curl -I -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | grep x-oauth-scopes
```

### Error: "Rate limit exceeded"

**Cause:** Too many API requests in short time

**Resolution:**
1. Check rate limit state:
   ```bash
   cat .ai-feature-pipeline/runs/<feature_id>/rate_limits.json | jq '.providers.github'
   ```
2. Wait for reset window (shown in `cooldownUntil`)
3. Reduce concurrent operations in `config.json`:
   ```json
   {
     "runtime": {
       "max_concurrent_tasks": 1
     }
   }
   ```

### Error: "Pull request not mergeable"

**Cause:** Merge conflicts, failed checks, or branch protection

**Resolution:**
```typescript
const { ready, reasons } = await adapter.isPullRequestReadyToMerge(42);
console.log('Merge blocked:', reasons);
// Resolve issues listed in reasons array
```

## References

- **Blueprint:** `.codemachine/artifacts/architecture/01_Blueprint_Foundation.md` (Section 2.1: GitHub Adapter)
- **Behavioral Contracts:** `.codemachine/artifacts/architecture/03_Behavior_and_Communication.md` (GitHub HTTP Contract)
- **Rate Limit Reference:** `docs/ops/rate_limit_reference.md`
- **HTTP Client:** `src/adapters/http/client.ts`
- **OpenAPI Spec:** `api/ai_feature.yaml`
- **GitHub API Docs:** https://docs.github.com/en/rest
- **GitHub GraphQL API:** https://docs.github.com/en/graphql

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-17 | Initial GitHub adapter implementation with full REST API coverage |
