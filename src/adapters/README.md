# Adapters

External service integration boundary. Provides typed adapters for GitHub, Linear,
HTTP, agent providers, and the CodeMachine CLI binary. Higher layers never make
raw API calls — all external communication goes through adapters.

## Key Exports

From the barrel (`index.ts`):

### GitHub

- `GitHubAdapter` / `createGitHubAdapter` — GitHub API integration (repos, branches, PRs, workflows)
- `BranchProtectionAdapter` — branch protection rule management
- `GitHubAdapterError`, `BranchProtectionError` — error classes
- Types: `GitHubAdapterConfig`, `RepositoryInfo`, `CreateBranchParams`, `PullRequest`, `StatusCheck`, `MergeResult`, etc.

### Linear

- `LinearAdapter` — Linear issue tracking integration
- `LinearAdapterError` — error class
- Types: `LinearAdapterConfig`, `IssueSnapshot`, `LinearIssue`, `LinearComment`, `UpdateIssueParams`, etc.

### Agents

- `AgentAdapter` / `createAgentAdapter` — LLM agent provider orchestration
- `ManifestLoader` / `createManifestLoader` — agent manifest loading and validation (factory wrappers; direct constructor use is equally valid)
- Types: `AgentManifest`, `AgentSessionRequest`, `AgentSessionResponse`, `ProviderRequirements`, etc.

### HTTP

- `HttpClient` — rate-limit-aware HTTP client with retries
- `HttpError` — typed HTTP error with error taxonomy
- `ErrorType`, `Provider` — enums for error classification and provider identification

### CodeMachine CLI

- `CodeMachineCLIAdapter` — wraps the CodeMachine binary for CLI-based execution
- `resolveBinary` / `clearBinaryCache` — binary resolution and caching
- Types: `AvailabilityResult`, `BinaryResolutionResult`, `CodeMachineExecutionResult`

## Structure

- `github/` — GitHub API adapter and branch protection
- `linear/` — Linear API adapter and types
- `agents/` — agent provider adapter and manifest loader
- `http/` — generic HTTP client
- `codemachine/` — CodeMachine CLI binary adapter
- `index.ts` — barrel re-exports

## Dependencies

Imports from: `core`, `utils`, `validation`, `telemetry`

Depended on by: `cli`, `workflows`
