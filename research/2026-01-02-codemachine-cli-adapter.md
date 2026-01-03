---
date: 2026-01-02T15:18:00-06:00
topic: 'Integrating CodeMachine CLI as Execution Engine'
query: 'CodeMachine CLI as the engine, I can outline an adapter design to invoke codemachine and map results into ExecutionTask.'
sources:
  internal: 10
  external: 6
tags: [research, codemachine, adapter, execution-engine, cli, orchestration]
---

# Integrating CodeMachine CLI as Execution Engine

## Executive Summary

This repo already contains robust planning, queue persistence, resume logic, and telemetry, but it lacks a concrete execution engine implementation. A CodeMachine CLI adapter is feasible by introducing a new execution runner that shells out to `codemachine start/run/step`, maps outputs to `ExecutionTask` lifecycle updates, and persists results in the existing queue/manifest system. The main risks are output parsing stability, authentication/engine selection orchestration, and aligning CodeMachine’s workflow semantics with this pipeline’s ExecutionTask schema.

## Original Query

> CodeMachine CLI as the engine, I can outline an adapter design to invoke codemachine and map results into ExecutionTask.

## Codebase Findings

### Existing Patterns

- Execution tasks are formalized in `src/core/models/ExecutionTask.ts` with schema validation, retry logic, and dependency checks.
- Queue lifecycle is implemented in `src/workflows/queueStore.ts` (JSONL queue, manifest, snapshot, `getNextTask`, `updateTaskInQueue`).
- Resume orchestration and integrity checks exist in `src/workflows/resumeCoordinator.ts`.
- Execution telemetry helpers are implemented in `src/telemetry/executionMetrics.ts` and `src/telemetry/logWriters.ts`.
- CLI already shells out to external commands in multiple workflows (`autoFixEngine`, `branchManager`, `patchManager`), providing a safe pattern for invoking external CLIs.

### Integration Points

- **Queue enqueue**: `initializeQueue` + `appendToQueue` in `src/workflows/queueStore.ts`.
- **Task selection**: `getNextTask` in `src/workflows/queueStore.ts`.
- **Task updates**: `updateTaskInQueue` in `src/workflows/queueStore.ts`.
- **Run state**: `setLastError`, `setCurrentStep`, `clearLastError` in `src/persistence/runDirectoryManager.ts`.
- **Telemetry**: `ExecutionMetricsHelper` + `ExecutionLogWriter` in `src/telemetry/*`.

### Gaps Identified

- No `src/execution/` module exists for the engine described in `docs/requirements/execution_flow.md`.
- No adapter exists for CodeMachine CLI or any CLI-based agent engine.
- Plan -> Queue initialization is not wired; the task planner builds a DAG but does not enqueue tasks.

## External Research

### Official Documentation

- **CodeMachine CLI README**: Describes CodeMachine as a CLI-native orchestration engine with supported AI engines including Codex CLI and Claude Code. Early development warning present.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI
- **CLI Reference**: Documents `codemachine start`, `run`, `step`, `auth login/logout`, and engine-specific commands like `codemachine claude run` or `codemachine codex run`. Notes exit codes for `start` and environment guardrails for OpenCode.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/cli-reference.md
- **Architecture**: Explains workflow templates, agents, and orchestration patterns.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/architecture.md
- **Customization**: Shows how to configure agents, workflows, and engine selection.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/customizing-workflows.md
- **Specification Schema**: Provides spec structure, useful for aligning inputs.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/specification-schema.md

### Best Practices

- Use `codemachine start` for non-interactive CI flows with deterministic exit codes.
- Prefer engine-specific commands (`codemachine claude run ...`) to pin execution engine.
- For OpenCode engine use, CodeMachine injects safe environment defaults; similar guardrails may be needed for other engines.

### Real-World Examples

- No external repositories were found directly integrating CodeMachine CLI into an existing execution pipeline. Documentation implies intended use as a primary orchestrator rather than a component.

### Common Pitfalls

1. **Output Parsing Fragility**: CodeMachine CLI emits human-readable output; the adapter must handle non-JSON output or use structured logs if available.
2. **Auth Drift**: CodeMachine CLI manages its own auth; this pipeline manages provider manifests. Keeping them consistent requires explicit coordination.
3. **Workflow Semantics Mismatch**: CodeMachine workflows are agent/step-centric; this pipeline’s ExecutionTask types may not map 1:1.

## Feasibility Assessment

### Feasible

- Shelling out to `codemachine start/run/step` is consistent with existing CLI and workflow patterns.
- ExecutionTask lifecycle and queue persistence are in place for robust tracking and resuming.
- Telemetry hooks exist to capture task-level metrics and logs.

### Risk Areas

- Lack of structured output contract from CodeMachine CLI for machine parsing.
- Different spec/task semantics between CodeMachine workflow templates and this pipeline’s ExecutionTask DAG.
- Authentication and engine selection differences (CLI-based engines vs HTTP provider manifests).

### Overall Feasibility

**Medium**. Integration is viable but requires a careful adapter boundary that isolates CLI execution from ExecutionTask tracking, plus a spec-to-workflow mapping layer.

## Adapter Design (Proposed)

### High-Level Responsibilities

1. **Input mapping**: Translate pipeline spec/plan outputs into CodeMachine CLI inputs (spec file + workspace layout).
2. **Execution invocation**: Run `codemachine start` or `codemachine step` with pinned engine.
3. **Lifecycle tracking**: Update `ExecutionTask` status based on CLI exit codes and log parsing.
4. **Artifact capture**: Persist relevant outputs (logs, patches, summaries) into run directory.

### Adapter Components

**1) CodeMachineRunner**

- Responsible for CLI invocation, environment setup, and log streaming.
- Inputs: `runDir`, `workspaceDir`, `specPath`, `engine`, `model`, `command`.
- Output: `exitCode`, `stdout`, `stderr`, `durationMs`, `artifacts`.

**2) TaskMapper**

- Maps `ExecutionTaskType` to CodeMachine workflows/steps.
  - Example: `CODE_GENERATION` -> `codemachine start`
  - Example: `VALIDATION` -> existing `AutoFixEngine` (keep native)

**3) QueueCoordinator**

- Initializes queue from plan.
- Appends CodeMachine-driven tasks or wraps CodeMachine run as a single top-level task.

**4) ResultNormalizer**

- Parses CLI output to detect success/failure and extract summary.
- Stores sanitized logs in run directory and updates `last_error` when needed.

## Step-by-Step Implementation Plan

1. **Define execution wrapper**
   - Add a `CodeMachineRunner` utility in `src/workflows/` or `src/adapters/` that uses `child_process.spawn` with timeout and env controls.
   - Reuse process patterns from `autoFixEngine.ts` and `contextAggregator.ts`.

2. **Create adapter entrypoint**
   - Introduce `src/workflows/cliExecutionEngine.ts` (or similar) that:
     - Loads plan
     - Enqueues tasks (or creates a single “codemachine-run” task)
     - Calls `CodeMachineRunner`
     - Updates `ExecutionTask` status with `updateTaskInQueue`

3. **Add task lifecycle telemetry**
   - Emit `ExecutionLogWriter.taskStarted/taskCompleted/taskFailed` around CLI execution.
   - Record queue depth and lifecycle metrics.

4. **Wire plan -> queue**
   - Add a small bridge from `taskPlanner` output to `queueStore` initialization.
   - Ensure queue state is compatible with resume and validation.

5. **Auth and engine pinning**
   - Add configuration to select CodeMachine engine/CLI and set env vars.
   - Fail fast if `codemachine` CLI is missing.

6. **Output normalization and artifacts**
   - Store CLI stdout/stderr in run dir.
   - Optional: parse for structured markers or add a `CODEMACHINE_PLAIN_LOGS=1` setting to normalize logs.

7. **Update documentation**
   - Document new engine adapter and expected CLI outputs.

## Code Patterns to Follow

```ts
// Pseudocode: CLI runner using existing patterns
const childProcess = spawn(command, args, {
  cwd: workspaceDir,
  env: { ...process.env, CODEMACHINE_PLAIN_LOGS: '1' },
  shell: false, // CRITICAL: Set to false to prevent command injection
  timeout: options.timeout,
});
```

## Things to Avoid

- Writing to run directory directly without using `runDirectoryManager` helpers.
- Assuming CodeMachine CLI output is JSON without validation.
- Embedding auth credentials in configs; rely on CodeMachine’s auth flow or environment variables.

## Open Questions

- Do you want CodeMachine CLI to drive the full pipeline, or only code generation steps?
- Should tasks be mapped 1:1 to CodeMachine steps, or run CodeMachine as a single black-box task?
- Do you want to align the spec formats between this repo and CodeMachine CLI, or keep separate adapters?

## Sources

- `src/core/models/ExecutionTask.ts`
- `src/workflows/queueStore.ts`
- `src/workflows/resumeCoordinator.ts`
- `src/persistence/runDirectoryManager.ts`
- `src/telemetry/executionMetrics.ts`
- `src/telemetry/logWriters.ts`
- `src/workflows/autoFixEngine.ts`
- `docs/requirements/execution_flow.md`
- https://github.com/moazbuilds/CodeMachine-CLI
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/cli-reference.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/architecture.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/customizing-workflows.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/specification-schema.md
