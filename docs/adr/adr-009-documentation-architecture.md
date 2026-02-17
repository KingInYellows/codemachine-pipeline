# ADR-009: Documentation Architecture Decisions

**Status**: Accepted
**Date**: 2026-02-15
**Context**: Phase 1 of Comprehensive Documentation Suite Plan
**Related**: Phase 0 (Architecture Foundation), Cycle 8 Documentation Initiative

## Context

This ADR documents critical architectural decisions discovered during documentation research for v1.0.0+. These findings answer 15 critical questions about system behavior, configuration, and operational mechanics that are essential for creating accurate, user-facing documentation.

## Critical Questions & Answers

### Q1: Node.js Version Requirement

**Answer**: `>=24.0.0` (Node.js 24 LTS or higher)

**Source**: `package.json` engines field
**Verification**: ✅ Confirmed in package.json line 23-25
**Breaking Change**: Yes - v1.0.0 upgraded from v22+ to v24+ for LTS alignment
**Documentation Impact**: Must be prominently featured in prerequisites.md

---

### Q2: Configuration File Discovery Algorithm

**Answer**: **Two-path behavior by command type** - `init` writes at git root, runtime commands read from current working directory.

**Algorithm**:

1. `codepipe init` resolves git root via `git rev-parse --show-toplevel`
2. `init` writes config to `{gitRoot}/.codepipe/config.json`
3. Runtime commands resolve from `process.cwd()`
4. Runtime config path is `{cwd}/.codepipe/config.json`
5. Validate file access and permissions
6. Parse JSON and validate against Zod schema
7. Apply `CODEPIPE_*` environment variable overrides

**Search Behavior**: No fallback locations, no parent directory traversal for runtime reads.

**Fallback**: Runtime commands hard-fail with: `"Config file not found: {path}. Run 'codepipe init' to create it."`

**Caching**: None - file read fresh on every command invocation

**Sources**:

- `src/cli/commands/init.ts:110-112` - Git root config placement during init
- `src/cli/utils/runDirectory.ts:11,23` - CWD-relative config resolution at runtime
- `src/core/config/RepoConfig.ts:356-365` - Error handling

**Documentation Impact**: Must clearly document the `init` (git root) vs runtime (CWD) difference to avoid subdirectory confusion.

---

### Q3: CodeMachine CLI Binary Resolution Priority

**Answer**: Three-path resolution with strict priority order

**Priority (Highest to Lowest)**:

1. **`CODEMACHINE_BIN_PATH`** environment variable
   - Allowlist-validated to prevent command injection
   - Must be absolute path to executable
   - Security: Path traversal protections applied

2. **npm optionalDependency** (platform-specific packages)
   - Project optional dependency: `codemachine` (wrapper package)
   - `binaryResolver.ts` attempts to resolve platform packages from `node_modules` (typically transitive via `codemachine`):
     - `codemachine-darwin-arm64`
     - `codemachine-darwin-x64`
     - `codemachine-linux-x64`
     - `codemachine-linux-arm64`
     - `codemachine-windows-x64`

3. **PATH search**
   - Iterates directories in `PATH` and checks for an executable `codemachine` (`codemachine.exe` on Windows)
   - Does not shell out to `which`/`where` (platform-independent and avoids command injection)

**Sources**:

- `src/adapters/codemachine/binaryResolver.ts` - Complete resolution logic
- `docs/solutions/integration-issues/codemachine-cli-strategy-prerequisite-validation.md` - Strategy documentation

**Documentation Impact**: Must document all three paths with platform-specific examples

---

### Q4: Approval Workflow Mechanics

**Answer**: Seven-gate system with SHA-256 hash validation and two-file state model

**Available Gates** (7 defined in schema, 6 accepted by CLI):

- `prd` - Product Requirements Document
- `spec` - Technical Specification
- `plan` - Implementation Plan
- `code` - Code Implementation
- `pr` - Pull Request
- `deploy` - Deployment
- `other` - Custom/extensibility gate (schema only; not accepted by `codepipe approve` CLI)

**Workflow Progression**:

1. **Pipeline Stage Completes** → Gate added to `manifest.approvals.pending[]`
2. **User Runs** `codepipe approve <gate> --approve` or `codepipe approve <gate> --deny`
3. **System Actions**:
   - Validates gate is in pending array
   - Computes SHA-256 hash of artifact (e.g., PRD.md)
   - Creates ApprovalRecord with metadata (signer, timestamp, hash, verdict)
   - Writes to `approvals/approvals.json` (audit trail)
   - Updates `manifest.json` (moves gate from pending to completed)
   - All writes use atomic temp-file-rename pattern with file locking
4. **Resume Check**: `codepipe resume` checks if `pending.length === 0`, blocks if approvals needed

**State Persistence (Two Files)**:

- `manifest.json` - Current state (pending/completed arrays)
- `approvals/approvals.json` - Complete audit trail (all ApprovalRecords)

**Hash Validation**:

- Prevents approving modified artifacts
- Exit code 30 if hash mismatch detected
- User must re-approve if artifact changes

**Exit Codes**:

- 0: Success
- 10: Validation error (invalid gate, not pending)
- 30: Artifact modified (hash mismatch)
- 1: General error

**Sources**:

- `src/cli/commands/approve.ts` - Complete approval logic
- `src/core/models/ApprovalRecord.ts` - Data structures and gate definitions (approval types)
- `src/workflows/approvalRegistry.ts` - State persistence and audit trail (approval storage)

**Documentation Impact**: Must explain hash validation, audit trail, and resume blocking

---

### Q5: Required vs Optional Configuration Fields

**Answer**: 5 required leaf fields; most other fields have defaults (and required parent objects can be empty)

**Absolutely Required** (no defaults, validation fails if missing):

1. `schema_version` - Semver format (e.g., "1.0.0")
2. `project.id` - Unique project identifier
3. `project.repo_url` - Repository URL (https:// or git@)
4. `github.enabled` - Boolean flag (true/false)
5. `linear.enabled` - Boolean flag (true/false)

**Required Sections** (parent objects required, but fields inside have defaults):

- `project.*` - Project metadata (`default_branch`, `context_paths`, `project_leads` have defaults)
- `github.*` - GitHub integration config
- `linear.*` - Linear integration config
- `runtime.*` - Runtime settings (all have defaults)
- `safety.*` - Safety controls (all have defaults)
- `feature_flags.*` - Feature toggles (most default to false; `enable_context_summarization` and `enable_resumability` default to true)

**Optional Sections** (entire section can be omitted):

- `validation.*` - Validation command registry
- `constraints.*` - Resource constraints
- `execution.*` - CodeMachine CLI settings (falls back to defaults)
- `governance.*` - Approval workflows (ADR-5, optional but recommended)
- `config_history.*` - Migration tracking

**Minimum Valid Configuration**:

```json
{
  "schema_version": "1.0.0",
  "project": {
    "id": "my-project",
    "repo_url": "https://github.com/org/repo.git"
  },
  "github": { "enabled": false },
  "linear": { "enabled": false },
  "runtime": {},
  "safety": {},
  "feature_flags": {}
}
```

**Sources**:

- `src/core/config/RepoConfig.ts` - Complete Zod schema (lines 1-520)
- `docs/reference/config/RepoConfig_schema.md` - Existing comprehensive documentation

**Documentation Impact**: Config examples must use nested structure, clearly mark required fields

---

### Q6: LINEAR_API_KEY Requirement

**Answer**: **Optional** - Required only if Linear integration is enabled

**Validation Logic**:

- If `config.linear.enabled === false` → No validation
- If `config.linear.enabled === true` AND configured Linear API key env var is missing (defaults to `LINEAR_API_KEY`) → **Warning** (not error)
- Linear features fail gracefully if key invalid

**Sources**:

- `src/core/config/RepoConfig.ts:415, 425, 434` - Credential validation
- Config validation warning: `Linear integration enabled but ${config.linear.api_key_env_var} not set` (defaults to `LINEAR_API_KEY`)

**Documentation Impact**: Must clarify that Linear is optional, key only needed when enabled

---

### Q7: Multi-User Queue Locking Mechanism

**Answer**: **YES** - File-based exclusive locking with stale lock detection

**Locking Mechanism**:

- Lock file: `.codepipe/runs/{feature_id}/run.lock`
- Atomic creation using `fs.writeFile()` with `'wx'` flag (exclusive mode)
- Stores process metadata: PID, hostname, timestamp, operation type
- Lock acquired before ANY queue/manifest modification

**Stale Lock Detection**:

- Age-based: 60-second threshold (configurable)
- Process-based: Unix/Linux checks if PID exists using signal 0
- Corrupted locks: Treated as stale, removed automatically
- Timeout: 30 seconds default, 100ms polling interval

**Concurrent Execution Support**:

- ✅ Multiple users on different features (different feature_ids)
- ✅ Multiple tasks within one pipeline (2-4x throughput)
- ✅ Resume after crash (automatic via stale lock recovery)
- ❌ Same feature_id on different machines (30s timeout, then failure)

**TOCTOU Protections**:

- Exclusive file creation prevents simultaneous lock acquisition
- All manifest operations wrapped in `withLock()`
- Atomic writes (temp-file-rename pattern)
- Process-aware cleanup validates process existence

**Limitations**:

- Single machine only (requires POSIX filesystem)
- Network filesystems not guaranteed (NFS locking unreliable)
- Windows: PID checking falls back to time-based only

**Sources**:

- `src/persistence/runDirectoryManager.ts:282-481` - Complete locking implementation
- `docs/reference/parallel-execution.md` - Parallel execution guide

**Documentation Impact**: Must explain team collaboration is safe, but same feature requires serial access

---

### Q8: Can .codepipe/ Be Committed to Git?

**Answer**: **Partially** - Only specific subdirectories are gitignored by default

**Gitignored Patterns** (only 4 subdirectories):

- `.codepipe/runs/` - Execution state (ephemeral)
- `.codepipe/logs/` - Log files (large, transient)
- `.codepipe/metrics/` - Metrics data (transient)
- `.codepipe/telemetry/` - Telemetry data (transient)

**NOT Gitignored**:

- `.codepipe/` directory itself (can be committed)
- `.codepipe/config.json` (CAN be committed for team collaboration, but shouldn't if it contains secrets)
- Any other files/folders in `.codepipe/` (not in the 4 subdirs above)

**Team Collaboration Strategy**:

- Commit: `.codepipe/config.json` (template with placeholder secrets)
- Share: Environment variable names in README
- Each developer: Sets their own `GITHUB_TOKEN`, `LINEAR_API_KEY` locally
- CI/CD: Injects secrets via GitHub Secrets → `CODEPIPE_*` env vars

**Sources**:

- `.gitignore:47-50` - .codepipe/ patterns

**Documentation Impact**: Must document team collaboration workflow, secret sharing strategy

---

### Q9: Queue Backup/Restore Mechanism

**Answer**: **YES** - Automatic snapshot + Write-Ahead Log (WAL) recovery, no manual backup commands

**Disaster Recovery Architecture**:

1. **Snapshots** (`queue_snapshot.json`)
   - Point-in-time checkpoints of complete queue state
   - SHA-256 checksums for integrity verification
   - Atomic writes (temp-file-rename pattern)
   - File locking prevents corruption

2. **Write-Ahead Log** (`queue_operations.log`)
   - NDJSON format for efficient streaming
   - Records all mutations (create/update/delete)
   - Monotonic sequence numbers for deterministic replay
   - CRC32-like checksums per operation

3. **Automatic Compaction**
   - Merges WAL into snapshots (1000 ops or 5MB threshold)
   - Prunes completed tasks without dependents
   - Keeps recovery time bounded

**Recovery Procedure** (Automatic):

```bash
codepipe resume --feature <feature_id>
# (If omitted, --feature defaults to current/latest.)
# System automatically:
# 1. Loads latest snapshot
# 2. Replays WAL operations
# 3. Verifies artifact integrity
# 4. Resumes from last checkpoint
```

**Manual Recovery** (If Corrupted):

```bash
# By default, --validate-queue=true (use --no-validate-queue to disable)
codepipe resume --feature <feature_id> --validate-queue    # Explicit validation (default)
codepipe resume --feature <feature_id> --dry-run --verbose # Dry-run diagnostics
```

**Queue File Format**:

- Location: `.codepipe/runs/<feature_id>/queue/`
- Format: JSON/NDJSON (text-based, human-readable)
- Portability: ✅ Yes (no binary serialization)
- Schema: Version 2.0.0

**What's Missing**:

- No `codepipe export` / `codepipe import` commands
- No remote backup integration
- No compression utilities
- External corruption requires manual intervention

**Disaster Recovery Best Practices**:

- Daily: `cp -r .codepipe/runs/ .codepipe/runs.backup-$(date +%F)` or `tar czf codepipe-runs-backup.tar.gz .codepipe/runs/` (manual backup required since `.codepipe/runs/` is gitignored)
- Before risky ops: `cp -r .codepipe/runs/<feature_id> .codepipe/runs/<feature_id>.backup`
- Corruption: Use `codepipe resume --feature <feature_id> --validate-queue` to diagnose, then start a new run if unrecoverable

**Sources**:

- `src/workflows/queueSnapshotManager.ts` - Snapshot management
- `src/workflows/queueOperationsLog.ts` - WAL implementation
- `src/workflows/queueCompactionEngine.ts` - Compaction logic
- `docs/playbooks/resume_playbook.md` - Recovery procedures

**Documentation Impact**: Must document automatic recovery, manual recovery procedures, limitations

---

### Q10: Credential Precedence (Environment Variables vs Config.json)

**Answer**: **Environment variable overrides** - Config stores env var _names_; CODEPIPE\_\* overrides can inject credentials directly

**Precedence Pattern**:

1. **Override env vars** (highest priority, contain actual credentials):
   - `CODEPIPE_GITHUB_TOKEN` → If set, this value is used as the GitHub token
   - `CODEPIPE_LINEAR_API_KEY` → If set, this value is used as the Linear API key

2. **Config.json env var name** (medium priority):
   - `github.token_env_var` → Defaults to "GITHUB_TOKEN"
   - `linear.api_key_env_var` → Defaults to "LINEAR_API_KEY"

3. **Actual credential** (read from env var):
   - `process.env[token_env_var]` → The actual token value

**Example Flow**:

```
config.json: { "github": { "token_env_var": "GITHUB_TOKEN" } }
Environment:
  GITHUB_TOKEN=ghp_default123
  CODEPIPE_GITHUB_TOKEN=ghp_override456

Result:
1. applyEnvironmentOverrides() sees CODEPIPE_GITHUB_TOKEN
2. Changes token_env_var to "CODEPIPE_GITHUB_TOKEN"
3. Reads actual token from process.env.CODEPIPE_GITHUB_TOKEN (ghp_override456)
```

**Security Design**:

- ✅ Credentials never stored in config.json (only env var names)
- ✅ Supports custom env var names per project
- ✅ CI/CD compatible (inject secrets via CODEPIPE\_\*)
- ✅ Flexible (different projects can use different var names)

**Sources**:

- `src/core/config/RepoConfig.ts:527-536` - Override logic
- `src/cli/pr/shared.ts:168` - GitHub token loading (shared PR utilities)
- `src/cli/commands/start.ts:819` - Linear key loading

**Documentation Impact**: Must explain the override pattern clearly with diagrams

---

### Q11: Debug Logging Enablement Method

**Answer**: `--verbose` and `--json` flags, automatic log persistence

**Command-Line Flags**:

- `--verbose` / `-v` - Show detailed diagnostic information (supported by `doctor`, `status` (see `src/cli/commands/status/index.ts`), `plan`, `validate`, `resume`, `rate-limits`)
- `--json` - Output results in JSON format, disable stderr mirroring

**Environment Variables**:

- `JSON_OUTPUT` - When set, enables pure JSON output mode (machine-readable)

**Log File Locations**:

```
<run_directory>/logs/logs.ndjson
Example: .codepipe/runs/<feature_id>/logs/logs.ndjson
```

**Log Levels** (in order of verbosity):

- `DEBUG` - Most detailed (internal state, trace calls)
- `INFO` - Standard operational events
- `WARN` - Warnings (degraded performance, deprecations)
- `ERROR` - Errors (recoverable failures)
- `FATAL` - Critical failures (process termination)

**Usage Examples**:

```bash
# Verbose diagnostics
codepipe doctor --verbose

# Structured JSON output
codepipe doctor --json

# Analyze logs with jq
jq 'select(.level=="ERROR")' .codepipe/runs/<feature_id>/logs/logs.ndjson
jq 'select(.component=="http:github")' .codepipe/runs/<feature_id>/logs/logs.ndjson
```

**Features**:

- Automatic secret redaction (GitHub tokens, API keys, JWTs, AWS credentials)
- Structured context (component, timestamp, trace_id, custom fields)
- NDJSON format (one JSON object per line)
- Async persistence with in-memory fallback

**Sources**:

- `src/telemetry/logger.ts` - Logging implementation
- `src/cli/commands/doctor.ts` - --verbose flag usage

**Documentation Impact**: Must document both flags and log analysis techniques

---

### Q12: AI API Keys Environment Variables

**Answer**: Follows same credential precedence pattern as Q10

**API Key Environment Variables by Engine**:

| Execution Engine | Required API Key Env Var |
| ---------------- | ------------------------ |
| `claude`         | `ANTHROPIC_API_KEY`      |
| `codex`          | `OPENAI_API_KEY`         |
| `openai`         | `OPENAI_API_KEY`         |

**Agent Endpoint Configuration** (URL override, not API key):

| Override Env Var                  | Config Field             | Description                                                |
| --------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `CODEPIPE_RUNTIME_AGENT_ENDPOINT` | `runtime.agent_endpoint` | Overrides the agent endpoint URL (not an API key override) |

**Agent Endpoint Env Var Indirection**:

- If `runtime.agent_endpoint` is unset, the CLI reads the endpoint from `process.env[runtime.agent_endpoint_env_var]` (default: `AGENT_ENDPOINT`)
- `CODEPIPE_RUNTIME_AGENT_ENDPOINT` sets `runtime.agent_endpoint` directly and bypasses `runtime.agent_endpoint_env_var`

**Additional Runtime Overrides**:

- `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` - Max parallel tasks (default: 3)
- `CODEPIPE_RUNTIME_TIMEOUT_MINUTES` - Global timeout (default: 30)
- `CODEPIPE_EXECUTION_CLI_PATH` - Override `execution.codemachine_cli_path` (only applies if `execution` exists in config.json)
- `CODEPIPE_EXECUTION_DEFAULT_ENGINE` - Override `execution.default_engine` (only applies if `execution` exists in config.json)
- `CODEPIPE_EXECUTION_TIMEOUT_MS` - Override `execution.task_timeout_ms` (only applies if `execution` exists in config.json)

**Note**: If your `config.json` omits the `execution` section, these `CODEPIPE_EXECUTION_*` overrides are ignored (no warning). The default config created by `codepipe init` includes `execution`.

**Sources**:

- `src/core/config/RepoConfig.ts:509-596` - All CODEPIPE\_\* overrides
- Same precedence pattern as GitHub/Linear credentials

**Documentation Impact**: Must document all AI API keys with cost protection warnings

---

### Q13: Migration Path from Pre-v1.0 to v1.0+

**Answer**: V1 queues are unsupported and will cause errors; manual config migration required; no automatic data migration

**Breaking Changes**:

1. **Node.js Requirement** (v22+ → v24+)
   - Must upgrade Node.js before upgrading CLI

2. **Package Name**
   - v1.0.0+: `@kinginyellows/codemachine-pipeline`
   - Install: `npm install -g @kinginyellows/codemachine-pipeline`
   - If you previously installed a different/unscoped package name, uninstall it and install the scoped package above

3. **Queue Format** (V1 → V2) - NO AUTOMATIC MIGRATION
   - V1: JSONL files (`queue.jsonl`, `queue_updates.jsonl`)
   - V2: WAL + snapshot (`queue_operations.log`, `queue_snapshot.json`)
   - **Migration Behavior**: ERROR + RESTART REQUIRED
     - System detects V1 queue format and throws error: `Legacy V1 queue format detected...`
     - V1 queues are NOT automatically migrated to V2
     - Old queue state is LOST (not preserved)
     - User must start a new run to create fresh V2 queue
     - See `src/workflows/queueCache.ts:detectLegacyV1Queue()` for detection logic

4. **Configuration Schema**
   - New `governance` object (optional but recommended)
   - Deprecated fields (still work with warnings):
     - `governance_notes` → `governance.governance_notes`
     - `safety.require_approval_for_*` → `governance.approval_workflow.*`
   - New `config_history` array for tracking migrations

**Manual Migration Checklist**:

```bash
# 1. Backup config
cp .codepipe/config.json .codepipe/config.json.backup

# 2. Update schema version
# Edit config.json: "schema_version": "1.0.0"

# 3. Add governance section (recommended)
# Add: "governance": { "approval_workflow": {...}, "accountability": {...} }

# 4. Add config_history
# Add: "config_history": [{ "timestamp": "2026-02-16T00:00:00Z", "schema_version": "1.0.0", "changed_by": "manual migration", "change_description": "Upgrade config schema to 1.0.0" }]

# 5. Validate
codepipe init --validate-only

# 6. Test
codepipe doctor
```

**Important Notes**:

- **V1 Queue Data Loss**: Upgrading with V1 queues will result in loss of queue state (no automatic migration)
- **No Backward Compatibility**: V1 queue format cannot be used with v1.0.0+
- **Config Migration Only**: Config migration has some automation via deprecation warnings, but V1 queues require manual restart
- **No Automated Migration Script**: Intentional design decision - config is governance-critical and requires manual review

**What Happens When User Upgrades with V1 Queue**:

1. User upgrades to v1.0.0+
2. User runs any queue operation (e.g., `codepipe resume --feature <feature_id>`)
3. System calls `getV2IndexCache()` which calls `detectLegacyV1Queue()`
4. Error is thrown: `Legacy V1 queue format detected in {queueDir}. V1 queues are no longer supported. Please migrate your queue to V2 format or recreate the run.`
5. User's queue state is NOT migrated
6. User must start a new run with `codepipe start` to create fresh V2 queue
7. Old queue data from V1 is lost

**Sources**:

- `src/workflows/queueCache.ts:56-121` - `detectLegacyV1Queue()` function (lines 78-121 show error throwing logic)
- `src/workflows/queueCache.ts:44` - `getV2IndexCache()` calls detection (line 57)
- `CHANGELOG.md:12-88` - Breaking changes documentation
- `docs/archive/announcements/v1.0.0-release.md:126-132` - Release announcement
- `docs/reference/config/config_migrations.md` - Config migration guide (queue format NOT covered)

**Documentation Impact**:

- Must clearly warn users: "V1 queues are UNSUPPORTED and will cause errors"
- Must document: "Upgrading with active V1 queues will result in data loss"
- Must provide: Step-by-step recovery instructions for users with V1 queues
- Must clarify: This is a breaking change, not a migration path

---

### Q14: Concurrent Pipeline Execution Support

**Answer**: **YES** - Fully supported via exclusive file locking (same as Q7)

**Support Matrix**:

| Scenario                           | Supported? | Mechanism                              |
| ---------------------------------- | ---------- | -------------------------------------- |
| Multiple users, different features | ✅ Yes     | Separate run directories, no conflicts |
| Multiple users, same feature       | ❌ No      | File lock timeout (30s), then failure  |
| Multiple tasks, same pipeline      | ✅ Yes     | Dependency-aware scheduling            |
| Resume after crash                 | ✅ Yes     | Stale lock detection + recovery        |

**Configuration**:

- Environment: `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=1-10`
- Config: `runtime.max_concurrent_tasks`
- Default: 3 (schema default per `runtime.max_concurrent_tasks`)

**Throughput Gains**:

- 1 concurrent task: Baseline (sequential)
- 2-4 concurrent tasks: 2-4x speedup (independent tasks)
- Dependency-blocked tasks: Wait for prerequisites

**Sources**: Same as Q7 (queue locking mechanism)

**Documentation Impact**: Must document concurrency model, configuration tuning

---

### Q15: Platform Support Matrix

**Answer**: All major platforms supported (Windows, macOS, Linux) with Node.js >=24.0.0

**Supported Platforms**:

- ✅ macOS (darwin-arm64, darwin-x64)
- ✅ Linux (linux-x64, linux-arm64)
- ✅ Windows (win32-x64)

**Platform Detection**:

- Uses `process.platform` and `process.arch` for binary resolution
- Optional dependencies install platform-specific CodeMachine CLI binaries

**Platform-Specific Considerations**:

- **Windows**: PID checking limited (falls back to time-based stale locks)
- **macOS/Linux**: Full process validation via signal 0
- **All platforms**: Requires git installed and in PATH

**Version Requirements**:

- Node.js: >=24.0.0 (enforced via `package.json` `engines`)

**Recommended tooling (not currently enforced)**:

- npm: a modern npm (bundled with Node.js; >=9 recommended)
- git: a modern git (>=2.20 recommended)

**Sources**:

- `package.json:23-25` - engines field
- No `os` field = all platforms supported
- `src/adapters/codemachine/binaryResolver.ts` - Platform-specific binary selection

**Documentation Impact**: Installation guide must include platform-specific instructions

---

## Decision Summary Table

| #   | Question               | Answer Summary                           | Impact on Docs            |
| --- | ---------------------- | ---------------------------------------- | ------------------------- |
| 1   | Node.js version        | >=24.0.0                                 | Prerequisites page        |
| 2   | Config discovery       | Two-path: init=git root, runtime=cwd     | Configuration overview    |
| 3   | CLI resolution         | 3-path priority (env → optional → PATH)  | CodeMachine CLI guide     |
| 4   | Approval mechanics     | 7 gates, hash validation, two-file model | Workflows, approval guide |
| 5   | Required fields        | 5 core required fields                   | Config file reference     |
| 6   | LINEAR_API_KEY         | Optional (warning if enabled)            | Configuration guide       |
| 7   | Queue locking          | File-based exclusive locks               | Team collaboration        |
| 8   | .codepipe/ committable | Partially - only 4 subdirs gitignored    | Team collaboration        |
| 9   | Queue backup           | Automatic snapshot + WAL                 | Disaster recovery         |
| 10  | Credential precedence  | Env var override pattern                 | Security guide            |
| 11  | Debug logging          | --verbose/--json flags                   | Troubleshooting           |
| 12  | AI API keys            | ANTHROPIC_API_KEY, OPENAI_API_KEY        | Configuration             |
| 13  | Migration v1.0         | NO auto queue migration, manual config   | Migration guide           |
| 14  | Concurrent execution   | YES - via locking                        | Advanced usage            |
| 15  | Platform support       | All platforms, Node >=24                 | Installation              |

## Documentation Decisions

### Critical Corrections Applied

1. ✅ Environment variable names corrected (CODEMACHINE_BIN_PATH not CLI_PATH)
2. ✅ Config schema structure corrected (nested, not flat)
3. ✅ Non-existent CODEMACHINE_LOG_LEVEL removed
4. ✅ CODEPIPE\_\* override family documented

### Key Documentation Requirements

1. **Configuration Guide Must Include**:
   - Nested config.json structure examples
   - Environment variable indirection explanation
   - CODEPIPE\_\* override table (8 variables)
   - Credential security best practices

2. **Installation Guide Must Include**:
   - Platform-specific instructions (Windows, macOS, Linux)
   - Node.js >=24.0.0 requirement prominently featured
   - CodeMachine CLI resolution (3 paths)

3. **Workflows Guide Must Include**:
   - Approval gate mechanics with hash validation
   - State persistence (manifest.json + approvals.json)
   - Resume blocking behavior

4. **Team Collaboration Guide Must Include**:
   - .codepipe/ gitignore strategy
   - Secret sharing workflow (template config + local env vars)
   - Multi-user queue locking guarantees
   - Concurrent execution limits

5. **Disaster Recovery Guide Must Include**:
   - Automatic snapshot + WAL recovery
   - Manual recovery procedures (validate, rebuild)
   - Queue file format and portability

6. **Troubleshooting Guide Must Include**:
   - Debug logging (--verbose/--json)
   - Log analysis techniques (jq queries)
   - Exit codes reference (0, 10, 30, 1)

## Implementation Notes

### Phase 1 Deliverables

- [x] All 15 critical questions answered
- [x] Findings stored in memory (namespace: `docs-questions`)
- [x] This ADR document created
- [ ] Decision log in planning document (to be updated)

### Next Steps (Phase 2)

With all critical questions answered, Phase 2 (Content Audit) can proceed with confidence:

- Audit existing documentation against these findings
- Identify factual errors in current docs
- Plan content rewrites based on verified architecture

## References

### Memory Storage

All research findings stored in claude-flow memory system:

- Namespace: `docs-questions`
- Keys: `q1` through `q15`
- Retrievable via: `npx @claude-flow/cli@latest memory retrieve --key "q<N>" --namespace "docs-questions"`

### Source Code References

| Component         | File Path                                  | Key Lines |
| ----------------- | ------------------------------------------ | --------- |
| Config loading    | src/core/config/RepoConfig.ts              | 1-805     |
| Approval system   | src/cli/commands/approve.ts                | 1-521     |
| Queue locking     | src/persistence/runDirectoryManager.ts     | 1-1112    |
| Binary resolution | src/adapters/codemachine/binaryResolver.ts | 1-125     |
| Debug logging     | src/telemetry/logger.ts                    | 1-640     |

### Related ADRs

- ADR-5: Governance Framework
- ADR-7: Validation Policy
- ADR-8: CodeMachine CLI Integration

---

**Decision**: Accepted
**Date**: 2026-02-15
**Participants**: Research agents (6 concurrent), Claude Code
**Status**: Complete - all 15 questions answered with code references
