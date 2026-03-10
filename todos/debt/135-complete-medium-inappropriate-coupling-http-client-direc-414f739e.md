# Inappropriate Coupling http client Directly Instantiates rateLimitLedger

**ID:** 135
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.88
**Scanner:** architecture-scanner

## Affected Files

- `src/adapters/http/client.ts` line 2
- `src/adapters/http/client.ts` lines 117-145

## Description

The HTTP client imports and directly instantiates RateLimitLedger from telemetry/rateLimitLedger. This couples the generic HTTP transport layer to a project-specific telemetry system, making the HttpClient class non-portable and harder to test in isolation. The RateLimitLedger is a stateful side-effect concern that should be injected via the HttpClientConfig rather than constructed internally.

## Suggested Remediation

Define a RateLimitRecorder interface in src/adapters/http/httpTypes.ts that HttpClient accepts via config. The concrete RateLimitLedger implementation from telemetry/ is then injected at construction time in the calling adapter (GitHubAdapter, LinearAdapter) or in a factory function.
