# Execution Engine Flow

## Overview

The Execution Engine orchestrates the transformation of approved specifications into executed code changes through a deterministic, resumable, and auditable task execution pipeline. This document describes the execution flow, DAG semantics, dependency resolution, and resume behavior.

## Purpose

- **Deterministic Execution**: Ensure repeatable task ordering via DAG topological sort
- **Dependency Management**: Enforce execution constraints based on task relationships
- **Resume Capability**: Support restart from failure points without re-executing completed work
- **Observability**: Provide CLI visibility into plan states, queue statuses, and blockers
- **Traceability**: Maintain links between PRD goals → Spec requirements → Execution tasks → Code diffs

## Architecture

### Key Components

The execution flow integrates four primary components:

1. **Task Planner** (`src/workflows/taskPlanner.ts`)
   - Converts spec.json test_plan → ExecutionTask DAG
   - Generates stable, deterministic task IDs
   - Validates DAG for cycles and missing dependencies
   - Persists plan.json with checksum for integrity

2. **Queue Coordinator** (Future: `src/workflows/queueCoordinator.ts`)
   - Reads plan.json and initializes execution queue
   - Enqueues entry tasks (no dependencies)
   - Monitors dependency satisfaction
   - Updates queue state (pending → running → completed/failed)

3. **Execution Engine** (`src/workflows/cliExecutionEngine.ts`)
   - Dequeues tasks in topological order
   - Applies code patches with allowlist enforcement
   - Runs validation commands (lint, test, build)
   - Commits changes to feature branch
   - Records execution artifacts (logs, diffs, metrics)

4. **Resume Coordinator** (Future: `src/workflows/resumeCoordinator.ts`)
   - Loads last execution state from run directory
   - Identifies last successfully completed task
   - Skips completed tasks via checksum verification
   - Replays execution from failure point

### Data Flow Diagram

```
┌─────────────┐
│ PRD & Spec  │ (Approved artifacts)
│  Approved   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│   Task Planner          │
│                         │
│ 1. Load spec.json       │
│ 2. Extract test_plan    │
│ 3. Generate task nodes  │
│ 4. Build dep graph      │
│ 5. Validate DAG         │
│ 6. Topological sort     │
│ 7. Persist plan.json    │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│  Queue Coordinator      │
│                         │
│ 1. Load plan.json       │
│ 2. Enqueue entry tasks  │
│ 3. Monitor deps         │
│ 4. Update queue state   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│  Execution Engine       │
│                         │
│ 1. Dequeue task         │
│ 2. Apply patch/changes  │
│ 3. Run validations      │
│ 4. Commit to branch     │
│ 5. Mark complete        │
└──────┬──────────────────┘
       │
       ▼ (on failure)
┌─────────────────────────┐
│  Resume Coordinator     │
│                         │
│ 1. Load last state      │
│ 2. Read queue snapshot  │
│ 3. Find restart point   │
│ 4. Skip completed tasks │
│ 5. Resume execution     │
└─────────────────────────┘
```

## DAG Semantics

### Task Nodes

Each task in the plan is represented as a **TaskNode** with the following properties:

```typescript
interface TaskNode {
  task_id: string; // Stable ID (e.g., "I3-T-UNIT-001")
  title: string; // Human-readable description
  task_type: string; // "code_generation", "testing", "deployment", etc.
  dependencies: TaskDependency[]; // Required predecessor tasks
  estimated_duration_minutes?: number;
  config?: Record<string, unknown>; // Task-specific parameters
}
```

**Stable ID generation**

- IDs are derived from the iteration plus normalized requirement ID (e.g., `I3-T-UNIT-001`)
- If `trace.json` already links a spec requirement to an ExecutionTask, that task ID is reused verbatim to guarantee deterministic traceability across regenerations
- Fallback IDs append a numeric suffix when duplicates occur

### Task Dependencies

Dependencies define execution order constraints:

```typescript
interface TaskDependency {
  task_id: string; // ID of prerequisite task
  type: 'required' | 'optional'; // Enforcement level
}
```

- **Required Dependencies**: Task cannot start until all required dependencies complete successfully
- **Optional Dependencies**: Task can start even if optional dependencies fail (future enhancement)
- **Spec-defined Dependencies**: The planner respects `depends_on`/`dependencies` arrays provided within `spec.json` test_plan entries to preserve author-defined ordering

### Dependency Graph Construction

The Task Planner builds the dependency graph using these heuristics:

1. **Testing depends on Code Generation**
   - All `testing` tasks depend on all `code_generation` tasks
   - Ensures code is written before tests run

2. **Test Ordering by Type**
   - Unit tests run first (no dependencies beyond code generation)
   - Integration tests depend on unit tests
   - E2E tests depend on integration tests
   - Enforces test pyramid discipline

3. **Deployment Gating**
   - Deployment tasks depend on all testing tasks
   - Ensures quality gates pass before release

4. **Traceability Stabilizers**
   - When regenerating a plan, the planner inspects `trace.json` to reuse prior ExecutionTask IDs to maintain PRD → Spec → Task link integrity

### Topological Ordering

The planner uses **Kahn's Algorithm** to compute a valid execution order:

```
Algorithm: Topological Sort (Kahn's)
Input: List of TaskNodes with dependencies
Output: Ordered list of task IDs

1. Calculate in-degree for each task (number of dependencies)
2. Enqueue all tasks with in-degree 0 (entry tasks)
3. While queue is not empty:
   a. Dequeue task T
   b. Add T to output order
   c. For each task D that depends on T:
      - Decrement in-degree of D
      - If in-degree of D becomes 0, enqueue D
4. If output order contains all tasks, return success
5. Otherwise, DAG has a cycle (error)
```

**Depth Calculation:**

- Entry tasks have depth 0
- Depth of task T = max(depth of all dependencies) + 1
- Maximum depth indicates critical path length
- Depth and ordered task IDs are persisted inside `plan.metadata.topological_order` and `plan.metadata.critical_path_depth` for CLI consumers

**Parallel Paths:**

- Count of tasks at each depth level
- Maximum count across depths indicates parallelization opportunity

### Cycle Detection

The planner uses **DFS-based cycle detection** during DAG validation:

```
Algorithm: Detect Cycles (DFS)
Input: List of TaskNodes with dependencies
Output: True if cycle exists, False otherwise

1. Initialize visited set and recursion stack
2. For each task T:
   a. If T not visited, call DFS(T)
3. DFS(task):
   a. If task in recursion stack, return True (cycle found)
   b. If task in visited, return False
   c. Add task to visited and recursion stack
   d. For each dependency D of task:
      - If DFS(D) returns True, propagate cycle detection
   e. Remove task from recursion stack
   f. Return False
```

If a cycle is detected, plan generation fails with an error listing the involved tasks.

## Plan Persistence

### plan.json Schema

The plan is persisted as a **PlanArtifact**:

```json
{
  "schema_version": "1.0.0",
  "feature_id": "FEAT-001",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z",
  "tasks": [
    {
      "task_id": "I3-T-INT-001",
      "title": "Implement Task Planner upgrades",
      "task_type": "code_generation",
      "dependencies": [],
      "config": {
        "requirement_id": "T-INT-001",
        "test_type": "unit"
      }
    },
    {
      "task_id": "I3.T2",
      "title": "Verify plan.json includes nodes/edges",
      "task_type": "testing",
      "dependencies": [{ "task_id": "I3.T1", "type": "required" }]
    }
  ],
  "dag_metadata": {
    "total_tasks": 2,
    "parallel_paths": 1,
    "estimated_total_duration_minutes": 60,
    "generated_at": "2025-01-15T10:00:00Z",
    "generated_by": "task-planner:v1.0.0"
  },
  "metadata": {
    "iteration_id": "I3",
    "spec_hash": "b4e6f8a9d3c2...",
    "critical_path_depth": 2,
    "topological_order": ["I3-T-UNIT-001", "I3-T-INT-001"]
  },
  "checksum": "a3f5e9d8c2b1..."
}
```

### plan_metadata.json

Additional metadata for resume/status commands:

```json
{
  "schema_version": "1.0.0",
  "feature_id": "FEAT-001",
  "plan_hash": "a3f5e9d8c2b1...",
  "spec_hash": "b4e6f8a9d3c2...",
  "iteration_id": "I3",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z",
  "total_tasks": 2,
  "entry_tasks": ["I3.T1"]
}
```

### Checksum Integrity

- **SHA-256 Checksum**: Computed over plan.json content (excluding checksum field)
- **Purpose**: Detect tampering, enable idempotent resume
- **Verification**: Resume coordinator verifies checksum before replay

## Queue Orchestration

### Queue Initialization

1. Load plan.json from run directory
2. Parse tasks and dependencies
3. Enqueue entry tasks (depth 0) to queue
4. Set initial status: `pending`

### Queue State Machine

```
pending → running → completed
                 ↘ failed → pending (retry)
                         ↘ cancelled
```

- **pending**: Task waiting for dependencies
- **running**: Task currently executing
- **completed**: Task finished successfully
- **failed**: Task encountered error (retry if recoverable)
- **cancelled**: Task skipped (user intervention)

### Dependency Monitoring

The queue coordinator monitors task completion events:

1. When task T completes:
   - Find all tasks with dependency on T
   - For each dependent task D:
     - Check if all dependencies of D are completed
     - If yes, enqueue D (transition to `pending`)

2. Queue priority:
   - Tasks at lower depths execute first (topological order)
   - Within same depth, FIFO ordering

### Queue Persistence (JSONL)

Tasks are persisted in append-only JSONL format:

```
{"task_id":"I3.T1","status":"pending","queued_at":"2025-01-15T10:00:00Z"}
{"task_id":"I3.T1","status":"running","started_at":"2025-01-15T10:01:00Z"}
{"task_id":"I3.T1","status":"completed","completed_at":"2025-01-15T10:05:00Z"}
{"task_id":"I3.T2","status":"pending","queued_at":"2025-01-15T10:05:00Z"}
```

Benefits:

- Append-only (crash-safe)
- Supports idempotent replays
- Easy to parse line-by-line

## Execution Engine

### Task Execution Workflow

1. **Dequeue Task**
   - Pop next pending task from queue
   - Verify dependencies satisfied
   - Transition to `running`

2. **Apply Patch/Changes**
   - Invoke agent with task config
   - Receive code patches (unified diff format)
   - Validate file paths against allowlist
   - Apply patches to working directory

3. **Run Validations**
   - Resolve validation commands from registry
   - Execute: lint, test, build (configurable per repo)
   - Capture stdout/stderr logs
   - Parse exit codes for success/failure

4. **Auto-Fix Retry Loop**
   - If validation fails:
     - Extract error messages
     - Re-invoke agent with error context
     - Retry (max 3 attempts)
   - If all retries fail, mark task as `failed`

5. **Commit to Branch**
   - Stage changes: `git add <modified_files>`
   - Commit with standardized message:

     ```
     feat(I3.T1): Implement Task Planner upgrades

     - Generated ExecutionTask DAG from spec.json
     - Validated cycle detection
     - Persisted plan.json with checksum

     Refs: FEAT-001, T-INT-001
     ```

   - Update task status: `completed`

6. **Record Artifacts**
   - Save execution logs: `logs/I3.T1.log`
   - Save diff: `diffs/I3.T1.diff`
   - Update metrics: cost, duration, token count

## Resume Logic

### Resume Triggers

- **Manual Resume**: User runs `codepipe resume` after fixing errors
- **Automatic Resume**: Future: Retry after transient failures (rate limits, network errors)

### Resume Workflow

1. **Load Last State**
   - Read `feature.json` for `last_step`, `last_error`
   - Load `plan.json` for task definitions
   - Load `queue/tasks.jsonl` for execution history

2. **Identify Restart Point**
   - Find last successfully completed task in queue log
   - Example: If I3.T1 completed but I3.T2 failed, restart from I3.T2

3. **Skip Completed Tasks**
   - For each task in topological order:
     - If task in `completed` state AND checksum matches, skip
     - If task in `failed` or `pending` state, enqueue

4. **Replay Execution**
   - Resume from first non-completed task
   - Follow normal execution workflow
   - Preserve deterministic ordering

### Checksum-Based Skipping

- **Purpose**: Avoid re-running tasks if code unchanged
- **Mechanism**:
  1. Compute hash of task output (committed files)
  2. Compare with hash from previous run
  3. If match, mark as completed (skip execution)
  4. If mismatch, re-execute (code changed externally)

## CLI Commands

### Generate Plan

```bash
codepipe plan generate --iteration I3
```

**Effects:**

- Validates spec approval
- Generates plan.json and plan_metadata.json
- Outputs plan summary

**Output Example:**

```
✓ Spec approved (spec_hash: a3f5e9d8...)
✓ Generated 4 tasks
✓ DAG validated (no cycles)
✓ Entry tasks: I3.T1, I3.T2
✓ Max depth: 2
✓ Parallel paths: 2

Plan saved: .codepipe/FEAT-001/plan.json
```

### View Plan (JSON)

```bash
codepipe plan --json
```

**Output Example:**

```json
{
  "totalTasks": 4,
  "entryTasks": ["I3.T1", "I3.T2"],
  "blockedTasks": 2,
  "queueState": {
    "ready": ["I3.T1", "I3.T2"],
    "blocked": [
      { "taskId": "I3.T3", "waitingOn": ["I3.T1", "I3.T2"] },
      { "taskId": "I3.T4", "waitingOn": ["I3.T3"] }
    ],
    "blockers": [
      { "taskId": "I3.T3", "reason": "Waiting for dependency completion" },
      { "taskId": "I3.T4", "reason": "Waiting for dependency completion" }
    ]
  },
  "taskTypeBreakdown": {
    "code_generation": 2,
    "testing": 2
  },
  "checksum": "a3f5e9d8...",
  "lastUpdated": "2025-01-15T10:00:00Z",
  "frReferences": ["FR-12", "FR-13", "FR-14"]
}
```

### View Plan Summary

```bash
codepipe plan --summary
```

**Output Example:**

```
Execution Plan Summary
======================

Feature ID: FEAT-001
Total Tasks: 4
Entry Tasks: I3.T1, I3.T2 (2 ready to start)
Blocked Tasks: 2 (waiting for dependencies)

Checksum: a3f5e9d8c2b1a4e6f8d9...
Last Updated: 2025-01-15T10:00:00Z

Task Breakdown:
  - code_generation: 2 tasks
  - testing: 2 tasks

Dependency Graph:
  I3.T1 (code_generation) → no deps
  I3.T2 (code_generation) → no deps
  I3.T3 (testing) → depends on I3.T1, I3.T2
  I3.T4 (testing) → depends on I3.T3
```

### Status with Plan Context

```bash
codepipe status
```

**Output Example:**

```
Feature: FEAT-001
Status: in_progress

Current Task: I3.T2 (running)
Last Completed: I3.T1 (completed at 10:05:00)
Pending: I3.T3, I3.T4 (2 tasks)

Plan: 4 tasks total, 1 completed, 1 running, 2 pending
```

### Resume from Failure

```bash
codepipe resume
```

**Output Example:**

```
✓ Loaded plan.json (4 tasks)
✓ Last completed: I3.T1
✓ Resuming from: I3.T2
✓ Skipping completed tasks (verified checksums)

Resuming execution...
```

## Integration with Traceability

The execution engine maintains traceability links:

### PRD Goal → Spec Requirement → Execution Task

1. **PRD Goal**: "Enable deterministic code generation"
   - Link ID: `LINK-PRD-SPEC-GOAL-001-T-INT-001`

2. **Spec Requirement**: `T-INT-001` - "Verify plan.json includes nodes/edges with stable IDs"
   - Link ID: `LINK-SPEC-TASK-T-INT-001-I3.T1`

3. **Execution Task**: `I3.T1` - "Implement Task Planner upgrades"
   - Execution produces code diff
   - Diff linked to task via `diffs/I3.T1.diff`

### Traceability Updates

When execution completes:

1. Update `trace.json` with new links:
   - `execution_task → code_diff` (implements relationship)
   - Record commit SHA, file paths, line ranges

2. Enable impact analysis:
   - Given PRD goal, find all affected diffs
   - Given code file, trace back to PRD goals

## Error Handling

| Error Condition                 | Recovery Strategy                                                          |
| ------------------------------- | -------------------------------------------------------------------------- |
| **Cycle Detected in DAG**       | Fail plan generation; user must fix spec dependencies                      |
| **Missing Dependency**          | Fail validation; list missing task IDs                                     |
| **Validation Failure**          | Retry with auto-fix (max 3 attempts); if all fail, pause for manual review |
| **Patch Apply Failure**         | Record error context; pause execution; wait for resume                     |
| **Git Commit Failure**          | Retry commit (idempotent); if persistent, escalate to user                 |
| **Checksum Mismatch on Resume** | Warn user; offer to re-execute or skip task                                |

## Performance Characteristics

- **Plan Generation**: < 2 seconds for 100 tasks (no external API calls)
- **Queue Initialization**: < 500ms for 1000 tasks
- **Dependency Resolution**: O(V + E) where V = tasks, E = dependencies
- **Topological Sort**: O(V + E) using Kahn's algorithm
- **Cycle Detection**: O(V + E) using DFS
- **Resume Overhead**: < 1 second (checksum verification per task)

## Security Considerations

- **Path Allowlist**: Execution engine enforces repo-level allowlist (prevent writes to `.git/`, etc.)
- **Command Validation**: Only registered validation commands execute (prevent injection)
- **Checksum Integrity**: SHA-256 hashes prevent plan tampering
- **Git Safety**: Commits require valid author info; no force-push to main/master

## CodeMachine CLI Adapter

The execution engine supports delegation to the external CodeMachine CLI for autonomous task execution. This section documents the adapter integration, task routing, and operational considerations.

### Adapter Architecture

The CodeMachine CLI adapter provides a pluggable execution backend via the Strategy pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLIExecutionEngine                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ ExecutionQueue  │→ │ StrategyRouter  │→ │   TaskMapper    │  │
│  │ (V2 WAL-based)  │  │                 │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 CodeMachineStrategy                       │   │
│  │  ┌──────────────────┐    ┌────────────────────────────┐  │   │
│  │  │ CodeMachineRunner│ →  │   ResultNormalizer         │  │   │
│  │  │ (CLI Spawning)   │    │ (Output + Credential Redact)│  │   │
│  │  └──────────────────┘    └────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components:**

| Component             | File                                   | Responsibility                                             |
| --------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `CLIExecutionEngine`  | `src/workflows/cliExecutionEngine.ts`  | Queue-based task orchestration with retry logic            |
| `CodeMachineRunner`   | `src/workflows/codeMachineRunner.ts`   | CLI process spawning, log streaming, path validation       |
| `TaskMapper`          | `src/workflows/taskMapper.ts`          | Maps task types to execution strategies/workflows          |
| `ResultNormalizer`    | `src/workflows/resultNormalizer.ts`    | Output parsing, error categorization, credential redaction |
| `CodeMachineStrategy` | `src/workflows/codeMachineStrategy.ts` | Strategy implementation for CodeMachine backend            |

### Task-to-Workflow Mapping

The `TaskMapper` routes task types to appropriate execution strategies:

| Task Type         | Strategy    | Workflow         | Description                             |
| ----------------- | ----------- | ---------------- | --------------------------------------- |
| `code_generation` | CodeMachine | `start`          | AI-driven code generation               |
| `testing`         | Native      | `native-autofix` | Test execution via native AutoFixEngine |
| `pr_creation`     | CodeMachine | `run pr`         | Pull request creation                   |
| `review`          | CodeMachine | `run review`     | AI code review                          |
| `documentation`   | CodeMachine | `run docs`       | Documentation generation                |
| `deployment`      | Native      | N/A              | Handled by native executor              |

**Engine Detection:**

```typescript
const mapping = mapTaskToWorkflow(task.task_type);
// Returns: { engine: 'codemachine' | 'native', workflow?: string }
```

### Configuration Reference

CodeMachine adapter configuration in `config.json`:

```json
{
  "execution": {
    "default_engine": "claude",
    "codemachine_cli_path": "codemachine",
    "task_timeout_ms": 1800000,
    "max_retries": 3,
    "max_parallel_tasks": 1,
    "retry_backoff_ms": 5000
  }
}
```

| Field                  | Type   | Default         | Description                                             |
| ---------------------- | ------ | --------------- | ------------------------------------------------------- |
| `default_engine`       | string | `"claude"`      | Default AI engine for code generation                   |
| `codemachine_cli_path` | string | `"codemachine"` | Path to CodeMachine CLI binary                          |
| `task_timeout_ms`      | number | `1800000`       | Task timeout (30 minutes)                               |
| `max_retries`          | number | `3`             | Max retry attempts for recoverable errors               |
| `max_parallel_tasks`   | number | `1`             | Maximum number of tasks to execute in parallel          |
| `retry_backoff_ms`     | number | `5000`          | Base backoff delay for exponential retry (milliseconds) |

**Environment Overrides:**

<<<<<<< HEAD
| Variable                          | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `CODEMACHINE_BIN_PATH`            | Override CodeMachine CLI binary location          |
| `CODEPIPE_EXECUTION_CLI_PATH`     | Override `execution.codemachine_cli_path` via env |
| `CODEPIPE_EXECUTION_DEFAULT_ENGINE` | Override `execution.default_engine` via env     |
| `CODEPIPE_EXECUTION_TIMEOUT_MS`   | Override per-task timeout in milliseconds         |
=======
| Variable                            | Description                                       |
| ----------------------------------- | ------------------------------------------------- |
| `CODEMACHINE_BIN_PATH`              | Override CodeMachine CLI binary location          |
| `CODEPIPE_EXECUTION_CLI_PATH`       | Override `execution.codemachine_cli_path` via env |
| `CODEPIPE_EXECUTION_DEFAULT_ENGINE` | Override `execution.default_engine` via env       |
| `CODEPIPE_EXECUTION_TIMEOUT_MS`     | Override per-task timeout in milliseconds         |
>>>>>>> 2ab773c (style: format code with Prettier and Ruff Formatter)

### CLI Invocation

The `CodeMachineRunner` spawns CLI processes with validated parameters:

```bash
codemachine run \
  -d "/path/to/repo" \
  --spec "/path/to/spec.md" \
  claude "Implement Task Planner upgrades"
```

**Security Measures:**

- Path validation prevents traversal attacks (`../` patterns rejected)
- Task IDs are sanitized before use in file paths
- CLI arguments use parameterized commands (no shell interpolation)

### Error Handling and Retry Logic

The adapter categorizes errors for appropriate recovery:

| Category                | Recoverable | Action                         | Examples                        |
| ----------------------- | ----------- | ------------------------------ | ------------------------------- |
| `transient`             | Yes         | Retry with exponential backoff | Network timeout, rate limit     |
| `permanent`             | No          | Mark task failed               | Invalid config, auth failure    |
| `timeout`               | Yes         | Retry with extended timeout    | Long-running task               |
| `human_action_required` | No          | Pause queue, notify operator   | Approval needed, merge conflict |

**Backoff Schedule:**

| Attempt | Delay      |
| ------- | ---------- |
| 1       | 5 seconds  |
| 2       | 10 seconds |
| 3       | 20 seconds |

After max retries, task transitions to `failed` state with `recoverable: false`.

### Exit Code Semantics

The adapter interprets CLI exit codes:

| Exit Code | Meaning                         | Recovery             |
| --------- | ------------------------------- | -------------------- |
| `0`       | Success                         | Mark completed       |
| `1`       | General error                   | Retry if transient   |
| `2`       | Invalid arguments               | Permanent failure    |
| `124`     | Timeout (via `timeout` command) | Retry with extension |
| `137`     | Killed (SIGKILL)                | Retry once           |
| `143`     | Terminated (SIGTERM)            | Graceful stop        |

### Credential Redaction

The `ResultNormalizer` automatically redacts 18+ sensitive patterns:

| Pattern Type       | Example                      | Redacted Output     |
| ------------------ | ---------------------------- | ------------------- |
| Bearer tokens      | `Bearer eyJ...`              | `Bearer [REDACTED]` |
| API keys           | `sk-abc123...`               | `[REDACTED]`        |
| GitHub tokens      | `ghp_xxxxx`                  | `[REDACTED]`        |
| Private keys       | `-----BEGIN...`              | `[REDACTED]`        |
| Connection strings | `postgresql://user:pass@...` | `[REDACTED]`        |
| AWS keys           | `AKIA...`                    | `[REDACTED]`        |
| JWT tokens         | `eyJhbG...`                  | `[REDACTED]`        |

### Doctor Integration

The `codepipe doctor` command validates CodeMachine availability:

```bash
codepipe doctor
```

**Successful Check:**

```
✓ CodeMachine CLI (Execution): /usr/local/bin/codemachine 2.1.0
```

**Warning (non-blocking):**

```
⚠ CodeMachine CLI (Execution): codemachine-cli command failed
→ Install codemachine-cli: npm install -g codemachine-cli (optional for execution engine)
```

See `docs/ops/codemachine_adapter_guide.md` for comprehensive operational guidance.

## Related Requirements

- **FR-9**: Traceability (PRD → Spec → ExecutionTask → Diff mapping)
- **FR-10**: Specification Authoring (spec.json as input to planner)
- **FR-12**: Execution Task Generation (stable IDs, dependency graphs)
- **FR-13**: Dependency Management (topological sort, cycle detection)
- **FR-14**: Plan Persistence and Resume (checksum verification, skip logic)
- **ADR-7**: Validation Policy (Zod-based schema enforcement)

## Related Documents

- **Container Diagram**: `02_System_Structure_and_Data.md#3-4-container-diagram`
- **Component Diagram**: `02_System_Structure_and_Data.md#3-5-component-diagram`
- **Spec Blueprint**: `spec_blueprint.md`
- **Traceability Playbook**: `traceability_playbook.md`
- **PlantUML Diagram**: `docs/diagrams/execution_flow.puml`

## Revision History

| Version | Date       | Author      | Changes                                        |
| ------- | ---------- | ----------- | ---------------------------------------------- |
| 1.0.0   | 2025-01-15 | AI Pipeline | Initial execution flow documentation           |
| 1.1.0   | 2026-01-28 | AI Pipeline | Add CodeMachine CLI Adapter section (CDMCH-31) |
