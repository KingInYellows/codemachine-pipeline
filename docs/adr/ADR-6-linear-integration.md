# ADR-6: Linear Integration Strategy

**Status:** Accepted
**Date:** 2025-12-15

## Context

The ai-feature-pipeline supports multiple entry points for feature work, including Linear issues (FR-5). Linear provides a GraphQL API and a TypeScript SDK (`@linear/sdk`) for programmatic access to issues, projects, and workflows. Integrating with Linear allows users to trigger the pipeline directly from issue trackers, keeping feature work linked to its originating ticket.

Key constraints that shaped this decision:

- Linear's API uses GraphQL exclusively, authenticated via API key (`Authorization: <API_KEY>`) or OAuth.
- API-key authentication is rate-limited to **1,500 requests/hour per user**.
- Linear's "Agents" APIs are in **Developer Preview** and may change without notice.
- The pipeline must degrade gracefully when Linear is unavailable or rate-limited, falling back to cached issue snapshots.

## Decision

### Authentication

The system supports two authentication methods for Linear, configured in `RepoConfig.linear`:

- **`api_key`** (default): Uses `LINEAR_API_KEY` environment variable. The API key is passed as `Authorization: <API_KEY>` in GraphQL requests.
- **`oauth`**: For environments requiring delegated access.

### API Access

- All Linear API calls go through the centralized HTTP layer (NFR-9) which provides retry/backoff, structured logging, and request IDs.
- The system uses the `@linear/sdk` TypeScript package for typed access where practical (IR-10), with a fallback to raw GraphQL for operations the SDK does not cover.
- Linear API calls are paced to stay within the 1,500 requests/hour budget (IR-9). The HTTP layer tracks request counts and delays when approaching the limit.

### Adapter Isolation

- Linear integration is implemented behind a `LinearAdapter` interface (NFR-8), isolating API-specific logic from the core pipeline.
- The Agents API integration, being Developer Preview (IR-11), is behind a separate versioned adapter interface so breaking changes in that API do not affect stable issue-fetching functionality.

### Data Flow

When a feature is triggered via `--linear ISSUE-123`:

1. The adapter fetches the issue title, description, labels, and assignee.
2. The issue payload is snapshotted into the feature's run directory (FR-2) for offline/resumable access.
3. A `Feature` is created with `source=issue` and `external_links.linear_issue_id` set.
4. If Linear becomes unavailable mid-run, the pipeline continues using the cached snapshot (graceful degradation).

### Webhook vs. Polling

The system does **not** use webhooks. The pipeline is local-first and runs on-demand without a persistent server (FR-16). Issue data is fetched at trigger time and cached. Polling is unnecessary because the pipeline operates on a single issue per invocation.

## Consequences

### Positive

- Users can start feature work directly from Linear issues without copy-pasting context.
- Cached snapshots make the pipeline resilient to Linear outages and rate limits.
- Adapter isolation means Linear API changes are contained to a single module.
- No webhook infrastructure is needed, keeping the system local-first.

### Negative

- Issue data may become stale if the Linear issue is updated after the pipeline fetches it. This is acceptable because the pipeline operates on a point-in-time snapshot.
- The 1,500 requests/hour limit constrains batch operations. For bulk processing, users must pace invocations or use OAuth with higher limits.
- The Agents API adapter requires ongoing maintenance as Linear evolves the Developer Preview.

### Risks

- If Linear deprecates the Agents API, the isolated adapter can be removed without affecting core functionality.
- Token expiry or rotation for API keys could break runs; the system surfaces authentication errors clearly and documents key management.
