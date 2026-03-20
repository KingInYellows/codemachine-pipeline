# Utils

Low-level, layer-agnostic utilities. Provides error handling, safe JSON parsing,
secret redaction, atomic file writes, environment filtering, process management,
and GitHub API URL resolution.

## Key Exports

The barrel (`index.ts`) exports error utilities and process helpers:

- `classifyError` / `getErrorMessage` / `serializeError` / `wrapError` — error classification and serialization
- `isProcessRunning` / `ProcessStatus` — process existence helpers

Most files are imported by direct path rather than through the barrel:

- `safeJson.ts` — safe JSON parse/stringify with error handling
- `redaction.ts` — `RedactionEngine` for secret redaction (GitHub tokens, API keys, JWTs)
- `atomicWrite.ts` — atomic file writes via write-to-temp-then-rename
- `envFilter.ts` — environment variable filtering
- `processRunner.ts` — child process execution
- `processExists.ts` — process existence detection
- `githubApiUrl.ts` — GitHub API URL resolution with security validation

## Structure

- `errors.ts` — error classification, serialization, and wrapping
- `safeJson.ts` — safe JSON operations
- `redaction.ts` — secret redaction engine
- `atomicWrite.ts` — atomic file write operations
- `envFilter.ts` — environment variable filtering
- `processRunner.ts` — process spawning and execution
- `processExists.ts` — process existence checking
- `githubApiUrl.ts` — GitHub API base URL resolution (security-sensitive: validates URLs, rejects embedded credentials)

## Dependencies

Imports from: `core`

Depended on by: `adapters`, `persistence`, `telemetry`, `workflows`
