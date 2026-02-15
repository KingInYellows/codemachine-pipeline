# Linear Adapter - Technical Specification

## Overview

The Linear Adapter provides integration with Linear's issue tracking system via MCP (Model Context Protocol) server. It supports fetching issue snapshots, caching with TTL, offline mode operation, and optional mutating operations behind feature flags.

## Architecture

### Core Components

- **LinearAdapter**: Main adapter class implementing Linear GraphQL API integration
- **HttpClient**: Shared HTTP client with rate-limit tracking and retry logic
- **RateLimitLedger**: Persistence layer for rate limit envelope tracking
- **Snapshot Cache**: File-based caching system with TTL support

### Data Flow

```
CLI Command (start --linear)
    ↓
LinearAdapter.fetchIssueSnapshot()
    ↓
├─→ Check Cache (if enabled)
│   ├─→ Valid? Return cached snapshot
│   └─→ Invalid/Missing? Continue to API
│
├─→ Fetch from Linear API via GraphQL
│   ├─→ HttpClient.post(/graphql)
│   ├─→ Rate Limit Ledger Update
│   └─→ Error? Try cache fallback
│
└─→ Save Snapshot to Cache
    └─→ Return IssueSnapshot
```

## Rate Limiting

### Linear API Limits

- **Primary Limit**: 1,500 requests per hour (sliding window)
- **Window**: Rolling 60-minute period
- **Enforcement**: Client-side via RateLimitLedger

### Implementation

The adapter uses the shared `HttpClient` with `Provider.LINEAR`, which automatically:

1. Tracks request counts in `rate_limits.json`
2. Implements exponential backoff on 429 responses
3. Surfaces cooldown state via `RateLimitLedger.isInCooldown()`
4. Requires manual acknowledgment after 3 consecutive 429s

### Sliding Window Counter

```typescript
// Maintained by RateLimitLedger
{
  "provider": "linear",
  "state": {
    "remaining": 1450,
    "reset": 1704123600,  // Unix epoch
    "inCooldown": false
  },
  "recentEnvelopes": [/* last 10 requests */]
}
```

### Sliding Window Enforcement

- `LinearAdapter` keeps a rolling queue of every GraphQL attempt within the last 60 minutes (window size = 1 hour).
- When that queue reaches 1,500 entries, additional requests are blocked with a `LinearAdapterError` (`ErrorType.TRANSIENT`) instructing operators to wait for the budget to refresh.
- Before issuing any GraphQL call, the adapter calls `RateLimitLedger.isInCooldown()` and `requiresManualAcknowledgement()` to honor provider cooldowns and manual acknowledgements after repeated 429 responses.
- Cooldown-triggered blocks bubble up as `ErrorType.TRANSIENT` so orchestrators retry later, while manual-ack scenarios surface `ErrorType.HUMAN_ACTION_REQUIRED` so operators can clear cooldown state in the CLI.

## Caching Strategy

### Cache Location

Snapshots are stored in the run directory:

```
.codepipe/runs/<feature-id>/inputs/linear_issue_<sanitized-id>.json
```

### Cache TTL

- **Default TTL**: 3600 seconds (1 hour)
- **Configurable**: Via `SnapshotMetadata.ttl`
- **Validation**: Age checked on every cache read

### Snapshot Structure

```typescript
{
  "issue": {
    "id": "linear-issue-uuid",
    "identifier": "ENG-123",
    "title": "Feature request title",
    "description": "Detailed description...",
    "state": { "id": "...", "name": "In Progress", "type": "started" },
    "priority": 2,
    "labels": [...],
    "assignee": {...},
    "team": {...},
    "project": {...},
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T12:00:00Z",
    "url": "https://linear.app/..."
  },
  "comments": [
    {
      "id": "comment-uuid",
      "body": "Comment text",
      "user": {...},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "metadata": {
    "issueId": "linear-issue-uuid",
    "retrieved_at": "2024-01-15T12:30:00Z",
    "hash": "sha256-hash-of-snapshot",
    "ttl": 3600,
    "isPreview": false
  }
}
```

## Offline Mode

### Behavior

When the Linear API is unavailable:

1. Adapter attempts API call
2. On failure (network error, 503, timeout):
   - Attempts to load cached snapshot
   - If cache exists (even if stale):
     - Returns cached snapshot
     - Adds `last_error` to metadata
     - Logs warning about stale data
   - If no cache:
     - Throws `LinearAdapterError` with `ErrorType.TRANSIENT`

### CLI Integration

```bash
# Initial fetch (network available)
codepipe start --linear ENG-123

# Subsequent resume (offline)
codepipe resume --linear-refresh  # Attempts refresh, uses cache on failure
```

### Last Error Tracking

```typescript
{
  "metadata": {
    "issueId": "...",
    "retrieved_at": "2024-01-15T10:00:00Z",
    "hash": "...",
    "last_error": {
      "timestamp": "2024-01-15T12:00:00Z",
      "message": "Network connection failed",
      "type": "transient"
    }
  }
}
```

## Developer Preview Features

### Feature Flag

Mutating operations (updates, comment posting) are gated behind `enablePreviewFeatures`:

```typescript
const adapter = createLinearAdapter({
  apiKey: process.env.LINEAR_API_KEY!,
  enablePreviewFeatures: true, // Opt-in required
  runDir: '.codepipe/runs/FEAT-123',
});
```

### Gated Operations

- `updateIssue()`: Modify issue title, description, state, priority, assignee
- `postComment()`: Add comments to issues

### Error Handling

Attempting mutating operations without preview features enabled:

```typescript
throw new LinearAdapterError(
  'Issue updates require preview features to be enabled',
  ErrorType.PERMANENT,
  undefined,
  undefined,
  'updateIssue'
);
```

## GraphQL Operations

### Issue Fetch

```graphql
query GetIssue($issueId: String!) {
  issue(id: $issueId) {
    id
    identifier
    title
    description
    state {
      id
      name
      type
    }
    priority
    labels {
      nodes {
        id
        name
        color
      }
    }
    assignee {
      id
      name
      email
    }
    team {
      id
      name
      key
    }
    project {
      id
      name
    }
    createdAt
    updatedAt
    url
  }
}
```

### Comments Fetch

```graphql
query GetComments($issueId: String!) {
  issue(id: $issueId) {
    comments {
      nodes {
        id
        body
        user {
          id
          name
          email
        }
        createdAt
        updatedAt
      }
    }
  }
}
```

### Issue Update (Preview)

```graphql
mutation UpdateIssue(
  $issueId: String!
  $title: String
  $description: String
  $stateId: String
  $priority: Int
  $assigneeId: String
) {
  issueUpdate(id: $issueId, input: { ... }) {
    success
    issue { id identifier }
  }
}
```

### Comment Post (Preview)

```graphql
mutation PostComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment {
      id
    }
  }
}
```

## Error Taxonomy

### Transient Errors

**Retry automatically via HttpClient:**

- 429: Rate limit exceeded
- 503, 502, 504: Service unavailable
- Network timeouts
- Connection resets

**Strategy**: Exponential backoff with jitter, respect `retry-after` headers

### Permanent Errors

**Fail fast, no retry:**

- 404: Issue not found
- 422: Validation failed (invalid input)
- 400: Bad request (malformed GraphQL)

### Human Action Required

**Requires operator intervention:**

- 401: Authentication failed (token missing/invalid)
- 403: Authorization failed (insufficient scopes)

**Resolution**: Update `LINEAR_API_KEY` environment variable or Linear workspace settings

## CLI Integration

### Start Command

```bash
codepipe start --linear ENG-123
```

**Behavior**:

1. Resolve Linear issue ID to identifier
2. Fetch issue snapshot via `LinearAdapter.fetchIssueSnapshot()`
3. Save snapshot to `inputs/linear_issue_ENG-123.json`
4. Inject issue metadata into context aggregation
5. Pass issue title/description to research detection
6. Include Linear URL in PRD metadata

### Environment Variables

```bash
# Required
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxxxxx

# Optional
LINEAR_ORGANIZATION=acme-corp  # Workspace slug
LINEAR_MCP_ENDPOINT=https://custom-mcp.example.com  # Custom MCP server
LINEAR_ENABLE_PREVIEW=true  # Enable mutating operations
```

### RepoConfig Integration

```yaml
# .codepipe/config.yml
integrations:
  linear:
    enabled: true
    api_key_env: LINEAR_API_KEY
    organization: acme-corp
    preview_features: false
    cache_ttl: 3600
```

## Testing Strategy

### Unit Tests

- GraphQL query construction
- Cache validity checking
- Snapshot hash computation
- TTL expiration logic

### Integration Tests

Mock `HttpClient` methods to simulate:

1. **Successful API responses**
   - Issue fetch with all fields populated
   - Comments fetch with multiple entries
   - Update/comment mutations (preview)

2. **Error scenarios**
   - 429: Rate limit exceeded → retry with backoff
   - 503: Service unavailable → use cache fallback
   - 401: Auth failed → throw HUMAN_ACTION_REQUIRED
   - 404: Issue not found → throw PERMANENT error

3. **Cache scenarios**
   - Valid cache → skip API call
   - Stale cache → refresh from API
   - API failure + valid cache → return cached
   - API failure + no cache → throw error

4. **Offline mode**
   - Network timeout → cache fallback
   - Multiple consecutive failures → transient classification
   - Resume after outage → refresh snapshot

### Test Fixtures

```typescript
const MOCK_LINEAR_ISSUE: LinearIssue = {
  id: 'linear-uuid-1234',
  identifier: 'ENG-123',
  title: 'Add Linear integration',
  description: 'Implement MCP-based Linear adapter...',
  // ... full fixture
};

const MOCK_GRAPHQL_RESPONSE = {
  data: {
    issue: MOCK_LINEAR_ISSUE,
  },
};
```

## Security Considerations

### API Key Management

- **Storage**: Environment variables only, never committed to git
- **Scope**: Minimum required permissions (read issues, read comments)
- **Rotation**: Support key rotation without service interruption

### Data Sanitization

- **Logging**: API keys redacted via `sanitizeHeaders()`
- **Cache**: Snapshots contain full issue data (no PII filtering)
- **Transmission**: HTTPS only, Linear enforces TLS 1.2+

### Rate Limit Abuse Prevention

- Client-side tracking prevents excessive requests
- Ledger persistence survives process restarts
- Manual acknowledgment required after repeated 429s

## Performance Characteristics

### API Latency

- **GraphQL Single Request**: ~200-500ms (P50)
- **GraphQL with Comments**: ~300-700ms (P50)
- **Cache Read**: <10ms (local filesystem)

### Cache Hit Ratio

Target: >80% for typical development workflows

- Initial fetch: Cache miss (100% API)
- Subsequent `resume` within TTL: Cache hit (0% API)
- PRD edits/revisions: Cache hit if <1 hour

### Rate Limit Headroom

With 1,500 req/hour limit:

- Typical feature run: 2-4 requests (issue + comments)
- Aggressive refresh: ~15 requests (edits, retries)
- **Headroom**: >100 features per hour

## Future Enhancements

### Planned (ADR-6 Roadmap)

1. **Incremental Sync**
   - Delta updates via `updatedAt` filtering
   - Only fetch modified issues/comments

2. **Webhook Integration**
   - Real-time issue updates via Linear webhooks
   - Invalidate cache on upstream changes

3. **Batch Operations**
   - Fetch multiple issues in single GraphQL request
   - Reduce API calls for multi-issue features

4. **Advanced Caching**
   - Shared cache across run directories
   - SQLite persistence for fast queries

### Under Consideration

- Linear Agents API integration (developer preview)
- Bi-directional sync (auto-update Linear from PR status)
- Custom field mapping (Linear ↔ PRD sections)

## References

- **ADR-6**: Linear Integration Architecture Decision Record
- **IR-8 to IR-11**: Integration requirements for Linear adapter
- **Section 3.4**: HTTP Clients & Adapter Responsibilities (Operational Architecture)
- **Section 3.17.2**: Linear Outage Handling Scenario

---

**Document Version**: 1.0
**Last Updated**: 2024-01-15
**Authors**: CodeMachine Pipeline Team
