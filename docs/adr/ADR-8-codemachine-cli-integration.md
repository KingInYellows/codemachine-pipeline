# ADR-8: CodeMachine-CLI Integration via Adapter Bridge

## Status

Accepted

## Context

The codemachine-pipeline project previously executed tasks through two mechanisms: a direct `codeMachineRunner.ts` spawn-based runner and a strategy pattern (`codeMachineStrategy.ts`) that wrapped it. Both hardcoded the binary path from config and provided no structured resolution, version enforcement, or lifecycle management.

CodeMachine-CLI v0.8.0 introduced several features the pipeline needs to leverage:

- **Coordination syntax**: a DSL for chaining agents (e.g., `claude 'build login page' && codex 'write tests'`).
- **Platform-specific optionalDependencies**: npm packages per platform (`codemachine-linux-x64`, `codemachine-darwin-arm64`, etc.) that bundle a native binary.
- **Workflow templates**: JavaScript module files (`.workflow.js`) that define multi-step agent orchestrations.

The pipeline needed a clean integration that would:

- Resolve the binary reliably across environments (npm optionalDep, env override, PATH fallback).
- Enforce minimum version compatibility with semver.
- Prevent command injection through shell-free spawning and path allowlisting.
- Support two-way communication: credential delegation via stdin, PID-based liveness tracking.
- Coexist with the existing strategy without breaking it, allowing gradual migration.

## Decision

Introduce a new adapter bridge layer under `src/adapters/codemachine/` that encapsulates all CodeMachine-CLI interaction, implemented as a new `ExecutionStrategy` named `codemachine-cli` (distinct from the existing `codemachine` strategy). Registration in CLI commands is deferred to a future cycle.

### Binary resolution

`binaryResolver.ts` implements a three-tier fallback chain:

1. **Environment variable** (`CODEMACHINE_BIN_PATH`): validated against an allowlist regex, checked for executability.
2. **npm optionalDependency**: resolves the platform-specific package via `require.resolve()` (e.g., `codemachine-linux-x64/package.json`), then locates the binary in the package root (e.g., `codemachine-linux-x64/codemachine`).
3. **PATH search**: scans `process.env.PATH` directories for an executable `codemachine` binary.

Results are cached in-process with `clearBinaryCache()` available for testing.

### Adapter

`CodeMachineCLIAdapter.ts` provides:

- `validateAvailability()`: binary resolution + version check via `--version` + semver minimum enforcement.
- `execute(args, options)`: spawn with `shell: false`, environment filtering (allowlist-based), optional credential piping via stdin as a JSON line, timeout management with SIGTERM-then-SIGKILL escalation, and log buffer size limits.
- `checkLiveness(runDir)`: PID file reading + `kill -0` liveness check.
- Atomic PID file management: write to temp, rename into place.

### Strategy registration

`CodeMachineCLIStrategy` implements `ExecutionStrategy` with `name = 'codemachine-cli'`. It calls `checkAvailability()` at construction time and caches the result. The strategy is defined but not yet registered in CLI commands (`start.ts`, `resume.ts`) — both still use the existing `createCodeMachineStrategy()`. When wired in (a future cycle), it should be registered before the existing `codemachine` strategy so it takes priority when the binary is available (first-match-wins).

The telemetry name-check in `cliExecutionEngine.ts` was updated from a string comparison to a `Set` (`CODEMACHINE_STRATEGY_NAMES`) that includes both `codemachine` and `codemachine-cli`.

### Workflow template mapping

`WorkflowTemplateMapper` translates pipeline `ExecutionTask` types to CodeMachine coordination syntax:

- `code_generation` maps to the configured default engine (e.g., `claude`).
- `testing` maps to `codex` with a testing-specific prompt prefix.
- Other task types map to appropriate engine defaults.
- Custom workflow templates (`.workflow.js` files) are resolved from a configurable directory with path traversal prevention.

### Security hardening

- `validateCliPath` in `codeMachineRunner.ts` was changed from a character blocklist to an allowlist regex (`/^[a-zA-Z0-9_\-./]+$/`).
- The adapter spawns with `shell: false` to prevent command injection.
- Environment variables are filtered through a configurable allowlist (`env_allowlist`), with `DEBUG` intentionally excluded.
- Credential delegation uses stdin (not env vars or CLI args) to avoid exposure in `ps` output.

### Config schema extensions

Three fields were added to `ExecutionConfigSchema`:

- `codemachine_cli_version`: optional string, minimum semver version to enforce.
- `codemachine_workflow_dir`: optional string, custom directory for `.workflow.js` templates.
- `env_credential_keys`: string array, keys from `process.env` to pipe as credentials via stdin.

### Doctor command upgrade

`codepipe doctor` now uses the binary resolver for its CodeMachine-CLI check and performs semver comparison for version compatibility, including a 0.x minor version mismatch warning.

## Consequences

**Positive:**

- **Reliable binary resolution.** The three-tier fallback chain works across CI (npm optionalDep), local development (PATH), and custom environments (env override) without manual configuration.
- **Version safety.** Semver enforcement prevents silent incompatibilities when CodeMachine-CLI is updated or downgraded.
- **Security improvement.** The allowlist regex, shell-free spawning, stdin credentials, and environment filtering close several injection vectors present in the original runner.
- **Coexistence.** The existing `codemachine` strategy continues to work unchanged. The new strategy takes priority only when the binary is available, enabling gradual migration.
- **Testability.** The adapter has full unit test coverage (36 tests) with mock-based binary resolution, process spawning, and liveness checking.

**Negative:**

- **External prerequisite.** CodeMachine CLI must be installed separately or exposed via `CODEMACHINE_BIN_PATH` / `PATH`. The pipeline no longer bundles `codemachine`, which avoids shipping large native binaries and inherited security noise in the published package.
- **Two strategies.** During the migration period, both `codemachine` and `codemachine-cli` strategies exist. The old strategy should be deprecated and removed in a future cycle once the new adapter is proven stable.

## References

- Binary resolver: `src/adapters/codemachine/binaryResolver.ts`
- Adapter: `src/adapters/codemachine/CodeMachineCLIAdapter.ts`
- Strategy: `src/workflows/codeMachineCLIStrategy.ts`
- Workflow template mapper: `src/workflows/workflowTemplateMapper.ts`
- Shared types: `src/workflows/codemachineTypes.ts`
- Config schema: `src/core/config/RepoConfig.ts` (ExecutionConfigSchema)
- Doctor command: `src/cli/commands/doctor.ts` (checkCodeMachineCli)
- Telemetry fix: `src/workflows/cliExecutionEngine.ts` (CODEMACHINE_STRATEGY_NAMES)
- Security fix: `src/workflows/codeMachineRunner.ts` (validateCliPath allowlist)
- Tests: `tests/unit/binaryResolver.test.ts`, `tests/unit/codeMachineCLIAdapter.test.ts`, `tests/unit/codeMachineCLIStrategy.test.ts`, `tests/unit/workflowTemplateMapper.test.ts`
