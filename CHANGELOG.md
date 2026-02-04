# Changelog

All notable changes to the AI Feature Pipeline CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Known Deviations

- Phase 2.3 (start command wiring) deferred until plan generation is implemented

## [1.0.0] - 2026-01-28

### Added

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

### Changed

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
