# Changelog

All notable changes to the AI Feature Pipeline CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-04-04

### Added

#### Cycle Command — Batch Linear Sprint Processing
- `codepipe cycle` CLI command for batch processing all issues in a Linear cycle (#873)
- CycleOrchestrator for sequential issue processing with skip logic (Done/Canceled/In Review auto-skipped) (#871)
- Topological sort via Kahn's algorithm with Tarjan's SCC cycle detection for dependency-safe ordering (#870)
- `fetchCycleIssues` with cursor-based pagination (250/page) and relation normalization (#869)
- `fetchActiveCycle` for automatic active cycle resolution per team (#869)
- Linear cycle and relation types: `LinearCycleIssue`, `LinearIssueRelation`, `LinearCycle`, `CycleSnapshot` (#868)
- Cycle dashboard with live progress updates, dry-run preview, and JSON output (#872)
- Per-issue run directory isolation and `report.json` audit trail (#871)

#### Public Repository Preparation
- CODE_OF_CONDUCT.md — Contributor Covenant v2.1 (#851)
- Pull request template with summary, test plan, and checklist (#851)
- Bug report and feature request issue templates (#840)
- SECURITY.md with vulnerability disclosure policy (#826)
- CONTRIBUTING.md updates with external contributor fork workflow (#840)
- Per-module READMEs for all 8 `src/` directories (#867)

#### CI & Infrastructure
- Post-release install verification script `scripts/tooling/verify_install.sh` (#862)
- Package version pruning workflow — weekly cleanup retaining 2 most recent pre-releases (#861)
- Composite Node.js setup action for CI workflow DRY (#784, CDMCH-123)

### Changed

#### Architecture Refactoring (40+ module splits)
- Decomposed `Resume.run()` god function into focused modules (CDMCH-253, #821)
- Decomposed `Init.run()` god function into focused private methods (CDMCH-160, #671)
- Extracted `PipelineOrchestrator` from `start.ts` (CDMCH-177, #776)
- Split `taskPlanner` into `plannerDAG` + `plannerPersistence` (CDMCH-210, #670)
- Split `RepoConfig` into schema, defaults, and loader modules (CDMCH-213, #668, #626)
- Split `contextSummarizer` into budget, store, orchestration, and types (#634)
- Split `cliExecutionEngine` into dependency resolver, telemetry recorder, artifact capture (#632)
- Split `contextAggregator` into file discovery and document builder (#633)
- Split `resumeCoordinator` into `runStateVerifier` + `resumeQueueRecovery` (#628)
- Split `writeActionQueue` into store and rate-limiter modules (#629)
- Split `validationRegistry` into store and orchestration layers (#630)
- Split `RunDirectoryManager` into focused modules (#625)
- Split `cli/status/data.ts` into domain modules (#631)
- Extracted `branchComplianceChecker` from `branchProtection` adapter (#636)
- Split `prdAuthoringEngine` into `prdStore` and authoring algorithm (#635)
- Extracted command utilities from `autoFixEngine` into `commandRunner` (CDMCH-211, #669)
- Extracted `RepoConfigLoader` from `RepoConfig` (CDMCH-213, #668)
- Extracted `LinearAdapterTypes` from `LinearAdapter` (CDMCH-203, #765)
- Extracted `resumeIntegrityChecker` from `runStateVerifier` (#667)
- Consolidated spec generators/rendering into `specComposer` (#598, #600)

#### Barrel Export & Import Cleanup
- Removed `runDirectoryManager` barrel, updated all imports (CDMCH-243, #822)
- Removed barrel re-exports from `validationRegistry` (CDMCH-252, #818)
- Replaced models barrel with sub-barrel re-exports (CDMCH-216, #677)
- Removed `specComposer` backward-compat re-exports (CDMCH-249, #819)
- Redirected workflow imports to persistence barrel index (#603)

#### Layer Boundary Enforcement
- Fixed 6 architecture layer violations (findings 125-126, 135-139, #623)
- Extracted shared types to break circular dependencies (findings 121-122, #622)
- Fixed persistence → workflow layer inversion (findings 138, 143, #662)

#### CI Migration
- Migrated all workflows to GitHub-hosted runners (#855)
- Added repository guards and fork checks for public repo security (#826)
- Added `timeout-minutes` to all CI jobs (#826)

#### Code Quality
- Removed redundant comments from Zod schemas and workflow headers (CDMCH-179, CDMCH-187, #773)
- Removed tautological JSDoc and enum member comments (#595, #596)
- Removed AI-pattern noise across codebase (findings 191-209, #639, #661)
- Deduplicated CLI command boilerplate across 17 findings (#637)
- Replaced ternary chains with `statusDelta` helper (CDMCH-201, #738)
- Replaced `generateRecommendations` if-else chain with Map lookup (CDMCH-185, #768)
- Introduced `withLogging<T>()` wrapper to eliminate try/catch boilerplate (CDMCH-202, #772)
- Extracted shared `mapExitToStatus()` and `buildStrategyResult()` helpers (CDMCH-190, #770)
- Removed non-null assertions (#619)
- Simplified boolean returns (#620)
- Replaced `any` type assertions with `unknown` (#618)
- Removed queue backward-compat shims (CDMCH-188, #790)
- Declarative env checks and flattened PRCreate try-catch (CDMCH-148, CDMCH-149, #676)
- Added injectable factory params to decouple CLI adapter creation (#602)
- Extracted `fillTaskBatch` and `recordTaskOutcome` from execute loop (#601)

#### Documentation
- README expansion with CI/CD section and restructured support info (#840)
- Private maintainer artifact removal (#837)
- Public-facing reference cleanup (#838)
- AGENTS.md alignment (#874)

### Fixed

#### Security Improvements
- Replaced custom `parseCommandString` with `shell-quote` for POSIX-compliant command parsing (CDMCH-199, #785, #787)
- Added Zod schema validation at all JSON deserialization boundaries — `PRMetadataSchema`, `CostTrackerStateSchema`, `RateLimitLedgerDataSchema`, `ApprovalsFileSchema`, and 5 more (findings 104, 108-114, #617)
- Hardened input validation: `os.mkdtemp` private directories, branch name allowlist, symlink cycle detection, spec.json Zod validation (findings 105-107, 115-120, #621)
- Consolidated secret redaction into `RedactionEngine` (CDMCH-168, #675)
- URL-encoded path parameters in GitHub adapter to prevent injection (#587)
- Filtered environment variables via allowlist in `autoFixEngine` (#587)
- Replaced shell exec template literals with `execFileAsync` in `branchManager` and `patchManager` (#616)
- Added `issueId` validation to all LinearAdapter public methods (CDMCH-161, #740)
- Capped `retryAfterSeconds` from external API at 300s maximum (CDMCH-196, #739)
- Added env var name validation and template substitution hardening (CDMCH-214, CDMCH-215, #673)
- Made GitHub API version configurable (CDMCH-209, #674)
- Added Zod schema validation for HTTP response parsing (#621)

#### Bug Fixes
- Flaky concurrent access test: added in-memory promise chain to serialize same-process callers in lockManager with AsyncLocalStorage reentrancy (CDMCH-232, #797)
- Circular dependencies: extracted `DEFAULT_GITHUB_API_VERSION` to `configConstants`, resume types to `core/models/resumeTypes` (CDMCH-233, #797)
- Redaction test fixtures: replaced non-matching placeholders with realistic `ghp_`/`ghs_` tokens (#857)
- Integration test fixture metadata and telemetry expectations (#614, #672)
- Removed unsupported `access:public` from `publishConfig` (#856)
- CI drift loop from auto-formatter conflict in CLI reference generator
- Resolved CI failures for v1.1.0 publish (CDMCH-231, #859)
- Removed bundled dependency vulnerabilities (#853)
- Sanitized secret-scanner false positives
- Restored redaction fixtures after history rewrite
- Fixed broken documentation paths and updated tests (#486)
- ESLint `Record<string, unknown>` disable patterns (CDMCH-122, #763)
- Batch tech debt fixes for cycle 8 sprint (CDMCH-119, CDMCH-118, CDMCH-135, CDMCH-126, #762)
- Reduced cyclomatic complexity in god functions (findings 148-173, #638, #663)
- High-priority security and architecture debt (8 fixes, #587)

### Dependencies

- Bumped `undici` 7.22.0 → 7.24.1 (#827)
- Bumped `hono` 4.11.9 → 4.12.7 (#828)
- Bumped `rollup` 4.56.0 → 4.59.0 (#831)
- Bumped `express-rate-limit` 8.2.1 → 8.3.1 (#830)
- Bumped `flatted` 3.3.3 → 3.4.1 (#833)
- Bumped `basic-ftp` 5.1.0 → 5.2.0 (#829)
- 8 additional minor/patch dependency updates (#864)

## [1.0.0] - 2026-02-14

### Added

#### Cycle 9: CodeMachine-CLI Two-Way Integration
- `CLIExecutionEngine` with queue-based task execution (#466)
- `CodeMachineRunner` with argument injection prevention (separate argv elements)
- `CodeMachineCLIStrategy` with 3-tier binary resolution (env var → optionalDep → PATH)
- `BinaryResolver` for platform-specific binary detection
- `ResultNormalizer` with 18 sensitive data redaction patterns
- Doctor command enhancement for CodeMachine binary availability
- Integration tests for strategy prerequisite validation
- Support for both legacy and CLI-based CodeMachine execution

#### Cycle 7: Testing & Documentation
- 45 CLI integration tests across 8 commands (init, start, resume, approve, etc.) (#421)
- CONTRIBUTING.md update with Graphite workflow and testing instructions (#422)
- JSDoc documentation for complex modules (#423)
- Integration test patterns for oclif commands

#### Cycle 6: Code Quality & Foundations
- LoggerInterface unification across adapters and workflows (CDMCH-93, #397)
- getErrorMessage consolidation into utils/errors.ts (CDMCH-94, #398)
- Record<string, unknown> audit with eslint-disable patterns (CDMCH-95, #399)
- Madge circular dependency guardrail with baseline (CDMCH-66, #400)
- V1 queue removal - V2 migration complete (CDMCH-63, #401, #402)
- ts-unused-exports pruning phase 1 (CDMCH-64, #403)
- Zod schema validation foundation (CDMCH-56, #404)


#### Queue Integrity Verification (CDMCH-69)
- Fail-fast/warn-only integrity modes via `QUEUE_INTEGRITY_MODE` env var
- `QueueIntegrityError` with structured fields: `kind`, `location`, `sequenceRange`, `recoveryGuidance`
- WAL checksum validation with accurate failure counting via `readOperationsWithStats()`
- Snapshot-to-WAL sequence gap detection
- `loadQueue()` blocks on corruption in fail-fast mode (default)

#### CLI Error Handling (CDMCH-53)
- Extended `CliError` with `howToFix` and `commonFixes` fields
- Added `NETWORK_ERROR` and `LINEAR_API_FAILED` error codes
- Enriched JSON error output with `how_to_fix`, `common_fixes`, `docs_url`
- Wrapped all error paths in `start.ts` and `status.ts` with actionable `CliError`

### Changed

#### Housekeeping & CI Improvements
- ESLint 10 compatibility (`preserve-caught-error`, `no-useless-assignment` rules) (#419)
- Package name: `codemachine-pipeline` → `@kinginyellows/codemachine-pipeline` (GitHub Packages scoping)
- Node.js requirement: v22+ → v24+ (LTS alignment)
- Documentation cleanup and organization (#464)
- Dockerfile consolidation (#461)
- Release branch strategy documentation (CDMCH-116, #463)

### Fixed

- Prettier formatting violations (26 files)
- Docker CI `doctor --json` exit code handling (added fallback for exit 20)
- Stale .dockerignore references (jest.config.js, .eslintrc.json)
- Flaky parallel execution test in CI (skipped pending investigation)
- Orphaned code fragment in `start.ts` causing build failures
- `exactOptionalPropertyTypes` issues in error constructors

#### Queue V2 System
- Queue V2 optimization with O(1) task operations (previously O(n²))
- WAL-based persistence with HNSW indexing (150x-12,500x faster search)
- Automatic V1→V2 migration with integrity validation
- Parallel execution with configurable concurrency (1-10 tasks)
- Dependency-aware task scheduling

#### Telemetry & Observability
- Enhanced telemetry: execution metrics, queue depth monitoring, agent cost tracking
- Structured logging (NDJSON format) with correlation IDs
- Log rotation at 100MB with optional gzip compression

#### Execution Engine
- Rate limit management with manual acknowledgement
- Research coordinator for task management

#### CodeMachine CLI Adapter Integration

- **CLIExecutionEngine**: Queue-based task execution with retry logic and backoff
  - Strategy pattern for pluggable execution backends
  - Artifact capture with path traversal prevention
  - Telemetry integration (ExecutionLogWriter events)
  - Graceful stop mechanism for interrupted pipelines

- **CodeMachineRunner**: Enhanced CLI wrapper with security hardening
  - Path validation (traversal/injection prevention)
  - CLI availability checking
  - Log file streaming with configurable buffer limit
  - Structured result parsing

- **TaskMapper**: Workflow routing for task types
  - Maps task types to execution strategies
  - Engine capability detection
  - Native vs CodeMachine execution decisions

- **ResultNormalizer**: Enhanced credential redaction
  - 18 sensitive data patterns (JWT, private keys, connection strings, GitHub tokens)
  - Error categorization (transient/permanent/human-action-required)

- **ExecutionStrategy Interface**: Pluggable execution backends
  - CodeMachineStrategy for external CLI execution
  - Extensible for future native strategies

#### Doctor Command Enhancement

- Added CodeMachine CLI availability check to `codepipe doctor`
  - Shows version when installed
  - Warns (non-blocking) when not installed with installation instructions
  - Respects custom `execution.codemachine_cli_path` configuration

#### Documentation

- Queue V2 Operations Guide
- Parallel Execution Guide
- Log Rotation Guide
- Execution Telemetry documentation
- `docs/architecture/execution_flow.md` - Execution engine architecture
- `docs/ops/codemachine_adapter_guide.md` - Operator guide for CodeMachine integration

#### Testing

- Integration tests for CLIExecutionEngine
- Unit tests for CodeMachineRunner, TaskMapper, ResultNormalizer
- Smoke test updates for execution engine validation

#### Queue V2 Implementation Changes
- Queue format upgraded from V1 (JSONL) to V2 (WAL + snapshots)
- Improved error handling with context in catch blocks
- Console logging replaced with StructuredLogger
- Extended `ExecutionTaskType` enum to include all task types
- `max_log_buffer_size` now configurable via `RepoConfig.execution`

### Security

- Path traversal prevention in artifact capture
- Input validation hardening
- Secure CLI execution with parameterized commands

### Performance

- 0.43ms for 500 tasks, <100ms for 1000 tasks (queue operations)
- 2-4x throughput improvement for parallel execution
- Memory-efficient task indexing

## [0.1.0-alpha.1] - 2025-12-30

### Added

- Initial alpha release of AI Feature Pipeline CLI
- Core CLI commands: `init`, `start`, `plan`, `status`, `resume`, `approve`, `doctor`, `validate`
- GitHub adapter for PR creation and status
- Linear adapter for issue tracking
- Structured logging and telemetry
- Rate limit handling with exponential backoff
- Configuration validation with JSON Schema
- Hash manifest for artifact integrity
- Run directory management for resumable workflows

### Documentation

- Architecture documentation
- CLI patterns guide
- Operator playbooks
