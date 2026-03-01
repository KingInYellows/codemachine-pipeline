# HTTP API Responses Parsed Without Schema Validation

**ID:** 107
**Status:** complete
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.80
**Scanner:** security-debt-scanner

## Affected Files

- `src/adapters/http/client.ts` lines 621-646

## Description

The HttpClient.parseResponseBody method casts parsed API responses directly to the caller's generic type T without any runtime schema validation. API responses from external services (GitHub, Linear, agent providers) may differ from expected types due to API version changes, error conditions, or malicious upstream services. Downstream callers access properties on the cast result without nil-checks, which can produce silent incorrect behavior or unhandled rejections.

## Suggested Remediation

Accept an optional Zod schema parameter in HttpClient.get/post/patch/delete methods (or in HttpRequestOptions). When provided, validate the parsed JSON against the schema before returning. For callers that do not provide a schema, return 'unknown' and require the caller to validate explicitly.
