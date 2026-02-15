# Integration Testing Guide

**Last Updated:** 2024-12-17
**Iteration:** I4
**Scope:** GitHub & Linear adapter regression testing with HTTP fixtures

---

## Overview

This guide documents the integration regression test suite for the AI Feature Pipeline's GitHub and Linear adapters. The test suite validates adapter behavior across success paths, rate-limit scenarios, and error conditions using deterministic HTTP fixtures.

### Key Principles

1. **Deterministic Testing**: All tests use recorded HTTP fixtures stored in `tests/fixtures/{github,linear}/` to ensure reproducible results without live API calls.
2. **Fixture Hashing**: Each fixture is tracked with a SHA256 hash in `manifest.json` for auditability and change detection.
3. **Error Taxonomy Coverage**: Tests validate the full error taxonomy (transient, permanent, human-action-required) as defined in the HTTP client architecture.
4. **Rate Limit Discipline**: Fixtures simulate primary rate limits (429), secondary rate limits (403), and missing OAuth scopes (403) to verify retry logic and cooldown behavior.

---

## Test Suite Structure

```
tests/
├── integration/
│   ├── github_linear_regression.spec.ts    # Main regression test suite
│   ├── githubAdapter.spec.ts               # GitHub adapter contract tests
│   └── linearAdapter.spec.ts               # Linear adapter contract tests
└── fixtures/
    ├── github/
    │   ├── success_repository.json          # GET /repos/{owner}/{repo}
    │   ├── success_pull_request.json        # POST /repos/{owner}/{repo}/pulls
    │   ├── success_branch_protection.json   # GET /branches/{branch}/protection
    │   ├── ratelimit_429_primary.json       # Primary rate limit response
    │   ├── error_403_secondary.json         # Secondary rate limit response
    │   ├── error_missing_scopes.json        # Insufficient OAuth scopes
    │   └── manifest.json                    # Fixture metadata & hashes
    └── linear/
        ├── success_issue.json               # GraphQL GetIssue query
        ├── success_comments.json            # GraphQL GetComments query
        ├── success_update_issue.json        # GraphQL UpdateIssue mutation
        ├── ratelimit_429_primary.json       # 1,500 req/hour limit exceeded
        ├── error_403_invalid_token.json     # Authentication failure
        ├── error_missing_scopes.json        # Insufficient write permissions
        └── manifest.json                    # Fixture metadata & hashes
```

---

## Running the Test Suite

### Run All Regression Tests

```bash
npm run test tests/integration/github_linear_regression.spec.ts
```

### Run Specific Provider Tests

```bash
# GitHub adapter tests only
npm run test tests/integration/github_linear_regression.spec.ts -- -t "GitHub Adapter"

# Linear adapter tests only
npm run test tests/integration/github_linear_regression.spec.ts -- -t "Linear Adapter"
```

### Run with Coverage

```bash
npm run test:coverage -- tests/integration/github_linear_regression.spec.ts
```

### Continuous Integration

The regression suite is executed as part of the nightly CI pipeline via:

```bash
npm run test:integration
```

See `.github/workflows/integration-tests.yml` for CI configuration.

---

## Fixture Management

### Fixture Structure

Each fixture is a JSON file with the following structure:

```json
{
  "status": 200,
  "headers": {
    "content-type": "application/json",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1735689600"
  },
  "data": {
    // Response payload
  }
}
```

**Required Fields:**

- `status` (number): HTTP status code
- `headers` (object): Response headers (must include rate-limit headers for GitHub)
- `data` (object): Response body (API payload or error message)

### Updating Fixtures

When adapter behavior changes or new endpoints are added, update fixtures using the provided script:

```bash
# Update all fixtures
./scripts/tooling/update_fixtures.sh

# Update specific provider
./scripts/tooling/update_fixtures.sh --provider github
./scripts/tooling/update_fixtures.sh --provider linear

# Dry-run mode (preview changes)
./scripts/tooling/update_fixtures.sh --dry-run
```

**What the script does:**

1. Validates fixture JSON structure
2. Computes SHA256 hashes for each fixture
3. Updates `manifest.json` with new hashes and timestamps
4. Records current git branch for traceability

### Adding New Fixtures

1. **Create the fixture file** in the appropriate provider directory:

```bash
# Example: Add a new GitHub workflow dispatch fixture
cat > tests/fixtures/github/success_workflow_dispatch.json << 'EOF'
{
  "status": 204,
  "headers": {
    "x-github-api-version": "2022-11-28",
    "x-ratelimit-remaining": "4997"
  },
  "data": null
}
EOF
```

2. **Update the manifest** by adding an entry to `tests/fixtures/{provider}/manifest.json`:

```json
{
  "file": "success_workflow_dispatch.json",
  "scenario": "Success - Workflow dispatch",
  "endpoint": "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
  "hash": "computed-by-script"
}
```

3. **Regenerate hashes**:

```bash
./scripts/tooling/update_fixtures.sh --provider github
```

4. **Add test cases** in `github_linear_regression.spec.ts`:

```typescript
it('should trigger workflow dispatch successfully', async () => {
  const fixture = await loadFixture('github', 'success_workflow_dispatch.json');
  const mockClient = createFixtureMockClient(fixture);

  Reflect.set(adapter as unknown as { client: HttpClient }, 'client', mockClient);

  await adapter.triggerWorkflow({
    workflow_id: 'deploy.yml',
    ref: 'main',
  });

  expect(mockClient.post).toHaveBeenCalled();
});
```

5. **Run tests** to verify:

```bash
npm run test tests/integration/github_linear_regression.spec.ts
```

---

## Test Coverage Map

### GitHub Adapter Coverage

| Scenario                    | Fixture                          | Test Coverage | Rate Limit Behavior                    |
| --------------------------- | -------------------------------- | ------------- | -------------------------------------- |
| Success - Repository fetch  | `success_repository.json`        | ✅ Covered    | Tracks remaining quota                 |
| Success - PR creation       | `success_pull_request.json`      | ✅ Covered    | Tracks remaining quota                 |
| Success - Branch protection | `success_branch_protection.json` | ✅ Covered    | N/A                                    |
| Primary rate limit (429)    | `ratelimit_429_primary.json`     | ✅ Covered    | Exponential backoff with `retry-after` |
| Secondary rate limit (403)  | `error_403_secondary.json`       | ✅ Covered    | Human action required                  |
| Missing OAuth scopes (403)  | `error_missing_scopes.json`      | ✅ Covered    | Human action required                  |

### Linear Adapter Coverage

| Scenario                         | Fixture                        | Test Coverage | Rate Limit Behavior     |
| -------------------------------- | ------------------------------ | ------------- | ----------------------- |
| Success - Issue fetch            | `success_issue.json`           | ✅ Covered    | Sliding window tracking |
| Success - Comments fetch         | `success_comments.json`        | ✅ Covered    | Sliding window tracking |
| Success - Issue update (preview) | `success_update_issue.json`    | ✅ Covered    | Requires preview flag   |
| Primary rate limit (429)         | `ratelimit_429_primary.json`   | ✅ Covered    | 1-hour cooldown         |
| Invalid API key (403)            | `error_403_invalid_token.json` | ✅ Covered    | Human action required   |
| Missing scopes (403)             | `error_missing_scopes.json`    | ✅ Covered    | Human action required   |

### Outstanding Gaps

The following scenarios are **not yet covered** and require manual testing or live API integration:

1. **GitHub:**
   - Auto-merge toggle with branch protection rules
   - Reviewer request with team permissions
   - Status check polling during CI runs
   - Workflow run status queries

2. **Linear:**
   - Snapshot caching with TTL expiration (tested in `linearAdapter.spec.ts` but not in regression suite)
   - GraphQL error responses with partial data
   - Webhook event handling

3. **Cross-Provider:**
   - Concurrent rate-limit exhaustion across GitHub + Linear
   - Rate-limit ledger persistence and recovery after crashes
   - Idempotency key collision detection

**Recommendation:** Schedule I5 tasks to address these gaps with live integration tests or end-to-end scenarios.

---

## Rate Limit Reference

For detailed information on rate-limit headers, retry policies, and cooldown logic, see:

- [Rate Limit Reference](./rate_limit_reference.md)
- [HTTP Client Architecture](../architecture/04_Operational_Architecture.md#3-4-http-clients-and-adapters)

### GitHub Rate Limit Headers

- `x-ratelimit-limit`: Maximum requests per hour (typically 5,000 for authenticated users)
- `x-ratelimit-remaining`: Requests remaining in current window
- `x-ratelimit-reset`: Unix timestamp when quota resets
- `retry-after`: Seconds to wait before retrying (present on 429 responses)

### Linear Rate Limit Behavior

- **Quota:** 1,500 requests per hour (sliding window)
- **Headers:** `retry-after` (seconds) on 429 responses
- **Adapter Logic:** Pre-flight checks block requests when sliding window is exhausted

---

## Debugging Test Failures

### Fixture Validation Errors

If a fixture fails validation:

```bash
./scripts/tooling/update_fixtures.sh --provider <provider>
```

Check for:

- Missing required fields (`status`, `headers`, `data`)
- Invalid JSON syntax
- Incorrect hash in manifest

### Test Assertion Failures

1. **Enable verbose logging** in the test:

```typescript
mockLogger = {
  debug: vi.fn((msg, meta) => console.log('DEBUG:', msg, meta)),
  info: vi.fn((msg, meta) => console.log('INFO:', msg, meta)),
  warn: vi.fn((msg, meta) => console.warn('WARN:', msg, meta)),
  error: vi.fn((msg, meta) => console.error('ERROR:', msg, meta)),
};
```

2. **Inspect mock call history**:

```typescript
console.log('HTTP calls:', mockClient.post.mock.calls);
```

3. **Compare fixture vs. adapter expectations**:

```bash
# View fixture content
cat tests/fixtures/github/success_repository.json | jq .

# Check adapter method signature
grep -A 10 'async getRepository' src/adapters/github/GitHubAdapter.ts
```

### Hash Mismatch Warnings

If hashes in `manifest.json` don't match computed values:

```bash
# Regenerate all hashes
./scripts/tooling/update_fixtures.sh

# Commit updated manifest
git add tests/fixtures/*/manifest.json
git commit -m "chore(fixtures): regenerate hashes"
```

---

## Best Practices

### 1. Keep Fixtures Minimal

Only include fields required for the test scenario. Remove extraneous data to improve readability:

```json
{
  "status": 200,
  "headers": { "x-ratelimit-remaining": "4999" },
  "data": {
    "id": 123,
    "full_name": "test-org/test-repo"
    // Omit fields not used in assertions
  }
}
```

### 2. Document Fixture Scenarios

Update `manifest.json` with clear scenario descriptions:

```json
{
  "file": "error_403_secondary.json",
  "scenario": "Rate Limit - Secondary rate limit exceeded (403)",
  "endpoint": "ANY",
  "hash": "abc123..."
}
```

### 3. Test Error Taxonomy

Ensure every error fixture validates the correct `ErrorType`:

```typescript
expect(httpError.type).toBe(ErrorType.TRANSIENT); // For 429, 503
expect(httpError.type).toBe(ErrorType.HUMAN_ACTION_REQUIRED); // For 401, 403
expect(httpError.type).toBe(ErrorType.PERMANENT); // For 422, 404
```

### 4. Avoid Brittle Assertions

Use `expect.objectContaining` and `expect.stringContaining` for flexibility:

```typescript
expect(result).toMatchObject({
  full_name: 'test-org/test-repo',
  // Don't assert on timestamp fields that may vary
});
```

### 5. Keep Tests Isolated

Each test should:

- Create its own adapter instance
- Use fresh mock clients
- Clean up temp directories in `afterEach`

---

## CI Integration

The regression suite runs automatically in CI via:

```yaml
# .github/workflows/integration-tests.yml
- name: Run Integration Regression Tests
  run: npm run test:integration
```

**Requirements:**

- Node.js v24 (LTS)
- `npm install` completed
- Fixtures directory present

**Artifacts:**

- Test results saved to `test-results/`
- Coverage reports in `coverage/`

---

## Contribution Guidelines

When contributing new fixtures or tests:

1. **Follow naming conventions:**
   - Success scenarios: `success_<operation>.json`
   - Rate limits: `ratelimit_429_<type>.json`
   - Errors: `error_<code>_<reason>.json`

2. **Update documentation:**
   - Add entry to Coverage Map table
   - Document scenario in `manifest.json`
   - Note any outstanding gaps

3. **Run full suite before committing:**

```bash
npm run test tests/integration/github_linear_regression.spec.ts
./scripts/tooling/update_fixtures.sh
git add tests/fixtures/
```

4. **Link to related tasks:**
   - Reference task IDs in commit messages
   - Update milestone notes if coverage gaps are addressed

---

## Related Documentation

- [Smoke Test Guide](./smoke_test_guide.md)
- [Rate Limit Reference](./rate_limit_reference.md)
- [HTTP Client Architecture](../architecture/04_Operational_Architecture.md)
- [Verification Testing Levels](../../plan/03_Verification_and_Glossary.md#verification-testing-levels)

---

## Support

For questions or issues with the integration test suite:

1. Review this guide and the test suite code
2. Check CI logs for failure details
3. Consult [rate_limit_reference.md](./rate_limit_reference.md) for rate-limit behavior
4. File issues in the project tracker with `testing` label
