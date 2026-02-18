# Run Directory Schema Specification

**Version:** 1.0.0
**Status:** Active
**Last Updated:** 2025-12-15

## Overview

The Run Directory Schema defines the deterministic structure of `.codepipe/runs/<feature_id>/` directories that persist state for each feature pipeline execution. This specification implements ADR-2 (State Persistence) requirements and supports local-first, resumable, and auditable workflows.

## Purpose

Each run directory:

- **Preserves execution state** across CLI invocations and system restarts
- **Enables resumability** by tracking last_step, last_error, and queue snapshots
- **Enforces concurrent access safety** via file-based locking
- **Provides traceability** through manifest references and hash integrity
- **Supports cleanup governance** via retention metadata and eligibility hooks

## Directory Structure

```
.codepipe/runs/<feature_id>/
├── manifest.json              # Central run state and metadata
├── hash_manifest.json         # File integrity tracking (SHA-256)
├── run.lock                   # Concurrent access mutex (transient)
├── artifacts/                 # Generated work products
│   ├── prd.md                # Product Requirements Document
│   ├── spec.md               # Technical Specification
│   ├── plan.json             # Execution Plan (DAG)
│   └── *.md, *.json          # Other artifacts
├── queue/                     # Task queue storage
│   ├── pending/*.json        # Tasks awaiting execution
│   ├── running/*.json        # Tasks currently executing
│   ├── completed/*.json      # Successfully completed tasks
│   └── failed/*.json         # Failed tasks with error details
├── logs/                      # Command outputs and events
│   ├── stdout.log            # Standard output stream
│   ├── stderr.log            # Standard error stream
│   └── events.ndjson         # Structured event log (newline-delimited JSON)
├── telemetry/                 # Observability data
│   ├── metrics.json          # Performance metrics
│   ├── traces.json           # Distributed traces
│   ├── costs.json            # Agent API cost estimates
│   └── rate_limits.json      # Rate limit tracking per provider
├── approvals/                 # Approval workflow artifacts
│   ├── approvals.json        # Approval records and signatures
│   └── signatures/*.json     # Individual approval artifacts
├── sqlite/                    # Optional SQLite WAL indexes
│   ├── run_queue.db          # Deterministic queue snapshot database
│   ├── run_queue.db-wal      # WAL file for concurrent readers
│   └── run_queue.db-shm      # SHM file for SQLite coordination
└── context/                   # Repository context cache
    ├── summary.json          # Aggregated context for agents
    └── file_hashes.json      # Source file hash snapshots
```

## Core Files

### manifest.json

**Purpose:** Central source of truth for run state, tracking execution progress, approvals, queue health, and artifact references.

**Schema Version:** 1.0.0

**Key Fields:**

- `schema_version` (string): Manifest format version (semver)
- `feature_id` (string): Unique identifier (ULID/UUIDv7)
- `title` (string, optional): Human-readable feature description
- `source` (string, optional): Feature origin (e.g., `linear:PROJ-123`, `manual:prompt`)
- `repo` (object): Repository metadata (url, default_branch)
- `status` (enum): Current state: `pending`, `in_progress`, `paused`, `completed`, `failed`
- `execution` (object): Execution tracking
  - `last_step` (string): Last successfully completed step
  - `last_error` (object): Most recent error (step, message, timestamp, recoverable)
  - `current_step` (string): Step currently being executed
  - `total_steps` (number): Total steps in plan
  - `completed_steps` (number): Steps completed so far
- `timestamps` (object): Lifecycle timestamps (created_at, updated_at, started_at, completed_at)
- `approvals` (object): Approval tracking
  - `approvals_file` (string): Path to approvals.json
  - `pending` (array): Required approvals not yet granted
  - `completed` (array): Approvals already granted
- `queue` (object): Queue metadata
  - `queue_dir` (string): Path to queue directory
  - `pending_count`, `completed_count`, `failed_count` (numbers): Task counts
  - `sqlite_index` (object, optional): Relative paths to `sqlite/run_queue.db`, `sqlite/run_queue.db-wal`, `sqlite/run_queue.db-shm` when WAL indexes are seeded
- `artifacts` (object): References to generated files (prd, spec, plan, hash_manifest)
- `telemetry` (object): Telemetry file references (logs_dir, metrics_file, traces_file, costs_file)
- `rate_limits` (object): Rate limit file reference
- `metadata` (object): Extensible metadata (cleanup_hook, tags, notes, etc.)
  - `sqlite_seeded` (boolean, optional): Indicates whether SQLite WAL files were provisioned for this run

**Atomicity:** Updates use write-to-temp-then-rename pattern to prevent corruption.

**Access Pattern:** Always acquire `run.lock` before writing; reads do not require locking but may see stale data during concurrent writes.

**Example:** See `.codepipe/templates/run_manifest.json`

### hash_manifest.json

**Purpose:** Tracks SHA-256 hashes of artifacts for integrity verification and change detection.

**Schema Version:** 1.0.0

**Structure:**

```json
{
  "schema_version": "1.0.0",
  "created_at": "2025-12-15T10:00:00.000Z",
  "updated_at": "2025-12-15T10:30:00.000Z",
  "files": {
    "artifacts/prd.md": {
      "path": "artifacts/prd.md",
      "hash": "a1b2c3d4...",
      "size": 12345,
      "timestamp": "2025-12-15T10:15:00.000Z",
      "metadata": {}
    }
  },
  "metadata": {}
}
```

**Use Cases:**

- Verify artifact integrity before resume or export
- Detect unauthorized modifications
- Support approval workflows (hash artifacts before approval)
- Enable incremental backups

**Maintenance:** Updated automatically by `generateHashManifest()` when artifacts change.

### run.lock

**Purpose:** File-based mutex preventing concurrent modifications to the same run directory.

**Lifecycle:** Created during lock acquisition, deleted on release. Automatically cleaned up if stale (> 60 seconds or owning process no longer exists).

**Structure:**

```json
{
  "pid": 12345,
  "hostname": "dev-machine.local",
  "acquired_at": "2025-12-15T10:30:00.000Z",
  "operation": "manifest_update"
}
```

**Locking Strategy:**

- Exclusive write locks only (no shared read locks for simplicity)
- Default timeout: 30 seconds
- Poll interval: 100ms
- Stale lock detection based on age and process liveness

**API:**

- `acquireLock(runDir, options)` - Acquire lock with timeout
- `releaseLock(runDir)` - Release lock
- `withLock(runDir, fn, options)` - Execute function while holding lock

## Subdirectories

### artifacts/

Stores generated work products (PRDs, specs, plans, code diffs, test results).

**Naming Convention:** Use descriptive names with extensions (e.g., `prd.md`, `test_results.json`).

**Retention:** Permanent until cleanup hook triggers based on run age and status.

**References:** Paths stored in `manifest.json` `artifacts` object.

### queue/

Task queue organized into state-specific subdirectories.

**Subdirectories:**

- `pending/` - Tasks awaiting execution
- `running/` - Tasks currently being executed
- `completed/` - Successfully finished tasks
- `failed/` - Tasks that failed with error details

**File Format:** Each task is a JSON file named `<task_id>.json` containing:

- `task_id`, `description`, `status`, `created_at`, `updated_at`
- `inputs`, `outputs`, `error` (for failed tasks)
- `retry_count`, `max_retries`

**SQLite Index:** When `queue.sqlite_index` is populated, the CLI seeds `sqlite/run_queue.db` (plus WAL/SHM companions) so observers can query queue state through SQLite without touching individual JSON files.

**State Transitions:** Orchestrator moves files between subdirectories as tasks progress.

**Queue Coordinator:** Responsible for maintaining queue counts in `manifest.json`.

### logs/

Command outputs and structured event streams.

**Files:**

- `stdout.log` - Captured standard output
- `stderr.log` - Captured standard error
- `events.ndjson` - Structured events (newline-delimited JSON)

**Rotation:** Not implemented yet; consider size limits in future iterations.

**Redaction:** Security Redactor must filter secrets before writing.

### telemetry/

Observability data for metrics, traces, costs, and rate limits.

**Files:**

- `metrics.json` - Performance metrics (durations, counts, gauges)
- `traces.json` - Distributed trace data
- `costs.json` - Agent API cost estimates and budgets
- `rate_limits.json` - Rate limit state per provider (GitHub, Linear, Agent)

**Schema:** Each file follows the schemas defined in Section 2.3 (Telemetry & Cost Tracking) of the architecture blueprint.

**Aggregation:** CLI commands like `status --show-costs` read from these files.

### approvals/

Approval workflow artifacts per ADR-5.

**Files:**

- `approvals.json` - Approval records with timestamps, signers, artifact hashes
- `signatures/*.json` - Individual approval artifacts with rationale

**Workflow:**

1. Orchestrator marks approval required in `manifest.json` `approvals.pending`
2. CLI prompts human operator
3. Operator approves, writing record to `approvals.json`
4. Orchestrator updates `manifest.json` `approvals.completed`

**Integrity:** Approval records include artifact hashes to prevent tampering.

### sqlite/ (optional)

SQLite queue indexes enable resumable observers (`codepipe observe`, future `cleanup`) to inspect queue health without re-hashing every JSON file.

**Files:**

- `run_queue.db` - Deterministic SQLite database containing queue pointers
- `run_queue.db-wal` - Write-ahead log enabling concurrent writers and readers
- `run_queue.db-shm` - Shared memory file used by SQLite for coordination

**Provisioning:** `createRunDirectory()` accepts `seedSqlite: true` to pre-create these files. When present, `manifest.json` sets `queue.sqlite_index` with relative paths and records `metadata.sqlite_seeded: true`.

**Usage:** Observers may replay WAL frames to build indexes without holding filesystem locks, reducing contention with human-triggered CLI commands.

**Cleanup:** Hooks may delete the `sqlite/` directory if `cleanup_hook.actions.remove_directory` or a dedicated SQLite action is enabled. Integrity checks should run before removal.

### context/

Repository context cache for agent prompts.

**Files:**

- `summary.json` - Aggregated context (README, docs, history) with token budgets
- `file_hashes.json` - Snapshot of source file hashes at run start

**Purpose:** Avoid re-scanning repository on resume; detect context drift.

**Freshness:** Invalidate if `file_hashes.json` diverges from current repository state.

## State Machine

Run status follows this state machine:

```
pending → in_progress → completed
                ↓
              paused ← → in_progress
                ↓
              failed → (retry) → in_progress
```

**State Descriptions:**

- `pending` - Run created but not started
- `in_progress` - Actively executing steps
- `paused` - Temporarily halted (approval required, rate limit hit, manual pause)
- `completed` - All steps finished successfully
- `failed` - Unrecoverable error occurred

**Transitions Tracked In:** `manifest.json` `status` field and `timestamps` object.

## Retention and Cleanup

### Cleanup Hooks

Cleanup behavior is defined in `manifest.json` `metadata.cleanup_hook`:

```json
{
  "eligibility": {
    "min_age_days": 30,
    "required_status": ["completed", "failed"]
  },
  "actions": {
    "remove_logs": true,
    "remove_telemetry": false,
    "archive_artifacts": true,
    "remove_directory": false
  }
}
```

**Eligibility Checks:**

- `min_age_days` - Minimum age (days since `created_at`)
- `required_status` - Only cleanup runs in these states

**Actions:**

- `remove_logs` - Delete `logs/` directory
- `remove_telemetry` - Delete `telemetry/` directory
- `archive_artifacts` - Move `artifacts/` to archive location (future)
- `remove_directory` - Delete entire run directory

**Invocation:** Future `codepipe cleanup` command will scan run directories and execute eligible hooks.

**Safety:** Cleanup never removes runs with `status: in_progress` or `status: paused`.

### Retention Metadata

`manifest.json` `timestamps` provides:

- `created_at` - When run was initialized
- `completed_at` - When run finished (null if incomplete)

Operators can define policies like:

- Delete runs older than 90 days with `status: completed`
- Archive runs older than 30 days with `status: failed`
- Never delete runs with `status: paused` (may be resumed)

## Concurrency and Safety

### File Locking

**Guarantee:** No two processes can write to `manifest.json` simultaneously.

**Implementation:** Atomic lock file creation with exclusive write flags.

**Stale Lock Detection:**

- Age-based: Locks older than 60 seconds are stale
- Process-based: If owning PID no longer exists (Unix only)

**Best Practices:**

- Always use `withLock()` wrapper for manifest updates
- Keep lock duration minimal
- Release locks in `finally` blocks

### Atomic Writes

All critical files use atomic write patterns:

1. Write to temporary file with unique suffix
2. Call `fsync()` to flush to disk (implicit in Node.js `writeFile`)
3. Rename temp file to target path (atomic on POSIX systems)
4. Clean up temp file on error

### Integrity Verification

Before resuming a run:

1. Load `manifest.json`
2. Load `hash_manifest.json`
3. Call `verifyHashManifest()` to check artifacts
4. If mismatches detected, warn operator or fail

## Integration with CLI Commands

### init

Creates base directories:

- `.codepipe/runs/`
- `.codepipe/logs/`
- `.codepipe/artifacts/`

### start

1. Generate `feature_id` (ULID/UUIDv7)
2. Call `createRunDirectory(baseDir, feature_id, options)`
3. Write initial manifest with `status: pending`
4. Begin orchestration, updating `status: in_progress`

### status

Read `manifest.json` and display:

- `status`, `last_step`, `current_step`, `last_error`
- Queue counts (`pending_count`, `completed_count`, `failed_count`)
- Timestamps and approval status

**Flags:**

- `--json` - Output raw manifest
- `--feature <id>` - Specific run
- `--verbose` - Include queue and telemetry details
- `--show-costs` - Read `telemetry/costs.json`

Dry-run invocation `bin/run status --json` references this schema and always prints `last_step` and `last_error` even when the manifest is missing, giving operators a portable manifest snapshot.

### resume

1. Load `manifest.json`
2. Verify integrity via `hash_manifest.json`
3. Check `last_error.recoverable`
4. Resume from `last_step` or restart current step
5. Update `status: in_progress`

### cleanup

1. Scan all run directories in `baseDir`
2. For each, call `isEligibleForCleanup(runDir)`
3. Execute cleanup actions per `metadata.cleanup_hook`
4. Log actions to `telemetry/cleanup.log`

## Schema Versioning and Migration

**Current Version:** 1.0.0

**Migration Strategy:**

- `manifest.json` includes `schema_version` field
- Future versions add new fields without breaking old ones (additive changes)
- Breaking changes require migration scripts stored in `scripts/migrations/`
- Migration history recorded in `config_history` per RepoConfig pattern

**Forward Compatibility:**

- Older CLI versions ignore unknown fields
- Newer CLI versions validate against schema version and warn if unsupported

**Backward Compatibility:**

- New fields are optional with sensible defaults
- CLI commands check schema version before operations

## Related Documentation

- **ADR-2: State Persistence** - Design rationale for run directory structure
- **RepoConfig Schema** - Repository-level configuration (`.codepipe/config.json`)
- **Section 2.3: Telemetry & Cost Tracking** - Telemetry file schemas
- **Section 3: Directory Structure** - Overall pipeline directory layout
- **Cleanup Command Spec** - Future `codepipe cleanup` implementation

## API Reference

See `src/persistence/runDirectoryManager.ts` for full API documentation.

**Key Functions:**

- `createRunDirectory(baseDir, featureId, options)` - Provision new run
- `readManifest(runDir)` - Load manifest
- `updateManifest(runDir, updates)` - Atomic manifest update
- `setLastStep(runDir, step)` - Update execution progress
- `setLastError(runDir, step, message, recoverable)` - Record error
- `getRunState(runDir)` - Get execution state snapshot
- `generateHashManifest(runDir, filePaths)` - Create hash manifest
- `verifyRunDirectoryIntegrity(runDir)` - Verify artifacts
- `registerCleanupHook(runDir, hook)` - Configure cleanup
- `isEligibleForCleanup(runDir)` - Check cleanup eligibility

## Diagram

See [run_directory_schema.mmd](../diagrams/run_directory_schema.mmd) for visual representation.

## Change Log

| Version | Date       | Changes                                |
| ------- | ---------- | -------------------------------------- |
| 1.0.0   | 2025-12-15 | Initial specification for Iteration I1 |

## Future Enhancements

- **SQLite WAL Indexes:** Optional SQLite database for query-optimized state (ADR-2)
- **Log Rotation:** Size-based rotation for `stdout.log` and `stderr.log`
- **Archive Support:** Compress and move artifacts to archive location
- **Remote Sync:** Replicate run directories to object storage (S3, GCS)
- **Distributed Locking:** Redis-based locking for multi-node scenarios
- **Schema Validation:** JSON Schema files for manifest and telemetry formats
