# Product Requirements Document: CodeMachine CLI Execution Engine Adapter

**PRD ID**: PRD-2026-001
**Version**: 1.0
**Effective Date**: 2026-01-02
**Status**: Draft

---

## 1. Executive Summary

The ai-feature pipeline currently lacks a concrete execution engine implementation. This PRD defines the integration of CodeMachine CLI as the primary execution engine, enabling autonomous code generation, validation, and artifact management. The adapter will bridge the existing queue/resume infrastructure with CodeMachine's CLI-based workflow orchestration, providing a production-ready execution layer while preserving the pipeline's telemetry, resumability, and governance controls.

**Expected Impact**: Enable end-to-end autonomous feature development with <5% manual intervention rate, reduce feature delivery time by 60%, and maintain 95%+ execution success rate with automatic retry and resume capabilities.

---

## 2. Problem Statement

### Current State

The ai-feature pipeline has robust planning (`taskPlanner`), queue persistence (`queueStore`), resume logic (`resumeCoordinator`), and telemetry (`executionMetrics`), but no execution engine implementation. The `docs/requirements/execution_flow.md` describes an execution module that does not exist in `src/execution/`. Tasks are planned but never executed.

**Current Workflow**:

1. User runs `ai-feature start <spec>`
2. PRD generated → Plan created → Queue initialized
3. **Pipeline stops** - no execution engine to consume queue

### Pain Points

- **No Code Generation**: Pipeline cannot autonomously write code despite having complete task plans
- **Manual Execution Required**: Developers must manually implement planned tasks
- **Incomplete Automation**: 80% of pipeline infrastructure exists but final 20% (execution) is missing
- **Integration Complexity**: Multiple execution patterns exist (autoFixEngine, patchManager) but no unified engine
- **CLI Output Fragility**: CodeMachine CLI emits human-readable output; parsing is error-prone without structured contracts

### Opportunity

Integrating CodeMachine CLI as the execution engine completes the autonomous pipeline. With CodeMachine's multi-engine support (Claude Code, Codex CLI), the pipeline can execute tasks with configurable AI backends while leveraging existing queue/resume/telemetry infrastructure.

**Quantified Impact**:

- Reduce feature delivery time from 5 days → 2 days (60% reduction)
- Achieve 95%+ task success rate with retry logic
- Enable 24/7 autonomous execution with resume-on-failure
- Support 3+ AI engines (Claude, Codex, OpenAI) via CodeMachine

---

## 3. Target Users and Personas

| Persona               | Goals                                                                                        | Pain Points                                                                                      | Usage Frequency             |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------- |
| **Platform Engineer** | Automate feature delivery, reduce manual coding, maintain pipeline reliability               | No execution engine, manual task implementation, fragmented execution patterns                   | Daily (pipeline operations) |
| **AI Agent**          | Execute planned tasks autonomously, handle failures gracefully, produce verifiable artifacts | Lack of structured CLI output, auth/engine coordination complexity, workflow semantic mismatches | Continuous (task execution) |
| **DevOps Engineer**   | Monitor execution health, debug failures, ensure resumability                                | No execution telemetry, unclear failure modes, missing CLI integration patterns                  | Weekly (incident response)  |

---

## 4. Feature Description and User Stories

### Feature Overview

The CodeMachine CLI Execution Engine Adapter enables autonomous task execution by:

1. Translating pipeline ExecutionTasks into CodeMachine CLI invocations
2. Managing CLI lifecycle (spawn, monitor, timeout, capture output)
3. Updating queue state based on CLI exit codes and log parsing
4. Persisting artifacts (logs, patches, summaries) in run directory
5. Providing resume-on-failure with queue integrity checks

### User Stories

**US-EXEC-001**: Priority MUST

```
As a Platform Engineer
I want the pipeline to execute planned tasks autonomously
So that features are delivered without manual coding
```

**Acceptance Criteria**:

- [ ] [AC-01] `ai-feature start <spec>` executes all queued tasks without human intervention
- [ ] [AC-02] CLI invokes `codemachine start` with correct spec/workspace/engine parameters
- [ ] [AC-03] Task status updates to `IN_PROGRESS` → `COMPLETED` or `FAILED` based on exit codes
- [ ] [AC-04] Execution completes within 2x estimated duration or times out gracefully

**US-EXEC-002**: Priority MUST

```
As an AI Agent
I want to map ExecutionTask types to CodeMachine workflows
So that each task type executes with the correct workflow template
```

**Acceptance Criteria**:

- [ ] [AC-05] `CODE_GENERATION` tasks invoke `codemachine start` with generation workflow
- [ ] [AC-06] `VALIDATION` tasks use existing `AutoFixEngine` (no CodeMachine invocation)
- [ ] [AC-07] `RESEARCH` tasks invoke `codemachine run` with research workflow
- [ ] [AC-08] Unsupported task types fail fast with clear error message

**US-EXEC-003**: Priority MUST

```
As a DevOps Engineer
I want execution failures to be resumable
So that transient errors don't require full pipeline restarts
```

**Acceptance Criteria**:

- [ ] [AC-09] Failed tasks remain in queue with `FAILED` status and retry count
- [ ] [AC-10] `ai-feature resume` re-executes failed tasks with incremented retry count
- [ ] [AC-11] Retry limit (default: 3) prevents infinite retry loops
- [ ] [AC-12] Resume validates queue integrity via SHA-256 hash manifest

**US-EXEC-004**: Priority SHOULD

```
As a Platform Engineer
I want to select AI engines per task
So that I can optimize cost/quality tradeoffs
```

**Acceptance Criteria**:

- [ ] [AC-13] Config supports `execution.default_engine` (claude|codex|openai)
- [ ] [AC-14] Tasks can override engine via `task.engine` field
- [ ] [AC-15] CLI invokes engine-specific commands (`codemachine claude run`)
- [ ] [AC-16] Missing engine fails fast with actionable error

**US-EXEC-005**: Priority SHOULD

```
As an AI Agent
I want structured CLI output
So that I can reliably parse execution results
```

**Acceptance Criteria**:

- [ ] [AC-17] Adapter parses exit codes: 0=success, 1=failure, 124=timeout
- [ ] [AC-18] Stdout/stderr captured and stored in `<runDir>/logs/<taskId>.log`
- [ ] [AC-19] Summary extracted from logs via regex or structured markers
- [ ] [AC-20] Parsing failures log warning but don't crash adapter

---

## 5. Functional Requirements

| ID           | Description                                                                                                | Priority | Related Story | Rationale                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------- | ------------- | ----------------------------------------------------------------- |
| REQ-EXEC-001 | Implement `CodeMachineRunner` utility to spawn CLI processes with timeout, env controls, and log streaming | MUST     | US-EXEC-001   | Core execution primitive; reuses patterns from `autoFixEngine.ts` |
| REQ-EXEC-002 | Create `TaskMapper` to translate `ExecutionTaskType` to CodeMachine workflows                              | MUST     | US-EXEC-002   | Ensures correct workflow selection per task type                  |
| REQ-EXEC-003 | Implement `CLIExecutionEngine` in `src/workflows/cliExecutionEngine.ts` to orchestrate queue consumption   | MUST     | US-EXEC-001   | Central coordinator for execution lifecycle                       |
| REQ-EXEC-004 | Add `initializeQueueFromPlan` function to bridge `taskPlanner` output to `queueStore`                      | MUST     | US-EXEC-001   | Wires planning to execution; currently missing                    |
| REQ-EXEC-005 | Implement `ResultNormalizer` to parse CLI output and extract success/failure/summary                       | MUST     | US-EXEC-005   | Handles non-JSON CLI output; isolates parsing fragility           |
| REQ-EXEC-006 | Update `ExecutionTask` status via `updateTaskInQueue` based on CLI exit codes                              | MUST     | US-EXEC-001   | Maintains queue state consistency                                 |
| REQ-EXEC-007 | Emit telemetry events (`taskStarted`, `taskCompleted`, `taskFailed`) around CLI execution                  | MUST     | US-EXEC-001   | Integrates with existing `ExecutionLogWriter`                     |
| REQ-EXEC-008 | Store CLI stdout/stderr in `<runDir>/logs/<taskId>.log`                                                    | MUST     | US-EXEC-005   | Enables post-execution debugging                                  |
| REQ-EXEC-009 | Implement retry logic with exponential backoff for transient failures                                      | MUST     | US-EXEC-003   | Handles network/API transient errors                              |
| REQ-EXEC-010 | Add config field `execution.codemachine_cli_path` with default `codemachine`                               | MUST     | US-EXEC-001   | Allows custom CLI binary paths                                    |
| REQ-EXEC-011 | Validate `codemachine` CLI availability on startup; fail fast if missing                                   | MUST     | US-EXEC-001   | Prevents silent failures mid-execution                            |
| REQ-EXEC-012 | Support engine selection via config `execution.default_engine` and task-level override                     | SHOULD   | US-EXEC-004   | Enables cost/quality optimization                                 |
| REQ-EXEC-013 | Implement timeout mechanism (default: 30min per task) with graceful termination                            | MUST     | US-EXEC-001   | Prevents hung processes                                           |
| REQ-EXEC-014 | Add `execution.workspace_dir` config to specify CodeMachine workspace root                                 | MUST     | US-EXEC-001   | Isolates execution environment                                    |
| REQ-EXEC-015 | Implement artifact capture: copy CodeMachine outputs to `<runDir>/artifacts/<taskId>/`                     | SHOULD   | US-EXEC-001   | Preserves execution artifacts for review                          |

---

## 6. Non-Functional Requirements

| ID            | Category        | Requirement                   | Metric                                | Target            |
| ------------- | --------------- | ----------------------------- | ------------------------------------- | ----------------- |
| NFR-PERF-001  | Performance     | Task execution overhead       | Adapter overhead vs raw CLI           | <5% overhead      |
| NFR-PERF-002  | Performance     | Queue update latency          | Time to update task status            | <100ms p95        |
| NFR-PERF-003  | Performance     | Log streaming throughput      | CLI output capture rate               | >10MB/s           |
| NFR-REL-001   | Reliability     | Execution success rate        | Tasks completed without retry         | >95%              |
| NFR-REL-002   | Reliability     | Resume success rate           | Resumed runs complete successfully    | >90%              |
| NFR-REL-003   | Reliability     | Queue integrity               | Hash manifest validation pass rate    | 100%              |
| NFR-SEC-001   | Security        | Credential isolation          | No credentials in logs/artifacts      | 0 leaks           |
| NFR-SEC-002   | Security        | CLI injection prevention      | Sanitized CLI arguments               | 0 vulnerabilities |
| NFR-OBS-001   | Observability   | Execution telemetry coverage  | Tasks with start/complete/fail events | 100%              |
| NFR-OBS-002   | Observability   | Log retention                 | Execution logs retained               | 30 days           |
| NFR-MAINT-001 | Maintainability | Adapter test coverage         | Unit + integration test coverage      | >80%              |
| NFR-MAINT-002 | Maintainability | CLI output parsing resilience | Parsing failures don't crash adapter  | 100%              |

---

## 7. Edge Cases

| ID          | Related Req  | Scenario                                     | Expected Behavior                                                                                              |
| ----------- | ------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| EC-EXEC-001 | REQ-EXEC-001 | CodeMachine CLI not found in PATH            | Fail fast on startup with error: "CodeMachine CLI not found at <path>. Install via npm install -g codemachine" |
| EC-EXEC-002 | REQ-EXEC-001 | CLI process killed externally (SIGKILL)      | Mark task as `FAILED`, log "Process terminated externally", allow retry                                        |
| EC-EXEC-003 | REQ-EXEC-005 | CLI output contains no parseable summary     | Log warning, use generic summary "Task completed with exit code 0", continue                                   |
| EC-EXEC-004 | REQ-EXEC-006 | Queue file corrupted mid-execution           | Detect via hash mismatch, halt execution, require `--force` resume                                             |
| EC-EXEC-005 | REQ-EXEC-009 | Retry limit exceeded (3 failures)            | Mark task as `PERMANENTLY_FAILED`, halt queue, require human intervention                                      |
| EC-EXEC-006 | REQ-EXEC-013 | Task exceeds timeout (30min default)         | Send SIGTERM, wait 10s, send SIGKILL, mark `FAILED` with "Timeout exceeded"                                    |
| EC-EXEC-007 | REQ-EXEC-012 | Task specifies unsupported engine            | Fail task immediately with "Engine 'xyz' not supported. Supported: claude, codex, openai"                      |
| EC-EXEC-008 | REQ-EXEC-014 | Workspace directory does not exist           | Create directory if parent exists, else fail with "Workspace parent <path> not found"                          |
| EC-EXEC-009 | REQ-EXEC-001 | CLI exits with unknown code (e.g., 137)      | Log warning "Unknown exit code 137", treat as failure, allow retry                                             |
| EC-EXEC-010 | REQ-EXEC-015 | Artifact directory write fails (permissions) | Log error, continue execution, mark artifact capture as failed in metadata                                     |
| EC-EXEC-011 | REQ-EXEC-004 | Plan contains zero tasks                     | Skip queue initialization, log "No tasks to execute", exit successfully                                        |
| EC-EXEC-012 | REQ-EXEC-001 | CLI stdout exceeds buffer size (10MB)        | Stream to file, log warning "Large output detected", continue                                                  |

---

## 8. Out of Scope

- **CodeMachine CLI Installation**: Adapter assumes CLI is pre-installed; installation automation is out of scope
- **Custom Workflow Templates**: Adapter uses CodeMachine's default workflows; custom template authoring is out of scope
- **Multi-Repo Execution**: Single workspace per run; multi-repo orchestration deferred to future iteration
- **Real-Time Progress Streaming**: CLI output captured post-execution; live streaming UI deferred
- **Distributed Execution**: Single-node execution only; distributed task execution out of scope
- **CodeMachine CLI Versioning**: Adapter assumes latest stable CLI; version pinning deferred

---

## 9. Success Metrics

| Metric                               | Target                 | Measurement Frequency | Alert Threshold |
| ------------------------------------ | ---------------------- | --------------------- | --------------- |
| Task Execution Success Rate          | >95%                   | Per run               | <90%            |
| Execution Overhead                   | <5% vs raw CLI         | Per task              | >10%            |
| Resume Success Rate                  | >90%                   | Per resume attempt    | <80%            |
| Queue Integrity Validation Pass Rate | 100%                   | Per queue operation   | <100%           |
| CLI Parsing Failure Rate             | <5%                    | Per task              | >10%            |
| Mean Time to Execute (MTTE)          | <2x estimated duration | Per task              | >3x             |
| Retry Rate                           | <10% of tasks          | Per run               | >20%            |
| Permanent Failure Rate               | <2% of tasks           | Per run               | >5%             |

---

## 10. Agent Implementation Details

### Agent Roles and Responsibilities

**CodeMachineRunner Agent**:

- Spawn CLI processes with timeout and environment controls
- Stream stdout/stderr to log files
- Capture exit codes and signal termination events
- Enforce resource limits (memory, CPU via cgroups if available)

**TaskMapper Agent**:

- Translate `ExecutionTaskType` enum to CodeMachine workflow identifiers
- Validate task-to-workflow mappings
- Provide fallback workflows for unmapped types

**CLIExecutionEngine Agent**:

- Consume tasks from queue via `getNextTask`
- Orchestrate CodeMachineRunner invocations
- Update queue state via `updateTaskInQueue`
- Emit telemetry events via `ExecutionLogWriter`
- Handle retry logic and backoff

**ResultNormalizer Agent**:

- Parse CLI output for success/failure indicators
- Extract summary text via regex or structured markers
- Sanitize logs (remove credentials, PII)
- Normalize exit codes to task status

### Agent Autonomy Level

**L3 - Conditional Autonomy**:

- Agents execute tasks autonomously within retry limits
- Human approval required for:
  - Permanent failures (retry limit exceeded)
  - Queue integrity failures (hash mismatch)
  - Unknown engine selection
- Agents can retry transient failures up to 3 times without approval
- Agents cannot modify queue structure or skip tasks without approval

### Agent Tooling and Access

**APIs**:

- CodeMachine CLI (via `child_process.spawn`)
- Queue Store API (`getNextTask`, `updateTaskInQueue`, `appendToQueue`)
- Run Directory Manager API (`setLastError`, `setCurrentStep`, `clearLastError`)
- Execution Telemetry API (`taskStarted`, `taskCompleted`, `taskFailed`)

**Databases**:

- JSONL queue file (read/write via `queueStore`)
- Hash manifest (read/write via `runDirectoryManager`)
- Execution logs (write-only to `<runDir>/logs/`)

**Forbidden Actions**:

- Direct queue file writes (must use `queueStore` API)
- Credential logging (must sanitize via `ResultNormalizer`)
- Queue structure modification (cannot reorder/skip tasks)
- Force push to protected branches (existing governance)

---

## 11. Guardrails and Constraints

| ID             | Category       | Constraint                         | Enforcement                                             |
| -------------- | -------------- | ---------------------------------- | ------------------------------------------------------- |
| GUARD-SEC-001  | Security       | No credentials in CLI arguments    | Sanitize args via whitelist; use env vars for secrets   |
| GUARD-SEC-002  | Security       | No credentials in logs/artifacts   | `ResultNormalizer` redacts patterns (API keys, tokens)  |
| GUARD-REL-001  | Reliability    | Retry limit = 3 attempts           | `CLIExecutionEngine` enforces max retry count           |
| GUARD-REL-002  | Reliability    | Timeout = 30min default            | `CodeMachineRunner` enforces via `setTimeout` + SIGTERM |
| GUARD-DATA-001 | Data Integrity | Queue updates atomic               | Use `fs.rename` for atomic writes in `queueStore`       |
| GUARD-DATA-002 | Data Integrity | Hash manifest validation on resume | `resumeCoordinator` validates before execution          |
| GUARD-PERF-001 | Performance    | Max concurrent tasks = 1           | Single-threaded execution; parallelism deferred         |
| GUARD-PERF-002 | Performance    | Log file size limit = 100MB        | Rotate logs if exceeded; warn user                      |
| GUARD-OPS-001  | Operations     | CLI availability check on startup  | Fail fast if `codemachine` not in PATH                  |
| GUARD-OPS-002  | Operations     | Workspace isolation                | Each run uses isolated workspace dir                    |

---

## 12. Risk and Mitigation

| Risk                                                                                       | Likelihood | Impact   | Mitigation                                                                                                            |
| ------------------------------------------------------------------------------------------ | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| **CLI Output Parsing Fragility**: CodeMachine output format changes break adapter          | High       | High     | Implement `ResultNormalizer` with regex fallbacks; log parsing failures as warnings; use exit codes as primary signal |
| **Auth Drift**: CodeMachine CLI auth state diverges from pipeline provider manifests       | Medium     | Medium   | Document auth coordination; add `ai-feature doctor` check for auth consistency; fail fast on auth errors              |
| **Workflow Semantic Mismatch**: CodeMachine workflows don't align with ExecutionTask types | Medium     | High     | Implement flexible `TaskMapper` with fallback workflows; allow custom workflow overrides in config                    |
| **CLI Availability**: CodeMachine CLI not installed or wrong version                       | High       | High     | Add startup validation; provide clear installation instructions in error messages                                     |
| **Timeout Tuning**: Default 30min timeout too short/long for some tasks                    | Medium     | Medium   | Make timeout configurable per task type; log timeout events for tuning                                                |
| **Retry Exhaustion**: Transient failures exceed retry limit                                | Medium     | Medium   | Implement exponential backoff; allow manual retry via `ai-feature resume --force`                                     |
| **Queue Corruption**: Concurrent writes or crashes corrupt queue file                      | Low        | High     | Use atomic writes (`fs.rename`); validate hash manifest on every resume                                               |
| **Resource Exhaustion**: Long-running tasks consume excessive memory/CPU                   | Low        | Medium   | Implement timeout enforcement; add resource monitoring to telemetry                                                   |
| **Credential Leakage**: Secrets logged in CLI output                                       | Low        | Critical | Implement credential redaction in `ResultNormalizer`; audit logs in tests                                             |

---

## Implementation Checklist

### Phase 1: Core Adapter (Week 1)

- [ ] Create `src/workflows/cliExecutionEngine.ts` with `CLIExecutionEngine` class
- [ ] Implement `CodeMachineRunner` utility in `src/workflows/codeMachineRunner.ts`
- [ ] Add `TaskMapper` in `src/workflows/taskMapper.ts`
- [ ] Implement `ResultNormalizer` in `src/workflows/resultNormalizer.ts`
- [ ] Add config schema fields: `execution.codemachine_cli_path`, `execution.default_engine`, `execution.workspace_dir`, `execution.task_timeout_ms`
- [ ] Update `RepoConfig` Zod schema with execution fields

### Phase 2: Queue Integration (Week 1)

- [ ] Implement `initializeQueueFromPlan` in `src/workflows/queueStore.ts`
- [ ] Wire `taskPlanner` output to queue initialization
- [ ] Add queue consumption loop in `CLIExecutionEngine`
- [ ] Implement task status updates via `updateTaskInQueue`
- [ ] Add retry logic with exponential backoff

### Phase 3: Telemetry & Artifacts (Week 2)

- [ ] Emit `taskStarted`, `taskCompleted`, `taskFailed` events
- [ ] Implement log file streaming to `<runDir>/logs/<taskId>.log`
- [ ] Add artifact capture to `<runDir>/artifacts/<taskId>/`
- [ ] Implement credential redaction in `ResultNormalizer`
- [ ] Add execution metrics (overhead, success rate, MTTE)

### Phase 4: Testing & Validation (Week 2)

- [ ] Unit tests for `CodeMachineRunner` (exit codes, timeouts, signals)
- [ ] Unit tests for `TaskMapper` (all ExecutionTaskType mappings)
- [ ] Unit tests for `ResultNormalizer` (parsing, redaction)
- [ ] Integration test: end-to-end execution with mock CodeMachine CLI
- [ ] Integration test: resume after failure
- [ ] Integration test: retry exhaustion
- [ ] Add smoke test to `scripts/tooling/smoke_execution.sh`

### Phase 5: Documentation & Rollout (Week 3)

- [ ] Update `docs/requirements/execution_flow.md` with adapter details
- [ ] Add `docs/ops/codemachine_adapter_guide.md`
- [ ] Update `README.md` with execution engine setup
- [ ] Add `ai-feature doctor` check for CodeMachine CLI availability
- [ ] Update `CHANGELOG.md` with new execution engine feature
- [ ] Create migration guide for existing runs

---

**End of PRD**
