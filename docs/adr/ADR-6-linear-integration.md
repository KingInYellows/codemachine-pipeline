# ADR-6: Linear Integration Strategy

## Status

Accepted

## Context

The codemachine-pipeline supports multiple entry points for feature work: prompts, structured specifications, and issue trackers. Linear is a primary issue tracker integration, allowing users to trigger the pipeline directly from a Linear issue (e.g., `--linear ISSUE-123`). The team needed to decide how to connect to Linear's API, handle its rate limits, manage data freshness, and deal with preview API instability.

Key factors driving this decision:

- Linear's API is GraphQL-only, authenticated via API key (`Authorization: <API_KEY>`) or OAuth.
- API-key authentication is rate-limited to **1,500 requests/hour** per user (sliding window).
- Linear's "Agents" integration APIs are marked as **Developer Preview** and may change without notice.
- The pipeline is local-first and runs on-demand without a persistent server, ruling out webhook-based approaches.
- Issue data must be available for PRD authoring and context aggregation even when the Linear API is temporarily unreachable.

## Decision

The Linear integration uses a **GraphQL-over-HTTP polling model** with snapshot caching and graceful degradation. The implementation lives in a dedicated `LinearAdapter` class behind a clean interface boundary.

### API access

All communication with Linear uses the GraphQL endpoint (`https://api.linear.app/graphql`) through the project's shared rate-limit-aware HTTP client (`src/adapters/http/client.ts`). This avoids an SDK dependency and gives full control over retry, rate-limit, and error-classification behavior.

### Snapshot caching with TTL

Each issue fetch produces a JSON snapshot stored in the run directory (`<runDir>/inputs/linear_issue_<id>.json`). Snapshots include a SHA-256 content hash and a configurable TTL (default: 1 hour). Subsequent requests within the TTL window are served from cache without API calls.

### Graceful degradation

If the API is unreachable or rate-limited, the adapter falls back to the most recent cached snapshot. The snapshot metadata records the last error (timestamp, message, error type) so downstream consumers can detect staleness. The pipeline continues in prompt/spec-only mode using the last known ticket data, as required by the specification (Section 2.1).

### Rate-limit enforcement

The adapter tracks request timestamps in a sliding window and blocks outgoing requests when the 1,500/hour budget is exhausted. It also integrates with the `RateLimitLedger` for persistent cooldown tracking across adapter restarts. After repeated 429 responses, the ledger can require manual operator acknowledgement before resuming requests.

### Preview feature gating

Write operations (issue updates, comment posting) are gated behind an `enablePreviewFeatures` configuration flag because they depend on Linear's Developer Preview APIs. Read operations (issue fetch, comment fetch) use stable API surfaces and are always available.

### Error taxonomy

Errors are classified into three categories:

- **Transient** -- retryable (network timeouts, temporary rate limits)
- **Permanent** -- not retryable (authentication failures, missing issues)
- **Human action required** -- needs operator acknowledgement (repeated 429 cooldown)

This classification drives retry logic, alerting, and CLI error messaging.

### Authentication

The adapter supports API key authentication, configured via `RepoConfig.linear.auth_method`. OAuth is defined in the config schema but not yet implemented. The API key is provided through the `LINEAR_API_KEY` environment variable.

### No webhooks

The system does not use webhooks. The pipeline is local-first and operates on a single issue per invocation without a persistent server. Issue data is fetched at trigger time, cached, and reused for the remainder of the run.

## Consequences

**Positive:**

- Users can start feature work directly from Linear issues without manually copying context.
- Cached snapshots make the pipeline resilient to Linear outages and rate limits.
- Adapter isolation means Linear API changes are contained to `src/adapters/linear/`.
- No webhook infrastructure is needed, keeping the system local-first.
- No SDK dependency reduces bundle size and avoids breakage from SDK updates.

**Negative:**

- Issue data may become stale if the Linear issue is updated after the pipeline fetches it. This is acceptable because the pipeline operates on a point-in-time snapshot.
- The 1,500 requests/hour limit constrains batch operations. For bulk processing, users must pace invocations or use OAuth with higher limits.
- GraphQL queries must be maintained manually rather than relying on SDK-generated types.

**Risks:**

- If Linear deprecates the Agents API, the isolated preview adapter code can be removed without affecting core read functionality.
- Multiple pipeline instances sharing an API key without coordination could hit the rate limit unexpectedly. The client-side enforcement only tracks a single process's request history.

## References

- Implementation: `src/adapters/linear/LinearAdapter.ts`
- HTTP client: `src/adapters/http/client.ts`
- Rate-limit ledger: `src/telemetry/rateLimitLedger.ts`
- Config schema (Linear section): `src/core/config/RepoConfig.ts`
- Specification: `specification.md`, Section 2.1 (Linear adapter requirements, IR-8 through IR-11) and Section 3.0 (RepoConfig data model)
